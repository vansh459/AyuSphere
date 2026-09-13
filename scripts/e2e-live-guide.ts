/**
 * Live E2E for Sphera v2 on the DEPLOYED site (Playwright, headless).
 * Walks: login → open the leaf-orb → greeting streams (the old 504 moment) →
 * ask a distinctive question → RELOAD → thread rehydrates (Neon memory) →
 * ask a recall question → the reply must remember. Screenshots per step.
 *
 * Run: pnpm tsx scripts/e2e-live-guide.ts [baseUrl]
 */
import { chromium, type Page } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const BASE = process.argv[2] ?? "https://ayusphere-three.vercel.app";
const SHOT_DIR = path.resolve(process.cwd(), ".e2e-shots");
const EMAIL = "pi@aiia.demo";
const PASSWORD = "Demo@1234";

let step = 0;
async function shot(page: Page, name: string) {
  step += 1;
  const file = path.join(SHOT_DIR, `${String(step).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  [shot] ${file}`);
}

function assert(cond: boolean, label: string) {
  console.log(`${cond ? "PASS" : "FAIL"} — ${label}`);
  if (!cond) process.exitCode = 1;
}

/** wait until the LAST assistant bubble has settled (streaming finished) */
async function waitForReply(page: Page, timeoutMs = 45_000): Promise<string> {
  const bubble = page
    .locator('[role="dialog"] .rounded-tl-xs')
    .last();
  await bubble.waitFor({ state: "visible", timeout: timeoutMs });
  let prev = "";
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await page.waitForTimeout(1200);
    const now = (await bubble.textContent()) ?? "";
    if (now.trim().length > 0 && now === prev) return now.trim();
    prev = now;
    if (Date.now() > deadline) return now.trim();
  }
}

async function guideError(page: Page): Promise<string | null> {
  const alert = page.locator('[role="dialog"] [role="alert"]');
  return (await alert.count()) > 0 ? await alert.first().textContent() : null;
}

async function main() {
  mkdirSync(SHOT_DIR, { recursive: true });
  console.log(`Sphera v2 live E2E against ${BASE}\n`);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const consoleErrors: string[] = [];
  page.on("console", (msg: { type: () => string; text: () => string }) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  // 1 · login
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await shot(page, "login");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/dashboard", { timeout: 30_000 });
  assert(true, `login as ${EMAIL} → /dashboard`);
  await page.waitForLoadState("networkidle");
  await shot(page, "dashboard");

  // 2 · open the orb — greeting must stream (this was the 504 moment)
  // the orb pulses forever (framer-motion) — skip the stability wait
  await page
    .locator('button[aria-label*="your in-app guide"]')
    .click({ force: true });
  await page.locator('[role="dialog"]').waitFor({ timeout: 10_000 });
  const greeting = await waitForReply(page);
  const err1 = await guideError(page);
  await shot(page, "greeting");
  assert(!err1, `no error banner on greet (got: ${err1 ?? "none"})`);
  assert(greeting.length > 20, `greeting streamed (${greeting.length} chars): "${greeting.slice(0, 90)}…"`);
  assert(!/HTTP 5\d\d/.test(err1 ?? ""), "no 5xx from /api/guide");

  // 3 · ask a distinctive question (plants the memory marker)
  const marker = `My favourite herb is Brahmi. How do I enrol a participant?`;
  await page.fill('[role="dialog"] input', marker);
  await page.click('button[aria-label="Send to guide"]');
  const reply1 = await waitForReply(page);
  await shot(page, "first-reply");
  assert(reply1.length > 20 && reply1 !== greeting, `reply streamed: "${reply1.slice(0, 90)}…"`);
  assert(/participant/i.test(reply1), "reply is on-topic (mentions participants)");

  // 4 · RELOAD → memory must rehydrate from Neon
  await page.reload({ waitUntil: "networkidle" });
  // the orb pulses forever (framer-motion) — skip the stability wait
  await page
    .locator('button[aria-label*="your in-app guide"]')
    .click({ force: true });
  await page.locator('[role="dialog"]').waitFor({ timeout: 10_000 });
  await page.waitForTimeout(2_500); // hydration fetch
  const panelText = (await page.locator('[role="dialog"]').textContent()) ?? "";
  await shot(page, "after-reload-rehydrated");
  assert(
    panelText.includes("favourite herb is Brahmi"),
    "PERSISTENCE: user message survived the reload (rehydrated from DB)",
  );
  assert(
    panelText.includes(reply1.slice(0, 40)),
    "PERSISTENCE: assistant reply survived the reload",
  );

  // 5 · recall question — LangGraph memory in action
  await page.fill('[role="dialog"] input', "What did I say my favourite herb was?");
  await page.click('button[aria-label="Send to guide"]');
  const recall = await waitForReply(page);
  await shot(page, "memory-recall");
  assert(/brahmi/i.test(recall), `MEMORY: recall reply mentions Brahmi: "${recall.slice(0, 120)}"`);

  // 6 · New chat starts an empty thread (fresh greeting, no old turns)
  await page.click('button[aria-label="Start a new chat"]');
  await waitForReply(page);
  const freshText = (await page.locator('[role="dialog"]').textContent()) ?? "";
  await shot(page, "new-chat");
  assert(
    !freshText.includes("favourite herb is Brahmi"),
    "New chat: old turns are gone (fresh thread)",
  );

  assert(consoleErrors.length === 0, `no browser console errors (${consoleErrors.length})`);
  if (consoleErrors.length) console.log("console errors:", consoleErrors.slice(0, 5));

  await browser.close();
  console.log(`\ndone — exit ${process.exitCode ?? 0}`);
}

main().catch((err) => {
  console.error("E2E crashed:", err);
  process.exit(1);
});
