# AyuSphere — Decision Log (ADR)

Every significant decision taken for the AyuSphere build is recorded here, newest at the bottom.
Format: **ID · Date · Decision · Alternatives considered · Rationale · Consequences**.

Related docs: [development-plan.md](development-plan.md) · [architecture.md](architecture.md) · [technology.md](technology.md) · [workflow.md](workflow.md)

---

## D-001 — Next.js full-stack monolith (no separate backend)

- **Date:** 2026-09-11
- **Decision:** Build the entire application — UI, API, business rules, AI integration — inside one Next.js (App Router) + TypeScript codebase using server actions and route handlers. No Node/Express or FastAPI service.
- **Alternatives:** (a) Node.js API + FastAPI AI service as shown on deck slide 3; (b) Next.js frontend + separate NestJS backend.
- **Rationale:** User directive; one language, one repo, one deploy. Hackathon timelines punish multi-service coordination. Server actions give end-to-end type safety with Zod.
- **Consequences:** Deck slide 3's stack graphic ("Node.js, FastAPI") is superseded — the pitch narration should say "Next.js full-stack with TypeScript." Long-running AI calls must respect serverless timeout limits (mitigated in D-005).

## D-002 — Neon Postgres as the database

- **Date:** 2026-09-11
- **Decision:** Neon serverless Postgres (India-adjacent region, e.g. `ap-southeast-1`, closest available) as the single source of truth.
- **Alternatives:** Supabase Postgres, PlanetScale (MySQL), locally installed Postgres.
- **Rationale:** User directive. Serverless driver works over HTTP/WebSocket from Vercel functions; branching gives free per-preview databases; generous free tier for the hackathon.
- **Consequences:** Use `@neondatabase/serverless` driver. Note for the compliance narrative: production deployment would move to an India data-resident Postgres (MeitY-empanelled cloud) — Neon is the development/demo host. Record this caveat in the demo Q&A prep.

## D-003 — Drizzle ORM over Prisma

- **Date:** 2026-09-11
- **Decision:** Drizzle ORM + drizzle-kit for schema, migrations, and queries.
- **Alternatives:** Prisma, Kysely, raw SQL.
- **Rationale:** First-class Neon serverless-driver support, zero binary/engine (fast cold starts on Vercel), SQL-first schema that doubles as documentation, TypeScript inference end to end.
- **Consequences:** Migrations via `drizzle-kit generate`/`migrate`. Team members familiar with Prisma need a short ramp-up; the schema file in `src/db/schema.ts` is the canonical data model.

## D-004 — Auth.js (NextAuth v5) with credentials + JWT

- **Date:** 2026-09-11 (user Q&A)
- **Decision:** Auth.js v5, Credentials provider (email + password, bcrypt-hashed in Neon), JWT session strategy, role claim embedded in the token.
- **Alternatives:** Clerk (hosted), Lucia, custom JWT.
- **Rationale:** Free, no external service in the demo path, full control over the 7 custom roles and the audit hooks on login events. Judges can be shown auth working offline of any third party.
- **Consequences:** We own password hashing, session invalidation, and rate limiting on the login route. Demo accounts (one per role) are created by the seed script.

## D-005 — Claude API for OCR/extraction and Copilot (no Tesseract, no Python)

- **Date:** 2026-09-11 (user Q&A)
- **Decision:** Doctor Note Intelligence uses Claude's vision capability (image in → structured JSON out with per-field confidence) via a Next.js route handler. The AI Copilot uses Claude with retrieved, RBAC-filtered trial records as context.
- **Alternatives:** Tesseract + spaCy in a FastAPI microservice (deck slide 3); Google Vision API; AWS Textract.
- **Rationale:** A vision LLM handles handwriting + entity extraction + CRF-field mapping in one prompted step, which Tesseract alone cannot; removes a whole service from the architecture. Structured-output prompting returns exactly the CRF draft shape we need.
- **Consequences:** Deviation from deck slide 3 ("Tesseract") — position Claude as the "Vision-LLM" the slide already names. API cost is bounded by demo volume. All extraction responses must carry confidence values and be treated as **draft-only until doctor approval** (see workflow.md §6). Model: default `claude-sonnet-5`; the model id is a config value, not hard-coded.

