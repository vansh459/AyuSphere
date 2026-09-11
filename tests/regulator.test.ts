import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "./helpers/db";
import { seed } from "@/db/seed";
import { alerts, trials, users, visits } from "@/db/schema";
import type { Actor } from "@/lib/audit";
import { RbacError } from "@/lib/rbac";
import { createTrial, transitionTrial } from "@/services/trials";
import { attachSiteToTrial, createSite } from "@/services/sites";
import {
  addParticipant,
  recordConsent,
  withdrawParticipant,
} from "@/services/participants";
import { completeVisit } from "@/services/visits";
import { createDraftEntry, approveEntry } from "@/services/crf";
import { captureAdverseEvent, advanceAeStatus } from "@/services/adverse-events";
import { acknowledgeAlert } from "@/services/alerts";
import { approveExtraction } from "@/services/extractions";
import { answerQuestion } from "@/services/copilot";
import { getAuditTrail } from "@/services/audit-browser";

let db: TestDb;
let regulator: Actor;
let realTrialId: string;
let realVisitId: string;
let realAlertId: string;

beforeAll(async () => {
  db = await createTestDb();
  await seed(db);
  const [u] = await db.select().from(users).where(eq(users.role, "regulator"));
  regulator = { id: u.id, role: "regulator" };
  const [t] = await db.select().from(trials).limit(1);
  realTrialId = t.id;
  const [v] = await db.select().from(visits).limit(1);
  realVisitId = v.id;
  const [a] = await db
    .insert(alerts)
    .values({
      ruleKey: "visit_overdue",
      entityRef: "visit:reg-test",
      severity: "warning",
      message: "m",
    })
    .returning();
  realAlertId = a.id;
}, 60_000);

describe("T4.3 — the regulator can mutate NOTHING (real entity ids)", () => {
  const uuid = "00000000-0000-0000-0000-000000000001";

  it("refuses every mutating service call with RbacError", async () => {
    const attempts: [string, () => Promise<unknown>][] = [
      ["createTrial", () =>
        createTrial(db, regulator, {
          protocolCode: "AYU-REG",
          title: "regulator should not create this",
          studyType: "observational",
          intervention: "X",
          targetEnrollment: 10,
          visitPlan: [{ visitNumber: 1, name: "B", dayOffset: 0, windowDays: 1 }],
        })],
      ["transitionTrial", () =>
        transitionTrial(db, regulator, realTrialId, "enrolment_closed")],
      ["createSite", () =>
        createSite(db, regulator, { name: "X", city: "Y", state: "Z" })],
      ["attachSiteToTrial", () =>
        attachSiteToTrial(db, regulator, {
          trialId: realTrialId,
          siteId: uuid,
          enrollmentTarget: 1,
        })],
      ["addParticipant", () => addParticipant(db, regulator, uuid)],
      ["recordConsent", () => recordConsent(db, regulator, uuid)],
      ["withdrawParticipant", () =>
        withdrawParticipant(db, regulator, uuid, "reason")],
      ["completeVisit", () => completeVisit(db, regulator, realVisitId)],
      ["createDraftEntry", () =>
        createDraftEntry(db, regulator, realVisitId, {})],
      ["approveEntry", () => approveEntry(db, regulator, uuid)],
      ["captureAdverseEvent", () =>
        captureAdverseEvent(db, regulator, {
          participantId: uuid,
          term: "X",
          seriousness: "ae",
          severity: "mild",
          onsetDate: new Date(),
        })],
      ["advanceAeStatus", () =>
        advanceAeStatus(db, regulator, uuid, "under_review")],
      ["acknowledgeAlert", () => acknowledgeAlert(db, regulator, realAlertId)],
      ["approveExtraction", () =>
        approveExtraction(db, regulator, {
          extractionId: uuid,
          finalData: {},
          touchedFields: [],
        })],
      ["copilot", () =>
        answerQuestion(db, regulator, "anything", {
          modelId: "m",
          complete: async () => "x",
        })],
    ];

    for (const [name, attempt] of attempts) {
      await expect(attempt(), `${name} must refuse the regulator`).rejects.toThrow(
        RbacError,
      );
    }
  });

  it("wrote zero audit rows while refusing (nothing mutated)", async () => {
    const rows = await getAuditTrail(db, regulator, { actorRole: "regulator" });
    expect(rows).toHaveLength(0);
  });
});

describe("T4.3 — audit browser (read-only access works)", () => {
  it("regulator CAN read the audit trail; filters apply", async () => {
    const all = await getAuditTrail(db, regulator, {});
    expect(all.length).toBeGreaterThan(0);

    const transitions = await getAuditTrail(db, regulator, {
      action: "trial.transition",
    });
    expect(transitions.length).toBeGreaterThan(0);
    for (const e of transitions) expect(e.action).toBe("trial.transition");

    const forTrial = await getAuditTrail(db, regulator, {
      entityType: "trial",
      entityId: transitions[0].entityId,
    });
    for (const e of forTrial) {
      expect(e.entityType).toBe("trial");
      expect(e.entityId).toBe(transitions[0].entityId);
    }
  });

  it("a role without audit.view is refused", async () => {
    const [pi] = await db.select().from(users).where(eq(users.role, "pi"));
    await expect(
      getAuditTrail(db, { id: pi.id, role: "pi" }, {}),
    ).rejects.toThrow(RbacError);
  });
});
