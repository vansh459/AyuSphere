import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "./helpers/db";
import { seed } from "@/db/seed";
import { trials } from "@/db/schema";
import {
  openAesByDeadline,
  portfolioKpis,
  sitePerformance,
  trialEnrolment,
} from "@/services/kpi";

let db: TestDb;
let ayu1Id: string;

beforeAll(async () => {
  db = await createTestDb();
  await seed(db);
  const [ayu1] = await db
    .select()
    .from(trials)
    .where(eq(trials.protocolCode, "AYU-001"));
  ayu1Id = ayu1.id;
}, 180_000);

describe("T2.5 — portfolio KPIs against the seed (exact numbers)", () => {
  it("counts trials, participants, sites, AEs exactly", async () => {
    const kpi = await portfolioKpis(db);
    expect(kpi.activeTrials).toBe(2);
    expect(kpi.totalTrials).toBe(3);
    expect(kpi.enrolledParticipants).toBe(66);
    expect(kpi.withdrawnParticipants).toBe(0);
    expect(kpi.sites).toBe(3);
    expect(kpi.openAdverseEvents).toBe(2); // 1 open SAE + 1 under_review AE
  });
});

describe("T2.5 — site performance for AYU-001", () => {
  it("returns per-site target/enrolled/rate, exposing the planted lagging site", async () => {
    const perf = await sitePerformance(db, ayu1Id);
    expect(perf).toHaveLength(3);
    const byName = Object.fromEntries(perf.map((p) => [p.siteName, p]));
    expect(byName["AIIA New Delhi"]).toMatchObject({ target: 50, enrolled: 24 });
    expect(byName["NIA Jaipur"]).toMatchObject({ target: 40, enrolled: 18 });
    expect(byName["GAC Pune"]).toMatchObject({ target: 30, enrolled: 3 });
    expect(byName["GAC Pune"].rate).toBeCloseTo(0.1, 5);
  });
});

describe("T2.5 — trial enrolment + AE deadline ordering", () => {
  it("aggregates enrolment vs target", async () => {
    const e = await trialEnrolment(db, ayu1Id);
    expect(e.target).toBe(120);
    expect(e.enrolled).toBe(45); // 24 + 18 + 3
    expect(e.progress).toBeCloseTo(45 / 120, 5);
    expect(e.dropoutRate).toBe(0);
  });

  it("lists open AEs ordered by reporting deadline (SAE first)", async () => {
    const rows = await openAesByDeadline(db);
    expect(rows).toHaveLength(2);
    expect(rows[0].ae.seriousness).toBe("sae"); // ~18h deadline sorts first
    expect(rows[0].subjectCode).toMatch(/^AYU-001-P-/);
    expect(
      rows[0].ae.reportingDeadline.getTime(),
    ).toBeLessThan(rows[1].ae.reportingDeadline.getTime());
  });
});
