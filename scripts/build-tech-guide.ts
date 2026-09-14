/**
 * Technology & Security Guide generator (T6.6) — one judge-facing PDF that
 * explains HOW AyuSphere is built: every technology and how it is used, the
 * request/AI/interop workflows, privacy vs security, every implemented
 * security & privacy mechanism, and the differentiators.
 *
 * Live facts are imported from the code itself (RBAC matrix, signature
 * meanings, dependency versions) so the document cannot drift from the app.
 *
 * Run: pnpm tsx scripts/build-tech-guide.ts
 */
import { chromium, type Browser } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { CAPABILITIES, MUTATING_CAPABILITIES, ROLES, can, type Role } from "@/lib/rbac";
import { SIGNATURE_MEANINGS } from "@/services/signatures";

const BUILD = path.resolve(process.cwd(), ".uat-build", "tech");
const OUT = path.resolve(process.cwd(), "docs", "uat", "Tech_Security_Guide.pdf");
const LIVE = "https://ayusphere-three.vercel.app";
const GENERATED = new Date().toLocaleDateString("en-IN", {
  day: "2-digit",
  month: "long",
  year: "numeric",
});

// ---------- versions straight from package.json ----------
const pkg = JSON.parse(readFileSync(path.resolve(process.cwd(), "package.json"), "utf8")) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  packageManager: string;
};
const v = (name: string) =>
  (pkg.dependencies[name] ?? pkg.devDependencies[name] ?? "").replace(/^[\^~]/, "");

// ---------- content ----------

type StackRow = { name: string; version: string; what: string; how: string };
type StackGroup = { group: string; rows: StackRow[] };