## D-006 — shadcn/ui + Tailwind as the component base

- **Date:** 2026-09-11
- **Decision:** shadcn/ui components (copied into the repo, fully ownable) on Tailwind CSS, restyled with our glass/clay token layer.
- **Alternatives:** MUI, Ant Design, Chakra, Mantine.
- **Rationale:** User directive. shadcn's copy-in model lets us bend every component to the glass/clay design language; Radix primitives give accessibility for free.
- **Consequences:** No component library version-lock; the design tokens in `globals.css`/`tailwind.config.ts` are the single styling authority.

## D-007 — Glassmorphism + claymorphism hybrid, with strict usage rules

- **Date:** 2026-09-11
- **Decision:** Two surface treatments only: **glass** (translucent, `backdrop-blur`, 1px light border) for navigation, overlays, modals, and the Copilot panel; **clay** (soft extruded, large radius, layered soft shadows, inner highlight) for content cards, KPI tiles, and primary CTAs. Never mixed on the same element.
- **Alternatives:** Pure flat minimal; neumorphism; standard Material elevation.
- **Rationale:** User directive. The rule ("glass = chrome, clay = content") keeps the hybrid coherent instead of decorative.
- **Consequences:** Both treatments are defined once as Tailwind utilities/CSS classes (`.glass`, `.clay`, `.clay-sm`) — components never hand-roll blur/shadow values. Contrast on glass surfaces must be AA-checked.

## D-008 — One font, exactly two font sizes

- **Date:** 2026-09-11
- **Decision:** Single typeface: **Plus Jakarta Sans** (variable). Exactly two sizes: `--text-body: 0.875rem` (14px) and `--text-heading: 1.5rem` (24px). All other hierarchy comes from weight (400/500/700), opacity steps (100%/70%/50%), letter-spacing, and uppercase micro-labels at body size.
- **Alternatives:** Inter; a two-typeface system; a conventional 6-step type scale.
- **Rationale:** User directive ("only 1 font and 2 font sizes, minimalist"). Constraint enforces the minimalist discipline; Jakarta Sans has the geometric warmth that suits a healthcare-consumer aesthetic (Airbnb-adjacent).
- **Consequences:** Tailwind's default text-size utilities are disabled/unused; only `text-body` and `text-heading` tokens exist. Big KPI numerals use `text-heading` with weight 700 — no third size is introduced. Edge cases (chart axis labels, badges) use `text-body` scaled by opacity/weight, never a new size.

## D-009 — Framer Motion for animation, Airbnb-style motion values

- **Date:** 2026-09-11
- **Decision:** Framer Motion (`motion` package) for all animation. Fixed motion vocabulary: durations 200ms (micro) / 300ms (standard) / 450ms (page), easing `cubic-bezier(0.32, 0.72, 0, 1)`, spring for drag/hover lift, `AnimatePresence` for exits, shared-layout transitions for list→detail, staggered children (40ms) on dashboards. `prefers-reduced-motion` respected globally.
- **Alternatives:** CSS transitions only; GSAP; React Spring.
- **Rationale:** User directive ("modern smooth animations like Airbnb"). A fixed vocabulary keeps motion consistent — the Airbnb feel comes from restraint plus physicality, not variety.
- **Consequences:** A `src/lib/motion.ts` exports the variants catalog; components import variants, never inline ad-hoc values.

## D-010 — Append-only audit trail for ALCOA+

- **Date:** 2026-09-11
- **Decision:** A single `audit_events` table, insert-only (no UPDATE/DELETE grants in app role), written by the service layer on every mutation: actor, role, action, entity type/id, before/after JSON, timestamp, request id. Domain tables use soft-delete + status fields; nothing is hard-deleted.
- **Alternatives:** Postgres triggers writing the log; temporal tables; event-sourcing everything.
- **Rationale:** PS mandates an "immutable, time-stamped audit trail" (ALCOA+). Service-layer writes keep the log semantically rich (business action names, not row diffs); insert-only DB grants provide the immutability guarantee.
- **Consequences:** Every server action goes through a `withAudit()` wrapper — bypassing it is a code-review blocker. The regulator role gets a read-only audit browser (workflow.md §13).

