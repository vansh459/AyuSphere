/**
 * UAT guide generator (T6.5) — rebuilds docs/uat/*.pdf from the app's living
 * knowledge base + FRESH screenshots of the deployed site, so the guides can
 * never drift from the product again.
 *
 * Content sources (single sources of truth):
 *   - src/lib/guide/knowledge.ts  → per-role workflows, permissions, limits
 *   - src/lib/nav.ts              → each role's grouped sidebar map
 *   - src/db/seed.ts              → demo credentials
 *
 * Run: pnpm tsx scripts/build-uat-guides.ts [baseUrl]
 */
import { chromium, type Browser, type Page } from "playwright";
import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { GLOBAL_KNOWLEDGE, ROLE_KNOWLEDGE } from "@/lib/guide/knowledge";
import { groupedNavForRole } from "@/lib/nav";
import { DEMO_PASSWORD, DEMO_USERS } from "@/db/seed";
import type { Role } from "@/lib/rbac";

const BASE = process.argv[2] ?? "https://ayusphere-three.vercel.app";
const BUILD = path.resolve(process.cwd(), ".uat-build");
const OUT = path.resolve(process.cwd(), "docs", "uat");
const GENERATED = new Date().toLocaleDateString("en-IN", {
  day: "2-digit",
  month: "long",
  year: "numeric",
});

const ROLES: Role[] = ["pi", "coordinator", "monitor", "ethics", "pv", "admin", "regulator"];

const PDF_NAME: Record<Role, string> = {
  pi: "UAT_Guide_Principal_Investigator.pdf",
  coordinator: "UAT_Guide_Study_Coordinator.pdf",
  monitor: "UAT_Guide_Monitor.pdf",
  ethics: "UAT_Guide_Ethics_Committee.pdf",
  pv: "UAT_Guide_Pharmacovigilance.pdf",
  admin: "UAT_Guide_Administrator.pdf",
  regulator: "UAT_Guide_Regulator.pdf",
};

