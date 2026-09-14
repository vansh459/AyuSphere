/** T6.10 — the in-process TTL cache behind response caching (ADR D-030). */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TtlCache } from "@/lib/ttl-cache";

describe("TtlCache", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns cached values within TTL and expires them after", () => {
    const c = new TtlCache<string>();
    c.set("k", "v", 1_000);
    expect(c.get("k")).toBe("v");
    vi.advanceTimersByTime(999);
    expect(c.get("k")).toBe("v");
    vi.advanceTimersByTime(2);
    expect(c.get("k")).toBeUndefined();
  });

  it("getOrCompute: computes once, then serves the cache", async () => {
    const c = new TtlCache<number>();
    const fn = vi.fn(async () => 42);
    expect(await c.getOrCompute("n", 1_000, fn)).toBe(42);
    expect(await c.getOrCompute("n", 1_000, fn)).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("getOrCompute: concurrent callers share one in-flight compute", async () => {
    const c = new TtlCache<number>();
    let calls = 0;
    const slow = () =>
      new Promise<number>((resolve) => {
        calls += 1;
        setTimeout(() => resolve(7), 50);
      });
    const [a, b] = [c.getOrCompute("k", 1_000, slow), c.getOrCompute("k", 1_000, slow)];
    await vi.advanceTimersByTimeAsync(60);
    expect(await a).toBe(7);
    expect(await b).toBe(7);
    expect(calls).toBe(1);
  });

  it("a failed compute caches nothing — the next call retries", async () => {
    const c = new TtlCache<number>();
    const fn = vi
      .fn<() => Promise<number>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(9);
    await expect(c.getOrCompute("k", 1_000, fn)).rejects.toThrow("boom");
    expect(await c.getOrCompute("k", 1_000, fn)).toBe(9);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("invalidate drops by prefix", () => {
    const c = new TtlCache<number>();
    c.set("guide:a", 1, 10_000);
    c.set("guide:b", 2, 10_000);
    c.set("search:a", 3, 10_000);
    c.invalidate("guide:");
    expect(c.get("guide:a")).toBeUndefined();
    expect(c.get("guide:b")).toBeUndefined();
    expect(c.get("search:a")).toBe(3);
  });

  it("caps entries by evicting the oldest-inserted", () => {
    const c = new TtlCache<number>();
    for (let i = 0; i < 501; i++) c.set(`k${i}`, i, 60_000);
    expect(c.size).toBe(500);
    expect(c.get("k0")).toBeUndefined(); // the first inserted was evicted
    expect(c.get("k500")).toBe(500);
  });
});
