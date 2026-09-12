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

## Phase 6 — Real registry data (D-021)

| # | Task | Test gate | Status |
|---|---|---|---|
| T6.1 | Scrape real Ayurveda trial metadata from CTRI (crawl4ai, pip-only, polite sequential crawl of public trial views; CAPTCHA-gated search untouched) + `seedReal` integration: idempotent trial insert, CRF templates per visit-plan entry, sites from scraped states, milestones, synthetic participants (faker, deterministic) for first ~6 trials + `pnpm db:seed:real` CLI with Neon DNS workaround | `tests/seed-real.test.ts`: >0 trials, CTRI number format, template coverage (no template-less visits), synthetic-participant bounds (5-15, ≤6 trials), determinism, idempotency; `pnpm typecheck` + full suite + `pnpm build` green | ✅ |
| T6.2 | Sphera role-aware floating guide (Groq): knowledge base, prompt builder, SSE streaming route, leaf-orb widget, Settings card | 12 guide tests (slicing, drift-guard, SSE, settings audit hygiene) + full suite 202 green + build | ✅ |

---

**Phases 7–10 close the PS gaps identified in [gap-analysis.md](gap-analysis.md); designs in [gap-plan.md](gap-plan.md).**

## Phase 7 — Compliance quick wins (gap-plan Phase 7)

| # | Task | Test gate | Status |
|---|---|---|---|
| T7.1 | E-signatures (D-022): `signatures` table + `verifySigner`/`recordSignature` (bcrypt re-auth + SHA-256 payload hash, same transaction as the guarded mutation) on CRF approve/correct, extraction approve, AE report; signing UIs (password + meaning) + "Signed" chips; signature id/hash in the audit `after` snapshot | `tests/signatures.test.ts`: wrong/missing password refuses atomically; hash matches recomputation; signature+audit commit together; regulator cannot sign; AE reported requires signature | ✅ |
| T7.2 | Configurable alerts/deadlines (D-023): `alert_config` in `app_settings` (lag threshold, AE warning hours, milestone lookahead, monitoring cadence, deadline-rule table) + admin "Alerts & Deadlines" Settings card; `sweepAlerts` + AE capture read config with built-in defaults; saves audited `settings.alert_update` | `tests/alert-config.test.ts`: saved config changes sweep (lag, AE window, milestone lookahead) + deadline behaviour; malformed config rejected at save AND stored-malformed falls back to defaults; RBAC-guarded; audited | ✅ |
| T7.3 | Monitoring-visit workflow: `monitoring_visits` table, schedule/complete service on `monitoring.log` (completion advances `trial_sites.monitoringVisitDue` by the configured cadence), `monitoring_overdue` sweep rule, schedule/complete UI on `/monitoring` | `tests/monitoring.test.ts`: overdue due-date raises exactly one open alert (idempotent); completion resolves it + advances due date by configured cadence; coordinator refused; double-completion refused; inactive site refused; audited | ✅ |
| T7.4 | MedDRA/WHODrug demo-subset coding (D-024): bundled `src/lib/dictionaries/` subsets (140+ PT/SOC terms, 45 ASU formulations), NEW AE capture form on `/adverse-events` with datalist pickers (exact PT match auto-codes), code validation at capture, decoded chips in AE list, SDTM `AEDECOD` = decoded PT, FHIR coding `display` | `tests/dictionaries.test.ts`: subsets well-formed; search returns expected PTs; unknown code rejected at capture; SDTM AEDECOD shows decoded term (empty for uncoded); FHIR display present | ✅ |

## Phase 8 — Pharmacovigilance depth (gap-plan Phase 8)

| # | Task | Test gate | Status |
|---|---|---|---|
| T8.1 | Safety-signal aggregation: coded term×trial grouping with per-site breakdown + disproportionality flag (≥3 events, ≥2× portfolio share; `src/services/safety-signals.ts`), signals panel on `/adverse-events`, printable `/adverse-events/dsmb` summary (signals + timeliness stats + open SAE clocks; app chrome print-hidden) | `tests/safety-signals.test.ts`: planted cluster flagged (ratio exactly 2.25×), background + below-min-count not; site breakdown/SAE counts exact; coded events group by code with decoded PT, uncoded by verbatim term; timeliness on-time/late/open-overdue exact | ✅ |
| T8.2 | SAE regulatory report artifact: printable CIOMS-style `/adverse-events/[id]/report` (reaction, suspect formulation, study context, escalation timeline, deadline compliance); audited "Generate report" + full PV review actions (start review, SIGNED mark-reported per D-022) now on `/adverse-events` | `tests/ae-report.test.ts`: full timeline with actors + decoded terms + deadline delta assembled; unknown id throws; generation audited `ae.report_generated`; regulator views but cannot generate (zero audit rows) | ✅ |
| T8.3 | NPvCC spontaneous ADR intake (D-025, stretch — built): `suspected_adrs` table (no participant link, reporter role only), receive→assess→forward walk on `ae.review` (audited `adr.receive/assess/forward`), dictionary-coded intake card on `/adverse-events`, feeds the signal view as its own "NPvCC" series (report source = site breakdown) | `tests/adr-intake.test.ts`: RBAC + unknown codes refused; full walk audited, illegal moves refused; spontaneous reports aggregate under the NPvCC series (decoded term grouping, source breakdown) without touching trial groups | ✅ |

## Phase 9 — Interoperability depth (gap-plan Phase 9)