/** per-role "New in this build" — the post-gap-fill features that touch them */
const WHATS_NEW: Record<Role, string[]> = {
  pi: [
    "**Electronic signatures** — approving a CRF, an extraction, or a correction re-verifies your password and stores a SHA-256 hash of the record (GCP e-sign)",
    "**Enrol & randomize** — arms are assigned by permuted-block randomization; manual arm choice is gone",
    "**Protocol amendments** — changing a running trial's visit plan/arms now requires an IEC-approved amendment (trial page card)",
    "**Consent register** — consent binds the consent-form version signed; a new form version flags re-consent per participant",
    "**Data queries** — a monitor's open query blocks entry approval until you answer it on the visit page",
    "**Adverse Events tabs** — Open AEs / Capture (MedDRA & WHODrug pickers) / Safety Signals / and the DSMB summary",
    "**Exports grew** — real Define-XML (variable-level metadata), ADaM ADSL, and a live audited FHIR API",
    "**Tailored dashboard** — your signing queue, open queries and visits lead the page",
    "**Sphera guide with memory** — the leaf orb remembers your conversation across refreshes and devices",
    "Grouped sidebar sections, working quick-search, mobile navigation drawer, live unread badges",
  ],
  coordinator: [
    "**Enrol & randomize** — arm assignment is automatic (permuted-block); consent binds the current consent-form version",
    "**Data queries** — answer the monitor's question on the visit page; approval stays blocked until answered",
    "**AE Capture tab** — MedDRA/WHODrug dictionary pickers code the event as you type",
    "**Tailored dashboard** — today's visits and open queries lead the page",
    "**Sphera guide with memory**, grouped sidebar, quick-search, mobile drawer, live badges",
  ],
  monitor: [
    "**Monitoring visits** — schedule and complete site visits; the due date advances by the configured cadence and overdue sites raise alerts",
    "**Data queries** — raise a query on any CRF entry (blocks its approval), close it when resolved; cycle-time stats on the page",
    "**Tailored dashboard** — site due dates and open queries lead the page",
    "**Sphera guide with memory**, quick-search, mobile drawer, live badges",
  ],
  ethics: [
    "**Amendment queue** — protocol amendments now come to you; returning one requires a comment, and running-trial changes stay blocked until approval",
    "**Tailored dashboard** — the IEC review queue and amendment queue are the whole page",
    "**Sphera guide with memory**, quick-search, mobile drawer",
  ],
  pv: [
    "**Signed safety reporting** — 'Sign & mark reported' re-verifies your password (e-signature); the audit trail keeps the hash",
    "**CIOMS-style SAE report** — one click generates the printable regulatory report with the escalation timeline and deadline compliance",
    "**Safety Signals + DSMB summary** — term×trial disproportionality flags and a printable board pack",
    "**NPvCC ADR intake** — spontaneous ASU&H reports: receive → assess → forward, feeding the signal view",
    "**AE tabs** — Open AEs / Capture (MedDRA & WHODrug pickers) / Safety Signals / NPvCC ADRs",
    "**Configurable deadline rules** — the AE/SAE clock now follows the admin-set rule table",
    "**Tailored dashboard** — escalation clocks and signals lead the page; **Sphera memory**, quick-search, mobile drawer",
  ],
  admin: [
    "**Alerts & Deadlines settings** — enrolment-lag %, AE warning window, milestone lookahead, monitoring cadence and the AE/SAE deadline table are now configurable (audited)",
    "**Electronic signatures everywhere** — approvals and safety reports carry password re-verification + record hashes, visible in the audit trail",
    "Everything the other roles gained: randomization, amendments, consent register, data queries, monitoring visits, AE tabs + dictionary coding, DSMB, ADR intake, Define-XML/ADSL/FHIR API",
    "**Tailored leadership dashboard**, grouped 6-section sidebar, quick-search, mobile drawer, live badges, **Sphera with memory**",
  ],
  regulator: [
    "**Signature evidence** — audit rows for approvals/reports include the e-signature id and the SHA-256 hash of the signed record",
    "**DSMB safety summary** — read-only access to the aggregate safety view",
    "**Tailored read-only dashboard** with portfolio charts and safety signals",
    "**Sphera guide with memory**, quick-search, mobile drawer",
  ],
};

const AXES: Record<Role, string> = {
  pi: "Axis 1 (data accuracy & integrity): template-validated CRFs, signed approvals, versioned corrections. Axis 3 (interoperability): the exports you run.",
  coordinator: "Axis 1 (data accuracy & integrity): validated capture, query answers, consent versioning.",
  monitor: "Axis 1 (data accuracy & integrity): data queries + quality findings. Axis 4: monitoring oversight trail.",
  ethics: "Axis 4 (access control): the IEC gate — nothing reaches CTRI/activation without your decision; amendments gate running-trial changes.",
  pv: "Axis 2 (timeliness of safety reporting): escalation clocks, signed reports, DSMB signals — the whole axis lives in your screens.",
  admin: "All four axes: you configure the rules, hold every capability, and own the audit browser.",
  regulator: "Axis 4 (access-control & audit completeness): strictly read-only everywhere + the complete immutable audit trail.",
};

const emailFor = (role: Role) => DEMO_USERS.find((u) => u.role === role)!.email;