## D-011 — SWR polling for "real-time", no websockets in MVP

- **Date:** 2026-09-11
- **Decision:** Dashboards and alert badges refresh via SWR with 10–15s `refreshInterval` plus revalidate-on-focus. No websocket/SSE infrastructure in the MVP.
- **Alternatives:** Pusher/Ably, Supabase Realtime, self-hosted SSE.
- **Rationale:** The PS's "real-time" requirement is about decision latency (minutes matter, not milliseconds). Polling is zero-infra, works on Vercel serverless, and demos identically.
- **Consequences:** Documented honestly as a staged item — roadmap slot for SSE if ever needed. Alert evaluation itself runs synchronously on writes + a Vercel cron sweep (see architecture.md §8).

## D-012 — Zod as the single validation layer

- **Date:** 2026-09-11
- **Decision:** Zod schemas define every form, server-action input, CRF field ruleset, and Claude structured-output shape. Shared between client and server from `src/lib/schemas/`.
- **Alternatives:** Yup, Valibot, per-layer manual validation.
- **Rationale:** One schema = client validation + server enforcement + TypeScript types + the CRF range/unit checks the PS demands ("data quality checks"). Claude's extraction output is parsed through the same schemas, so AI output can never bypass validation.
- **Consequences:** CRF templates store their field rules as data; a factory builds Zod schemas from templates at runtime.

## D-013 — Recharts for dashboard visualization

