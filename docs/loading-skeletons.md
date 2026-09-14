# Loading Skeletons — Analysis & Implementation (T6.11)

## 1 · The problem

Every screen in AyuSphere's `(app)` group is a **dynamic server component**: the page function runs its database queries on the server *before* any HTML is produced (that is what makes the data trustworthy — nothing renders that RBAC hasn't checked). The cost is navigational: in the Next.js App Router, when a user clicks a sidebar link the browser **keeps showing the old page, completely frozen**, until the new page's server render arrives.

Measured on the deployed site (Playwright, `verify-cache.mjs`): a dashboard navigation takes **~500ms on a warm cache and ~1000–1100ms cold**. For that entire window there was no spinner, no skeleton, no visual acknowledgment — the click *feels* ignored. A judge clicking through seven roles' screens crosses that gap dozens of times.

Two different problems hide in that gap, and they need two different tools:

| Problem | Tool | Status |
|---|---|---|
| The server genuinely takes long | Response caching (T6.10, ADR D-030) | shipped — halved warm-path renders |
| The wait is *invisible* — no feedback between click and paint | **Loading skeletons** | this change |

Caching cannot finish the job alone: cold instances miss the cache, first visits are always uncached, and even 500ms of frozen UI reads as lag. Perceived performance research consistently shows that *acknowledged* waits feel dramatically shorter than unacknowledged ones — the skeleton's job is acknowledgment, not speed.

## 2 · How App Router loading UI works

`loading.tsx` is the App Router's built-in mechanism: placing one in a route segment wraps that segment's page in an automatic **Suspense boundary**. On navigation, the router paints the loading component **instantly** (it's static, prefetched with the route) while the server render streams in behind it; React then swaps in the real page.

Placement is hierarchical, and we exploit that:

- **`src/app/(app)/loading.tsx`** — a route-*group* level file. One file covers **every page in the group** (dashboard, trials, participants, visits, AEs, monitoring, ethics, exports, audit, settings, …). Any navigation inside the app shell now paints immediately.
- **`src/app/(app)/dashboard/loading.tsx`** — a segment-level override. The dashboard is the most-visited and heaviest page (seven parallel aggregate queries), so it gets a skeleton with **shape parity**: the fallback mimics the real layout (greeting → stat-tile grid → two chart cards), so when real content lands, elements appear *in place* instead of jumping — minimal cumulative layout shift (CLS).

No page code changes at all: the pages keep their query-then-render structure; the framework provides the interleaving.

## 3 · Design decisions

1. **Design-system compliance is enforced, not promised.** Skeleton primitives (`src/components/app/skeleton.tsx`) are built from the same tokens as the app: `clay` card surfaces (D-007), the `--color-line` token (`bg-line/60`) for shimmer bars, and **no text-size utilities anywhere** — bars are sized with `h-*`/`w-*`, so the D-008 "two text sizes" rule can't be violated. The design-qa static test suite scans these files like any other component; a violation fails `pnpm verify`.
2. **Shimmer = `animate-pulse`, opacity-only.** Tailwind's pulse animates opacity, not position — nothing moves, so users with `prefers-reduced-motion` see a gentle fade rather than motion sickness triggers. Precedent already existed in the codebase (the breached escalation clock pulses).
3. **Accessibility.** The fallback root carries `role="status"`, `aria-label="Loading"`, and `aria-busy="true"` — screen readers announce the loading state once instead of reading a page of meaningless gray boxes; the individual bars are `aria-hidden`.
4. **Coarse by default, precise where it pays.** The group-level skeleton is deliberately generic (title bar + three card shells). Over-detailed skeletons are a maintenance trap: every layout tweak makes them lie, and a wrong-shaped skeleton is worse than a generic one. Only the dashboard earns shape parity, because its layout is stable and its traffic is highest.

## 4 · What deliberately does NOT get a skeleton

- **The login page** — a single small form with no data dependencies; it renders near-instantly, and a skeleton flash would only add noise.
- **API routes** — machine consumers; loading UI is meaningless there.
- **In-page mutations** (approve, capture, schedule…) — server actions re-render the same page in place; the right pattern there is a pending state on the button itself, not a whole-page skeleton. Separate concern, out of scope here.
- **The Sphera panel** — already has its own streaming indicator; tokens appearing progressively *is* its loading state.

## 5 · Trade-offs and limits (stated honestly)

- **Skeletons change perception, not speed.** Server time is identical; the T6.10 cache is what changed actual latency. The pair is the complete answer.
- **The flash problem:** on very fast responses (warm cache, ~300ms) the skeleton appears for a blink before content replaces it. Alternatives (delaying the skeleton ~150ms) trade a flash for a return of the frozen-click feeling; for a demo app, instant feedback wins and the flash is accepted.
- **Skeletons can rot.** If a page's layout changes materially, a shape-parity skeleton misleads. Mitigation: only the dashboard has a precise skeleton; everything else uses the generic shape that cannot rot.

## 6 · Files

| File | Role |
|---|---|
| `src/components/app/skeleton.tsx` | `Skeleton` (one shimmer bar) + `SkeletonCard` (clay card shell) primitives |
| `src/app/(app)/loading.tsx` | Generic instant fallback for every app-group route |
| `src/app/(app)/dashboard/loading.tsx` | Dashboard shape-parity fallback (stat grid + chart shells) |

## 7 · Verification

- `pnpm verify` — design-qa statically checks the new components (text sizes, hex colors, blur rules); full suite green.
- `pnpm build` — the loading files compile into the route tree (visible as Suspense boundaries).
- Live (Playwright): delay the navigation request ~2s via route interception, click a sidebar link, screenshot mid-navigation — the skeleton is visible, then the real page replaces it.
