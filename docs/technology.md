# AyuSphere — Technology Document

Complete technology stack, design system, and tooling for the AyuSphere build.
Every choice here has a matching entry in [decisions.md](decisions.md) (referenced as D-0XX).

Related docs: [development-plan.md](development-plan.md) · [architecture.md](architecture.md) · [workflow.md](workflow.md)

---

## 1. Stack at a glance

| Layer | Technology | Version target | Why (ADR) |
|---|---|---|---|
| Framework | **Next.js (App Router)** + **TypeScript** (strict) | Next 15.x, TS 5.x | One full-stack codebase; RSC for fast dashboards; server actions for typed mutations (D-001) |
| Database | **Neon Postgres** (serverless) | Postgres 16 | Serverless driver from Vercel functions; DB branching per preview (D-002) |
| ORM / migrations | **Drizzle ORM** + drizzle-kit | latest | No engine binary, fast cold starts, SQL-first schema (D-003) |
| Auth | **Auth.js (NextAuth v5)** — Credentials + JWT | v5 | Self-owned auth for 7 custom roles; no external dependency in demo (D-004) |
| AI — OCR/extraction & Copilot | **Claude API** (`claude-sonnet-5`, vision + text) | Messages API | One model does handwriting OCR + entity extraction + CRF mapping + grounded Q&A (D-005) |
| UI components | **shadcn/ui** on **Tailwind CSS** | shadcn latest, TW 3.4+ | Copy-in components fully restylable to glass/clay (D-006) |
| Animation | **Framer Motion** | 11.x | Airbnb-quality shared layout transitions, springs, exit animations (D-009) |
| Validation | **Zod** | 3.x | One schema → client + server + CRF rules + AI output parsing (D-012) |
| Charts | **Recharts** (via shadcn chart primitives) | 2.x | Composable React charts bound to design tokens (D-013) |
| Data fetching (client) | **SWR** | 2.x | Polling-based "real-time" dashboards, revalidate on focus (D-011) |
| File storage | **Vercel Blob** (private) | — | Doctor-note images + trial documents as source evidence (D-014) |
| Hosting | **Vercel** | — | Preview deploy per PR; production on `main` (D-014) |
| Package manager | **pnpm** | 9.x | Fast, strict, workspace-ready |
| Tests | **Vitest** + **PGlite** (`@electric-sql/pglite`) | latest | Test-gated tasks (D-020); in-process real Postgres for service tests — **no Docker, no containers anywhere** (D-019) |
| Lint / format | ESLint (next config) + Prettier | — | Zero-debate formatting |
| Seed / synthetic data | `@faker-js/faker`, fixed seed | — | Deterministic synthetic demo data (D-016) |

### Key packages

```
next react react-dom typescript
drizzle-orm @neondatabase/serverless drizzle-kit
next-auth@beta bcryptjs
@anthropic-ai/sdk
tailwindcss class-variance-authority tailwind-merge lucide-react
framer-motion
zod
recharts
swr
@vercel/blob
@faker-js/faker (dev)
```

### Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon pooled connection string |
| `AUTH_SECRET` | Auth.js JWT signing secret |
| `ANTHROPIC_API_KEY` | Claude API |
| `ANTHROPIC_MODEL` | Model id, default `claude-sonnet-5` (config, not hard-coded — D-005) |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob |

---

## 2. Design system — "Calm Clinical"

The visual language is **minimalist, one-font/two-size, glass + clay, Airbnb-smooth**. Everything below is tokenized once; components never hand-roll values.

### 2.1 Typography (D-008)

- **One typeface:** Plus Jakarta Sans (variable), loaded via `next/font` with `font-display: swap`, full fallback stack (`system-ui, sans-serif`).
- **Exactly two sizes:**

| Token | Value | Line height | Used for |
|---|---|---|---|
| `--text-body` | 0.875rem (14px) | 1.6 | Everything: paragraphs, labels, table cells, buttons, inputs, chart labels, badges |
| `--text-heading` | 1.5rem (24px) | 1.25 | Page titles, section headings, KPI numerals |

- **Hierarchy without new sizes** — the only permitted levers:
  - Weight: 400 (body), 500 (emphasis/labels), 700 (headings, KPI numbers)
  - Opacity: 100% primary · 70% secondary · 50% muted/meta
  - Micro-labels: body size, uppercase, `tracking-widest`, 70% opacity, weight 500
- **Hard rule:** no `text-xs`, `text-lg`, etc. anywhere in the codebase. Tailwind config exposes only `text-body` and `text-heading`.

### 2.2 Color tokens (D-015)

```css
:root {
  /* Brand */
  --primary:        #1B7A43;  /* deep Ayurveda green — actions, active nav, focus rings */
  --primary-soft:   #E8F4EC;  /* tint — selected states, soft badges */
  --primary-deep:   #0F5230;  /* pressed / dark accents */

  /* Neutrals (warm) */
  --bg:             #F7F6F3;  /* app ground */
  --surface:        #FFFFFF;  /* clay card base */
  --ink:            #1C1E1D;  /* primary text */
  --line:           #E5E3DE;  /* hairline borders */

  /* Semantic — status only, never decoration */
  --success:        #1B7A43;
  --warning:        #B7791F;  /* amber — approaching deadline, lagging site */
  --danger:         #C0392B;  /* red — SAE, overdue, breached deadline */
  --info:           #2563EB;  /* blue — informational alerts, monitor role */
}
```

- Charts pull series colors from `--primary` ramp + semantic set; status colors appear **only** when they mean status.
- Contrast: all text/background pairs AA-checked, including text over glass surfaces.

### 2.3 Spacing & layout (minimalist rules)

