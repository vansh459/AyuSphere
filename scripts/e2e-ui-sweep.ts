/**
 * UI sweep (T6.4) against the DEPLOYED site: all 7 roles get their sidebar
 * variant screenshotted (grouped sections for busy roles, flat for sparse),
 * plus mobile-drawer navigation at 390px, the quick-jump search, and the
 * Adverse Events tabs.
 *
 * Run: pnpm tsx scripts/e2e-ui-sweep.ts [baseUrl]
 */
import { chromium, type Browser, type Page } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const BASE = process.argv[2] ?? "https://ayusphere-three.vercel.app";
const SHOT_DIR = path.resolve(process.cwd(), ".e2e-shots");
const PASSWORD = "Demo@1234";

const ROLES: { email: string; role: string; grouped: boolean }[] = [
  { email: "pi@aiia.demo", role: "pi", grouped: true },
  { email: "coordinator@aiia.demo", role: "coordinator", grouped: true },
  { email: "monitor@aiia.demo", role: "monitor", grouped: false },
  { email: "ethics@aiia.demo", role: "ethics", grouped: false },
  { email: "pv@aiia.demo", role: "pv", grouped: false },
  { email: "admin@aiia.demo", role: "admin", grouped: true },
  { email: "regulator@aiia.demo", role: "regulator", grouped: false },
];

function check(cond: boolean, label: string) {
  console.log(`${cond ? "PASS" : "FAIL"} — ${label}`);
  if (!cond) process.exitCode = 1;
}

async function shot(page: Page, name: string) {
  const file = path.join(SHOT_DIR, `ui-${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  [shot] ${file}`);
}

async function login(page: Page, email: string) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/dashboard", { timeout: 30_000 });
  await page.waitForLoadState("networkidle");
}

async function sweepRole(
  browser: Browser,
  cfg: (typeof ROLES)[number],
): Promise<void> {
  const page = await (
    await browser.newContext({ viewport: { width: 1440, height: 900 } })
  ).newPage();
  await login(page, cfg.email);
  const headers = await page.locator("aside nav .microlabel").allTextContents();
  await shot(page, `sidebar-${cfg.role}`);
  if (cfg.grouped) {
    check(
      headers.length > 1 && headers.includes("Overview"),
      `${cfg.role}: sidebar sectioned (${headers.length} headers: ${headers.join(", ")})`,
    );
  } else {
    check(
      headers.length === 0,
      `${cfg.role}: sparse role keeps a FLAT list (${headers.length} headers)`,
    );
  }
  await page.context().close();
}

async function main() {
  mkdirSync(SHOT_DIR, { recursive: true });
  console.log(`UI sweep against ${BASE}\n`);
  const browser = await chromium.launch();

  // 1 · sidebar variant per role
  for (const cfg of ROLES) await sweepRole(browser, cfg);

  // 2 · quick-jump search (PI): protocol code prefix → trial page
  // (the live DB carries real CTRI registry trials, not AYU demo codes)
  const pi = await (
    await browser.newContext({ viewport: { width: 1440, height: 900 } })
  ).newPage();
  await login(pi, "pi@aiia.demo");
  await pi
    .locator('input[aria-label="Quick search"]')
    .pressSequentially("CTRI", { delay: 40 });
  const firstResult = pi.locator('div.clay button:has-text("CTRI")').first();
  await firstResult.waitFor({ timeout: 10_000 });
  await shot(pi, "search-dropdown");
  await firstResult.click();
  await pi.waitForURL("**/trials/**", { timeout: 15_000 });
  check(true, "search: 'CTRI' jumps to a trial page");
  await shot(pi, "search-landed-trial");
  await pi.context().close();

  // 3 · Adverse Events tabs (PV)
  const pv = await (
    await browser.newContext({ viewport: { width: 1440, height: 900 } })
  ).newPage();
  await login(pv, "pv@aiia.demo");
  await pv.goto(`${BASE}/adverse-events`, { waitUntil: "networkidle" });
  check(
    (await pv.locator('a[href="/adverse-events?tab=signals"]').count()) > 0,
    "AE page shows the tab bar",
  );
  await shot(pv, "ae-tab-open");
  await pv.click('a[href="/adverse-events?tab=capture"]');
  await pv.locator('text=Capture adverse event').waitFor({ timeout: 15_000 });
  await shot(pv, "ae-tab-capture");
  await pv.click('a[href="/adverse-events?tab=signals"]');
  await pv.locator("text=Safety signals").waitFor({ timeout: 15_000 });
  await shot(pv, "ae-tab-signals");
  await pv.click('a[href="/adverse-events?tab=adrs"]');
  await pv.locator("text=NPvCC surveillance").waitFor({ timeout: 15_000 });
  await shot(pv, "ae-tab-adrs");
  check(true, "AE tabs: Open → Capture → Signals → ADRs all render");
  await pv.context().close();

  // 4 · mobile drawer at 390px (coordinator)
  const mobile = await (
    await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    })
  ).newPage();
  await login(mobile, "coordinator@aiia.demo");
  // the app has other <aside>s (assistant panel, toasts) — target the
  // sidebar specifically by its fixed width class
  check(
    (await mobile.locator("aside.w-60:visible").count()) === 0,
    "mobile: desktop sidebar hidden",
  );
  await mobile.click('button[aria-label="Open navigation"]');
  await mobile
    .locator('[role="dialog"][aria-label="Navigation"]')
    .waitFor({ timeout: 10_000 });
  await shot(mobile, "mobile-drawer-open");
  await mobile.click('[role="dialog"] a[href="/visits"]');
  await mobile.waitForURL("**/visits", { timeout: 15_000 });
  check(true, "mobile: drawer opens and navigates to Visit Schedule");
  await shot(mobile, "mobile-after-nav");
  await mobile.context().close();

  await browser.close();
  console.log(`\ndone — exit ${process.exitCode ?? 0}`);
}

main().catch((err) => {
  console.error("UI sweep crashed:", err);
  process.exit(1);
});
