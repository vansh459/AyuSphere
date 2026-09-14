# AyuSphere — Technology & Security Guide

**SIH26046** · Ministry of Ayush · All India Institute of Ayurveda
Live system: `https://ayusphere-three.vercel.app`
PDF version: `Tech_Security_Guide.pdf` — regenerate any time with `pnpm tsx scripts/build-tech-guide.ts` (versions, the RBAC matrix and signature statements are extracted from the codebase at generation time, so the document cannot drift from the app).

Companion documents: the 7 role UAT guides and `Judge_Demo_Script.md` (the 8-minute storyline).

---

## 1 · What we built

**AyuSphere** is a working, deployed clinical trial management system for AIIA's Ayurveda trials — not a mock-up. It covers the full trial lifecycle (draft → IEC review → CTRI registration → active → completed → locked), participant screening/consent/enrolment with permuted-block randomization, template-driven e-CRFs with electronically signed approvals, a complete pharmacovigilance loop (MedDRA/WHODrug-coded AEs, configurable escalation deadlines, CIOMS-style reports, safety-signal detection, DSMB packs, NPvCC spontaneous-ADR intake), monitoring visits and data queries, protocol amendments under IEC control, and standards-based interoperability (CDISC SDTM/ADaM/Define-XML and a live two-way FHIR R4 API).

Seven enforced roles each see a tailored workspace; every mutation is validated, permission-checked and audited in the same database transaction; and the whole system is gated by **319 automated tests** running against real Postgres. It installs like a native app on phones (PWA), and every displayed date is pinned to IST regardless of where the server runs.

## 2 · Technology stack — what and how

### Frontend

| Technology | What it is | How AyuSphere uses it |
|---|---|---|
| **Next.js 16 (App Router, Turbopack)** | Full-stack React framework | Every screen is a server component that reads the session and renders only what the role may see; mutations are server actions, so clinical-data logic never ships to the browser. One repo, one deploy. |
| **React 19** | UI library | Server components for data-heavy pages; small client islands only where interactivity needs it (forms, Sphera panel, toasts, mobile drawer). |
| **TypeScript 5 (strict)** | Typed JavaScript | Strict across app/services/tests/scripts; DB row types inferred from the schema — a schema change breaks the build, not production. |
| **Tailwind CSS 4** | Utility-first CSS | Implements the design system (glass + clay tokens, one font, two text sizes); a static design-qa test fails the build on violations. |
| **framer-motion** | Animation | Small approved motion catalog — decorative only, never load-bearing. |
| **Recharts** | Charts | Dashboard KPIs: enrolment progress, AE severity mix, portfolio charts. |
| **Live badges (fetch + events)** | Dependency-free client refresh | Live unread badges and toasts refresh via plain `fetch` on navigation and a `refreshBadges` event — no data-fetching library; unused deps removed (T6.12). |
| **PWA (manifest + install banner)** | Installable web app | Standalone manifest; phone-only banner — Android gets the native install dialog (`beforeinstallprompt`), iPhone gets honest Share → Add to Home Screen instructions. Desktop/iPads never see it (incl. iPadOS masquerading as a Mac, excluded via touch-point detection). |
| **IST dates (`src/lib/dates.ts`)** | One timezone truth | Servers run in UTC — bare formatting shifted IST users back a day around midnight. All date renders go through Asia/Kolkata-pinned helpers; a static test forbids bare `toLocale*String` calls. |
| lucide-react · clsx · CVA · tailwind-merge | Icons & utilities | Iconography and conditional class composition across every screen. |

### Backend & data

