# AyuSphere — UI/UX Audit (all 7 roles)

Audit of the live application (deployed build + tablet screen recording +
per-role code walkthrough of `src/lib/nav.ts`, `dashboardVariant`, and every
page). Each finding is marked **✔ fixed (T6.4)** — shipped with this audit —
or **→ recommended** for a later pass.

---

## 1. Global findings

| # | Finding | Severity | Status |
|---|---|---|---|
| G1 | **Congested sidebar** — one flat, unsectioned list: admin 17 items, PI 13, coordinator 11; rows 44px + 3-line footer (~90px); on tablets the list is cut off behind an invisible custom scrollbar (visible in the user's recording: everything below "AI Assistant" hidden) | High | ✔ fixed — grouped sections (Overview / Study Conduct / Data Capture / Safety & Quality / Intelligence / System) for roles with > 6 items, compact rows (py-2), one-line footer; sparse roles keep a clean flat list |
| G2 | **No mobile navigation** — the sidebar is `max-md:hidden` with no alternative: on phones users literally cannot leave the current page | High | ✔ fixed — topbar hamburger (`md:hidden`) opens a slide-in drawer rendering the same grouped nav with live badges |
| G3 | **Dead search box** — the topbar input had a placeholder and no behavior (a misleading affordance judges will try) | Medium | ✔ fixed — RBAC-scoped quick-jump: role's screens by label, trials by protocol code/title, participants by subject code; Enter opens the first match |
| G4 | **Adverse Events page overload** — capture form + signals panel + open-AE list (with PV actions) + NPvCC ADR intake stacked in one scroll | Medium | ✔ fixed — link-based tabs: **Open AEs** (default) / **Capture** / **Safety Signals** / **NPvCC ADRs**; per-tab data loads only when shown |
| G5 | Admin dashboard is very long (13 stacked cards from the T10.5 leadership variant) | Low | → recommended: a two-column masonry for the queue cards, or collapse-by-default for charts the admin has already seen |
| G6 | Settings page mixes four concerns (AI model, alert rules, guide key, users) on one scroll | Low | → recommended: side-tabs within Settings |
| G7 | Trial detail page is long (KPIs, milestones, docs, consent register, amendments) | Low | → recommended: anchor sub-nav or tabs, same pattern as Adverse Events |
| G8 | Toast system polls every 1.2s (messages) / 2s (alerts) — chatty on mobile data and serverless invocations | Low | → recommended: back off to 5–10s when the tab is hidden; piggyback on the 15s badge poll |
| G9 | Monitoring page stacks 4 dense cards (visits, queries, per-trial performance, deviations) | Low | → recommended: same tab pattern if monitor feedback agrees |

## 2. Per-role walkthrough

### Principal Investigator (13 nav items → now 6 sections)
- **Strengths:** tailored dashboard leads with the signing queue + open data queries (T10.5); signing flows carry the e-signature meaning inline; Doctor Note pipeline has clear staged UI.
- **Fixed here:** sidebar sectioning (their Study Conduct block is the busiest in the app); quick search jumps straight to a trial or subject code.
- **Recommended:** visit page entry rows get heavy once queries + signatures + threads stack (G7-adjacent).

### Study Coordinator (11 items → sections)
- **Strengths:** dashboard = today's visits + open queries; enrol flow is one-click per stage with the randomization arm assigned automatically.
- **Fixed here:** sidebar sections; participant quick-jump by subject code (their most common lookup).

### Monitor (4 items — flat list, correctly)
- **Strengths:** single Monitoring workspace covers visits, queries, performance, findings.
- **Fixed here:** nothing needed on the sidebar (sparse list stays flat by design); search jumps to their screens.
- **Recommended:** G9.

### Ethics Committee (3 items — flat)
- **Strengths:** the two queues (IEC review + amendments) are the whole surface; decisions are two clicks with an enforced comment on return.
- **Fixed here:** trial search routes ethics to `/ethics` (they cannot open `/trials/[id]`).

### Pharmacovigilance (6 items — flat)
- **Strengths:** deadline-ordered safety portfolio with live escalation clocks; signed reporting; DSMB summary.
- **Fixed here:** **G4** — their main page was the most overloaded in the app; now Open AEs / Capture / Signals / NPvCC ADRs tabs (guide knowledge updated to the new click paths).

### Administrator (17 items → all six sections)
- **Strengths:** full portfolio dashboard; live badges across messages/alerts/AEs/ethics.
- **Fixed here:** **G1** hits admin hardest — sectioned sidebar restores scannability; System (Audit/Settings) sits last, matching frequency of use.
- **Recommended:** G5, G6.

### Regulator (3 items — flat)
- **Strengths:** genuinely read-only everywhere (same components, mutations stripped); audit browser front and center.
- **Fixed here:** search offers only their three screens — no data buckets leak (test-pinned).

## 3. Interaction & consistency notes (kept, by design)

- One font / two sizes (D-008), glass-chrome + clay-content (D-007), and the fixed motion vocabulary (D-009) are applied consistently — the new nav sections, drawer, search dropdown, and tabs reuse the same tokens (`microlabel`, `clay`, `sheetSlide`-style motion).
- Status colors stay semantic (danger = overdue/SAE only) across all roles.
- Every new surface respects `prefers-reduced-motion` (drawer falls back to fade).

## 4. Verification

- `tests/nav.test.ts` (grouping = RBAC-exact, header threshold, admin/regulator shapes) and `tests/search.test.ts` (RBAC buckets, caps, short-query guard) — part of `pnpm verify`.
- `scripts/e2e-ui-sweep.ts` — Playwright against the deployed site: all 7 roles screenshot with their sidebar variant, 390px mobile drawer navigation, quick-search jump, AE tab switching.
