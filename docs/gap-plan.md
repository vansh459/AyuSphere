# AyuSphere — Gap-Fill Plan (SIH26046)

Implementation plan closing every ◐/✖ row of [gap-analysis.md](gap-analysis.md),
ordered by SIH judging value on the PS's own four evaluation axes. Tasks follow
the repo's fixed conventions: every mutation = server action → `assertCan` →
Zod → service → `withAudit()`; alerts idempotent (one open alert per
rule+entity via the partial unique index); PGlite/Vitest test gates per task
(D-020); no new fonts/sizes (D-008); design decisions appended to
[decisions.md](decisions.md) (new ADRs **D-022…D-027**). The task board rows
live in [tasks.md](tasks.md) Phases 7–10.

Priority logic: Phase 7 = highest judge-value per effort (closes "Missing"
compliance words the PS names literally). Phase 8 = pharmacovigilance depth
(axis 2, AIIA's NPvCC identity). Phase 9 = interoperability depth (axis 3).
Phase 10 = CTMS workflow completeness (axes 1+4).

---

## Phase 7 — Compliance quick wins (demo-critical)

### T7.1 Electronic signatures (G5 · ADR D-022)

GCP/21-CFR-11-style signature on the three record-freezing actions: CRF entry
approval, extraction approval, AE "mark reported".

- **Schema** (`src/db/schema.ts` + migration):
  ```ts
  export const signatures = pgTable("signatures", {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").notNull(),
    actorRole: text("actor_role").notNull(),
    entityType: text("entity_type").notNull(),   // crf_entry | extraction | adverse_event
    entityId: uuid("entity_id").notNull(),
    action: text("action").notNull(),            // approve | report
    meaning: text("meaning").notNull(),          // "I approve this record as accurate and complete"
    payloadHash: text("payload_hash").notNull(), // sha256 of canonical JSON payload
    signedAt: timestamp("signed_at", { withTimezone: true }).notNull().defaultNow(),
  });
  ```
- **Service** `src/services/signatures.ts`: `signAndExecute(db, actor, {password, entityType, entityId, action, meaning, payload}, fn)` — verifies the password against `users.passwordHash` (bcrypt, reusing `src/lib/auth-core.ts`), computes `sha256(JSON.stringify(payload))` (node `crypto`), inserts the signature row **inside the same `withAudit` transaction** as the guarded mutation.
- **Wire-in**: `approveEntry` (`src/services/crf.ts`), `approveExtraction` (`src/services/extractions.ts`), `advanceAeStatus(..., "reported")` (`src/services/adverse-events.ts`) gain an optional-but-enforced signature step; server actions collect the re-entered password via a confirm dialog (glass modal, meaning statement shown verbatim).
- **UI**: signature chip ("Signed · role · timestamp") on approved CRF entries, extraction records and reported AEs; signature rows visible in the audit browser next to their audit events.
- **Test gate** (`tests/signatures.test.ts`, PGlite): wrong/missing password refuses the action and writes nothing (atomic); hash matches an independent recomputation; signature row + audit row commit together; regulator cannot sign anything.

### T7.2 Configurable alert & deadline settings (G8 · ADR D-023)

Make the PS word "configurable" literally true using the existing
`app_settings` table (no new table).

- **Config shape** (Zod in `src/services/settings.ts`): `alert_config` key —
  `{ enrolmentLagThreshold: 0.5, aeApproachingHours: 24, milestoneLookaheadDays: 7, deadlineRules: [{seriousness, initialHours, detailedDays?}] }`; defaults = today's constants.
- **Read path**: `sweepAlerts()` (`src/services/alerts.ts`) and AE capture load config once per sweep/insert (`getAlertConfig(db)` with default fallback so tests and empty DBs behave unchanged); `computeDeadlines()` already accepts a `rules` param — pass the configured table.
- **UI**: "Alerts & Deadlines" card on `/settings` (admin only, existing `users.manage` gate), numeric inputs + the AE/SAE rule table; saves audited as `settings.alert_update`.
- **Test gate** (`tests/alert-config.test.ts`): saved config changes sweep behaviour (lower lag threshold stops flagging a site; shorter SAE hours moves the computed deadline); malformed config rejected by Zod; defaults apply when unset.

### T7.3 Monitoring-visit workflow + `monitoring_overdue` rule (G9)

Gives the monitor role its promised mutation and closes the architecture.md §8
promise.

- **Schema**: `monitoring_visits` table — `id, trialSiteId → trial_sites, monitorId, scheduledDate, completedAt?, summary, findings (jsonb), reportDocumentId? → documents`.
- **Service** `src/services/monitoring.ts`: `scheduleMonitoringVisit`, `completeMonitoringVisit` (guarded by existing `monitoring.log` capability, audited `monitoring.schedule/complete`); completing sets the next `trial_sites.monitoringVisitDue` from a configurable cadence (default 90 days, lives in T7.2's config).
- **Alerts**: add `"monitoring_overdue"` to `RuleKey`; sweep raises warning when `monitoringVisitDue < now` with no completed visit since; auto-resolves on completion.
- **UI**: `/monitoring` gains a "Log monitoring visit" flow (site picker → date → summary/findings → optional report upload reusing the documents flow).
- **Test gate** (`tests/monitoring.test.ts`): overdue due-date raises exactly one open alert; completing the visit resolves it and advances the due date; coordinator cannot log (RBAC).

### T7.4 MedDRA/WHODrug demo-subset coding (G1 · ADR D-024)

Bundled, honestly-labeled demo dictionary subsets (licensed dictionaries are
explicitly out of scope — README already states this).

- **Data** `src/lib/dictionaries/meddra-subset.ts`: ~200 MedDRA-like terms as `{code, pt, soc}` covering common Ayurveda-trial AEs (GI, skin, hepatic, general); `whodrug-subset.ts`: ASU formulation list `{code, drugName, atcLike}`. Pure TS modules — searchable, no DB migration needed.
- **Service**: `searchMeddra(q)`, `searchWhodrug(q)` pure functions; `captureAeInput` (already has `meddraCode`/`whodrugCode`) additionally validated: if a code is supplied it must exist in the subset (Zod refine).
- **UI**: autocomplete combobox in the AE capture form (term typing suggests PT + SOC; picking fills `meddraCode` and the decoded term chip); AE detail + PV dashboard show decoded `PT (SOC)` instead of a bare code.
- **Downstream**: SDTM `AEDECOD` now carries the PT; FHIR AdverseEvent coding block already consumes `meddraCode`.
- **Test gate** (`tests/dictionaries.test.ts`): search returns expected PTs; unknown code rejected at capture; SDTM AE export shows the decoded term for a seeded coded AE.

## Phase 8 — Pharmacovigilance depth (axis 2)

### T8.1 Safety-signal aggregation + DSMB view (G2)

- **Service** `src/services/safety-signals.ts` (pure queries, no schema change): group open+closed AEs by `meddraCode` (fallback: term) × trial × site with counts, SAE share, and a simple disproportionality ratio (term share within trial ÷ term share across portfolio; flag ≥ 2× with n ≥ 3 — labeled *decision support, never confirmed causality*).
- **UI**: "Safety Signals" panel on the PV dashboard variant and a `/adverse-events` tab: signal table (term, trial, site, n, SAE%, ratio, flag) with click-through to the underlying AE list; printable **DSMB aggregate summary** (print stylesheet page listing signals + open SAE clocks + reporting-timeliness stats).
- **Test gate** (`tests/safety-signals.test.ts`, PGlite): planted cluster (same coded term ×3 in one trial) is flagged, background noise is not; ratio math exact on fixtures.

### T8.2 SAE regulatory report artifact (G14)

- **Route** `/adverse-events/[id]/report`: printable CIOMS-style summary (trial, subject code only, term + codes, onset, seriousness/severity/causality, narrative, timeline from `ae_actions`, deadline vs `reportedAt`) rendered server-side from existing rows; "Generate report" is audited (`ae.report_generated`) and linked from the PV "mark reported" step (report first, then sign+report per T7.1).
- **Test gate** (`tests/ae-report.test.ts`): report data assembly returns the full timeline and correct deadline delta; regulator can view, cannot generate.

### T8.3 NPvCC spontaneous ADR intake (G13 · stretch · ADR D-025)

Scope decision recorded in D-025; build only if demo time allows.

- **Schema**: `suspected_adrs` — `id, source (hospital|community|literature), suspectedDrug (whodrug-coded), term (meddra-coded), eventDate, outcome, seriousness, narrative, reporterRole, status (received|assessed|forwarded), createdBy` — deliberately **not** linked to trial participants (de-identified spontaneous reports).
- **Service + UI**: PV intake form + list at `/adverse-events` ("Spontaneous ADRs" tab); counts feed the T8.1 signal view as a separate "spontaneous" series; audited `adr.receive/assess/forward`.
- **Test gate** (`tests/adr-intake.test.ts`): capture/assess walk audited; appears in signal aggregation under its own source.

## Phase 9 — Interoperability depth (axis 3)

### T9.1 Real Define-XML (G3)

- Extend `src/services/export/sdtm.ts`: `defineXml(trial, templates)` replaces the stub — per exported domain, emit `ItemDef` elements with `DataType`, `Length`, human `Description`/label, and `CodeList`s (AESER Y/N, AESEV, ARM values from the trial's arms after T10.2); CRF-derived variables read datatype/label/unit from the template's `fields` JSONB (they already carry `cdashVar`).
- **Test gate** (extend `tests/exports.test.ts`): every ItemRef resolves to an ItemDef; datatypes match column semantics; XML well-formed (parse with a lightweight check).

### T9.2 ADaM ADSL dataset (G3)

- `src/services/export/adam.ts`: `buildAdsl(db, trialId)` — one row per subject: `STUDYID, USUBJID, SUBJID, SITEID, ARM/ARMCD, TRTSDT (enrolledAt), EOSSTT (COMPLETED/DISCONTINUED/ONGOING), DCSREAS (withdrawalReason), SAFFL (Y if any post-enrolment data)` — pure projection of existing rows, CSV via the shared `toCsv`.
- Add to `/exports` page + `/api/export?kind=adsl`, audited `export.adsl`; listed in Define-XML (T9.1) under an ADaM MetaDataVersion.
- **Test gate**: seeded trial exports expected ADSL rows; withdrawn participant carries `DCSREAS`; column set exact.

### T9.3 FHIR REST API + EDC import stub + ABDM narrative (G4 · ADR D-026)

- **Read API** (route handlers, session- or token-authenticated, audited `fhir.read`): `GET /api/fhir/ResearchStudy/[id]`, `GET /api/fhir/Bundle/[trialId]` — serve the existing mappers (`src/services/export/fhir.ts`) as `application/fhir+json`; RBAC: `export.run` capability; regulator gets read.
- **Import stub** `POST /api/fhir/import` (capability `crf.enter`): accepts a FHIR `Bundle` of `Observation` resources referencing a subject code + visit; maps LOINC-ish/`cdashVar`-tagged observations onto the visit's CRF template and creates a **draft** CRF entry (`source = "manual"`, flagged `importedFrom: "fhir"` in data) — nothing auto-approves, reusing the existing draft→submit→approve path so validation and signatures still gate it. This is the honest "EDC/HIS interoperability" demo: a judge posts a bundle, sees a draft appear.
- **ABDM**: documented roadmap section (this file + architecture.md): ABHA-linked identifiers would live outside the de-identified research schema; demo shows the FHIR endpoints as the ABDM-compatible building block. No fake ABHA integration.
- **Test gate** (`tests/fhir-api.test.ts`): GET returns valid bundle JSON for an authorized role and 403 for unauthenticated; import creates a draft entry mapped to the right template fields, never an approved one; malformed bundle rejected by Zod.

## Phase 10 — CTMS workflow completeness (axes 1+4)

### T10.1 Data-query management (G6)

- **Schema**: `data_queries` — `id, crfEntryId → crf_entries, raisedBy, assignedRole (coordinator|pi), status (open|answered|closed), question, createdAt, closedAt?`; `data_query_messages` — `id, queryId, authorId, body, at` (thread).
- **RBAC**: new capability `query.manage` (monitor + admin raise/close) and reuse `crf.enter` (coordinator/PI answer).
- **Service** `src/services/data-queries.ts`: `raiseQuery`, `answerQuery`, `closeQuery` — all audited; open query on an entry **blocks its approval** until answered (checked in `crf.approve` path); query-status KPI (open/answered/median cycle days) on trial detail + `/monitoring`.
- **Test gate** (`tests/data-queries.test.ts`): full raise→answer→close walk audited; approval blocked while a query is open; RBAC (coordinator cannot close, monitor cannot answer own query as coordinator).

### T10.2 Randomization engine (G7 · ADR D-027)

- **Schema**: `trials.arms` JSONB — `[{name, ratio}]` (default `[{Intervention 1},{Control 1}]` scaffolded on trial creation alongside CRF templates).
- **Engine** `src/lib/rules/randomization.ts` (pure, unit-testable): permuted-block allocation per trial (block size = 2×∑ratio), deterministic under an injected RNG seed for tests; MVP is open-label (no concealment claim — stated in D-027).
- **Service**: `enrolParticipant` drops the free-text `arm` param and calls the engine; allocation recorded in the audit `after` snapshot (`{arm, blockIndex}`).
- **UI**: arm shown as read-only badge post-enrolment; trial form gains an arms editor (name + ratio rows).
- **Test gate** (extend `tests/participant-service.test.ts` + `tests/randomization.test.ts`): block of 4 with 1:1 ratio yields 2+2; deterministic under fixed seed; ratios respected over N enrolments; manual arm input no longer accepted.

### T10.3 Protocol amendments (G10)

- **Schema**: `amendments` — `id, trialId, versionNumber, summary, documentId? → documents, status (draft|submitted|approved|returned), submittedBy, decidedBy?, decidedAt?, comment?`.
- **Service** `src/services/amendments.ts`: PI/coordinator submit (`trial.manage`), ethics approve/return (`trial.ethicsReview`) — mirrors the initial-review pattern; an approved amendment increments the trial's protocol version and is the required gate for changing `visitPlan`/`arms` on an `active` trial (lifecycle guard extension).
- **UI**: "Amendments" section on trial detail + amendment queue card on `/ethics` (the queue workflow.md already promised).
- **Test gate** (`tests/amendments.test.ts`): active-trial protocol change refused without an approved amendment; ethics-only decision; full walk audited.

### T10.4 Consent versioning & re-consent (G11)

- **Schema**: `participants.consentDocumentId` already exists — enforce it: `recordConsent` requires the id of the **current highest version** consent-form document for that trial and stores it (Zod + service check, no migration).
- **Rule**: new sweep check — participants whose `consentDocumentId` version < latest `consent_form` version get a `reconsent_due` alert (new `RuleKey`), auto-resolving when consent is re-recorded; consent register view on the trial detail (who consented on which version, when).
- **Test gate** (`tests/consent.test.ts`): consent without document id refused; uploading consent-form v2 raises `reconsent_due` for v1 participants; re-recording resolves it.

### T10.5 Tailored dashboards (G12)

- Compose `/dashboard` per role from **existing** services (no new queries where avoidable): PI — my trials, pending CRF/extraction approvals, open queries (T10.1), overdue visits; Ethics — review + amendment queues, approved registry; PV — safety portfolio with escalation clocks ordered by deadline + signal panel (T8.1); Monitor — assigned-site performance, deviations, monitoring dues (T7.3); Admin/leadership + Regulator — portfolio + signals + audit shortcut (regulator read-only).
- Implementation: a `dashboardVariant(role)` switch in the page assembling role-specific card sets; shared components stay identical (one code path, mutations stripped for regulator as today).
- **Test gate** (extend `tests/nav.test.ts` pattern → `tests/dashboard-variants.test.ts`): variant selector returns the expected card set per role; build green.

---

## Sequencing & effort (6-person team, post-submission sprint)

| Phase | Tasks | Est. | Rationale |
|---|---|---|---|
| 7 | T7.1–T7.4 | 3–4 days | Closes every "Missing" compliance word the PS names literally (e-signature, configurable, MedDRA/WHODrug, monitoring alert) — maximum judge value per effort |
| 8 | T8.1–T8.2 (+T8.3 stretch) | 2–3 days | AIIA = NPvCC; safety depth is the org's identity |
| 9 | T9.1–T9.3 | 2–3 days | Turns "export subset" into "interoperability conformance" with a live API demo |
| 10 | T10.1–T10.5 | 4–5 days | Rounds out the CTMS story; T10.5 last since it showcases everything above |

Demo-critical minimum if time is short: **T7.1, T7.2, T7.4, T8.1, T9.1, T10.5**.