| Technology | What it is | How AyuSphere uses it |
|---|---|---|
| **Neon Postgres (serverless)** | Managed serverless Postgres (WebSocket driver via `ws`) | The single system of record: 25+ tables — trials, sites, participants, CRFs, AEs, signatures, amendments, queries, audit events, guide threads. |
| **Drizzle ORM + drizzle-kit** | Type-safe SQL builder + migrations | Every query is parameterized from the typed schema — string-built SQL does not exist in the codebase. Versioned generated migrations (0001–0009). |
| **Zod 4** | Runtime validation | Every service input parsed at the boundary — types, lengths, enums, ranges — before any logic runs. |
| **Vercel Blob** | Object storage | Consent forms, documents, doctor-note images under unguessable UUID paths. |
| **In-process TTL cache (`src/lib/ttl-cache.ts`)** | Dependency-free response cache (ADR D-030) | Portfolio aggregates (45s), search (60s), Sphera config + fresh-thread replies cached per warm instance with stampede protection — audited responses and live badges provably never cached. |

### Auth & security

| Technology | What it is | How AyuSphere uses it |
|---|---|---|
| **Auth.js (NextAuth v5)** | Authentication framework | Credentials sign-in, **JWT session capped at 12 hours** carrying id/role/site; built-in CSRF protection. |
| **bcryptjs** | Adaptive password hashing | Cost factor **12**; also re-verified on every electronic signature. |
| **node:crypto (SHA-256)** | Hashing | Every e-signature stores the SHA-256 of the canonical JSON of the signed record — tampering is detectable. |

### AI

| Technology | What it is | How AyuSphere uses it |
|---|---|---|
| **LangGraph + LangChain** | Agent-graph framework | Sphera is a StateGraph: loads the user's persisted thread, injects only THAT role's knowledge, streams tokens, saves the turn to Postgres — memory survives refreshes and devices. |
| **Groq (ChatGroq)** | Low-latency LLM API | Powers Sphera. Admin pastes the key once in Settings (stored server-side, serves all roles); env-var fallback for dev. |
| **Anthropic Claude SDK** | Claude API client | Clinical copilot + doctor-note extraction (image → structured **draft** CRF, always human-approved). |

### Testing & tooling

| Technology | What it is | How AyuSphere uses it |
|---|---|---|
| **Vitest + PGlite** | Test runner + Postgres-in-WASM | **297 tests / 47 files against real embedded Postgres** — RBAC denials, audit atomicity, signature refusal, randomization balance, export formats. |
| **Playwright** | Browser automation | Live E2E sweeps against the deployed site + the PDF generators for these guides. |
| **Faker** | Synthetic data | Every participant, CRF value and AE in the demo DB is synthetic. |
| ESLint 9 · tsx · pnpm | Lint / script runner / packages | `pnpm verify` = typecheck + full test suite; nothing merges red. |

### Platform

| Technology | How AyuSphere uses it |
|---|---|
| **Vercel** | Auto-deploys every push to main; Vercel Cron drives alert/deadline sweeps (bearer-secret protected). Cloud-based per the PS. |
| **GitHub (trunk-based)** | Single main branch, small verified commits — the repo is itself an audit trail of the build. |

## 3 · Architecture & workflows

### 3.1 · The life of every write

Every clinical-record change — enrolment, CRF entry, AE capture, approval — travels one pipeline; there is no second path around it:

```
Browser (role sees only permitted actions)
  → Next.js server action / API route   (session from 12h JWT · HTTPS · CSRF)
  → Zod schema                          (invalid → rejected with field errors)
  → RBAC assertCan(role, capability)    (denied → RbacError, nothing executes)
  → Service layer                       (state machines, deadline rules, randomization)
  → withAudit() transaction             (mutation + audit row commit together or not at all)
  → Drizzle ORM → Neon Postgres         (parameterized SQL; audit_events is insert-only)
```

### 3.2 · Sphera — the AI guide with memory

```
User asks Sphera (leaf orb)
  → /api/guide            (session checked; per-user thread loaded from guide_messages)
  → LangGraph StateGraph  (injects ONLY this role's knowledge — can't describe screens the role can't open)
  → ChatGroq              (key from admin Settings, server-side; never sent to the browser)
  → streamed tokens → browser · turn persisted to Postgres (memory survives sessions/devices)
```

### 3.3 · Interoperability — data out, data in

