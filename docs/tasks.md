# AyuSphere — Task Board (test-gated)

Rule (D-020): a task is **done** only when its test gate passes (`pnpm test` green, `pnpm typecheck` clean). The next task starts only after the previous one is done. No Docker anywhere (D-019) — tests run on PGlite in-process Postgres.

Legend: ☐ pending · ◐ in progress · ✅ done (gate passed)

---

## Phase 0 — Foundation

| # | Task | Test gate | Status |
|---|---|---|---|
| T0.1 | Scaffold Next.js 15 + TS + Tailwind + pnpm; add Vitest, Drizzle, PGlite, deps; repo hygiene (`.env.example`, scripts) | Sanity spec passes; `pnpm typecheck` clean | ✅ |
| T0.2 | Design tokens: Plus Jakarta Sans, exactly 2 text sizes, color tokens, `.glass`/`.clay` utilities, `motion.ts` variants catalog | Token spec: globals define both sizes & all tokens; motion catalog exports validated | ✅ |
| T0.3 | Drizzle schema (all 15 tables) + generated SQL migration | Migration applies on PGlite; all tables + enums exist; participants table has no identifier columns | ✅ |
| T0.4 | Auth core: bcrypt hashing, credentials `authorize()`, JWT role claim, RBAC permission matrix | Hash/verify roundtrip; authorize accepts valid / rejects invalid+inactive; RBAC matrix spec (regulator has zero mutations) | ✅ |
| T0.5 | Deterministic seed script (7 role users, trials, sites, participants, visits, planted demo moments) | Seed runs on PGlite; expected counts; determinism (two runs → same subject codes) | ✅ |

## Phase 1 — CTMS core (P0 part 1)

| # | Task | Test gate | Status |
|---|---|---|---|
| T1.1 | Trial lifecycle state machine (guards: ethics gate, CTRI gate) | Every legal transition allowed, every illegal rejected; active requires IEC approval + CTRI number | ✅ |
| T1.2 | Audit wrapper `withAudit()` + trial service (create/transition) | PGlite: create writes trial + audit row atomically; failed action writes nothing; invalid transition rejected & unaudited | ✅ |
| T1.3 | Site service: registry, trial-site attach, activation | Activation timestamps + audits; enrolment blocked at inactive site | ✅ |
| T1.4 | Participant service: generated subject codes, screening, consent, enrolment guards, withdrawal | Code format `AYU-<n>-P-<seq>`; enrolment refused without consent/eligibility/active trial; withdrawal cancels visits | ✅ |
| T1.5 | Visit engine: schedule generation from protocol offsets, window math, status transitions | Window boundaries exact (± days); upcoming→due→overdue→missed transitions on clock changes | ✅ |
| T1.6 | CRF templates → runtime Zod factory + entry service (draft/submit/approve, versioned corrections) | Factory enforces range/required/unit; approved entry immutable — correction creates linked new version | ✅ |
| T1.7 | App shell UI: glass sidebar/topbar, login page, role-gated navigation, dashboard shells | `pnpm build` succeeds; RBAC nav spec (regulator sees no mutating routes) | ✅ |

## Phase 2 — Safety + Doctor Note AI (P0 part 2)

| # | Task | Test gate | Status |
|---|---|---|---|
| T2.1 | Deadline engine (seriousness-based rule table → reporting deadline) | SAE 24h/14d representative rules computed exactly; configurable table honored | ✅ |
| T2.2 | AE service: capture, `ae_actions` timeline, PV review flow, deadline set at insert | PGlite: insert sets deadline + first action; status walk appends actions; all audited | ✅ |
| T2.3 | Alerts rules engine: write-time evaluation + sweep; idempotency; auto-resolve | One open alert per (rule, entity); resolves when condition clears; overdue-visit sweep raises deviation | ✅ |
| T2.4 | Extraction pipeline (mock Claude client): quality gate, template-shaped extraction, Zod parse, confidence gating, approval → CRF entry with provenance | Low-quality rejected with reason; low-confidence fields block approval until touched; approval creates `source=extraction` entry linked to extraction; invalid AI output never approvable | ✅ |
| T2.5 | KPI query layer (enrolment vs target, dropout, site performance, open AEs) | PGlite: seeded data returns exact expected numbers | ✅ |
| T2.6 | Safety + Doctor Note UI: AE pages, escalation clock component, upload → review screen | `pnpm build` succeeds; clock threshold logic spec (amber/red bands) | ✅ |

## Phase 3 — Intelligence (P1)

| # | Task | Test gate | Status |
|---|---|---|---|
| T3.1 | Data-quality + protocol-deviation rule set | Duplicate/impossible/missing-value fixtures each flagged; clean data not flagged | ✅ |
| T3.2 | Copilot retrieval whitelist (RBAC-scoped functions) + grounded answer assembly (mock Claude) | Retrieval respects role scope; empty retrieval → decline, no model call with fabricated context; citations map to real ids | ✅ |
| T3.3 | Recruitment analytics: velocity, projected completion, site risk banding | Fixture sites produce expected velocity/risk bands | ✅ |
| T3.4 | Copilot + analytics UI | `pnpm build` succeeds | ✅ |

## Phase 4 — Interoperability + polish (P2)

| # | Task | Test gate | Status |
|---|---|---|---|
| T4.1 | FHIR R4 mappers (ResearchStudy, ResearchSubject, Patient de-identified, AdverseEvent) | Bundles validate against structural specs; no identifier fields in Patient | ✅ |
| T4.2 | SDTM DM/AE CSV + Define-XML stub | Column sets match domain specs; seeded trial exports expected rows | ✅ |
| T4.3 | Regulator read-only pass + audit browser | Every mutation service refuses regulator; audit query filters correct | ✅ |
| T4.4 | Design QA sweep: 2-text-sizes rule, token-only colors, reduced motion, shared UX states | Static spec: no forbidden Tailwind text-size classes in `src/`; build passes | ✅ |

## Phase 5 — Full CTMS UI (all nav routes implemented)

| # | Task | Test gate | Status |
|---|---|---|---|
| T5.1 | Trials list + create + detail (lifecycle actions, KPIs, site risk bands, milestones) | `pnpm build` + full suite green | ✅ |
| T5.2 | Ethics review queue (approve/return) + approved registry | `pnpm build` + full suite green | ✅ |
| T5.3 | Participants: add → screen → consent → enrol → withdraw, full table | `pnpm build` + full suite green | ✅ |
| T5.4 | Sites: registry, trial attach, activation | `pnpm build` + full suite green | ✅ |
| T5.5 | Visits: swept schedule + per-visit e-CRF entry (draft/submit/approve) + complete | `pnpm build` + full suite green | ✅ |
| T5.6 | Monitoring: site performance, data-quality findings, deviation alerts | `pnpm build` + full suite green | ✅ |
| T5.7 | Documents: versioned upload (Blob or data-URL fallback) + library | `pnpm build` + full suite green | ✅ |
| T5.8 | Settings: user create/deactivate (audited) | `pnpm build` + full suite green | ✅ |
| T5.9 | Dashboard: live portfolio KPIs with role-aware click-throughs | `pnpm build` + full suite green | ✅ |
