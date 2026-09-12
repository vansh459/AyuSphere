import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "./helpers/db";
import { DEMO_USERS, seed, type SeedSummary } from "@/db/seed";
import {
  adverseEvents,
  participants,
  trialSites,
  users,
} from "@/db/schema";

let db: TestDb;
let summary: SeedSummary;

beforeAll(async () => {
  db = await createTestDb();
  summary = await seed(db);
}, 180_000);

describe("T0.5 — deterministic synthetic seed (D-016)", () => {
  it("creates the expected volumes", () => {
    expect(summary.users).toBe(7);
    expect(summary.trials).toBe(3);
    expect(summary.sites).toBe(3);
    expect(summary.participants).toBe(66); // 24+18+3+12+9
    expect(summary.adverseEvents).toBe(3);
    expect(summary.visits).toBeGreaterThan(100);
  });

  it("seeds exactly one user per role", async () => {
    const rows = await db.select().from(users);
    const roles = rows.map((r) => r.role).sort();
    expect(roles).toEqual(
      DEMO_USERS.map((u) => u.role).sort(),
    );
  });

  it("plants the demo SAE with a live countdown (open, deadline in the future)", async () => {
    const saes = await db
      .select()
      .from(adverseEvents)
      .where(
        and(
          eq(adverseEvents.seriousness, "sae"),
          eq(adverseEvents.status, "open"),
          gt(adverseEvents.reportingDeadline, new Date()),
          isNull(adverseEvents.reportedAt),
        ),
      );
    expect(saes).toHaveLength(1);
    const hoursLeft =
      (saes[0].reportingDeadline.getTime() - Date.now()) / 3_600_000;
    expect(hoursLeft).toBeGreaterThan(12);
    expect(hoursLeft).toBeLessThan(24);
  });

  it("plants a lagging site (enrolment far below target)", async () => {
    const rows = await db
      .select({
        target: trialSites.enrollmentTarget,
        enrolled: sql<number>`(select count(*)::int from participants p where p.trial_site_id = ${trialSites.id})`,
      })
      .from(trialSites)
      .where(lt(sql`(select count(*)::int from participants p where p.trial_site_id = ${trialSites.id})`, trialSites.enrollmentTarget));
    const lagging = rows.filter((r) => r.enrolled / r.target < 0.2);
    expect(lagging.length).toBeGreaterThanOrEqual(1);
  });

  it("is deterministic: a second fresh seed produces identical subject codes", async () => {
    const db2 = await createTestDb();
    await seed(db2);
    const codes1 = (
      await db.select({ c: participants.subjectCode }).from(participants)
    )
      .map((r) => r.c)
      .sort();
    const codes2 = (
      await db2.select({ c: participants.subjectCode }).from(participants)
    )
      .map((r) => r.c)
      .sort();
    expect(codes2).toEqual(codes1);
  }, 60_000);
});
