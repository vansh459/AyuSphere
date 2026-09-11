# AyuSphere — Development Plan

**Project:** AyuSphere — AI-assisted Clinical Research Intelligence Platform for Ayurveda
**Problem statement:** SIH26046 (AIIA Clinical Trials Dashboard — real-time, cloud-based, GCP-compliant CTMS) · **Team:** Bob The Builder

This is the master plan. It links to the rest of the suite:

| Doc | Contents |
|---|---|
| [architecture.md](architecture.md) | System design, database schema, lifecycle state machine, RBAC, audit, AI pipelines |
| [technology.md](technology.md) | Full stack + versions, design system (1 font / 2 sizes, glass+clay, motion), repo layout |
| [workflow.md](workflow.md) | Every end-to-end application flow, actor by actor, plus the judge-facing demo storyline |
| [decisions.md](decisions.md) | ADR log — every decision with alternatives, rationale, consequences (D-001…D-018) |

Source requirements: `Sih26046txt.txt` (official PS), `46sihfeature.pdf` (feature tiers + MVP priorities), `AyuSphere_SIH2026.pdf` (submitted idea deck).

---

## 1. Goal

Build a deployable CTMS + analytics platform that a judge can score top marks on the PS's own four evaluation axes:

1. **Data accuracy & integrity** → template-driven validation, ALCOA+ append-only audit trail, versioned corrections
2. **Timeliness of safety & regulatory reporting** → AE/SAE escalation clock, milestone (CTRI/ethics) due alerts
3. **Interoperability conformance** → real FHIR R4 bundle + SDTM DM/AE export a judge can open
4. **Access-control & audit completeness** → 7 enforced roles, regulator read-only view, filterable audit browser

Differentiation on top of compliance (never instead of it): **Doctor Note Intelligence** (image → structured CRF draft → validation → doctor approval → auditable record) and the **evidence-linked AI Copilot**.

## 2. Fixed constraints (from the user + ADRs)

- Next.js (App Router) + TypeScript full-stack monolith — no separate backend (D-001)
- Neon Postgres + Drizzle (D-002, D-003) · Auth.js v5 credentials/JWT (D-004)
- Claude API for OCR/extraction + Copilot — no Python service (D-005)
- shadcn/ui, glassmorphism + claymorphism with strict usage rules (D-006, D-007)
- **One font (Plus Jakarta Sans), exactly two font sizes**, 8-pt spacing, minimalist (D-008)
- Framer Motion, Airbnb-style motion vocabulary (D-009)
- Synthetic data only, deterministic seed (D-016)

## 3. Scope by priority (from the feature plan's MVP table)

| Priority | Feature set | Plan phase |
|---|---|---|
| **P0** | Role-based auth · trial/site/participant management · visit scheduling · e-CRFs · dashboard KPIs · AE/SAE capture + deadline clock · Doctor Note image→CRF with approval · audit trail | Phases 1–2 |
| **P1** | Protocol-deviation + data-quality rules · AI Copilot with cited answers · recruitment/site risk indicators | Phase 3 |
| **P2** | FHIR R4 + SDTM export subset · what-if simulator · cross-trial analytics | Phase 4 (export in-scope; simulator/cross-trial = stretch) |

**Out of scope for the hackathon build** (stated honestly in the demo): live EDC/HIS integration, licensed full MedDRA/WHODrug dictionaries (bundled demo subsets instead), ADaM datasets, websockets, production data-resident hosting (documented caveat, D-002/D-014).

## 4. Phases & milestones

Estimates assume a 6-person SIH team; workstreams within a phase run in parallel.

> **Execution rule (D-020):** each phase is broken into test-gated tasks in [tasks.md](tasks.md) — a task is done only when its minimum tests pass (`pnpm test` + typecheck), and only then does the next task start. **No Docker anywhere** (D-019): dev = `pnpm dev` + Neon branch; tests = PGlite in-process Postgres.

### Phase 0 — Foundation (days 1–2)
- Scaffold Next.js + TS + Tailwind + shadcn; pnpm; ESLint/Prettier
- Neon project + Drizzle schema (all tables from architecture.md §3) + first migration
- Auth.js credentials flow, JWT role claim, route middleware
- Design tokens: typography (2 sizes), colors, `.glass`/`.clay` utilities, `motion.ts` variants catalog
- Seed script v1: 7 role users + 2 trials + sites/participants
- **Exit criteria:** login as any role → role-correct empty dashboard shell, deployed on Vercel preview