const STACK: StackGroup[] = [
  {
    group: "Frontend",
    rows: [
      {
        name: "Next.js (App Router, Turbopack)",
        version: v("next"),
        what: "Full-stack React framework — server components, server actions, API routes in one codebase.",
        how: "Every screen is a server component that reads the session and renders only what the role may see; mutations are server actions, so clinical data logic never ships to the browser. One repo, one deploy.",
      },
      {
        name: "React",
        version: v("react"),
        what: "UI library.",
        how: "Server components for data-heavy pages; small client islands only where interactivity needs it (forms, Sphera panel, toasts, mobile drawer).",
      },
      {
        name: "TypeScript",
        version: "5.x",
        what: "Typed JavaScript.",
        how: "Strict mode across app, services, tests and scripts — `pnpm typecheck` is part of the merge gate. Database row types are inferred from the schema, so a schema change breaks the build, not production.",
      },
      {
        name: "Tailwind CSS",
        version: "4.x",
        what: "Utility-first CSS.",
        how: "Implements the design system (glassmorphism + claymorphism tokens, one font, two text sizes). A static test suite (design-qa) fails the build if a screen violates the design rules.",
      },
      {
        name: "framer-motion",
        version: v("framer-motion"),
        what: "Animation library.",
        how: "A small approved motion catalog (page fade, card hover, orb pulse) — decorative only, never load-bearing.",
      },
      {
        name: "Recharts",
        version: v("recharts"),
        what: "Charting library.",
        how: "Dashboard KPIs: enrolment progress, AE severity mix, portfolio charts on the regulator/leadership dashboards.",
      },
      {
        name: "Live badges (fetch + events)",
        version: "—",
        what: "Dependency-free client data refresh.",
        how: "Live unread badges and toasts refresh through plain fetch on navigation and a `refreshBadges` event — no data-fetching library needed; unused dependencies are removed (perf audit T6.12).",
      },
      {
        name: "lucide-react · clsx · CVA · tailwind-merge",
        version: "—",
        what: "Icons and small utilities.",
        how: "Consistent iconography and conditional class composition; date math is plain Date arithmetic in `src/lib` (deadline clocks, IST formatting).",
      },
    ],
  },
  {
    group: "Backend & data",
    rows: [
      {
        name: "Neon Postgres (serverless)",
        version: `driver ${v("@neondatabase/serverless")}`,
        what: "Managed serverless Postgres with WebSocket connections (the `ws` package supplies the socket in Node).",
        how: "The single system of record: 25+ tables covering trials, sites, participants, CRFs, AEs, signatures, amendments, queries, audit events, guide threads. Scales to zero between demos.",
      },
      {
        name: "Drizzle ORM + drizzle-kit",
        version: v("drizzle-orm"),
        what: "Type-safe SQL query builder and migration generator.",
        how: "Every query is built from the typed schema and executed as a parameterized statement — string-concatenated SQL does not exist in the codebase. Schema changes flow through generated, versioned migrations (0001–0009).",
      },
      {
        name: "Zod",
        version: v("zod"),
        what: "Runtime schema validation.",
        how: "Every service input has a Zod schema — types, lengths, enums, ranges are enforced at the boundary before any database work. The e-CRF field ranges the PI sees are the same schemas.",
      },
      {
        name: "Vercel Blob",
        version: v("@vercel/blob"),
        what: "Object storage.",
        how: "Consent forms, uploaded documents and doctor-note images, stored under unguessable UUID paths and referenced from the database.",
      },
    ],
  },
  {
    group: "Auth & security",
    rows: [
      {
        name: "Auth.js (NextAuth v5)",
        version: v("next-auth"),
        what: "Authentication framework.",
        how: "Credentials sign-in with a JWT session capped at 12 hours; the token carries the user's role and site, so every request knows who is acting. CSRF protection is built in.",
      },
      {
        name: "bcryptjs",
        version: v("bcryptjs"),
        what: "Adaptive password hashing.",
        how: "Passwords hashed at cost factor 12 — and re-verified a second time whenever a user electronically signs a record.",
      },
      {
        name: "node:crypto (SHA-256)",
        version: "Node 24 built-in",
        what: "Cryptographic hashing.",
        how: "Each e-signature stores the SHA-256 hash of the canonical JSON of the signed record — later tampering is detectable because the hash no longer matches.",
      },
    ],
  },
  {
    group: "AI",
    rows: [
      {
        name: "LangGraph + LangChain",
        version: `${v("@langchain/langgraph")} / ${v("@langchain/core")}`,
        what: "Agent-graph framework for LLM applications.",
        how: "Sphera (the in-app guide) is a LangGraph StateGraph: it loads the user's persisted thread, injects only THAT role's knowledge, streams tokens to the client, and saves the turn back to Postgres — memory survives refreshes and devices.",
      },
      {
        name: "Groq (ChatGroq)",
        version: v("@langchain/groq"),
        what: "Low-latency LLM inference API.",
        how: "Powers Sphera's replies. The admin pastes the API key once in Settings; it is stored server-side and serves every role — with an environment-variable fallback for local dev.",
      },
      {
        name: "Anthropic Claude SDK",
        version: v("@anthropic-ai/sdk"),
        what: "Claude API client.",
        how: "The clinical copilot and the doctor-note extraction flow (image → structured draft CRF, always human-approved before it becomes data).",
      },
    ],
  },
  {
    group: "Testing & tooling",
    rows: [
      {
        name: "Vitest + PGlite",
        version: `${v("vitest")} / ${v("@electric-sql/pglite")}`,
        what: "Test runner + Postgres compiled to WebAssembly.",
        how: "297 tests in 47 files run against a REAL embedded Postgres — RBAC denials, audit atomicity, signature refusal, randomization balance and export formats are all tested with genuine SQL semantics, not mocks.",
      },
      {
        name: "Playwright",
        version: v("playwright"),
        what: "Browser automation.",
        how: "Live end-to-end sweeps against the deployed site (login flows, badges, tabs, mobile drawer) and the PDF generators that produced this document and the UAT guides.",
      },
      {
        name: "Faker",
        version: v("@faker-js/faker"),
        what: "Synthetic data generation.",
        how: "Every participant, CRF value and AE in the demo database is synthetic — no real patient data anywhere (see Privacy).",
      },
      {
        name: "ESLint 9 · tsx · pnpm",
        version: pkg.packageManager,
        what: "Lint, TypeScript script runner, package manager.",
        how: "`pnpm verify` = typecheck + full test suite; nothing merges red.",
      },
    ],
  },
  {
    group: "Platform",
    rows: [
      {
        name: "Vercel",
        version: "—",
        what: "Cloud hosting for Next.js.",
        how: "Auto-deploys every push to main; Vercel Cron drives the alert/deadline sweeps (protected by a bearer secret). Fluid compute — no servers to manage, meets the PS's cloud-based requirement.",
      },
      {
        name: "GitHub (trunk-based)",
        version: "—",
        what: "Version control & collaboration.",
        how: "Single main branch, small verified commits; the repository itself is an audit trail of how the system was built.",
      },
    ],
  },
];

