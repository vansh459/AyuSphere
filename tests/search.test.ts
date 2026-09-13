/**
 * T6.4 — quick-jump search (the previously dead topbar box).
 * Gate: results are RBAC-shaped — screens come from the caller's own nav,
 * trials only for roles that can open trial pages, participants only for
 * participant managers; matches by protocol code / subject code substring;
 * buckets are capped; short queries return nothing.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./helpers/db";
import { participants, sites, trialSites, trials, users } from "@/db/schema";
import { quickSearch } from "@/services/search";

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
  const [pi] = await db
    .insert(users)
    .values([{ email: "pi@s2.demo", passwordHash: "x", name: "PI", role: "pi" }])
    .returning();
  const [trial] = await db
    .insert(trials)
    .values({
      protocolCode: "AYU-777",
      title: "Ashwagandha search fixture",
      studyType: "interventional",
      intervention: "Ashwagandha",
      targetEnrollment: 10,
      status: "active",
      createdBy: pi.id,
    })
    .returning();
  const [site] = await db
    .insert(sites)
    .values({ name: "S", city: "C", state: "ST" })
    .returning();
  const [ts] = await db
    .insert(trialSites)
    .values({ trialId: trial.id, siteId: site.id, activationStatus: "active" })
    .returning();
  await db.insert(participants).values(
    Array.from({ length: 7 }, (_, i) => ({
      subjectCode: `AYU-777-P-000${i + 1}`,
      trialSiteId: ts.id,
    })),
  );
});

describe("T6.4 — quick search", () => {
  it("finds trials by protocol code and title for trial managers", async () => {
    const byCode = await quickSearch(db, { role: "pi" }, "777");
    expect(byCode.some((r) => r.kind === "trial" && r.href.startsWith("/trials/"))).toBe(true);
    const byTitle = await quickSearch(db, { role: "pi" }, "ashwagandha");
    expect(byTitle.some((r) => r.kind === "trial")).toBe(true);
  });

  it("finds participants by subject code, capped at 5, linking the trial filter", async () => {
    const res = await quickSearch(db, { role: "coordinator" }, "AYU-777-P");
    const people = res.filter((r) => r.kind === "participant");
    expect(people).toHaveLength(5); // 7 exist — bucket capped
    expect(people[0].href).toBe("/participants?trial=AYU-777");
  });

  it("RBAC shape: ethics gets trials (via /ethics) but never participants; regulator gets neither", async () => {
    const ethics = await quickSearch(db, { role: "ethics" }, "AYU-777");
    expect(ethics.some((r) => r.kind === "trial" && r.href === "/ethics")).toBe(true);
    expect(ethics.some((r) => r.kind === "participant")).toBe(false);

    const regulator = await quickSearch(db, { role: "regulator" }, "AYU-777");
    expect(regulator.some((r) => r.kind === "trial")).toBe(false);
    expect(regulator.some((r) => r.kind === "participant")).toBe(false);
  });

  it("screens come from the caller's OWN nav only", async () => {
    const monitor = await quickSearch(db, { role: "monitor" }, "monit");
    expect(monitor.some((r) => r.kind === "screen" && r.href === "/monitoring")).toBe(true);
    // monitor has no /settings — searching it yields nothing
    const settings = await quickSearch(db, { role: "monitor" }, "settings");
    expect(settings).toHaveLength(0);
    // regulator still finds their audit screen with an empty-DB-safe match
    const audit = await quickSearch(db, { role: "regulator" }, "audit");
    expect(audit.some((r) => r.kind === "screen" && r.href === "/audit")).toBe(true);
  });

  it("queries under 2 characters return nothing", async () => {
    expect(await quickSearch(db, { role: "pi" }, "a")).toEqual([]);
    expect(await quickSearch(db, { role: "pi" }, "  ")).toEqual([]);
  });
});