- **Date:** 2026-09-11
- **Decision:** Recharts for enrolment curves, site-performance bars, participant-distribution donuts, and KPI sparklines.
- **Alternatives:** Chart.js, Visx, Tremor, ECharts.
- **Rationale:** React-native composition model, plays well with shadcn (shadcn's chart primitives wrap Recharts), light enough for the MVP chart set.
- **Consequences:** Chart colors bind to the design tokens (D-015 palette), never library defaults; axis/tick labels use the body size token per D-008.

## D-014 — Vercel hosting + Vercel Blob for file storage

- **Date:** 2026-09-11
- **Decision:** Deploy on Vercel (preview per PR, production on main). Doctor-note images and trial documents go to Vercel Blob, private access, URLs resolved through an authorizing route handler.
- **Alternatives:** Netlify, Railway, AWS Amplify; S3/UploadThing/Supabase Storage for files.
- **Rationale:** Tightest Next.js integration, zero-config previews for team demos; Blob keeps storage in the same account/console.
- **Consequences:** Original note images are retained as **source evidence** (PS/feature-plan requirement) with their extraction records pointing at the blob URL. Same data-residency caveat as D-002 for the production narrative.

## D-015 — Color system: Ayurveda green primary + semantic status set

- **Date:** 2026-09-11
- **Decision:** Primary `#1B7A43` (deep Ayurveda green) with a 3-step tint ramp; neutrals are warm off-whites/charcoals; semantic set: success green, warning amber, danger red (AE/SAE + overdue), info blue. Dark-ink-on-light default theme. Status colors are reserved for status — never decoration.
- **Alternatives:** Full 10-step Tailwind palette per hue; multi-accent theme.
- **Rationale:** Continuity with the deck's green identity; minimalism rule (D-008 spirit) extends to color: few tokens, strict semantics. Clinical software must make danger/overdue unmistakable.
- **Consequences:** Tokens defined as CSS variables consumed by Tailwind config; charts, badges, and the escalation clock all pull from the same set.

## D-016 — Synthetic data only, generated by a seed script

- **Date:** 2026-09-11
- **Decision:** All demo data is synthetic, generated deterministically by `src/db/seed.ts` (faker with a fixed seed): 7 role users, ~4 trials across lifecycle stages, ~8 sites, ~400 participants, visits, CRF entries, AEs at varying deadline proximity, and pre-aged audit events. Trial titles/shapes modeled on public CTRI records (metadata only).
- **Alternatives:** Hand-entered demo data; scraped real datasets.
- **Rationale:** The PS mandates synthetic/de-identified data — clinical-trial data is sensitive personal data under DPDP. Deterministic seeding makes every demo and preview environment identical.
- **Consequences:** No real personal data ever enters any environment. The seed intentionally plants "demo moments": one AE near its reporting deadline, one lagging site, one data-quality conflict for the Doctor Note demo.

## D-017 — FHIR/CDISC focused subset first

- **Date:** 2026-09-11
- **Decision:** Interoperability ships as a focused, demonstrable subset: FHIR R4 `ResearchStudy`, `ResearchSubject`, `Patient` (de-identified), `AdverseEvent` JSON export; CDISC SDTM `DM` (demographics) and `AE` (adverse events) domains as CSV/Define-XML-stub. CDASH-style naming used in CRF templates from day one.
- **Alternatives:** Full SDTM/ADaM pipeline; HAPI FHIR server integration; skip interop entirely.
- **Rationale:** Matches the PS's staged-build expectation and deck slide 4's stated risk control ("focused subset first, expand via mapping library"). A judge can be shown a real FHIR bundle and a real SDTM file — depth over breadth.
- **Consequences:** Internal schema fields carry CDASH-aligned names so export is mapping, not migration. ADaM and full Define-XML are roadmap items, said plainly.

## D-018 — Documentation-first: this 5-file docs suite precedes code

- **Date:** 2026-09-11
- **Decision:** `docs/` (development-plan, architecture, technology, workflow, decisions) is written before scaffolding the app; all future significant choices append to this file.
- **Alternatives:** README-only; docs after code.
- **Rationale:** User directive; a 6-member SIH team needs a shared contract before parallel work starts.
- **Consequences:** PRs that contradict a recorded decision must either follow it or amend the ADR first.

## D-019 — Docker removed completely; PGlite for tests

- **Date:** 2026-09-11
- **Decision:** No Docker anywhere in development, testing, or deployment. Local dev runs `pnpm dev` against a Neon dev branch; automated tests run against **PGlite** (`@electric-sql/pglite`) — a real in-process Postgres (WASM) that Drizzle supports natively, needing no container, no daemon, no install beyond `pnpm install`. CI and Vercel likewise container-free.
- **Alternatives:** Postgres in Docker for local dev/tests (deck slide 3 showed a Docker logo); testcontainers; mocking the DB layer.
- **Rationale:** User directive ("remove docker completely"). PGlite gives faithful Postgres semantics for service-layer tests with zero infrastructure; Neon's serverless model already removed the need for a containerized runtime.
- **Consequences:** Deck slide 3's Docker logo is superseded in the technical narrative. Tests exercising Postgres-specific behavior run on PGlite; anything PGlite can't express (rare) is covered against the Neon dev branch manually. No `Dockerfile`/`docker-compose` will ever exist in the repo.

## D-020 — Test-gated task workflow (Vitest)

- **Date:** 2026-09-11
- **Decision:** Every phase is broken into tasks in [tasks.md](tasks.md); a task is **done only when its minimum tests pass** (`pnpm test` green + `tsc --noEmit` clean), and the next task starts only then. **Vitest** is the test runner: pure domain logic tested as unit tests, services tested against PGlite, AI flows tested with a mocked Claude client, UI gated by typecheck + production build.
- **Alternatives:** Jest; test-after-phase instead of test-per-task; E2E-only testing.
- **Rationale:** User directive (each task completes when it passes minimum tests, then proceed). Vitest is the fastest TS-native runner and shares the Vite pipeline.
- **Consequences:** `docs/tasks.md` is the live task board — each task lists its test gate and status. A red test blocks progression, not just merging.

---

## Template for new decisions

```markdown
## D-0XX — <short title>

- **Date:** YYYY-MM-DD
- **Decision:** <what was decided, one or two sentences>
- **Alternatives:** <what else was considered>
- **Rationale:** <why this option won>
- **Consequences:** <what this commits us to, trade-offs accepted, follow-ups>
```
