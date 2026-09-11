# AyuSphere — Application Workflow Document

The complete workflow of the whole application: every flow, actor by actor, step by step.
Each workflow states **who acts → what they do → what the system does → what is written → what is audited → what the user sees next**.

Related docs: [architecture.md](architecture.md) (schema, state machine, RBAC matrix) · [technology.md](technology.md) · [decisions.md](decisions.md)

Roles used below: **PI** (Principal Investigator), **Coordinator**, **Monitor**, **Ethics**, **PV** (pharmacovigilance), **Admin**, **Regulator** (read-only).

---

## 1. Authentication & role-based landing

1. User opens the app → unauthenticated requests are redirected by middleware to `/login` (glass card, single form: email + password).
2. Submit → Auth.js Credentials provider verifies bcrypt hash against `users` → JWT session issued with `role` claim. Failure shows an inline error; 5 failures rate-limit the IP+email pair.
3. **Audit:** `auth.login` (or `auth.login_failed`) event with actor + timestamp.
4. Redirect to `/dashboard`, which renders **role-specifically**:

| Role | Landing dashboard shows |
|---|---|
| PI | Their trials: enrolment vs target, overdue visits, pending CRF/extraction approvals, open AEs |
| Coordinator | Today's/upcoming visits, data-entry queue, milestone due list (CTRI/ethics) |
| Monitor | Assigned sites: monitoring visit schedule, deviation list, data-quality flags |
| Ethics | Trials awaiting review, approved-trial registry, amendment queue |
| PV | Safety portfolio: open AE/SAE with countdown clocks, breached deadlines first, signal summary |
| Admin | Whole-portfolio KPIs, all alerts, user management shortcut |
| Regulator | Read-only portfolio view + audit browser entry point |

5. Sidebar (glass) shows only the routes the role may access (from the RBAC matrix); direct URL access to a forbidden route renders the shared permission-denied state (§14) and logs `rbac.denied`.
6. Logout clears the session and audits `auth.logout`.

## 2. Trial creation & lifecycle

**Create (PI/Coordinator/Admin):**
1. `/trials` → "New Trial" (clay CTA) → form: title, protocol code, study type, phase, Ayurveda intervention (formulation, dosage form), target enrolment, planned dates.
2. Zod validates → `trials` row created with `status = draft` → milestones auto-scaffolded (`iec_submission`, `iec_approval`, `ctri_registration`) with due dates.
3. **Audit:** `trial.create` with full after-snapshot.

**Lifecycle transitions** (state machine, architecture.md §4 — invalid transitions are refused by the service, not just hidden in the UI):

| Transition | Who | Precondition | Side effects |
|---|---|---|---|
| draft → iec_review | PI | protocol document uploaded | Ethics dashboard queue +1 |
| iec_review → iec_approved | Ethics | — | `iec_approval` milestone completed |
| iec_review → draft (returned) | Ethics | comment required | PI notified via alert |
| iec_approved → ctri_registered | Coordinator | CTRI number entered | `ctri_registration` milestone completed |
| ctri_registered → active | Admin/PI | ≥1 site activated | enrolment opens |
| active → enrolment_closed | PI | — | recruitment KPIs freeze targets |
| enrolment_closed → followup → closeout | PI | last visit completed for closeout | trial becomes read-only |

Every transition: audit event (`trial.transition`, before/after status) + milestone alert re-evaluation. A trial can never be `active` without ethics approval **and** a CTRI number — the prospective-registration rule.

## 3. Site management & activation

1. Admin maintains the site registry (`/sites`): name, city, PI.
2. Attaching a site to a trial creates a `trial_sites` row: `activation_status = pending`, per-site enrolment target, monitoring cadence.
3. Activation (Admin/PI) flips status, timestamps it, audits `site.activate` — participants can now be enrolled at that site.
4. Site page shows: recruitment rate vs target, monitoring visit due date, open issues, deviation count. Falling behind triggers the `enrolment_lag` alert (§9).

## 4. Participant management (de-identified)

1. Coordinator/PI at an active trial-site → "Add Participant" → the system **generates** the subject code (`AYU-<trial>-P-<seq>`) — there is no field for name/phone/address anywhere (privacy by schema).
2. Screening: eligibility checklist (from protocol config) → `screening_status` pass/fail; consent recorded (`consent_status`, `consent_date`, consent-form document version linked).
3. Enrolment requires: consent recorded + eligibility pass + trial `active`. Randomization assigns `arm` (simple randomization in MVP).
4. On enrolment, the **visit schedule is generated** (§5) from the trial's protocol offsets.
5. Withdrawal: reason captured, remaining visits cancelled, participant status `withdrawn`; KPI dropout counters update.
6. **Audit:** `participant.create / screen / consent / enrol / withdraw` — each with snapshots.