### Phase 1 — CTMS core, P0 part 1 (days 3–6)
- Trial CRUD + lifecycle state machine with ethics/CTRI gates
- Site registry + trial-site activation; participant management (generated subject codes, screening, consent, enrolment, withdrawal)
- Visit schedule generation, window computation, due/overdue statuses
- CRF templates (JSONB fields → runtime Zod) + manual e-CRF entry with draft/submit/approve versioning
- `withAudit()` wrapper live on every mutation; audit browser v1
- **Exit criteria:** full manual journey — create trial → ethics approve → CTRI → activate site → enrol → complete visit with CRF — with every step visible in the audit browser

### Phase 2 — Safety + the signature AI flow, P0 part 2 (days 7–10)
- AE/SAE capture, deadline engine, escalation clock component, PV dashboard + `ae_actions` timeline
- Alerts engine: write-time evaluation + Vercel cron sweep; bell + `/alerts` + inline surfacing
- **Doctor Note Intelligence end to end** (workflow.md §6): upload → quality gate → Claude extraction against the active CRF template → validation incl. cross-document consistency → side-by-side review with confidence heatmap → approval → provenance
- Dashboard KPIs + charts (Recharts), SWR polling, count-up numerals, staggered entry
- Seed v2 with planted demo moments (near-deadline SAE, lagging site, dose contradiction)
- **Exit criteria:** demo storyline steps 1–3 run clean (workflow.md §15)

### Phase 3 — Intelligence, P1 (days 11–13)
- Data-quality + protocol-deviation rule set wired into alerts and trial quality panel
- AI Copilot: whitelisted RBAC-scoped retrieval functions → grounded, citation-linked answers; query logging
- Recruitment analytics: velocity vs target, site risk indicators (rule-based; labeled decision support)
- **Exit criteria:** Copilot answers "which sites are behind target?" with correct citations under two different roles' scopes

### Phase 4 — Interoperability + polish, P2 (days 14–15)
- FHIR R4 bundle export + SDTM DM/AE CSVs + Define-XML stub; export audit
- Regulator read-only pass across all pages; permission-denied logging
- Motion/design QA sweep (only 2 text sizes, token-only colors, reduced-motion), empty/loading/error states everywhere
- Full demo dry-run against workflow.md §15; fix list; final seed
- **Exit criteria:** all four evaluation axes demonstrable in under 8 minutes

## 5. Team workflow

- **Git:** trunk-based; short-lived feature branches → PR → Vercel preview (own Neon branch) → squash-merge to `main` (auto-deploys production demo).
- **PR rules:** must not contradict an ADR (amend decisions.md first — D-018); mutations without `withAudit()` are a blocker; UI introducing a third font size or ad-hoc shadows/blur is a blocker.
- **Environments:** local (`.env.local`, shared Neon dev branch) → preview (per-PR) → production (demo instance, always seeded & demo-ready).
- **Suggested split (6 people):** 1 — design system + shell + dashboards; 2 — trials/sites/participants/visits; 3 — CRF templates + entry + validation; 4 — AI (extraction pipeline + Copilot); 5 — AE/alerts/rules engine; 6 — auth/RBAC/audit/exports + seed data.

## 6. Verification & quality gates

- **Per phase:** exit criteria above, checked on the deployed preview, not localhost.
- **Domain unit tests** (the pure layer): lifecycle transition guards, visit-window math, deadline engine, alert idempotency, CRF Zod factory — these are the compliance-critical calculations.
- **E2E happy path** (Playwright, one spec): the demo storyline end to end, run in CI before merge to `main` in the final week.
- **Requirement trace:** every PS-named capability maps to a workflow.md section; spot-check before final submission.
- **AI safety checks:** extraction output that fails Zod is never shown as approvable; Copilot with empty retrieval must decline; both covered by fixture tests.

## 7. Risks (mirrors deck slide 4, with build-level mitigations)

| Risk | Mitigation in this plan |
|---|---|
| Handwriting extraction accuracy varies | Confidence heatmap + mandatory approval (Phase 2); quality gate rejects bad captures with a reason |
| AI hallucination in Copilot | Whitelisted retrieval only, citation-constrained answers, decline-on-empty (Phase 3) |
| Sensitive data / DPDP | Synthetic-only seed, no identifier columns in schema, private blobs (D-016) |
| Serverless timeout on vision calls | Single-call design, streaming responses, image size cap at upload |
| Scope blow-up | P0→P2 gates; simulator/cross-trial explicitly stretch; out-of-scope list stated up front |
| Demo fragility | Deterministic seed with planted moments; demo storyline is a tested E2E spec |

## 8. Immediate next steps

1. Phase 0 scaffold (`pnpm create next-app`, shadcn init, Drizzle + Neon connection)
2. Commit the design tokens + `.glass`/`.clay`/motion catalog before any feature UI
3. Schema migration + seed v1 → first Vercel preview with working login
