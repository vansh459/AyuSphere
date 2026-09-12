/**
 * D-021 — real CTRI registry metadata seed, synthetic participants only.
 * seedReal must insert real trial metadata (valid CTRI numbers), scaffold a
 * CRF template for every visit-plan entry (visits never template-less),
 * generate ONLY synthetic, de-identified participants, be deterministic,
 * and be idempotent (re-run inserts nothing new).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { eq, isNull } from "drizzle-orm";
import { createTestDb, type TestDb } from "./helpers/db";
import { seedReal, type SeedRealSummary } from "@/db/seed-real";
import ctriData from "@/db/data/ctri_trials.json";
import {
  crfTemplates,
  milestones,
  participants,
  trials,
  visits,
} from "@/db/schema";

const CTRI_RE = /^CTRI\/\d{4}\/\d{2}\/\d{6}$/;

let db: TestDb;
let summary: SeedRealSummary;

beforeAll(async () => {
  db = await createTestDb();
  summary = await seedReal(db);
}, 180_000);

describe("D-021 — seedReal: real CTRI registry metadata", () => {
  it("inserts more than zero trials from the scraped registry data", () => {
    expect(summary.trialsInserted).toBeGreaterThan(0);
    expect(summary.trialsInserted).toBe(
      (ctriData as { trials: unknown[] }).trials.length,
    );
  });

  it("every inserted trial carries a valid CTRI registration number", async () => {
    const rows = await db.select().from(trials);
    expect(rows.length).toBeGreaterThan(0);
    for (const t of rows) {
      expect(t.ctriNumber).toMatch(CTRI_RE);
    }
  });

  it("scaffolds a CRF template for every visit-plan entry of every trial", async () => {
    const trialRows = await db.select().from(trials);
    const templateRows = await db.select().from(crfTemplates);
    for (const t of trialRows) {
      const plan = t.visitPlan as { name: string }[];
      expect(plan.length).toBeGreaterThan(0);
      for (const v of plan) {
        const match = templateRows.find(
          (tt) => tt.trialId === t.id && tt.visitType === v.name,
        );
        expect(match, `${t.protocolCode} / ${v.name} must have a template`).toBeDefined();
        expect((match!.fields as unknown[]).length).toBeGreaterThan(0);
      }
    }
  });

  it("creates no template-less visits", async () => {
    const orphans = await db.select().from(visits).where(isNull(visits.templateId));
    expect(orphans).toHaveLength(0);
  });

  it("participants are synthetic and de-identified: subject codes only, no identifier values", async () => {
    const rows = await db.select().from(participants);
    expect(rows.length).toBeGreaterThan(0);
    for (const p of rows) {
      // the only identity is the trial-scoped subject code
      expect(p.subjectCode).toMatch(/^CTRI-\d{6}-P-\d{4}$/);
      // no identifying free-text sneaks into the open columns
      expect(p.arm === null || ["intervention", "control"].includes(p.arm!)).toBe(true);
      expect(p.withdrawalReason).toBeNull();
      expect(p.eligibility).toEqual({});
    }
    // schema-level: participants has no name/phone/address/dob columns at all
    const cols = Object.keys(participants);
    for (const forbidden of ["name", "phone", "address", "dob", "email", "aadhaar"]) {
      expect(cols).not.toContain(forbidden);
    }
  });

  it("participant counts stay within the 5-15 per trial band, first ~6 trials only", async () => {
    const trialRows = await db.select().from(trials);
    const withParticipants = new Map<string, number>();
    const parts = await db
      .select({ code: participants.subjectCode })
      .from(participants);
    for (const p of parts) {
      const proto = p.code.split("-P-")[0];
      withParticipants.set(proto, (withParticipants.get(proto) ?? 0) + 1);
    }
    expect(withParticipants.size).toBeGreaterThan(0);
    expect(withParticipants.size).toBeLessThanOrEqual(6);
    for (const [, count] of withParticipants) {
      expect(count).toBeGreaterThanOrEqual(5);
      expect(count).toBeLessThanOrEqual(15);
    }
    expect(summary.participantsCreated).toBe(parts.length);
    expect(trialRows.length).toBeGreaterThanOrEqual(withParticipants.size);
  });

  it("is deterministic: a second fresh seed produces identical subject codes", async () => {
    const db2 = await createTestDb();
    await seedReal(db2);
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
  }, 120_000);

  it("is idempotent: re-running on the same db inserts nothing new", async () => {
    const before = (await db.select({ id: trials.id }).from(trials)).length;
    const again = await seedReal(db);
    expect(again.trialsInserted).toBe(0);
    expect(again.trialsSkipped).toBeGreaterThan(0);
    expect(again.participantsCreated).toBe(0);
    const after = (await db.select({ id: trials.id }).from(trials)).length;
    expect(after).toBe(before);
  });

  it("active trials have completed iec_approval + ctri_registration milestones", async () => {
    const activeTrials = await db
      .select()
      .from(trials)
      .where(eq(trials.status, "active"));
    expect(activeTrials.length).toBeGreaterThan(0);
    const ms = await db.select().from(milestones);
    for (const t of activeTrials) {
      const mine = ms.filter((m) => m.trialId === t.id);
      const iec = mine.find((m) => m.kind === "iec_approval");
      const ctri = mine.find((m) => m.kind === "ctri_registration");
      expect(iec?.completedAt).toBeTruthy();
      expect(ctri?.completedAt).toBeTruthy();
    }
  });

  it("enrollment targets are clamped to 10..1000", async () => {
    const rows = await db.select().from(trials);
    for (const t of rows) {
      expect(t.targetEnrollment).toBeGreaterThanOrEqual(10);
      expect(t.targetEnrollment).toBeLessThanOrEqual(1000);
    }
  });
});
