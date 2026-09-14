/**
 * In-process TTL cache (T6.10, ADR D-030) — the app's one caching primitive.
 * Scope: a single function instance. On Vercel Fluid Compute instances are
 * reused across concurrent requests, so warm instances get real hit rates; a
 * cold instance simply misses. No external store, nothing to invalidate
 * across instances — which is exactly why only tolerant-of-staleness reads
 * may use it (portfolio aggregates, search results, guide config/FAQ
 * replies). Never cache: audited responses (exports/FHIR), badge counts,
 * or anything a user's own mutation must reflect instantly.
 */

type Entry<V> = { value: V; expiresAt: number };

const MAX_ENTRIES = 500;

export class TtlCache<V = unknown> {
  private store = new Map<string, Entry<V>>();
  private inflight = new Map<string, Promise<V>>();

  get(key: string): V | undefined {
    const e = this.store.get(key);
    if (!e) return undefined;
    if (Date.now() >= e.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return e.value;
  }

  set(key: string, value: V, ttlMs: number): void {
    if (this.store.size >= MAX_ENTRIES && !this.store.has(key)) {
      // evict oldest-inserted (Map preserves insertion order)
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  /**
   * Cached value if fresh, else runs `fn` — concurrent callers with the same
   * key share one in-flight computation (no stampede on a cold key).
   * A failed compute caches nothing; the next call retries.
   */
  async getOrCompute(key: string, ttlMs: number, fn: () => Promise<V>): Promise<V> {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    const running = this.inflight.get(key);
    if (running) return running;
    const p = (async () => {
      try {
        const value = await fn();
        this.set(key, value, ttlMs);
        return value;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, p);
    return p;
  }

  /** drop every key starting with `prefix` (empty prefix clears all) */
  invalidate(prefix = ""): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }

  get size(): number {
    return this.store.size;
  }
}

/** shared instance for app-wide response caching (keys are namespaced) */
export const appCache = new TtlCache();