- **8-pt grid**: allowed spacing steps `4 / 8 / 12 / 16 / 24 / 32 / 48 / 64px` — nothing off-grid.
- Page gutter 24px (16px at phone width); content max-width 1280px; dashboard grid 12-col, 24px gap.
- Card interior padding 24px; between-card gap 24px; section gap 48px.
- **Whitespace is the hierarchy tool** — prefer space over dividers; hairline `--line` borders only where scanning requires them (tables).
- Density: dashboards breathe; tables are the one intentionally compact surface (12px cell padding).

### 2.4 Surface language — glass + clay (D-007)

Two treatments, strict jobs, defined once as utility classes:

| | `.glass` | `.clay` |
|---|---|---|
| **Job** | Chrome: sidebar, top bar, modals/sheets, Copilot panel, toasts | Content: KPI tiles, cards, form sections, primary CTA buttons |
| **Fill** | `rgba(255,255,255,0.65)` | `--surface` |
| **Blur** | `backdrop-filter: blur(16px)` | none |
| **Border** | 1px `rgba(255,255,255,0.5)` | none (shadow does the work) |
| **Radius** | 16px | 20px (cards) / 14px (buttons) |
| **Shadow** | `0 8px 32px rgba(28,30,29,0.08)` | layered soft: `0 2px 4px rgba(28,30,29,0.04), 0 12px 24px rgba(28,30,29,0.06), inset 0 1px 0 rgba(255,255,255,0.8)` |

- **Never mixed** on one element; never nest glass inside glass.
- Clay hover state: translate-y −2px + shadow deepens (the "lift").
- Glass requires a subtly tinted app background (`--bg` + faint green radial glow) so the blur reads.

### 2.5 Motion — Airbnb-style (D-009)

Central catalog in `src/lib/motion.ts`; components import variants, never inline values.

| Token | Value |
|---|---|
| Micro (hover, press, toggle) | 200ms |
| Standard (card enter, dropdown, accordion) | 300ms |
| Page / modal | 450ms |
| Easing (default) | `cubic-bezier(0.32, 0.72, 0, 1)` — fast out, soft landing |
| Spring (hover lift, drag) | `{ stiffness: 380, damping: 30 }` |
| Dashboard stagger | 40ms/child, fade + 12px rise |

Signature moves:
- **Shared layout** (`layoutId`) from list row → detail panel (trial list → trial page header).
- **AnimatePresence** on every modal/sheet/toast — nothing pops or vanishes.
- KPI numbers **count up** on load (400ms, eased).
- Escalation-clock ring animates continuously; turns `--danger` under threshold.
- Buttons: scale 0.98 on press.
- `prefers-reduced-motion`: all variants collapse to opacity-only, globally.

### 2.6 Component conventions (shadcn)

- shadcn components are copied in and restyled via the token layer only — no per-component custom CSS.
- Variants via `class-variance-authority`; `cn()` for class merging.
- Icons: lucide-react, 16px inline / 20px nav, `stroke-width: 1.75`.
- Empty states, loading skeletons (shimmer at 300ms), and permission-denied states are shared components — every page uses them (see workflow.md §14).

---

## 3. Repo layout

```
ayusphere/
├─ docs/                       # this suite
├─ drizzle/                    # generated migrations
├─ public/
├─ src/
│  ├─ app/
│  │  ├─ (auth)/login/
│  │  ├─ (app)/                # authed shell: glass sidebar + topbar
│  │  │  ├─ dashboard/
│  │  │  ├─ trials/[id]/
│  │  │  ├─ participants/
│  │  │  ├─ sites/
│  │  │  ├─ visits/
│  │  │  ├─ crf/
│  │  │  ├─ adverse-events/
│  │  │  ├─ doctor-note/       # image → CRF review UI
│  │  │  ├─ copilot/
│  │  │  ├─ alerts/
│  │  │  ├─ documents/
│  │  │  ├─ exports/           # FHIR / SDTM
│  │  │  ├─ audit/             # regulator + admin view
│  │  │  └─ settings/
│  │  └─ api/                  # route handlers (upload, ai, cron)
│  ├─ components/ui/           # shadcn (restyled)
│  ├─ components/app/          # KPI tile, escalation clock, confidence field…
│  ├─ db/  (schema.ts, seed.ts, index.ts)
│  ├─ lib/ (auth.ts, motion.ts, rbac.ts, audit.ts, ai/, schemas/, rules/)
│  └─ services/                # trial, participant, visit, crf, ae, alert, export
├─ drizzle.config.ts
└─ tailwind.config.ts
```

---

## 4. Standards & compliance mapping (what tech satisfies which PS requirement)

| PS requirement | Satisfied by |
|---|---|
| Role-based access (7 roles) | Auth.js JWT role claim + `rbac.ts` route/service guards |
| Immutable ALCOA+ audit trail | Insert-only `audit_events` table + `withAudit()` wrapper (D-010) |
| Real-time KPIs & alerts | SWR polling + write-time rule evaluation + Vercel cron sweep (D-011) |
| CDISC alignment | CDASH-style CRF field naming; SDTM DM/AE export (D-017) |
| HL7 FHIR R4 | JSON export: ResearchStudy, ResearchSubject, Patient, AdverseEvent (D-017) |
| AE/SAE timelines (NDCT-style) | Deadline engine + escalation clock component |
| DPDP: minimisation, consent, encryption | Synthetic data only (D-016); consent fields on participant; TLS + Neon AES-256 at rest |
| e-signatures / integrity | Approval actions record actor + timestamp + hash of approved payload (MVP-level e-sign) |
| Data-resident hosting (production) | Documented caveat: Neon/Vercel for demo, MeitY-empanelled cloud in production narrative (D-002/D-014) |
