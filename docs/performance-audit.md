# Performance Audit — 14-Item Checklist, Code-Verified (T6.12)

A generic web-performance checklist was triaged against what AyuSphere actually is: a
Next.js 16 App Router app of ~90% **server components** on Vercel (Fluid Compute) with
Neon Postgres. Every verdict below was verified in the codebase or measured live — not
assumed. Result: **3 accepted, 11 rejected as already handled or not applicable.**

## Lighthouse baseline (item 6, measured 14 Sep 2026)

`https://ayusphere-three.vercel.app/login` · Lighthouse 13.4.1, headless Chromium:

| Category | Score |
|---|---|
| Performance | **98** |
| Accessibility | **100** |
| Best practices | **100** |
| SEO | **100** |

Command (rerun any time): `pnpm dlx lighthouse https://ayusphere-three.vercel.app/login --output=html --view`
(only the login page is auditable unauthenticated; the app pages behind login are
server-rendered with the same design system, plus the T6.10/T6.11 speed work).

## Verdict table

| # | Item | Verdict | Evidence |
|---|---|---|---|
| 1 | Debounce input handlers | ❌ already done | Quick-search debounces at 250ms (`quick-search.tsx:51`); MedDRA/WHODrug pickers filter locally — no network per keystroke anywhere |
| 2 | Split code into chunks | ❌ framework does it | App Router splits per route automatically; heavy `recharts` ships only on chart pages; image-prep is already `import()`-ed on demand (`messages-client.tsx:213`) |
| 3 | Add CDN | ❌ platform does it | Vercel's edge network **is** the CDN — static assets are fingerprinted and cached immutable at the edge |
| 4 | Server-side caching | ❌ already shipped | T6.10 / ADR D-030: aggregates 45s, search 60s, Sphera config + fresh-thread replies; audited endpoints deliberately `no-store` |
| 5 | Paginate large pages | ❌ already bounded | Every list is capped: audit 100 (max 500, `audit-browser.ts:32`), visits 150, documents 100, queries 50, monitoring 50 — at ~60 participants, pagination UI would be premature |
| 6 | Lighthouse audit | ✅ **done** | Scores above; JSON artifact in `.uat-build/` |
| 7 | Compress API payloads | ❌ platform does it | Vercel applies gzip/brotli to every response automatically |
| 8 | N+1 database queries | ❌ mitigated, not worth rewrite | One real case: Monitoring loops per-trial (perf + data-quality) — now behind the 45s cache; a grouped-query rewrite buys microseconds at 6 trials. `exportRowCounts` was already written as one grouped query |
| 9 | Unnecessary rerenders | ❌ not applicable | ~90% server components; client islands (forms, toasts, badges) are tiny — no measurable rerender cost exists |
| 10 | Minify JS and CSS | ❌ built-in | `next build` (Turbopack) minifies by default |
| 11 | Lazy loading | ✅ **implemented** | Zero `loading="lazy"` existed; added `loading="lazy" decoding="async"` to all four blob `<img>`s: chat attachments, Extractions gallery, preview modal, doctor-note preview — off-screen ~1MB scans no longer download eagerly |
| 12 | Defer non-critical scripts | ❌ nothing to defer | Zero third-party scripts (no analytics/trackers); Next defers its own bundles |
| 13 | Unused dependencies | ✅ **implemented** | `swr` and `date-fns` were installed but **never imported** (grepped `src/`, `scripts/`, `tests/`) — removed from package.json. Also fixed the factual error this exposed: the Tech & Security Guide credited SWR for live badges; they use plain `fetch` + a `refreshBadges` event. Guide corrected and PDF regenerated |
| 14 | DB connection pooling | ❌ triple-covered | Neon serverless driver uses a WebSocket `Pool` (`src/db/index.ts:32`), `getDb()` is a warm-instance singleton, and Neon's pgbouncer pooler fronts Postgres |

## Why most items don't apply here (the architectural reason)

Generic checklists assume a client-heavy SPA: big JS bundles, client-side data fetching,
long lists rendered in the browser. AyuSphere inverted that: pages are **server
components** (data never leaves the server unrendered), the client ships only small
interactive islands, and the platform (Vercel + Neon) owns transport concerns —
compression, CDN, minification, pooling, code splitting. The performance levers that
actually mattered were therefore server-side and perceptual, and they were pulled in
order:

1. **T6.10 — response caching** (actual latency): warm dashboard render 1044ms → 502ms;
   repeat Sphera FAQ 1958ms → 276ms. With audit-integrity carve-outs (ADR D-030).
2. **T6.11 — loading skeletons** (perceived latency): every navigation paints instantly
   instead of freezing for the 500–1100ms server render.
3. **T6.12 — this audit**: lazy blob images, dead-dependency removal, measured baseline.

## Residual known costs (accepted, documented)

- Cold serverless instances miss the in-process cache (D-030 trade-off).
- Monitoring's per-trial loop is O(trials) queries on a cold cache — revisit with a
  grouped query only if trial count grows past ~20.
- `audit_events` grows forever; its first real fix is **indexing**
  (`(entity_type, entity_id)` + `(at desc)`), scheduled for when data volume warrants —
  the regulator's audit view must stay live, so caching is the wrong tool there.