| # | Task | Test gate | Status |
|---|---|---|---|
| T9.1 | Real Define-XML: `defineXml(trial, templates)` replaces the stub — ItemDefs with DataType/Length/labels for every DM/AE variable (1:1 with CSV columns), CodeLists (NY, AESEV, COUNTRY) with decodes, one ItemGroup per CRF template with cdashVar-named typed unit-labeled ItemDefs, XML-escaped; export route feeds trial templates | extend `tests/exports.test.ts`: DM/AE metadata 1:1 with columns; every ItemRef→ItemDef and CodeListRef→CodeList resolves (no orphans); datatypes match semantics; CRF float/text/unit labels present; balanced-tag well-formedness + escaping | ✅ |
| T9.2 | ADaM ADSL export (`src/services/export/adam.ts` — STUDYID/USUBJID/SUBJID/SITEID/ARM/ARMCD/TRTSDT/EOSSTT/DCSREAS/SAFFL, pure projection): `/api/export?format=adsl` audited `export.adsl`, `/exports` tile, `IG.ADSL` Analysis ItemGroup + `CL.EOSSTT` in Define-XML | extend `tests/exports.test.ts`: exact column set, one row per subject (45), SAFFL ↔ enrolment consistent, withdrawn subject carries `EOSSTT=DISCONTINUED` + `DCSREAS`, ADSL metadata 1:1 with columns and resolves in Define-XML | ✅ |
| T9.3 | FHIR REST API + EDC import stub (D-026): authenticated audited `GET /api/fhir/{ResearchStudy,Bundle}/[id]` (`export.run`, regulator read via `audit.view`, `application/fhir+json`, audited `fhir.read`); `POST /api/fhir/import` — Observation bundle → **draft** CRF entry mapped by cdashVar/name through the visit's template (`src/services/fhir-import.ts`), audited `fhir.import` beside `crf.create`; ABDM narrative in architecture.md §11; endpoint URLs surfaced on `/exports` | `tests/fhir-api.test.ts` (service-level, PGlite): RBAC refused without `crf.enter`; malformed bundle/unknown/mixed subjects refused; out-of-range values fail the same Zod as manual entry with nothing written; valid bundle → draft (never approved) with cdashVar + text mapping, unmatched reported, both audit rows present; explicit visitId honored, foreign refused; no-match imports nothing | ✅ |

## Phase 10 — CTMS workflow completeness (gap-plan Phase 10)

| # | Task | Test gate | Status |
|---|---|---|---|
| T10.1 | Data-query management: `data_queries` + `data_query_messages` thread, new `query.manage` capability (monitor/admin), raise (monitor) → answer (coordinator/PI via `crf.enter`) → close; an OPEN query blocks CRF approval (before the signature check); raise/close + stats (open/answered/closed, median cycle days) on `/monitoring`, answer threads on `/visits/[id]` | `tests/data-queries.test.ts`: full raise→answer→close walk audited; approval refused while open then succeeds after answer (signed); coordinator cannot raise/close, monitor cannot answer; unknown/superseded entries refused; closed queries immutable; stats + labeled listing exact | ✅ |
| T10.2 | Randomization engine (D-027): `trials.arms` JSONB (armsSchema, default 1:1 Intervention/Control, unique names) + permuted-block allocator (`src/lib/rules/randomization.ts` — block = 2×∑ratio, Fisher–Yates over a per-(trial, block) seeded PRNG); `enrolParticipant` drops the free-text arm and records `{arm, blockIndex}` in the audit snapshot; arms editor on `/trials/new`, "Enrol & randomize" on `/participants` | `tests/randomization.test.ts`: every 1:1 block exactly 2+2; deterministic under fixed seed; 2:1 ratios exact over 60 allocations; legacy/malformed configs fall back to defaults; manual arm parameter gone; 4 PGlite enrolments fill a balanced block matching the engine, audited with blockIndex; duplicate arm names refused at creation; default arms stored | ✅ |
| T10.3 | Protocol amendments: `amendments` table + `trials.protocol_version`; submit (PI/coordinator, non-draft trials only) → ethics approve/return (comment required to return); `updateProtocol` consumes the earliest approved unapplied amendment for `visitPlan`/`arms` changes past draft, bumping the version (drafts edit freely); amendment queue on `/ethics`, submit form + history + version badge on `/trials/[id]` | `tests/amendments.test.ts`: active-trial change refused without approved amendment, succeeds by consuming one (v2, appliedAt stamped), next change refused again; drafts free + amendment-less; ethics-only decision, comment enforced, re-decision refused, resubmission sequences; full walk audited incl. `trial.protocol_update` | ✅ |
| T10.4 | Consent versioning & re-consent: `recordConsent` binds the trial's latest consent-form document (explicit id must be one of the trial's consent forms; NO form on file = consent refused), audit carries the signed version; `reconsent_due` sweep rule flags participants signed on older versions (legacy unbound consents skipped); consent register card on `/trials/[id]`; seed plants ICF v1 per trial | `tests/consent.test.ts`: consent refused with no form on file; wrong-kind doc refused; binding + audited version; ICF v2 upload raises exactly one reconsent_due (idempotent) with versions in the message; re-record binds v2 and resolves; legacy unbound never flagged; register rows exact | ✅ |
| T10.5 | Tailored dashboards: `dashboardVariant(role)` selector (`src/lib/dashboard-variants.ts`, capability-filtered) composes `/dashboard` per role from shared cards — PI: signing queue (`pendingApprovals`) + open queries + visits; Ethics: IEC + amendment queues; PV: escalation clocks + safety signals; Monitor: site due dates + queries; Admin: full portfolio + safety + audit shortcut; Regulator: read-only portfolio + signals + audit, no AI assistant. Role-specific data loads only when its card shows | `tests/dashboard-variants.test.ts`: non-empty declared card sets, no duplicates; exact composition per role; capability-sensitive cards never leak (assistant/audit/approvals/ethics/monitoring/safety/queries guards over all 7 roles); role-defining expectations (regulator read-only, coordinator no approvals, admin leadership set); build green | ✅ |
