/**
 * T10.3 — Protocol amendments.
 * Gate: protocol changes on a non-draft trial are refused without an
 * approved, unapplied amendment and succeed by consuming one (version
 * bumped, amendment stamped applied); the decision is ethics-only and a
 * return requires a comment; drafts stay freely editable; the full walk is
 * audited.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "./helpers/db";
import { amendments, auditEvents, trials, users } from "@/db/schema";
import type { Actor } from "@/lib/audit";
import { RbacError } from "@/lib/rbac";
import {
  AmendmentError,
  decideAmendment,
  listAmendments,
  pendingAmendments,
  submitAmendment,
  updateProtocol,
} from "@/services/amendments";

const PLAN_V1 = [{ visitNumber: 1, name: "Baseline", dayOffset: 0, windowDays: 3 }];
const PLAN_V2 = [
  ...PLAN_V1,
  { visitNumber: 2, name: "Day 90", dayOffset: 90, windowDays: 7 },
];

let db: TestDb;
let pi: Actor, ethics: Actor;
let activeTrialId: string;
let draftTrialId: string;

beforeAll(async () => {
  db = await createTestDb();
  const rows = await db
    .insert(users)
    .values([
      { email: "pi@am.demo", passwordHash: "x", name: "PI", role: "pi" },
      { email: "et@am.demo", passwordHash: "x", name: "ET", role: "ethics" },
    ])
    .returning();
  pi = { id: rows[0].id, role: "pi" };
  ethics = { id: rows[1].id, role: "ethics" };

  const inserted = await db
    .insert(trials)
    .values([
      {
        protocolCode: "AYU-AMD",
        title: "Amendment fixture (active)",
        studyType: "interventional",
        intervention: "X",
        targetEnrollment: 10,
        status: "active",
        visitPlan: PLAN_V1,
        createdBy: pi.id,
      },
      {
        protocolCode: "AYU-DRAFT",
        title: "Amendment fixture (draft)",
        studyType: "interventional",
        intervention: "X",
        targetEnrollment: 10,
        status: "draft",
        visitPlan: PLAN_V1,
        createdBy: pi.id,
      },
    ])
    .returning();
  activeTrialId = inserted[0].id;
  draftTrialId = inserted[1].id;
});

describe("T10.3 — the gate", () => {
  it("a protocol change on an ACTIVE trial is refused without an approved amendment", async () => {
    await expect(
      updateProtocol(db, pi, activeTrialId, { visitPlan: PLAN_V2 }),
    ).rejects.toThrow(/require an approved, unapplied amendment/);
    const [t] = await db.select().from(trials).where(eq(trials.id, activeTrialId));
    expect(t.visitPlan).toEqual(PLAN_V1);
    expect(t.protocolVersion).toBe(1);
  });

  it("drafts are edited freely (no amendment, no version bump)", async () => {
    const updated = await updateProtocol(db, pi, draftTrialId, {
      visitPlan: PLAN_V2,
    });
    expect(updated.visitPlan).toEqual(PLAN_V2);
    expect(updated.protocolVersion).toBe(1);
    // and drafts cannot receive amendments — they are pre-IEC
    await expect(
      submitAmendment(db, pi, {
        trialId: draftTrialId,
        summary: "needless amendment on a draft protocol",
      }),
    ).rejects.toThrow(/edited directly/);
  });
});

describe("T10.3 — submit → ethics decision → apply", () => {
  it("ethics-only decision; returning requires a comment; resubmission sequences", async () => {
    const a1 = await submitAmendment(db, pi, {
      trialId: activeTrialId,
      summary: "Add a day-90 follow-up visit to the schedule",
    });
    expect(a1.versionNumber).toBe(1);
    expect(a1.status).toBe("submitted");

    // ethics cannot submit; PI cannot decide
    await expect(
      submitAmendment(db, ethics, { trialId: activeTrialId, summary: "ethics writing amendments?" }),
    ).rejects.toThrow(RbacError);
    await expect(
      decideAmendment(db, pi, a1.id, "approved"),
    ).rejects.toThrow(RbacError);

    // a return needs a comment
    await expect(decideAmendment(db, ethics, a1.id, "returned")).rejects.toThrow(
      /requires a comment/,
    );
    const returned = await decideAmendment(
      db,
      ethics,
      a1.id,
      "returned",
      "specify the visit window for day 90",
    );
    expect(returned.status).toBe("returned");
    // a decided amendment cannot be decided again
    await expect(
      decideAmendment(db, ethics, a1.id, "approved"),
    ).rejects.toThrow(AmendmentError);

    // resubmit with the fix → v2, visible in the ethics queue, then approved
    const a2 = await submitAmendment(db, pi, {
      trialId: activeTrialId,
      summary: "Add a day-90 follow-up visit (window ±7 days)",
    });
    expect(a2.versionNumber).toBe(2);
    const queue = await pendingAmendments(db);
    expect(queue.map((q) => q.amendment.id)).toEqual([a2.id]);
    const approved = await decideAmendment(db, ethics, a2.id, "approved");
    expect(approved.status).toBe("approved");
    expect(approved.decidedBy).toBe(ethics.id);
  });

  it("applying the change consumes the amendment and bumps the protocol version", async () => {
    const updated = await updateProtocol(db, pi, activeTrialId, {
      visitPlan: PLAN_V2,
      arms: [
        { name: "High dose", ratio: 2 },
        { name: "Control", ratio: 1 },
      ],
    });
    expect(updated.visitPlan).toEqual(PLAN_V2);
    expect(updated.protocolVersion).toBe(2);

    const all = await listAmendments(db, activeTrialId);
    const consumed = all.find((a) => a.versionNumber === 2)!;
    expect(consumed.appliedAt).toBeInstanceOf(Date);

    // the gate is consumed — the next change needs a NEW approved amendment
    await expect(
      updateProtocol(db, pi, activeTrialId, { visitPlan: PLAN_V1 }),
    ).rejects.toThrow(/require an approved, unapplied amendment/);
  });

  it("the full walk is audited", async () => {
    const rows = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.entityType, "amendment"));
    expect(rows.map((r) => r.action).sort()).toEqual([
      "amendment.approve",
      "amendment.return",
      "amendment.submit",
      "amendment.submit",
    ]);

    const [protoUpdate] = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "trial.protocol_update"))
      .then((r) => r.filter((e) => e.entityId === activeTrialId));
    expect(protoUpdate).toBeDefined();
    const after = protoUpdate.after as { protocolVersion: number; amendmentId: string };
    expect(after.protocolVersion).toBe(2);
    expect(after.amendmentId).toBeTruthy();

    // amendments never appear for unknown trials
    await expect(
      submitAmendment(db, pi, {
        trialId: "00000000-0000-4000-8000-000000000042",
        summary: "amendment for a ghost trial",
      }),
    ).rejects.toThrow(AmendmentError);
  });
});