## 5. Visit scheduling & tracking

1. Protocol config per trial defines visit types and day offsets (e.g. baseline d0, follow-up d30 ±7).
2. Enrolment generates `visits` rows with `scheduled_date`, `window_start`, `window_end`, status `upcoming`.
3. Status transitions run in the cron sweep and on page load: `upcoming → due` (inside window) `→ overdue` (past window without completion) `→ missed` (window long past — raises a `protocol_deviation`).
4. Coordinator's dashboard lists due/overdue visits; completing a visit opens its CRF (§6/§7) and stamps `completed_at`.
5. **Audit:** `visit.complete`, `visit.missed` (system-attributed with `actor = system`).

## 6. Doctor Note Intelligence — image → structured CRF (the signature flow)

Actor: PI (doctor) at a participant's due visit.

1. **Capture** — Visit page → "Scan doctor note" → upload/camera → image goes to `/api/upload` → Vercel Blob (private). `extractions` row created, status `pending`.
2. **Quality check** — Claude vision pre-pass scores blur/glare/skew/crop. Below threshold → UI asks for recapture **with the reason** ("glare over vitals section"); the failed attempt is retained on the extraction record.
3. **Extract & map** — One vision call carrying the *current visit's CRF template* (fields, types, units) returns structured JSON: per field `{value, confidence, source_text}`. Stored in `extractions.mapped_fields` with model id + prompt version.
4. **Validate** — The template's Zod schema runs range/unit/required/cross-field checks; **cross-document consistency** compares against the participant's approved history (dose change, impossible date, unit flip) and attaches flags.
5. **Human review** — Side-by-side screen: original image left, draft CRF right. Confidence heatmap: green (high) / amber / red (low). Validation flags shown inline. Amber/red fields and any flagged field must be explicitly confirmed or edited before "Approve" enables. Doctor can reject entirely (status `rejected`, nothing enters the record).
6. **Approve** — Creates the `crf_entries` row (`source = extraction`, `status = approved`) linked to the extraction; the extraction stores reviewer + timestamp; the original image remains attached as source evidence.
7. **Downstream** — Rules re-evaluate: extracted values may raise data-quality alerts or an AE draft (e.g. an adverse-event term detected → PV pre-notified). Dashboard KPIs update on next poll.
8. **Audit:** `extraction.create / quality_fail / review / approve|reject` and `crf.create` — the full provenance chain (image → model → confidences → reviewer → record) is walkable from the audit browser.

> **Demo moment (seeded):** one note contains a dose that contradicts the previous visit — validation catches it at step 4, the doctor corrects it at step 5, and the audit trail shows the correction.

## 7. Manual e-CRF data entry

1. Coordinator/PI opens a due visit → CRF form rendered **from the template** (fields, units, ranges) — the same template that drives extraction, so manual and AI paths converge on identical validation.
2. Client-side Zod gives immediate feedback; server re-validates on save.
3. Save as `draft` (editable) or `submit` → PI approval → `approved` (frozen). Corrections to an approved entry create a **new version** linked to the old — never an in-place edit.
4. **Audit:** `crf.create / submit / approve / correct`.

## 8. Adverse Event / SAE workflow

1. **Capture** (PI/Coordinator/PV, or pre-drafted from an extraction): term, onset, severity, outcome, causality assessment, narrative, seriousness (AE vs **SAE**), optional MedDRA/WHODrug code from the bundled demo subset.
2. On save, the **deadline engine** computes `reporting_deadline` from the seriousness-based rule table (SAE → 24h initial / 14d detailed — representative, configurable values). `ae_actions` gets its first entry.
3. **Escalation clock starts** — countdown ring on the AE card and PV dashboard; amber then red as thresholds pass; breach raises `ae_deadline_breached` (danger).
4. **PV review** — PV dashboard sorts by deadline proximity; PV reviews, may edit coding/causality, marks `reported_at` when the regulatory report is filed (report generation = printable summary in MVP), then `closed`.
5. Aggregate view: safety-signal panel groups AEs by term/trial/site and flags unusual clusters **for human review** (labeled decision support, never confirmed causality).
6. **Audit:** every step in `ae_actions` + `audit_events` — this is the "timeliness of safety reporting" evidence.

## 9. Alerts engine & notifications