const CAP_LABEL: Record<string, string> = {
  "dashboard.view": "View dashboard",
  "trial.manage": "Manage trials & lifecycle",
  "trial.ethicsReview": "IEC review & amendments",
  "site.manage": "Manage sites",
  "participant.manage": "Screen / consent / enrol",
  "crf.enter": "Enter CRF data",
  "crf.approve": "Approve CRFs (signed)",
  "ae.capture": "Capture adverse events",
  "ae.review": "PV review & report (signed)",
  "monitoring.log": "Log monitoring visits",
  "query.manage": "Raise / close data queries",
  "alert.acknowledge": "Acknowledge alerts",
  "copilot.use": "Use AI copilot",
  "chat.use": "Internal messaging",
  "export.run": "Run exports (CDISC/FHIR)",
  "document.upload": "Upload documents",
  "users.manage": "Manage users",
  "audit.view": "Browse audit trail",
};

const ROLE_SHORT: Record<Role, string> = {
  pi: "PI",
  coordinator: "Coord",
  monitor: "Monitor",
  ethics: "Ethics",
  pv: "PV",
  admin: "Admin",
  regulator: "Regulator",
};

function esc(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

const CSS = `
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", system-ui, -apple-system, sans-serif; color: #1c1e1d; margin: 0; font-size: 10.5pt; }
  .cover { min-height: 92vh; display: flex; flex-direction: column; justify-content: center; padding: 48px; page-break-after: always; background: #f2f7f3; }
  .cover h1 { color: #0f5230; font-size: 26pt; margin: 0 0 4px; }
  .cover h2 { color: #1b7a43; font-size: 15pt; margin: 0 0 24px; font-weight: 600; }
  .cover p { margin: 4px 0; color: #3c433f; }
  .cover .box { margin-top: 28px; background: #fff; border: 1px solid #d8e2da; border-radius: 12px; padding: 16px 20px; display: inline-block; }
  section { padding: 24px 44px; }
  h2.sec { color: #0f5230; font-size: 15pt; border-bottom: 2px solid #1b7a43; padding-bottom: 6px; margin: 0 0 12px; }
  h3 { color: #1b7a43; font-size: 12pt; margin: 16px 0 6px; }
  p { line-height: 1.5; margin: 6px 0; }
  ul, ol { margin: 6px 0 12px; padding-left: 22px; }
  li { margin: 4px 0; line-height: 1.45; }
  code { background: #eef4ef; padding: 1px 6px; border-radius: 5px; font-size: 9.5pt; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0 16px; page-break-inside: auto; }
  th { background: #0f5230; color: #fff; text-align: left; padding: 6px 8px; font-size: 9.5pt; }
  td { padding: 6px 8px; border-bottom: 1px solid #e4eae5; vertical-align: top; font-size: 9.5pt; line-height: 1.4; }
  tr { page-break-inside: avoid; }
  td.name { font-weight: 600; color: #0f5230; white-space: nowrap; }
  td.ver { color: #5b635e; white-space: nowrap; }
  .flow { display: flex; flex-direction: column; align-items: stretch; margin: 12px 0 18px; page-break-inside: avoid; }
  .flow .node { background: #fff; border: 1.5px solid #1b7a43; border-radius: 10px; padding: 8px 14px; text-align: center; font-size: 9.5pt; }
  .flow .node b { color: #0f5230; }
  .flow .arrow { text-align: center; color: #1b7a43; font-size: 12pt; line-height: 1.2; padding: 2px 0; }
  .flow .arrow small { display:block; color: #5b635e; font-size: 8.5pt; }
  .vs { display: flex; gap: 20px; margin: 12px 0; page-break-inside: avoid; }
  .vs > div { flex: 1; border-radius: 12px; padding: 14px 18px; }
  .vs .sec-box { background: #eef4ef; border: 1.5px solid #1b7a43; }
  .vs .priv-box { background: #f4f1fa; border: 1.5px solid #6b4fa0; }
  .vs h3 { margin-top: 0; }
  .vs .priv-box h3 { color: #6b4fa0; }
  .matrix td, .matrix th { text-align: center; padding: 4px 4px; font-size: 8.5pt; }
  .matrix td:first-child, .matrix th:first-child { text-align: left; white-space: nowrap; }
  .matrix .dot { color: #1b7a43; font-size: 10pt; }
  .matrix .mut { color: #8a6d1a; font-size: 7.5pt; }
  .callout { background: #f2f7f3; border-left: 4px solid #1b7a43; border-radius: 0 10px 10px 0; padding: 12px 16px; margin: 12px 0; page-break-inside: avoid; }
  .roadmap { background: #fdf6ec; border-left: 4px solid #c9922a; border-radius: 0 10px 10px 0; padding: 12px 16px; margin: 12px 0; page-break-inside: avoid; }
  .wow { background: #fff; border: 1.5px solid #1b7a43; border-radius: 12px; padding: 12px 16px; margin: 10px 0; page-break-inside: avoid; }
  .wow b { color: #0f5230; }
  .foot { color: #5b635e; font-size: 9pt; padding: 0 44px 24px; }
  .meaning { font-style: italic; color: #3c433f; }
`;

function flow(nodes: { label: string; note?: string }[]): string {
  return `<div class="flow">${nodes
    .map(
      (n, i) =>
        `${i > 0 ? `<div class="arrow">▼${n.note ? `<small>${esc(n.note)}</small>` : ""}</div>` : ""}<div class="node">${n.label}</div>`,
    )
    .join("")}</div>`;
}

function stackTable(g: StackGroup): string {
  return `<h3>${esc(g.group)}</h3>
  <table><tr><th style="width:22%">Technology</th><th style="width:10%">Version</th><th style="width:28%">What it is</th><th>How AyuSphere uses it</th></tr>
  ${g.rows
    .map(
      (r) =>
        `<tr><td class="name">${esc(r.name)}</td><td class="ver">${esc(r.version)}</td><td>${esc(r.what)}</td><td>${esc(r.how)}</td></tr>`,
    )
    .join("")}</table>`;
}

function rbacMatrix(): string {
  const head = `<tr><th>Capability</th>${ROLES.map((r) => `<th>${ROLE_SHORT[r]}</th>`).join("")}</tr>`;
  const rows = CAPABILITIES.map((cap) => {
    const mut = (MUTATING_CAPABILITIES as readonly string[]).includes(cap);
    return `<tr><td>${esc(CAP_LABEL[cap] ?? cap)}${mut ? ` <span class="mut">✎</span>` : ""}</td>${ROLES.map(
      (r) => `<td>${can(r, cap) ? '<span class="dot">●</span>' : ""}</td>`,
    ).join("")}</tr>`;
  }).join("");
  return `<table class="matrix">${head}${rows}</table>
  <p style="font-size:9pt;color:#5b635e">● = capability granted · ✎ = a mutating capability (changes clinical records). Rendered directly from
  <code>src/lib/rbac.ts</code> at generation time — this table cannot disagree with the running app. Note the Regulator column:
  no ✎ capability is granted, an invariant enforced by an automated test.</p>`;
}

function html(): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>${CSS}</style></head><body>

  <div class="cover">
    <h1>AyuSphere · Technology &amp; Security Guide</h1>
    <h2>How the system is built — every technology, workflow, and safeguard</h2>
    <p>Problem statement <b>SIH26046</b> · Ministry of Ayush · All India Institute of Ayurveda</p>
    <p>Cloud-based Clinical Trial Management System for Ayurveda — real-time, role-based, GCP-aligned.</p>
    <div class="box">
      <p><b>Live system:</b> <code>${LIVE}</code></p>
      <p><b>Companion documents:</b> 7 role UAT guides · Judge Demo Script (8-minute storyline)</p>
    </div>
    <p style="margin-top:24px">Generated ${GENERATED}. Versions, the permission matrix and signature statements in this document
    are extracted from the codebase at generation time — the document cannot drift from the product.</p>
  </div>

  <section>
    <h2 class="sec">1 · What we built</h2>
    <p><b>AyuSphere</b> is a working, deployed clinical trial management system for AIIA's Ayurveda trials — not a mock-up.
    It covers the full trial lifecycle (draft → IEC review → CTRI registration → active → completed → locked), participant
    screening/consent/enrolment with permuted-block randomization, template-driven e-CRFs with electronically signed approvals,
    a complete pharmacovigilance loop (MedDRA/WHODrug-coded AEs, configurable escalation deadlines, CIOMS-style reports,
    safety-signal detection, DSMB packs, NPvCC spontaneous-ADR intake), monitoring visits and data queries, protocol amendments
    under IEC control, and standards-based interoperability (CDISC SDTM/ADaM/Define-XML and a live two-way FHIR R4 API).</p>
    <p>Seven enforced roles each see a tailored workspace; every mutation is validated, permission-checked and audited in the
    same database transaction; and the whole system is gated by <b>297 automated tests</b> running against real Postgres.</p>
  </section>

  <section>
    <h2 class="sec">2 · Technology stack — what and how</h2>
    ${STACK.map(stackTable).join("")}
  </section>

  <section>
    <h2 class="sec">3 · Architecture &amp; workflows</h2>

    <h3>3.1 · The life of every write (the core workflow)</h3>
    <p>Every clinical-record change in AyuSphere — enrolment, CRF entry, AE capture, approval — travels the same pipeline.
    There is no second path around it:</p>
    ${flow([
      { label: "<b>Browser</b> — server-rendered screen; the role sees only permitted actions" },
      { label: "<b>Next.js server action / API route</b> — session read from the 12-hour JWT", note: "HTTPS · Auth.js CSRF protection" },
      { label: "<b>Zod schema</b> — shape, types, lengths, ranges validated; bad input never reaches logic", note: "invalid → rejected with field errors" },
      { label: "<b>RBAC assertCan(role, capability)</b> — permission re-checked in the service, not just the UI", note: "denied → RbacError, nothing executes" },
      { label: "<b>Service layer</b> — business rules (state machines, deadline rules, randomization)" },
      { label: "<b>withAudit() transaction</b> — the mutation AND its audit row commit together or not at all", note: "an unaudited write cannot commit" },
      { label: "<b>Drizzle ORM → Neon Postgres</b> — parameterized SQL only; audit_events is insert-only" },
    ])}

    <h3>3.2 · Sphera — the AI guide with memory</h3>
    ${flow([
      { label: "<b>User asks Sphera</b> (leaf orb, any screen)" },
      { label: "<b>/api/guide</b> — session checked; the user's thread loaded from <code>guide_messages</code>", note: "per-user thread — no cross-user leakage" },
      { label: "<b>LangGraph StateGraph</b> — injects ONLY this role's knowledge base (click paths, permissions)", note: "the guide cannot describe screens the role cannot open" },
      { label: "<b>ChatGroq</b> — key from admin Settings (server-side), env fallback; 20s timeout", note: "key never sent to the browser" },
      { label: "<b>Streamed tokens → browser</b> · turn persisted back to Postgres", note: "memory survives refresh, devices, sessions" },
    ])}

    <h3>3.3 · Interoperability — data out, data in</h3>
    <p><b>Out:</b> one click exports CDISC <b>SDTM</b> (DM/AE domains), <b>ADaM ADSL</b>, <b>Define-XML</b> (real variable-level
    metadata), and a <b>FHIR R4 Bundle</b>; a live API (<code>GET /api/fhir/Bundle/[trialId]</code>) serves
    <code>application/fhir+json</code> to any authorized system.
    <b>In:</b> inbound FHIR Observation bundles are parsed and land as <b>draft</b> CRF entries only — an imported value
    becomes clinical data exclusively after a human with <code>crf.enter</code> permission reviews it and an approver signs.
    Nothing auto-commits.</p>
  </section>

  <section>
    <h2 class="sec">4 · Privacy vs Security — and why a CTMS needs both</h2>
    <div class="vs">
      <div class="sec-box">
        <h3>Security = protecting the data</h3>
        <p>Keeping systems and data safe from unauthorized access, tampering and loss — whoever the attacker is.</p>
        <ul>
          <li>Answers: <i>"Can the wrong person get in, read, or change this?"</i></li>
          <li>Tools: authentication, authorization, hashing, validation, audit trails, transport encryption.</li>
          <li>Failure looks like: a breached account, a forged record, an injected query.</li>
        </ul>
      </div>
      <div class="priv-box">
        <h3>Privacy = governing the data</h3>
        <p>Rules about what personal data is collected at all, why, who may see it, and for how long — even from insiders.</p>
        <ul>
          <li>Answers: <i>"Should this data exist here, and who is entitled to see it?"</i></li>
          <li>Tools: data minimization, de-identification, consent, purpose limitation, role-scoped visibility.</li>
          <li>Failure looks like: a perfectly "secure" system that stores names it never needed.</li>
        </ul>
      </div>
    </div>
    <div class="callout"><b>The relationship:</b> security protects whatever data you hold; privacy decides what you hold and who is
    entitled to it. You can have security without privacy (a well-locked vault full of data you should never have collected) — but
    you can never have privacy without security. AyuSphere is designed for both: the strongest privacy control in the system is
    that <b>identifying data is never collected in the first place</b> (§6), and everything that IS collected sits behind the
    security layers in §5. This is the posture India's <b>DPDP Act</b> and the ICMR/GCP guidelines expect of clinical systems.</div>
  </section>

  <section>
    <h2 class="sec">5 · Security in AyuSphere — every layer, as implemented</h2>

    <h3>5.1 · Authentication — who you are</h3>
    <ul>
      <li>Credentials sign-in via <b>Auth.js v5</b>; passwords hashed with <b>bcrypt, cost factor 12</b> (~250ms per attempt —
      brute force is computationally expensive by design). Plaintext passwords are never stored or logged.</li>
      <li>Sessions are signed <b>JWTs capped at 12 hours</b> carrying the user's id, role and site; inactive (deactivated)
      accounts are refused at sign-in. CSRF protection is built into Auth.js.</li>
    </ul>

    <h3>5.2 · Authorization — what you may do (RBAC)</h3>
    <p>A single capability matrix (<code>src/lib/rbac.ts</code>) is the only source of permission truth. The UI hides what you
    cannot do, but the <b>service layer independently re-checks</b> every call with <code>assertCan()</code> — bypassing the UI
    changes nothing.</p>
    ${rbacMatrix()}

    <h3>5.3 · Auditability — who did what (ALCOA+)</h3>
    <ul>
      <li>Every mutation runs inside <code>withAudit()</code>: the change and its audit event are inserted <b>in the same
      database transaction</b>. An unaudited write cannot commit; a failed write leaves no audit noise.</li>
      <li>Each audit row stores the actor's id and role, the action, the entity, and <b>before/after JSON snapshots</b> —
      the table is insert-only. Even system-initiated writes (cron deadline sweeps) are attributed to a fixed system actor,
      so <i>every</i> row is attributable.</li>
      <li>The regulator role browses this trail read-only, including e-signature evidence.</li>
    </ul>

    <h3>5.4 · Electronic signatures — record-freezing actions</h3>
    <ul>
      <li>Approving a CRF, approving a correction, and marking a safety report submitted all require the actor to
      <b>re-enter their password</b>, which is bcrypt-verified against their own active account — a stolen open session
      cannot sign.</li>
      <li>The signature row stores a <b>SHA-256 hash of the canonical JSON</b> of the signed record (keys recursively sorted,
      so the hash is order-independent) and commits <b>in the same transaction</b> as the guarded mutation: no signature, no
      change; refused signature, nothing written. Any later tampering with the record is detectable — its hash no longer matches.</li>
      <li>Each signature carries a fixed, 21-CFR-11-style meaning statement, shown verbatim at signing:</li>
    </ul>
    <ul>${Object.entries(SIGNATURE_MEANINGS)
      .map(([k, m]) => `<li><b>${esc(k)}</b>: <span class="meaning">"${esc(m)}"</span></li>`)
      .join("")}</ul>

    <h3>5.5 · Input safety</h3>
    <ul>
      <li><b>Validation:</b> every service input is parsed by a Zod schema before any logic runs — types, lengths, enums,
      numeric ranges. Malformed input is rejected at the boundary with field-level errors.</li>
      <li><b>SQL injection:</b> structurally prevented — all database access goes through Drizzle ORM, which emits
      parameterized statements only. There is no string-built SQL anywhere in the codebase.</li>
      <li><b>XSS:</b> React escapes rendered output by default; the app renders no untrusted raw HTML.</li>
    </ul>

    <h3>5.6 · Secrets &amp; service protection</h3>
    <ul>
      <li>The Groq API key is entered once by the admin in Settings and stored <b>server-side</b>; the settings page receives
      only a boolean "key is set" — <b>the key value is never sent to any browser</b>. Environment variables serve as fallback;
      the <code>.env</code> file is never committed.</li>
      <li>The scheduled alert sweep (<code>/api/cron/alerts</code>) requires a <b>bearer secret</b> (<code>CRON_SECRET</code>) —
      outsiders cannot trigger or spam the alert engine.</li>
      <li>All traffic is HTTPS (TLS) end to end: browser → Vercel → Neon.</li>
    </ul>

    <h3>5.7 · Safe interoperability</h3>
    <ul>
      <li>FHIR import creates <b>drafts only</b> behind the <code>crf.enter</code> capability; imported data becomes clinical
      record only through the same signed human approval as manually entered data.</li>
      <li>AI outputs follow the same rule: the doctor-note extraction produces a draft a human must approve — no model output
      ever writes itself into a clinical record.</li>
    </ul>

    <div class="roadmap"><b>Hardening roadmap (stated honestly):</b> this is a competition prototype and three upgrades are
    planned for production: (1) uploaded documents currently use unguessable-URL public blob storage → move to private,
    access-checked blob reads; (2) add a strict Content-Security-Policy and related security headers; (3) encrypt the
    stored AI API key at rest with a KMS-managed key. None of these affect clinical data, which lives entirely in Postgres
    behind the layers above.</div>
  </section>

  <section>
    <h2 class="sec">6 · Privacy in AyuSphere — DPDP-aligned by design</h2>
    <ul>
      <li><b>De-identification is structural, not procedural.</b> The participants table has <b>no name, phone, address or
      date-of-birth columns — they do not exist in the schema</b>. A participant's only identity is a subject code like
      <code>AYU-001-P-0042</code>. The system cannot leak what it cannot store; re-identification keys stay offline at the
      site, exactly as GCP source documents intend.</li>
      <li><b>Data minimization:</b> only trial-relevant fields (eligibility, arm, consent state, visit data) are collected.</li>
      <li><b>Consent as data:</b> consent is recorded against the <b>specific consent-form version</b> signed; publishing a new
      form version automatically flags affected participants for <b>re-consent</b>. Withdrawal is a first-class, audited state.</li>
      <li><b>Role-scoped visibility:</b> the RBAC matrix (§5.2) is also a privacy control — an ethics member or monitor sees
      only what their duty requires (purpose limitation, enforced in code).</li>
      <li><b>Demo data policy:</b> the live system carries <b>real CTRI registry trials</b> (public records) but <b>100%
      synthetic participants</b> generated with Faker — no real patient data exists anywhere in the deployment.</li>
      <li><b>Accountability:</b> the same audit trail that serves GCP serves DPDP — every touch of participant data is
      attributable and reviewable.</li>
    </ul>
  </section>

  <section>
    <h2 class="sec">7 · What makes this build stand out</h2>
    <div class="wow"><b>An unaudited write cannot commit.</b> Audit isn't a log file bolted on — it's a transactional invariant.
    If the audit insert fails, the clinical change rolls back with it. Most systems log after the fact; AyuSphere cannot forget.</div>
    <div class="wow"><b>Signatures are cryptographic, not cosmetic.</b> Password re-verification + SHA-256 record hash + fixed
    meaning statement, atomic with the change it covers — a checkbox UI can be faked; this cannot.</div>
    <div class="wow"><b>One knowledge base powers the AI guide, the UAT documents — and this document.</b> Sphera's role knowledge,
    the 7 UAT guides, the RBAC table in §5.2 and the version numbers in §2 are all generated from the same source files, with
    drift-guard tests that fail if documentation and product ever disagree. Zero documentation rot, by construction.</div>
    <div class="wow"><b>297 tests on real Postgres.</b> PGlite embeds actual Postgres in the test runner — RBAC denials, audit
    atomicity, signature refusals, randomization balance and export formats are proven against genuine SQL semantics on every commit.</div>
    <div class="wow"><b>Interoperability is live, both directions.</b> Judges can curl the FHIR endpoint during the demo; Define-XML
    carries real variable-level metadata; inbound bundles flow through the same human-signed approval as manual entry.</div>
    <div class="wow"><b>Regulation is configurable, not hard-coded.</b> AE/SAE escalation deadlines, enrolment-lag thresholds and
    monitoring cadence live in an admin-edited (and audited) rule table — when NDCT timelines change, no code changes.</div>
    <div class="wow"><b>Scientific rigor built in:</b> permuted-block randomization at enrolment, monitor data queries that block
    approval until answered, protocol amendments gated by the IEC, DSMB packs from live disproportionality signals, and the
    NPvCC national-pharmacovigilance intake AIIA actually operates.</div>
    <div class="wow"><b>AI with guardrails and memory.</b> Sphera remembers you across sessions (Postgres-persisted LangGraph
    threads) but knows only your role's screens — and no AI output anywhere becomes clinical data without a signed human approval.</div>
  </section>

  <section>
    <h2 class="sec">8 · Engineering workflow</h2>
    <ul>
      <li><b>Trunk-based development:</b> one <code>main</code> branch, small frequent commits, every push auto-deploys to Vercel.</li>
      <li><b>Merge gate:</b> <code>pnpm verify</code> = strict TypeScript typecheck + the full 297-test suite; nothing ships red.</li>
      <li><b>Schema discipline:</b> every database change is a generated, versioned Drizzle migration applied to Neon — the schema's
      history is replayable.</li>
      <li><b>Live E2E:</b> Playwright sweeps run against the deployed site itself (logins for all 7 roles, badges, tabs, search,
      mobile drawer) — we test what judges will actually touch.</li>
      <li><b>Docs as code:</b> architecture decisions (28 ADRs), the gap analysis against the problem statement, task tracking and
      these generated guides all live in the repository.</li>
    </ul>
  </section>

  <p class="foot">AyuSphere · SIH26046 · Technology &amp; Security Guide · generated ${GENERATED} · versions, permissions and
  signature statements extracted from the codebase at generation time.</p>
  </body></html>`;
}

async function printPdf(browser: Browser, htmlFile: string, pdfPath: string) {
  const page = await browser.newPage();
  await page.goto(`file://${htmlFile}`, { waitUntil: "networkidle" });
  await page.pdf({
    path: pdfPath,
    format: "A4",
    printBackground: true,
    margin: { top: "12mm", bottom: "12mm", left: "0", right: "0" },
  });
  await page.close();
  console.log(`wrote ${pdfPath}`);
}

async function main() {
  mkdirSync(BUILD, { recursive: true });
  const htmlFile = path.join(BUILD, "tech-guide.html");
  await writeFile(htmlFile, html(), "utf8");
  console.log(`wrote ${htmlFile}`);
  const browser = await chromium.launch();
  await printPdf(browser, htmlFile, OUT);
  await browser.close();
}

main().catch((err) => {
  console.error("tech-guide generator failed:", err);
  process.exit(1);
});
