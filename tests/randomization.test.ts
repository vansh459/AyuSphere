/**
 * T10.2 — Randomization engine (D-027).
 * Gate: permuted blocks are exactly balanced (1:1 → 2+2 per block of 4);
 * allocation is deterministic under a fixed seed; ratios are respected over
 * N enrolments; enrolment no longer accepts a manual arm (engine-assigned,
 * recorded in the audit snapshot); malformed arm configs fall back safely
 * and duplicate arm names are rejected at trial creation.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "./helpers/db";
import {
  auditEvents,
  documents,
  participants,
  sites,
  trialSites,
  trials,
  users,
} from "@/db/schema";
import type { Actor } from "@/lib/audit";
import {
  DEFAULT_ARMS,
  assignArm,
  blockSize,
  parseArms,
  type ArmConfig,
} from "@/lib/rules/randomization";
import {
  addParticipant,
  enrolParticipant,
  recordConsent,
  recordScreening,
} from "@/services/participants";
import { createTrial } from "@/services/trials";

const ONE_TO_ONE: ArmConfig[] = [
  { name: "Intervention", ratio: 1 },
  { name: "Control", ratio: 1 },
];
const TWO_TO_ONE: ArmConfig[] = [
  { name: "High dose", ratio: 2 },
  { name: "Control", ratio: 1 },
];

describe("T10.2 — engine (pure)", () => {
  it("1:1 arms → block of 4 with exactly 2+2, in every block", () => {
    expect(blockSize(ONE_TO_ONE)).toBe(4);
    for (let block = 0; block < 10; block++) {
      const armsInBlock = [0, 1, 2, 3].map(
        (pos) => assignArm(ONE_TO_ONE, block * 4 + pos, "trial-x").arm,
      );
      expect(
        armsInBlock.filter((a) => a === "Intervention"),
        `block ${block} must hold exactly 2 Intervention`,
      ).toHaveLength(2);
      expect(armsInBlock.filter((a) => a === "Control")).toHaveLength(2);
    }
  });

  it("is deterministic under a fixed seed and tracks block metadata", () => {
    const first = Array.from({ length: 20 }, (_, i) =>
      assignArm(ONE_TO_ONE, i, "seed-A"),
    );
    const second = Array.from({ length: 20 }, (_, i) =>
      assignArm(ONE_TO_ONE, i, "seed-A"),
    );
    expect(first.map((a) => a.arm)).toEqual(second.map((a) => a.arm));
    expect(first[5].blockIndex).toBe(1);
    expect(first[5].positionInBlock).toBe(1);
    expect(first[5].blockSize).toBe(4);
  });

  it("2:1 ratios are respected exactly over whole blocks", () => {
    expect(blockSize(TWO_TO_ONE)).toBe(6); // 2×(2+1)
    const arms = Array.from({ length: 60 }, (_, i) =>
      assignArm(TWO_TO_ONE, i, "seed-B").arm,
    );
    expect(arms.filter((a) => a === "High dose")).toHaveLength(40);
    expect(arms.filter((a) => a === "Control")).toHaveLength(20);
  });

  it("parseArms falls back to the default 1:1 config on legacy/malformed data", () => {
    expect(parseArms([])).toEqual(DEFAULT_ARMS);
    expect(parseArms(null)).toEqual(DEFAULT_ARMS);
    expect(parseArms([{ name: "A", ratio: 0 }])).toEqual(DEFAULT_ARMS);
    expect(parseArms(TWO_TO_ONE)).toEqual(TWO_TO_ONE);
    expect(assignArm(ONE_TO_ONE, 0, "x")).toBeTruthy();
    expect(() => assignArm(ONE_TO_ONE, -1, "x")).toThrow(/non-negative/);
  });
});

describe("T10.2 — enrolment allocates via the engine (PGlite)", () => {
  let db: TestDb;
  let pi: Actor;
  let trialSiteId: string;
  let trialId: string;

  beforeAll(async () => {
    db = await createTestDb();
    const [u] = await db
      .insert(users)
      .values([{ email: "pi@r.demo", passwordHash: "x", name: "PI", role: "pi" }])
      .returning();
    pi = { id: u.id, role: "pi" };

    const [trial] = await db
      .insert(trials)
      .values({
        protocolCode: "AYU-RND",
        title: "Randomization fixture",
        studyType: "interventional",
        intervention: "X",
        targetEnrollment: 10,
        status: "active",
        arms: ONE_TO_ONE,
        visitPlan: [],
        createdBy: pi.id,
      })
      .returning();
    trialId = trial.id;
    const [site] = await db
      .insert(sites)
      .values({ name: "S", city: "C", state: "ST" })
      .returning();
    const [ts] = await db
      .insert(trialSites)
      .values({ trialId: trial.id, siteId: site.id, activationStatus: "active" })
      .returning();
    trialSiteId = ts.id;
    // consent binding (T10.4): recording consent needs a form on file
    await db.insert(documents).values({
      trialId: trial.id,
      kind: "consent_form",
      title: "Consent form v1",
      blobUrl: "blob://c1",
      uploadedBy: pi.id,
    });
  });

  it("the manual arm parameter is gone (engine decides)", () => {
    expect(enrolParticipant.length).toBe(3); // (db, actor, participantId)
  });

  it("four enrolments fill one balanced block; audit carries arm + blockIndex", async () => {
    const enrolledArms: string[] = [];
    for (let i = 0; i < 4; i++) {
      const p = await addParticipant(db, pi, trialSiteId);
      await recordScreening(db, pi, p.id, true);
      await recordConsent(db, pi, p.id);
      const enrolled = await enrolParticipant(db, pi, p.id);
      expect(enrolled.arm).toBeTruthy();
      enrolledArms.push(enrolled.arm!);
    }
    expect(enrolledArms.filter((a) => a === "Intervention")).toHaveLength(2);
    expect(enrolledArms.filter((a) => a === "Control")).toHaveLength(2);

    // deterministic against the engine, seeded by the trial id
    const expected = [0, 1, 2, 3].map((i) => assignArm(ONE_TO_ONE, i, trialId).arm);
    expect(enrolledArms).toEqual(expected);

    // allocation details land in the audit snapshot
    const enrolAudits = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "participant.enrol"));
    expect(enrolAudits).toHaveLength(4);
    for (const a of enrolAudits) {
      const after = a.after as { arm: string; blockIndex: number };
      expect(["Intervention", "Control"]).toContain(after.arm);
      expect(after.blockIndex).toBe(0);
    }

    // stored on the participants too
    const stored = await db
      .select()
      .from(participants)
      .where(eq(participants.status, "enrolled"));
    expect(stored.every((p) => p.arm !== null)).toBe(true);
  });

  it("duplicate arm names are rejected at trial creation", async () => {
    await expect(
      createTrial(db, pi, {
        protocolCode: "AYU-DUP",
        title: "Duplicate arms trial",
        studyType: "interventional",
        intervention: "Ashwagandha",
        targetEnrollment: 5,
        visitPlan: [{ visitNumber: 1, name: "B", dayOffset: 0, windowDays: 1 }],
        arms: [
          { name: "Arm", ratio: 1 },
          { name: "arm", ratio: 1 },
        ],
      }),
    ).rejects.toThrow(/unique/);
  });

  it("createTrial stores the arms config (default when omitted)", async () => {
    const t = await createTrial(db, pi, {
      protocolCode: "AYU-DEF",
      title: "Default arms trial",
      studyType: "interventional",
      intervention: "Ashwagandha",
      targetEnrollment: 5,
      visitPlan: [{ visitNumber: 1, name: "B", dayOffset: 0, windowDays: 1 }],
    });
    expect(t.arms).toEqual(DEFAULT_ARMS);
  });
});
