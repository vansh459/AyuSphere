import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "./helpers/db";
import { documents, users, visits } from "@/db/schema";
import type { Actor } from "@/lib/audit";
import {
  activateTrialSite,
  attachSiteToTrial,
  createSite,
} from "@/services/sites";
import { createTrial, transitionTrial } from "@/services/trials";
import {
  EnrolmentError,
  addParticipant,
  enrolParticipant,
  recordConsent,
  recordScreening,
  withdrawParticipant,
} from "@/services/participants";

let db: TestDb;
let pi: Actor, ethics: Actor;
let activeTsId: string;
let pendingTsId: string;

/** full journey to an active trial with one active + one pending site */
beforeAll(async () => {
  db = await createTestDb();
  const rows = await db
    .insert(users)
    .values([
      { email: "pi@t.demo", passwordHash: "x", name: "PI", role: "pi" },
      { email: "et@t.demo", passwordHash: "x", name: "ET", role: "ethics" },
    ])
    .returning();
  pi = { id: rows[0].id, role: "pi" };
  ethics = { id: rows[1].id, role: "ethics" };

  const trial = await createTrial(db, pi, {
    protocolCode: "AYU-400",
    title: "Participant service fixture trial",
    studyType: "interventional",
    intervention: "Ashwagandha",
    targetEnrollment: 30,
    visitPlan: [
      { visitNumber: 1, name: "Baseline", dayOffset: 0, windowDays: 3 },
      { visitNumber: 2, name: "Week 4", dayOffset: 28, windowDays: 7 },
      { visitNumber: 3, name: "Week 12", dayOffset: 84, windowDays: 7 },
    ],
  });
  await db.insert(documents).values({
    trialId: trial.id,
    kind: "protocol",
    title: "Protocol v1",
    blobUrl: "blob://p",
    uploadedBy: pi.id,
  });
  await transitionTrial(db, pi, trial.id, "iec_review");
  await transitionTrial(db, ethics, trial.id, "iec_approved");
  await transitionTrial(db, pi, trial.id, "ctri_registered", {
    ctriNumber: "CTRI/2026/09/012345",
  });

  const siteA = await createSite(db, pi, {
    name: "AIIA Delhi",
    city: "New Delhi",
    state: "DL",
  });
  const siteB = await createSite(db, pi, {
    name: "NIA Jaipur",
    city: "Jaipur",
    state: "RJ",
  });
  const tsA = await attachSiteToTrial(db, pi, {
    trialId: trial.id,
    siteId: siteA.id,
    enrollmentTarget: 20,
  });
  const tsB = await attachSiteToTrial(db, pi, {
    trialId: trial.id,
    siteId: siteB.id,
    enrollmentTarget: 10,
  });
  await activateTrialSite(db, pi, tsA.id);
  activeTsId = tsA.id;
  pendingTsId = tsB.id;

  await transitionTrial(db, pi, trial.id, "active");
});

describe("T1.4 — subject codes", () => {
  it("generates sequential de-identified codes across the trial", async () => {
    const p1 = await addParticipant(db, pi, activeTsId);
    const p2 = await addParticipant(db, pi, activeTsId);
    expect(p1.subjectCode).toBe("AYU-400-P-0001");
    expect(p2.subjectCode).toBe("AYU-400-P-0002");
    expect(p1.status).toBe("screening");
  });
});

describe("T1.4 — enrolment guards (each independently)", () => {
  it("refuses without screening pass", async () => {
    const p = await addParticipant(db, pi, activeTsId);
    await recordConsent(db, pi, p.id);
    await expect(enrolParticipant(db, pi, p.id, "intervention")).rejects.toThrow(
      /screening/,
    );
  });

  it("refuses without consent", async () => {
    const p = await addParticipant(db, pi, activeTsId);
    await recordScreening(db, pi, p.id, true);
    await expect(enrolParticipant(db, pi, p.id, "intervention")).rejects.toThrow(
      /consent/,
    );
  });

  it("refuses at a non-activated site", async () => {
    const p = await addParticipant(db, pi, pendingTsId);
    await recordScreening(db, pi, p.id, true);
    await recordConsent(db, pi, p.id);
    await expect(enrolParticipant(db, pi, p.id, "control")).rejects.toThrow(
      /site is not activated/,
    );
  });

  it("refuses failed screening", async () => {
    const p = await addParticipant(db, pi, activeTsId);
    await recordScreening(db, pi, p.id, false);
    await recordConsent(db, pi, p.id);
    await expect(
      enrolParticipant(db, pi, p.id, "intervention"),
    ).rejects.toThrow(EnrolmentError);
  });
});

describe("T1.4 — enrolment generates the visit schedule", () => {
  it("creates one visit per plan item with exact windows", async () => {
    const p = await addParticipant(db, pi, activeTsId);
    await recordScreening(db, pi, p.id, true);
    await recordConsent(db, pi, p.id);
    const enrolled = await enrolParticipant(db, pi, p.id, "intervention");
    expect(enrolled.status).toBe("enrolled");

    const vs = await db
      .select()
      .from(visits)
      .where(eq(visits.participantId, p.id));
    expect(vs).toHaveLength(3);

    const week4 = vs.find((v) => v.visitNumber === 2)!;
    const enrolledAt = enrolled.enrolledAt!.getTime();
    const day = 86_400_000;
    expect(week4.scheduledDate.getTime()).toBe(enrolledAt + 28 * day);
    expect(week4.windowStart.getTime()).toBe(enrolledAt + 21 * day);
    expect(week4.windowEnd.getTime()).toBe(enrolledAt + 35 * day);
    expect(week4.status).toBe("upcoming");
  });

  it("cannot enrol twice", async () => {
    const p = await addParticipant(db, pi, activeTsId);
    await recordScreening(db, pi, p.id, true);
    await recordConsent(db, pi, p.id);
    await enrolParticipant(db, pi, p.id, "control");
    await expect(enrolParticipant(db, pi, p.id, "control")).rejects.toThrow(
      /already enrolled/,
    );
  });
});

describe("T1.4 — withdrawal", () => {
  it("cancels remaining visits, keeps completed ones, records reason", async () => {
    const p = await addParticipant(db, pi, activeTsId);
    await recordScreening(db, pi, p.id, true);
    await recordConsent(db, pi, p.id);
    await enrolParticipant(db, pi, p.id, "intervention");

    // complete the baseline manually
    const vs = await db
      .select()
      .from(visits)
      .where(eq(visits.participantId, p.id));
    await db
      .update(visits)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(visits.id, vs.find((v) => v.visitNumber === 1)!.id));

    const w = await withdrawParticipant(db, pi, p.id, "participant request");
    expect(w.status).toBe("withdrawn");
    expect(w.withdrawalReason).toBe("participant request");

    const after = await db
      .select()
      .from(visits)
      .where(eq(visits.participantId, p.id));
    expect(after.find((v) => v.visitNumber === 1)!.status).toBe("completed");
    expect(after.find((v) => v.visitNumber === 2)!.status).toBe("cancelled");
    expect(after.find((v) => v.visitNumber === 3)!.status).toBe("cancelled");
  });
});