**Out:** one-click CDISC **SDTM** (DM/AE), **ADaM ADSL**, **Define-XML** (real variable-level metadata), **FHIR R4 Bundle**; live API `GET /api/fhir/Bundle/[trialId]` serves `application/fhir+json`.
**In:** inbound FHIR Observation bundles land as **draft** CRFs only — imported values become clinical data only after human review and a signed approval. Nothing auto-commits.

## 4 · Privacy vs Security

| | **Security** — protecting the data | **Privacy** — governing the data |
|---|---|---|
| Question it answers | "Can the wrong person get in, read, or change this?" | "Should this data exist here at all, and who is entitled to see it?" |
| Tools | Authentication, authorization, hashing, validation, audit trails, TLS | Data minimization, de-identification, consent, purpose limitation, role-scoped visibility |
| Failure looks like | A breached account, a forged record, an injected query | A perfectly "secure" system storing names it never needed |

**The relationship:** security protects whatever data you hold; privacy decides what you hold and who is entitled to it. You can have security without privacy (a well-locked vault of data you should never have collected) — but never privacy without security. AyuSphere's strongest privacy control is that **identifying data is never collected in the first place** (§6), and everything that IS collected sits behind the layers in §5. This is the posture India's **DPDP Act** and ICMR/GCP guidelines expect.

## 5 · Security in AyuSphere — every layer, as implemented

1. **Authentication** — Auth.js v5 credentials sign-in; **bcrypt cost 12** (brute force computationally expensive); **12-hour JWT** sessions carrying id/role/site; deactivated accounts refused; built-in CSRF protection.
2. **Authorization (RBAC)** — one capability matrix in `src/lib/rbac.ts` (7 roles × 18 capabilities) is the only permission truth. The UI hides what you can't do, but the **service layer independently re-checks** every call with `assertCan()` — bypassing the UI changes nothing. The regulator role holds **zero mutating capabilities**, an invariant enforced by an automated test. (The PDF renders the full matrix directly from this file.)
3. **Auditability (ALCOA+)** — `withAudit()`: every mutation and its audit event insert **in the same database transaction** — an unaudited write cannot commit, a failed write leaves no audit noise. Rows carry actor id + role, action, entity, **before/after JSON**; the table is insert-only; even cron writes are attributed to a fixed system actor.
4. **Electronic signatures** — record-freezing actions (approve CRF, approve correction, mark safety report submitted) require the actor to **re-enter their password** (bcrypt-verified — a stolen open session cannot sign) and store a **SHA-256 hash of the canonical JSON** of the record, committed in the same transaction as the guarded change. Fixed 21-CFR-11-style meaning statements are shown verbatim at signing.
5. **Input safety** — Zod validation on every service input; SQL injection structurally prevented (Drizzle parameterized statements only, no string-built SQL); React escapes output (no untrusted raw HTML).
6. **Secrets & services** — Groq key stored server-side via admin Settings, the client only ever receives `keySet: true/false` — the key value never reaches a browser; env fallback; `.env` untracked; `/api/cron/alerts` requires a `CRON_SECRET` bearer token; TLS end to end (browser → Vercel → Neon). **Caching is audit-safe by written policy (ADR D-030):** exports and FHIR reads are served `no-store` (every download writes an audit row a cache hit would skip); badge counts are never cached — performance work is not allowed to bend compliance.
7. **Safe interoperability & AI** — FHIR import creates drafts behind the `crf.enter` capability; AI extraction outputs are drafts too — **no imported or AI-generated value becomes clinical record without a signed human approval**.

> **Hardening roadmap (stated honestly):** a competition prototype with three planned production upgrades — (1) private, access-checked blob reads for uploaded documents (currently unguessable-URL public storage); (2) strict Content-Security-Policy and related headers; (3) KMS-encrypted AI key at rest. None affect clinical data, which lives entirely in Postgres behind the layers above.

## 6 · Privacy in AyuSphere — DPDP-aligned by design