function esc(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
/** knowledge strings use **bold** markdown — render it */
function md(s: string): string {
  return esc(s).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

async function login(page: Page, email: string) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill("#email", email);
  await page.fill("#password", DEMO_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/dashboard", { timeout: 30_000 });
  await page.waitForLoadState("networkidle");
}

type Shot = { slug: string; caption: string };

async function capture(page: Page, dir: string, slug: string): Promise<void> {
  await page.screenshot({ path: path.join(dir, `${slug}.png`) });
}

/** navigate + screenshot every nav route, plus role-specific feature moments */
async function captureRole(browser: Browser, role: Role): Promise<Shot[]> {
  const dir = path.join(BUILD, role);
  mkdirSync(dir, { recursive: true });
  const page = await (
    await browser.newContext({ viewport: { width: 1440, height: 900 } })
  ).newPage();
  await login(page, emailFor(role));
  const shots: Shot[] = [];

  for (const group of groupedNavForRole(role)) {
    for (const item of group.items) {
      const slug = item.href.replaceAll("/", "").replaceAll("?", "-") || "dashboard";
      await page.goto(`${BASE}${item.href}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(400);
      await capture(page, dir, slug);
      shots.push({ slug, caption: item.label });
    }
  }

  // feature moments
  const extra = async (href: string, slug: string, caption: string) => {
    await page.goto(`${BASE}${href}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    await capture(page, dir, slug);
    shots.push({ slug, caption });
  };
  if (role === "pi" || role === "coordinator" || role === "admin") {
    await extra(
      "/adverse-events?tab=capture",
      "ae-capture",
      "Adverse Events — Capture tab (MedDRA/WHODrug pickers)",
    );
  }
  if (role === "pv" || role === "admin") {
    await extra("/adverse-events?tab=signals", "ae-signals", "Adverse Events — Safety Signals tab");
    await extra("/adverse-events/dsmb", "dsmb", "DSMB safety summary (printable)");
  }
  if (role === "pv") {
    await extra("/adverse-events?tab=adrs", "ae-adrs", "Adverse Events — NPvCC ADRs tab");
  }

  if (role === "pi") {
    // quick-search → trial detail (also demonstrates the search)
    await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
    await page
      .locator('input[aria-label="Quick search"]')
      .pressSequentially("CTRI", { delay: 40 });
    const first = page.locator('div.clay button:has-text("CTRI")').first();
    await first.waitFor({ timeout: 10_000 });
    await capture(page, dir, "quick-search");
    shots.push({ slug: "quick-search", caption: "Quick search — jump to any screen, trial or participant" });
    await first.click();
    await page.waitForURL("**/trials/**", { timeout: 15_000 });
    await page.waitForLoadState("networkidle");
    await capture(page, dir, "trial-detail");
    shots.push({
      slug: "trial-detail",
      caption: "Trial detail — lifecycle, KPIs, consent register, protocol amendments",
    });

    // Sphera greeting
    await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
    await page.locator('button[aria-label*="your in-app guide"]').click({ force: true });
    await page.locator('[role="dialog"]').waitFor({ timeout: 10_000 });
    await page.waitForTimeout(9_000); // greeting streams (or rehydrates)
    await capture(page, dir, "sphera");
    shots.push({
      slug: "sphera",
      caption: "Sphera — the role-aware guide (persistent memory across sessions)",
    });
  }

  await page.context().close();
  console.log(`captured ${shots.length} screens for ${role}`);
  return shots;
}

/** one 390px mobile shot with the drawer open — used by the demo script */
async function captureMobile(browser: Browser): Promise<void> {
  const dir = path.join(BUILD, "master");
  mkdirSync(dir, { recursive: true });
  const page = await (
    await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    })
  ).newPage();
  await login(page, emailFor("coordinator"));
  await page.click('button[aria-label="Open navigation"]');
  await page.locator('[role="dialog"][aria-label="Navigation"]').waitFor({ timeout: 10_000 });
  await page.waitForTimeout(700); // slide-in settles
  await capture(page, dir, "mobile-drawer");
  await page.context().close();
}

const CSS = `
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", system-ui, -apple-system, sans-serif; color: #1c1e1d; margin: 0; font-size: 11pt; }
  .cover { min-height: 92vh; display: flex; flex-direction: column; justify-content: center; padding: 48px; page-break-after: always; background: #f2f7f3; }
  .cover h1 { color: #0f5230; font-size: 26pt; margin: 0 0 4px; }
  .cover h2 { color: #1b7a43; font-size: 16pt; margin: 0 0 24px; font-weight: 600; }
  .cover p { margin: 4px 0; color: #3c433f; }
  .cover .creds { margin-top: 28px; background: #fff; border: 1px solid #d8e2da; border-radius: 12px; padding: 16px 20px; display: inline-block; }
  .cover .creds code { background: #eef4ef; padding: 2px 8px; border-radius: 6px; }
  section { padding: 28px 48px; }
  h2.sec { color: #0f5230; font-size: 15pt; border-bottom: 2px solid #1b7a43; padding-bottom: 6px; margin: 0 0 14px; }
  h3 { color: #1b7a43; font-size: 12pt; margin: 18px 0 6px; }
  ol, ul { margin: 6px 0 12px; padding-left: 22px; }
  li { margin: 4px 0; line-height: 1.45; }
  .nav-group { margin: 8px 0; }
  .nav-group b { color: #0f5230; text-transform: uppercase; letter-spacing: 0.08em; font-size: 9pt; }
  .two-col { display: flex; gap: 24px; }
  .two-col > div { flex: 1; }
  .can { border-left: 4px solid #1b7a43; padding-left: 12px; }
  .cannot { border-left: 4px solid #c0392b; padding-left: 12px; }
  figure { margin: 14px 0; page-break-inside: avoid; }
  figure img { width: 100%; border: 1px solid #d8e2da; border-radius: 8px; }
  figcaption { color: #5b635e; font-size: 9pt; margin-top: 4px; }
  .new li { margin: 6px 0; }
  .axes { background: #f2f7f3; border-radius: 12px; padding: 14px 18px; margin-top: 18px; }
  .foot { color: #5b635e; font-size: 9pt; padding: 0 48px 24px; }
  .step-role { display: inline-block; background: #1b7a43; color: #fff; border-radius: 8px; padding: 2px 10px; font-size: 9pt; margin-right: 8px; }
  .axis { display: inline-block; background: #eef4ef; color: #0f5230; border-radius: 8px; padding: 2px 10px; font-size: 9pt; }
  table.script { width: 100%; border-collapse: collapse; }
  table.script td { vertical-align: top; padding: 8px 6px; border-bottom: 1px solid #e4eae5; }
`;

function roleHtml(role: Role, shots: Shot[]): string {
  const k = ROLE_KNOWLEDGE[role];
  const groups = groupedNavForRole(role);
  const shotImg = (slug: string) => {
    const s = shots.find((x) => x.slug === slug);
    return s
      ? `<figure><img src="${role}/${s.slug}.png" alt="${esc(s.caption)}"/><figcaption>${esc(s.caption)}</figcaption></figure>`
      : "";
  };
  const tourSlugs = shots.filter((s) => s.slug !== "dashboard");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>${CSS}</style></head><body>
  <div class="cover">
    <h1>AyuSphere · UAT Guide</h1>
    <h2>${esc(k.display_name)}</h2>
    <p>${md(GLOBAL_KNOWLEDGE.app)}</p>
    <p>Problem statement <b>SIH26046</b> · Ministry of Ayush · All India Institute of Ayurveda</p>
    <div class="creds">
      <p><b>Live demo:</b> <code>${BASE}</code></p>
      <p><b>Sign in as:</b> <code>${emailFor(role)}</code> · password <code>${DEMO_PASSWORD}</code></p>
    </div>
    <p style="margin-top:24px">Generated ${GENERATED} from the application's living knowledge base — click paths in this
    guide are the exact labels in the product and are drift-guard tested against the navigation and permission matrix.</p>
  </div>

  <section>
    <h2 class="sec">1 · Your workspace</h2>
    <p>${md(GLOBAL_KNOWLEDGE.navigation)}</p>
    ${groups
      .map(
        (g) =>
          `<div class="nav-group">${groups.length > 1 ? `<b>${esc(g.group)}</b><br/>` : ""}${g.items
            .map((i) => esc(i.label))
            .join(" · ")}</div>`,
      )
      .join("")}
    ${shotImg("dashboard")}
  </section>

  <section>
    <h2 class="sec">2 · What you can and cannot do</h2>
    <div class="two-col">
      <div class="can"><h3>You can</h3><ul>${k.permissions.map((p) => `<li>${md(p)}</li>`).join("")}</ul></div>
      <div class="cannot"><h3>You cannot</h3><ul>${k.cannot_do.map((c) => `<li>${md(c)}</li>`).join("")}</ul></div>
    </div>
  </section>

  <section>
    <h2 class="sec">3 · Core workflows (exact click paths)</h2>
    ${k.core_workflows
      .map(
        (w) =>
          `<h3>${esc(w.goal)}</h3><ol>${w.steps.map((s) => `<li>${md(s)}</li>`).join("")}</ol>`,
      )
      .join("")}
  </section>

  <section>
    <h2 class="sec">4 · Screens</h2>
    ${tourSlugs.map((s) => shotImg(s.slug)).join("")}
  </section>

  <section>
    <h2 class="sec">5 · New in this build</h2>
    <ul class="new">${WHATS_NEW[role].map((n) => `<li>${md(n)}</li>`).join("")}</ul>
    <div class="axes"><b>How this role scores in evaluation:</b> ${esc(AXES[role])}</div>
  </section>

  <p class="foot">AyuSphere · SIH26046 · ${esc(k.display_name)} UAT guide · generated ${GENERATED} · all participant data synthetic (DPDP), trials are public CTRI registry records.</p>
  </body></html>`;
}

/** the ~8-minute judge storyline — mapped to the PS's four evaluation axes */
const DEMO_STEPS: {
  minute: string;
  role: string;
  actions: string[];
  say: string;
  axis: string;
  shot?: string;
}[] = [
  {
    minute: "0:00",
    role: "PI",
    actions: [
      "Sign in as **pi@aiia.demo** — the dashboard is role-tailored: signing queue, open data queries, due visits",
      "Click the leaf orb — **Sphera** greets by name and role (it remembers past conversations)",
    ],
    say: "Seven enforced roles, each with its own dashboard. Even the in-app guide only knows THIS role's screens.",
    axis: "Axis 4 · access control",
    shot: "pi/dashboard",
  },
  {
    minute: "1:00",
    role: "PI",
    actions: [
      "**Visit Schedule** → open a due visit → fill the e-CRF (ranges enforced) → **Save & submit for approval**",
      "Enter your password and click **Sign & approve** — a GCP electronic signature: password re-verified, SHA-256 hash of the record stored",
    ],
    say: "Approval is not a click — it is a signature. The hash lands in the immutable audit trail.",
    axis: "Axis 1 · data integrity",
    shot: "pi/visits",
  },
  {
    minute: "2:30",
    role: "PI",
    actions: [
      "**Adverse Events** → **Capture** tab → pick the participant, type 'Nausea' (MedDRA picker auto-codes it), suspected formulation 'Ashwagandha churna' (WHODrug picker), seriousness **SAE** → **Capture**",
      "The **Open AEs** tab shows the new SAE with its escalation clock already counting down",
    ],
    say: "Coded to MedDRA and WHODrug demo dictionaries; the NDCT-style deadline clock starts at capture — and the rules are admin-configurable, not hard-coded.",
    axis: "Axis 2 · safety timeliness",
    shot: "pi/ae-capture",
  },
  {
    minute: "3:30",
    role: "PV",
    actions: [
      "Switch to **pv@aiia.demo** — the safety dashboard sorts by deadline proximity",
      "**Start PV review** → **Sign & mark reported** (another e-signature) → **Generate regulatory report** — the printable CIOMS-style summary with the full escalation timeline and deadline compliance",
      "**Safety Signals** tab → term×trial disproportionality flags → **Full DSMB summary** (printable board pack); the **NPvCC ADRs** tab takes spontaneous reports",
    ],
    say: "AIIA hosts the National Pharmacovigilance Coordination Centre — this is that role, end to end, with artifacts a regulator can hold.",
    axis: "Axis 2 · safety timeliness",
    shot: "pv/dsmb",
  },
  {
    minute: "5:00",
    role: "PI",
    actions: [
      "**Reports & Exports** → download the **FHIR R4 Bundle**, **SDTM DM/AE**, **ADaM ADSL** and **Define-XML** (real variable-level metadata)",
      "Show the live API: GET /api/fhir/Bundle/[trialId] returns application/fhir+json; inbound Observation bundles land as DRAFT CRFs — nothing imported auto-commits",
    ],
    say: "CDISC and FHIR are not slideware here — every artifact opens, and the API is live and audited.",
    axis: "Axis 3 · interoperability",
    shot: "pi/exports",
  },
  {
    minute: "6:00",
    role: "Ethics",
    actions: [
      "Switch to **ethics@aiia.demo** — the amendment queue lists protocol changes awaiting IEC decision",
      "**Return** one (a comment is REQUIRED) or **Approve** — running-trial protocol changes stay blocked until approval",
    ],
    say: "IEC oversight covers amendments, not just first approval — the protocol version bumps only through this gate.",
    axis: "Axis 4 · access control",
    shot: "ethics/ethics",
  },
  {
    minute: "7:00",
    role: "Regulator",
    actions: [
      "Switch to **regulator@aiia.demo** — read-only everywhere, three screens only",
      "**Audit Trail** → filter to the CRF entry approved in minute 1 — the row shows the approver, before/after, timestamp AND the e-signature hash",
    ],
    say: "ALCOA+ made literal: append-only at the database, every approval attributable and hash-sealed.",
    axis: "Axis 4 · audit completeness",
    shot: "regulator/audit",
  },
  {
    minute: "7:45",
    role: "Any",
    actions: [
      "Closers: quick-search 'CTRI' jumps to a real registry trial; the app works on a phone (drawer navigation); ask Sphera \"what did I ask you earlier?\" — it remembers",
    ],
    say: "Real CTRI trials, synthetic participants only — DPDP by schema. Everything you saw is test-gated: 297 automated tests.",
    axis: "All axes",
    shot: "master/mobile-drawer",
  },
];

function demoScriptHtml(): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>${CSS}</style></head><body>
  <div class="cover">
    <h1>AyuSphere · Judge Demo Script</h1>
    <h2>The 8-minute storyline — mapped to the four evaluation axes</h2>
    <p>${md(GLOBAL_KNOWLEDGE.app)}</p>
    <p>Problem statement <b>SIH26046</b> · evaluated on: data accuracy &amp; integrity · timeliness of safety &amp; regulatory
    reporting · interoperability conformance · access-control &amp; audit completeness</p>
    <div class="creds">
      <p><b>Live demo:</b> <code>${BASE}</code> · every role signs in with password <code>${DEMO_PASSWORD}</code></p>
      <p>pi@ · coordinator@ · monitor@ · ethics@ · pv@ · admin@ · regulator@ — all <code>aiia.demo</code></p>
    </div>
    <p style="margin-top:24px">Generated ${GENERATED}. Each step names the login, the exact clicks, the line to say, and the axis it scores.</p>
  </div>
  ${DEMO_STEPS.map(
    (s) => `<section>
    <h2 class="sec">${esc(s.minute)} — <span class="step-role">${esc(s.role)}</span> <span class="axis">${esc(s.axis)}</span></h2>
    <ol>${s.actions.map((a) => `<li>${md(a)}</li>`).join("")}</ol>
    <p><b>Say:</b> <i>${md(s.say)}</i></p>
    ${s.shot ? `<figure><img src="${s.shot}.png" alt=""/><figcaption>${esc(s.role)} — live screen</figcaption></figure>` : ""}
  </section>`,
  ).join("")}
  <p class="foot">AyuSphere · SIH26046 · Judge demo script · generated ${GENERATED}.</p>
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
  mkdirSync(OUT, { recursive: true });
  console.log(`Building UAT guides from ${BASE}\n`);
  const browser = await chromium.launch();

  await captureMobile(browser);
  for (const role of ROLES) {
    const shots = await captureRole(browser, role);
    const html = roleHtml(role, shots);
    const htmlFile = path.join(BUILD, `${role}.html`);
    await writeFile(htmlFile, html, "utf8");
    await printPdf(browser, htmlFile, path.join(OUT, PDF_NAME[role]));
  }

  const scriptFile = path.join(BUILD, "judge-demo-script.html");
  await writeFile(scriptFile, demoScriptHtml(), "utf8");
  await printPdf(browser, scriptFile, path.join(OUT, "Judge_Demo_Script.pdf"));

  await browser.close();
  console.log("\nall guides regenerated");
}

main().catch((err) => {
  console.error("generator failed:", err);
  process.exit(1);
});
