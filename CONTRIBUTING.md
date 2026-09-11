# Contributing to AyuSphere

Thank you for your interest in contributing to **AyuSphere** — the AI-assisted Clinical Research Intelligence Platform for Ayurveda (SIH26046).

This document outlines the workflow, architecture standards, and verification rules required for all contributions.

---

## 1. Prerequisites

- **Node.js**: `v20.x` or higher
- **Package Manager**: `pnpm` (v9.15+ recommended)
- **Git**: Configured with your verified GitHub email (`git config user.email`)

---

## 2. Local Setup

1. **Clone your fork / repository:**
   ```bash
   git clone https://github.com/vansh459/AyuSphere.git
   cd AyuSphere
   ```

2. **Install dependencies:**
   ```bash
   pnpm install
   ```

3. **Configure Environment Variables:**
   ```bash
   cp .env.example .env.local
   ```
   Fill in the required variables in `.env.local`:
   - `DATABASE_URL`: Neon Postgres connection string
   - `AUTH_SECRET`: Random 32+ character secret
   - `ANTHROPIC_API_KEY` or `GEMINI_API_KEY`: API key for AI copilot and doctor-note extraction

4. **Initialize Database & Seed Data:**
   ```bash
   pnpm db:migrate
   pnpm db:seed
   ```

5. **Start Development Server:**
   ```bash
   pnpm dev
   ```
   Open [http://localhost:3000](http://localhost:3000). Demo credentials can be found in `README.md`.

---

## 3. Core Architecture & Non-Negotiable Rules

All contributions must adhere to the design rules established in `docs/decisions.md`:

- **Design System & Typography (D-008):**
  - AyuSphere enforces a strict **one-font, two-sizes** system.
  - Font: `Plus_Jakarta_Sans` variable font only.
  - Text sizes: Only `--text-body` (14px) and `--text-heading` (24px) are permitted. Default Tailwind text scales (`text-xs`, `text-sm`, `text-lg`, etc.) are prohibited and will fail `tests/design-qa.test.ts`.
- **Surfaces & Color Tokens (D-007, D-015):**
  - Use centralized CSS tokens (`--color-primary`, `--color-surface`, `--color-ink`, etc.).
  - Do not use arbitrary hex classes (e.g. `bg-[#ffffff]`) in components.
- **De-Identification by Schema (D-004):**
  - The `participants` table has no personal identifiers (PII). Never add columns for real names, phone numbers, or national IDs.
- **ALCOA+ Audit Atomicity:**
  - Every mutating database operation must commit within `withAudit()` to maintain an immutable audit trail.
- **In-Process Postgres (PGlite, D-019):**
  - Vitest runs entirely on `@electric-sql/pglite` — no Docker or external database instance is needed to run the 150+ unit and integration tests.

---

## 4. Verification Before Committing

Before creating a commit or submitting a Pull Request, always verify that your code compiles and all test gates pass:

```bash
# 1. Type check
pnpm typecheck

# 2. Run Vitest test suite (150+ tests)
pnpm test

# 3. Lint check
pnpm lint
```

Or run the combined verification script:
```bash
pnpm verify
```

---

## 5. Submitting a Pull Request

1. Create a dedicated branch for your change:
   ```bash
   git checkout -b fix/your-feature-name
   ```
2. Make your focused changes and ensure all tests pass.
3. Commit with a clear, conventional commit message:
   ```bash
   git commit -m "docs: add CONTRIBUTING guide and local verification workflow"
   ```
4. Push your branch and open a Pull Request against the `main` branch.
5. Provide a concise summary of what was changed and the verification steps taken.
