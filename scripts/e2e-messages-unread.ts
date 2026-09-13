/**
 * Repro for "message read but badge still shows 1" — two live sessions:
 * coordinator sends a message, PI reads it; the unread badge on the PI's
 * contact list must clear on read and STAY cleared across polls, navigation,
 * and reloads. Screenshots at every step.
 *
 * Run: pnpm tsx scripts/e2e-messages-unread.ts [baseUrl]
 */
import { chromium, type Page } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const BASE = process.argv[2] ?? "https://ayusphere-three.vercel.app";
const SHOT_DIR = path.resolve(process.cwd(), ".e2e-shots");
const PASSWORD = "Demo@1234";

let step = 0;
async function shot(page: Page, name: string) {
  step += 1;
  const file = path.join(SHOT_DIR, `msg-${String(step).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  [shot] ${file}`);
}

function check(cond: boolean, label: string) {
  console.log(`${cond ? "PASS" : "FAIL"} — ${label}`);
  if (!cond) process.exitCode = 1;
}

async function login(page: Page, email: string) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/dashboard", { timeout: 30_000 });
}

/** the contact row button for a given name, on the messages page */
function contactRow(page: Page, name: string) {
  return page.locator("button", { hasText: name }).first();
}

/** unread badge inside that contact row (the red circle) */
function badge(page: Page, name: string) {
  return contactRow(page, name).locator("span.bg-danger");
}

async function badgeText(page: Page, name: string): Promise<string | null> {
  const b = badge(page, name);
  return (await b.count()) > 0 ? ((await b.first().textContent()) ?? "").trim() : null;
}

/** the SIDEBAR count chip on a nav item (the bug from the video) */
async function sidebarBadge(page: Page, label: string): Promise<string | null> {
  const chip = page
    .locator(`aside a:has-text("${label}") .sidebar-count-badge`);
  return (await chip.count()) > 0
    ? ((await chip.first().textContent()) ?? "").trim()
    : null;
}

async function main() {
  mkdirSync(SHOT_DIR, { recursive: true });
  console.log(`Messages unread-badge repro against ${BASE}\n`);
  const browser = await chromium.launch();

  // sender: coordinator
  const sender = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await login(sender, "coordinator@aiia.demo");
  await sender.goto(`${BASE}/messages`, { waitUntil: "networkidle" });
  const marker = `badge-test ${Date.now()}`;
  await contactRow(sender, "Dr. Ananya Sharma").click();
  await sender.fill('input[placeholder^="Message"]', marker);
  await sender.click('button[aria-label="Send message"]');
  await sender.waitForTimeout(1500);
  await shot(sender, "sender-sent");
  console.log(`sent: "${marker}"`);

  // reader: PI
  const reader = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await login(reader, "pi@aiia.demo");
  await reader.goto(`${BASE}/messages`, { waitUntil: "networkidle" });
  await reader.waitForTimeout(1000);
  const before = await badgeText(reader, "Ravi Kumar");
  await shot(reader, "reader-before-open");
  check(before !== null, `unread badge visible before reading (shows "${before}")`);
  const sideBefore = await sidebarBadge(reader, "Messages");
  check(
    sideBefore !== null,
    `SIDEBAR "Messages" badge visible before reading (shows "${sideBefore}")`,
  );

  // read the thread
  await contactRow(reader, "Ravi Kumar").click();
  await reader.locator(`text=${marker}`).waitFor({ timeout: 15_000 });
  console.log("thread open — message text visible (READ)");
  await reader.waitForTimeout(3000); // contacts refresh + badge refetch land
  const afterOpen = await badgeText(reader, "Ravi Kumar");
  await shot(reader, "reader-thread-open");
  check(afterOpen === null, `badge cleared right after reading (shows "${afterOpen ?? "none"}")`);
  const sideAfter = await sidebarBadge(reader, "Messages");
  check(
    sideAfter === null,
    `THE VIDEO BUG: sidebar "Messages" badge cleared after reading, NO reload (shows "${sideAfter ?? "none"}")`,
  );

  // wait past a poll cycle — does it come back?
  await reader.waitForTimeout(6000);
  const afterPoll = await badgeText(reader, "Ravi Kumar");
  await shot(reader, "reader-after-poll");
  check(afterPoll === null, `badge still clear after a 5s poll cycle (shows "${afterPoll ?? "none"}")`);

  // navigate away and back
  await reader.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  await reader.goto(`${BASE}/messages`, { waitUntil: "networkidle" });
  await reader.waitForTimeout(1500);
  const afterNav = await badgeText(reader, "Ravi Kumar");
  await shot(reader, "reader-after-nav-back");
  check(afterNav === null, `badge clear after navigating away and back (shows "${afterNav ?? "none"}")`);

  // hard reload
  await reader.reload({ waitUntil: "networkidle" });
  await reader.waitForTimeout(1500);
  const afterReload = await badgeText(reader, "Ravi Kumar");
  await shot(reader, "reader-after-reload");
  check(afterReload === null, `badge clear after hard reload (shows "${afterReload ?? "none"}")`);

  // live receive while the thread is open: badge must not appear
  const marker2 = `badge-test-2 ${Date.now()}`;
  await contactRow(reader, "Ravi Kumar").click();
  await reader.waitForTimeout(500);
  await sender.fill('input[placeholder^="Message"]', marker2);
  await sender.click('button[aria-label="Send message"]');
  await reader.locator(`text=${marker2}`).waitFor({ timeout: 15_000 });
  await reader.waitForTimeout(2500);
  const liveBadge = await badgeText(reader, "Ravi Kumar");
  await shot(reader, "reader-live-receive");
  check(liveBadge === null, `no badge while receiving into the OPEN thread (shows "${liveBadge ?? "none"}")`);

  await browser.close();
  console.log(`\ndone — exit ${process.exitCode ?? 0}`);
}

main().catch((err) => {
  console.error("repro crashed:", err);
  process.exit(1);
});