- **De-identification is structural, not procedural.** The participants table has **no name, phone, address or date-of-birth columns — they do not exist in the schema**. The only identity is a subject code (`AYU-001-P-0042`). The system cannot leak what it cannot store; re-identification keys stay offline at the site, as GCP source documents intend.
- **Data minimization** — only trial-relevant fields are collected.
- **Consent as data** — consent binds the **specific consent-form version** signed; a new version automatically flags **re-consent**; withdrawal is a first-class audited state.
- **Role-scoped visibility** — the RBAC matrix is also a privacy control: purpose limitation enforced in code.
- **Demo data policy** — real **CTRI registry trials** (public records), **100% synthetic participants** (Faker). No real patient data exists anywhere in the deployment.
- **Accountability** — the same audit trail that serves GCP serves DPDP: every touch of participant data is attributable and reviewable.

## 7 · What makes this build stand out

- **An unaudited write cannot commit.** Audit is a transactional invariant, not a log file — if the audit insert fails, the clinical change rolls back with it.
- **Signatures are cryptographic, not cosmetic.** Password re-verification + SHA-256 record hash + fixed meaning statement, atomic with the change.
- **One knowledge base powers the AI guide, the UAT guides — and this document.** Sphera's knowledge, the 7 UAT guides, the RBAC table and the version numbers are generated from the same source files, with drift-guard tests. Zero documentation rot, by construction.
- **319 tests on real Postgres** (PGlite) — RBAC denials, audit atomicity, signature refusals, randomization balance, export formats, timezone rules and phone detection proven on every commit.
- **Lighthouse 98 · 100 · 100 · 100** — measured on the live deployment; backed by audit-safe caching, instant loading skeletons, lazy media.
- **Installs like a native app on phones** — PWA manifest + phone-only banner with honest platform behavior: native install dialog on Android, the true Share → Add to Home Screen path on iOS (never a fake button), tested exclusions for desktop and iPads.
- **Interoperability is live, both directions** — judges can curl the FHIR endpoint during the demo.
- **Regulation is configurable, not hard-coded** — AE/SAE deadlines, enrolment-lag thresholds and monitoring cadence live in an admin-edited, audited rule table.
- **Scientific rigor built in** — permuted-block randomization, approval-blocking data queries, IEC-gated amendments, DSMB packs from live signals, NPvCC national-PV intake.
- **AI with guardrails and memory** — Sphera remembers across sessions but knows only your role's screens; no AI output becomes clinical data without a signed human approval.

## 8 · Performance engineering — measured, layered, audit-safe

**Lighthouse (live deployment, 14 Sep 2026): Performance 98 · Accessibility 100 · Best Practices 100 · SEO 100.**

Three layers, applied in order (full 14-point triage in `docs/performance-audit.md`):

1. **Actual latency — response caching (ADR D-030):** warm dashboard render 1044ms → 502ms; a repeated Sphera question 1958ms → 276ms with zero LLM cost. Hard carve-outs: audited exports/FHIR reads and live badges are *never* cached (§5.6).
2. **Perceived latency — loading skeletons:** every navigation paints instantly (design-system skeleton) while the server renders, instead of freezing the old page for 500–1100ms.
3. **Hygiene — audited against a 14-point checklist:** lazy-loaded media, dead dependencies removed; the other 11 items are covered by the platform (Vercel CDN/compression/minification, App Router code-splitting, pooled Neon driver) or already engineered — each verdict recorded with code evidence.

## 9 · Engineering workflow

- **Trunk-based development** — one `main` branch, small frequent commits, every push auto-deploys to Vercel.
- **Merge gate** — `pnpm verify` = strict typecheck + all 319 tests; nothing ships red.
- **Schema discipline** — every DB change is a generated, versioned Drizzle migration; the schema's history is replayable.
- **Live E2E** — Playwright sweeps run against the deployed site itself, testing what judges will actually touch.
- **Docs as code** — 30 ADRs, the gap analysis vs the problem statement, task tracking and these generated guides all live in the repository.