1. Rules (registry in architecture.md §8): `enrolment_lag`, `visit_overdue`, `ae_deadline_approaching/breached`, `milestone_due` (CTRI/ethics), `monitoring_overdue`, `data_quality`, `protocol_deviation`.
2. Evaluated on relevant writes + 10-minute cron sweep. Alerts are idempotent — one open alert per (rule, entity).
3. Surfacing: topbar bell (glass dropdown, count badge), role-filtered `/alerts` list, and inline on the affected entity (e.g. red ring on the overdue visit row).
4. Users `acknowledge` (owning it) or the system auto-`resolves` when the condition clears (visit completed, deadline met).
5. **Audit:** `alert.raise / acknowledge / resolve`.

## 10. Dashboards & KPIs

- **Portfolio (Admin/Regulator/leadership):** active trials, total participants, sites, enrolment progress curve, dropout %, open AEs by seriousness, alerts by severity, milestone timeline.
- **Per-trial drill-down:** enrolment vs target per site, visit compliance %, deviation count, data-quality score, AE list, document set, milestone status.
- **Per-role variants** as in §1. Every KPI tile (clay) click-throughs to its underlying filtered list — nothing is a dead number.
- Data refresh: SWR 10–15s polling + on-focus revalidation. KPI numerals count up on load; dashboard cards stagger in (40ms).

## 11. AI Copilot (grounded Q&A)

1. Copilot panel (glass, right side) available to PI/Coordinator/PV/Admin.
2. User asks e.g. *"Which sites are behind target?"* → intent matched to whitelisted retrieval functions → queries run **under the asker's RBAC scope** → compact JSON context → Claude answers, constrained to cite record ids.
3. UI renders the answer with citation chips linking to the actual trial/site/AE pages. Empty retrieval → "no supporting records found," never a guess.
4. **Audit:** `copilot.query` (question, retrieval set, answer hash).

## 12. Data quality & protocol deviation checks

1. Continuous checks (write-time): range/unit violations, missing required fields, duplicate entries, logically impossible values (date sequencing, vitals bounds).
2. Scheduled checks (cron): missed/out-of-window visits, missing required assessments per completed visit.
3. Findings appear as `data_quality` / `protocol_deviation` alerts, on the trial's quality panel, and in the monitor's site view; each links to the offending record.
4. Resolution = correcting the record (which itself is audited) → alert auto-resolves.

## 13. Exports, documents & audit browser

**Documents:** upload per trial with `kind` + auto-incremented version; consent forms link from participant consent records; all files private-blob, access-checked. Audit: `document.upload`.

**Exports (PI/PV/Admin):** `/exports` → choose trial → download FHIR R4 bundle (ResearchStudy, ResearchSubject, de-identified Patient, AdverseEvent) or SDTM `DM`/`AE` CSVs + Define-XML stub. Every export audited (`export.fhir` / `export.sdtm`) — who, what, when.

**Audit browser (Admin + Regulator read-only):** filterable timeline (actor, entity, action, date range); selecting an event shows before/after diff; from any record page, "View history" deep-links to its filtered audit trail. This screen is the "access-control and audit completeness" evaluation-axis demo.

## 14. Cross-cutting UX states

Every page implements the same four states from shared components:

| State | Behavior |
|---|---|
| **Loading** | Skeleton shimmer (300ms), layout-stable — no spinners on full pages |
| **Empty** | Friendly illustration-free copy + the one action that fills it ("No participants yet — Add participant") |
| **Error** | Inline clay card: what failed + retry; server errors never expose internals; audited as `system.error` |
| **Permission denied** | Shared component naming the required role; attempt logged `rbac.denied` |

Form errors: inline under field (danger token), first error focused. Destructive actions (withdraw participant, reject extraction) require a typed-confirmation dialog. All mutations show optimistic or pending UI within 100ms — nothing feels dead.

## 15. End-to-end demo storyline (judge-facing, maps to the 4 evaluation axes)

1. **Login as PI** → dashboard (role-based access — axis 4).
2. Open participant's due visit → **scan the seeded doctor note** → quality check passes → draft CRF with confidence heatmap → validation catches the seeded dose contradiction → doctor corrects, approves (data accuracy & integrity — axis 1).
3. The note's AE term pre-drafts an **SAE → escalation clock starts** → switch to PV role → deadline countdown on PV dashboard → mark reported (timeliness of safety reporting — axis 2).
4. Dashboard KPIs update; **ask the Copilot** "what changed today?" → cited answer linking the new records (grounded AI).
5. Open **Exports** → download the FHIR bundle + SDTM AE file (interoperability conformance — axis 3).
6. **Switch to Regulator** → read-only everywhere → open the audit browser → walk the full provenance chain of the record created in step 2 (audit completeness — axis 4).
