# AyuSphere ↔ SIH26046 — Gap Analysis

Requirement-by-requirement trace of the **official problem statement** (SIH26046,
Ministry of Ayush / All India Institute of Ayurveda — *"AIIA Clinical Trials
Dashboard — a real-time, cloud-based, GCP-compliant CTMS for Ayurveda research,
with CDISC/FHIR-interoperable data, role-based KPIs, and integrated ethics,
regulatory (CTRI / NDCT Rules 2019) and pharmacovigilance tracking"*) against
what is actually implemented in this repository — verified in **code**, not
docs claims.

Status legend: ✅ **Built** (working, test-gated) · ◐ **Partial** (core exists,
PS asks for more) · ✖ **Missing** (nothing in code) · 📄 **Narrative**
(hosting/legal posture — documented caveat, correctly out of hackathon scope).

The fill plan for every ◐/✖ row lives in [gap-plan.md](gap-plan.md) (task IDs
`T7.x`–`T10.x`), scheduled on the task board in [tasks.md](tasks.md).

---

## 1. Expected-solution requirements (the scored list)

| PS requirement (quoted) | Status | Evidence in repo | Gap | Fill |
|---|---|---|---|---|
| "a real-time portfolio view with per-study drill-down" | ✅ | `/dashboard` (`src/services/dashboard.ts`), trial detail `/trials/[id]`; SWR 10–15 s polling (D-011: PS "real-time" = decision latency) | — | — |
| "configurable KPIs and alerting" | ✅ | **Closed by T7.2 (D-023):** `alert_config` in `app_settings` (lag threshold, AE warning window, milestone lookahead, monitoring cadence, AE/SAE deadline-rule table) edited from the admin "Alerts & Deadlines" Settings card, Zod-validated, audited; `sweepAlerts` and AE capture read it with built-in defaults (`src/services/settings.ts`, `tests/alert-config.test.ts`) | — (was ◐) | done |
| "strictly role-based access" | ✅ | 7 roles exactly as the PS names them (`src/lib/rbac.ts` matrix; nav from matrix in `src/lib/nav.ts`; service-level `assertCan`); `tests/auth-rbac.test.ts`, `tests/regulator.test.ts` | — | — |
| "an immutable, ALCOA+-compliant audit trail" | ✅ | `withAudit()` wraps every mutation in the same transaction (`src/lib/audit.ts`); insert-only `audit_events`; audit browser `/audit`; corrections are versioned, never in-place | — | — |
| "CDISC-aligned data models" | ✅ | CDASH-aligned naming from creation (D-017), CRF template fields carry `cdashVar` (`src/db/schema.ts`) | — | — |
| "HL7 FHIR R4 / ABDM interoperability with EDC and the hospital information system" | ✅ | **Closed by T9.3 (D-026):** live authenticated FHIR R4 read endpoints (`GET /api/fhir/Bundle/[trialId]`, `GET /api/fhir/ResearchStudy/[id]`, `application/fhir+json`, audited, regulator read-only) + inbound `POST /api/fhir/import` mapping EDC/HIS Observation bundles to **draft** CRF entries through the visit template (never auto-approved; `src/services/fhir-import.ts`, `tests/fhir-api.test.ts`); ABDM posture documented honestly (FHIR endpoints = the ABDM-compatible building block; ABHA linkage stays outside the de-identified schema, stated as roadmap) | — (was ◐) | done |
| "an integrated pharmacovigilance module (AE/SAE capture … regulatory-timeline tracking)" | ✅ | AE/SAE capture + deadline engine (`src/lib/rules/deadlines.ts`), escalation clock component, `ae_actions` timeline, PV review flow (`src/services/adverse-events.ts`), deadline alerts | — | — |
| "… MedDRA/WHO Drug coding …" | ✅ | **Closed by T7.4 (D-024):** bundled demo-subset dictionaries (`src/lib/dictionaries/` — 140+ MedDRA-like PT/SOC terms, 45 ASU WHODrug-like formulations, clearly labeled demo artifacts), AE capture form with coding pickers, codes validated at capture, decoded terms shown in AE views, SDTM `AEDECOD` = decoded PT, FHIR coding carries `display` (`tests/dictionaries.test.ts`) | — (was ◐) | done |
| "feeds aggregate safety signals to the Data Safety Monitoring Board and institutional leadership" | ✅ | **Closed by T8.1:** `src/services/safety-signals.ts` groups AEs by coded term × trial with site breakdown, SAE share, and a disproportionality ratio (flag = ≥3 events and ≥2× portfolio share, labeled decision support); signals panel on `/adverse-events` + printable DSMB summary at `/adverse-events/dsmb` with reporting-timeliness stats and open SAE clocks (`tests/safety-signals.test.ts`) | — (was ✖) | done |
| "CTRI and ethics/regulatory milestone tracking" | ✅ | `milestones` table (`iec_submission`, `iec_approval`, `ctri_registration`, …), lifecycle gates (active requires IEC approval **and** CTRI number — `src/lib/rules/lifecycle.ts`), `milestone_due` alerts | — | — |
| "informed-consent and privacy controls aligned to the DPDP regime" | ✅ | De-identification **by schema** + synthetic data (D-016/D-021); **consent management closed by T10.4:** consent binds the consent-form **version** signed (no form on file ⇒ consent refused), a new form version raises `reconsent_due` per affected participant (auto-resolving on re-consent), consent register on the trial detail (`src/services/participants.ts`, `tests/consent.test.ts`) | — (was ◐) | done |
| "electronic-signature and data-integrity controls consistent with GCP" | ✅ | **Closed by T7.1 (D-022):** `signatures` table + password re-auth + meaning statement + SHA-256 payload hash on CRF approve/correct, extraction approve, AE report (`src/services/signatures.ts`, `tests/signatures.test.ts`); signature commits atomically with the signed mutation | — (was ✖) | done |
| "export submission-ready datasets (SDTM / ADaM, Define-XML)" | ✅ | **Closed by T9.1 + T9.2:** SDTM `DM`/`AE` CSVs; real Define-XML (ItemDefs with DataType/Length/labels 1:1 with columns, CodeLists with decodes, CRF capture metadata, ADSL Analysis ItemGroup); **ADaM ADSL** subject-level dataset (`src/services/export/adam.ts`) downloadable and audited from `/exports` | Full domain coverage beyond the subset + def:2.x stylesheet packaging stay stated roadmap items | done |
| "tailored dashboards for Investigators, the Ethics Committee, pharmacovigilance and institutional leadership" | ✅ | **Closed by T10.5:** `dashboardVariant(role)` (`src/lib/dashboard-variants.ts`) composes `/dashboard` per role from shared, capability-guarded cards — PI signing queue + data queries, Ethics IEC/amendment queues, PV escalation clocks + safety signals, Monitor site due dates, Admin/leadership full portfolio + audit, Regulator read-only portfolio without the AI assistant (`tests/dashboard-variants.test.ts`) | — (was ◐) | done |
| "hosted on secure, data-resident cloud infrastructure (ISO/IEC 27001, CERT-In)" | 📄 | Documented caveat: Neon/Vercel is the dev/demo host; production narrative names India data-resident, ISO 27001/CERT-In infrastructure (D-002, D-014, architecture.md §12) | Correct hackathon posture — keep as stated caveat | — |

## 2. Lifecycle-tracking requirements (PS description paragraph)

| PS clause | Status | Evidence | Gap | Fill |
|---|---|---|---|---|
| "protocol and Institutional Ethics Committee approval" | ✅ | `draft → iec_review → iec_approved` with ethics-role-only gate; ethics queue `/ethics` | Initial review only — see amendments row | — |
| IEC oversight of **amendments** (implied; workflow.md even promises an "amendment queue") | ✅ | **Closed by T10.3:** `amendments` table + submit (PI/coordinator) → ethics approve/return with the promised queue on `/ethics`; protocol changes (`visitPlan`/`arms`) on trials past draft require and consume an approved amendment via `updateProtocol`, bumping `trials.protocol_version` (`src/services/amendments.ts`, `tests/amendments.test.ts`) | — (was ✖) | done |
| "CTRI registration" (prospective-registration rule) | ✅ | `ctri_registered` gate; trial cannot be `active` without CTRI number + IEC approval (`tests/lifecycle.test.ts`); real CTRI registry metadata seeded (D-021) | — | — |
| "site activation" | ✅ | `trial_sites` activation flow (`src/services/sites.ts`); enrolment blocked at inactive site | — | — |
| "screening, enrolment and randomization against target" | ✅ | Screening/consent/enrolment triple-guarded; **randomization closed by T10.2 (D-027):** trials carry an arms config (`[{name, ratio}]`) and enrolment assigns the arm via a deterministic permuted-block allocator (`src/lib/rules/randomization.ts`), allocation recorded in the audit snapshot; manual arm entry removed (`tests/randomization.test.ts`). Open-label MVP — no concealment/blinding claimed | — (was ◐) | done |
| "visit and protocol-deviation compliance" | ✅ | Visit windows + status sweep (`src/lib/rules/visits.ts`); missed visit ⇒ `protocol_deviation` alert (`src/services/alerts.ts`) | — | — |
| "data-query and data-quality status" | ✅ | Automated data-quality rules ⇒ `data_quality` alerts; **human query loop closed by T10.1:** monitor raises on a CRF entry (`query.manage`) → coordinator/PI answers on the visit page → monitor closes; an open query blocks approval; status KPIs incl. median cycle days on `/monitoring` (`src/services/data-queries.ts`, `tests/data-queries.test.ts`) | — (was ◐) | done |
| "study milestones and timelines … close-out" | ✅ | `milestones` + lifecycle through `closeout` | — | — |
| Example alert: "an overdue monitoring visit" | ✅ | **Closed by T7.3:** `monitoring_visits` table + schedule/complete workflow behind `monitoring.log` (`src/services/monitoring.ts`, UI on `/monitoring`); `monitoring_overdue` sweep rule raises/auto-resolves on `trial_sites.monitoring_visit_due`; completion advances the due date by the configured cadence (D-023); `tests/monitoring.test.ts` | — (was ✖) | done |
| Timely SAE reporting artifact (workflow.md §8: "report generation = printable summary in MVP") | ✅ | **Closed by T8.2:** printable CIOMS-style report at `/adverse-events/[id]/report` (`src/services/ae-report.ts` — reaction, suspect formulation, study context, escalation timeline, deadline compliance); generation audited `ae.report_generated`; PV review actions (start review, signed mark-reported) now live on `/adverse-events` (`tests/ae-report.test.ts`) | — (was ✖) | done |
| NPvCC context: spontaneous ADR surveillance for ASU&H drugs beyond trials | ✅ | **Closed by T8.3 (D-025):** `suspected_adrs` intake (hospital/community/literature sources, dictionary-coded, no participant linkage) with the receive→assess→forward PV walk on `/adverse-events`; reports feed the safety-signal view as their own "NPvCC" series (`src/services/adr.ts`, `tests/adr-intake.test.ts`) | — (was ✖ stretch) | done |

## 3. The four evaluation axes — standing after the gap-fill (Phases 7–10 complete)

| Axis | Standing |
|---|---|
| 1 · Data accuracy & integrity | Template-driven Zod validation, immutable approved CRFs with versioned corrections, quality rules, **e-signatures on every record-freezing action (T7.1)**, and the **monitor's data-query loop blocking approval (T10.1)** |
| 2 · Timeliness of safety & regulatory reporting | Configurable deadline engine (T7.2) + escalation clocks, **MedDRA/WHODrug-coded events (T7.4)**, **signal aggregation + DSMB summary (T8.1)** incl. the NPvCC spontaneous series (T8.3), **printable CIOMS-style SAE report with deadline compliance (T8.2)** |
| 3 · Interoperability conformance | FHIR R4 bundle + **live authenticated FHIR API + EDC import-to-draft (T9.3)**, SDTM DM/AE + **ADaM ADSL (T9.2)**, **real Define-XML with ItemDefs/codelists/CRF metadata (T9.1)** |
| 4 · Access-control & audit completeness | Enforced 7-role matrix (+`query.manage`), regulator read-only, audit browser with signature ids/hashes in snapshots, IEC amendment gate on protocol changes (T10.3), consent-version register (T10.4), **role-tailored dashboards (T10.5)** |

**All 14 gaps identified in this analysis are closed** (Phases 7–10, tasks.md); the remaining items are the honestly-stated hosting/licensing narratives in §5.

## 4. Where the build already exceeds the PS

Differentiators judges see nowhere in the PS text — keep them front-and-centre
in the demo:

- **Doctor Note Intelligence** — image → quality gate → template-shaped Claude
  extraction → Zod validation incl. cross-document checks → confidence-heatmap
  review → PI approval with full provenance (`src/services/extractions.ts`,
  `tests/extraction.test.ts`). Nothing auto-commits.
- **Grounded AI Copilot** — whitelisted RBAC-scoped retrieval, citation-linked
  answers, decline-on-empty without a model call (`src/services/copilot.ts`).
- **Real CTRI registry data** — genuine public Ayurveda trial records seeded
  idempotently (D-021), participants fully synthetic.
- **Provider-switchable AI** (Claude/Gemini via admin settings), internal
  messaging, deterministic seeded demo moments, 30-file PGlite/Vitest suite
  with a statically tested design system.

## 5. Explicitly out of hackathon scope (state honestly in the demo)

Live EDC/HIS integration, licensed full MedDRA/WHODrug dictionaries (demo
subsets instead — T7.4), full ADaM beyond ADSL, websockets (D-011), production
data-resident hosting (D-002/D-014 narrative), CAPTCHA-bypassing CTRI
automation (D-021 rejected it).
