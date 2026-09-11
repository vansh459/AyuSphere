/**
 * Participant service — de-identified lifecycle (workflow.md §4).
 * Subject codes are system-generated; enrolment is triple-guarded
 * (screening passed + consent given + trial active + site active) and
 * generates the visit schedule in the same transaction.
 */
import { and, eq, ne, sql } from "drizzle-orm";
import type { Db } from "@/db";
import {
  crfTemplates,
  participants,
  trialSites,
  trials,
  visits,
} from "@/db/schema";
import { withAudit, type Actor } from "@/lib/audit";
import { assertCan } from "@/lib/rbac";
import {
  generateVisitSchedule,
  type VisitPlanItem,
} from "@/lib/rules/visits";

export class EnrolmentError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "EnrolmentError";
  }
}

async function loadContext(db: Db, participantId: string) {
  const [row] = await db
    .select({
      participant: participants,
      trialSite: trialSites,
      trial: trials,
    })
    .from(participants)
    .innerJoin(trialSites, eq(participants.trialSiteId, trialSites.id))
    .innerJoin(trials, eq(trialSites.trialId, trials.id))
    .where(eq(participants.id, participantId))
    .limit(1);
  if (!row) throw new EnrolmentError("participant not found");
  return row;
}

export async function addParticipant(
  db: Db,
  actor: Actor,
  trialSiteId: string,
) {
  assertCan(actor.role, "participant.manage");
  const [ts] = await db
    .select({ trialSite: trialSites, trial: trials })
    .from(trialSites)
    .innerJoin(trials, eq(trialSites.trialId, trials.id))
    .where(eq(trialSites.id, trialSiteId))
    .limit(1);
  if (!ts) throw new EnrolmentError("trial site not found");

  return withAudit(db, actor, "participant.create", async (tx) => {
    // sequential per trial, across all its sites
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(participants)
      .innerJoin(trialSites, eq(participants.trialSiteId, trialSites.id))
      .where(eq(trialSites.trialId, ts.trial.id));
    const subjectCode = `${ts.trial.protocolCode}-P-${String(n + 1).padStart(4, "0")}`;
    const [p] = await tx
      .insert(participants)
      .values({ subjectCode, trialSiteId })
      .returning();
    return {
      result: p,
      entityType: "participant",
      entityId: p.id,
      after: { subjectCode, status: p.status },
    };
  });
}

export async function recordScreening(
  db: Db,
  actor: Actor,
  participantId: string,
  passed: boolean,
) {
  assertCan(actor.role, "participant.manage");
  const { participant } = await loadContext(db, participantId);
  return withAudit(db, actor, "participant.screen", async (tx) => {
    const [p] = await tx
      .update(participants)
      .set({ screeningStatus: passed ? "passed" : "failed" })
      .where(eq(participants.id, participantId))
      .returning();
    return {
      result: p,
      entityType: "participant",
      entityId: participantId,
      before: { screeningStatus: participant.screeningStatus },
      after: { screeningStatus: p.screeningStatus },
    };
  });
}

export async function recordConsent(
  db: Db,
  actor: Actor,
  participantId: string,
  consentDocumentId?: string,
) {
  assertCan(actor.role, "participant.manage");
  const { participant } = await loadContext(db, participantId);
  return withAudit(db, actor, "participant.consent", async (tx) => {
    const [p] = await tx
      .update(participants)
      .set({
        consentStatus: "given",
        consentDate: new Date(),
        consentDocumentId: consentDocumentId ?? null,
      })
      .where(eq(participants.id, participantId))
      .returning();
    return {
      result: p,
      entityType: "participant",
      entityId: participantId,
      before: { consentStatus: participant.consentStatus },
      after: { consentStatus: "given" },
    };
  });
}

export async function enrolParticipant(
  db: Db,
  actor: Actor,
  participantId: string,
  arm: string,
) {
  assertCan(actor.role, "participant.manage");
  const { participant, trialSite, trial } = await loadContext(
    db,
    participantId,
  );

  if (participant.status !== "screening") {
    throw new EnrolmentError(`participant is already ${participant.status}`);
  }
  if (participant.screeningStatus !== "passed") {
    throw new EnrolmentError("screening has not passed");
  }
  if (participant.consentStatus !== "given") {
    throw new EnrolmentError("informed consent has not been recorded");
  }
  if (trial.status !== "active") {
    throw new EnrolmentError(
      `trial is ${trial.status}; enrolment requires an active trial`,
    );
  }
  if (trialSite.activationStatus !== "active") {
    throw new EnrolmentError("site is not activated for this trial");
  }

  const templates = await db
    .select()
    .from(crfTemplates)
    .where(eq(crfTemplates.trialId, trial.id));

  return withAudit(db, actor, "participant.enrol", async (tx) => {
    const enrolledAt = new Date();
    const [p] = await tx
      .update(participants)
      .set({ status: "enrolled", arm, enrolledAt })
      .where(eq(participants.id, participantId))
      .returning();

    const schedule = generateVisitSchedule(
      enrolledAt,
      trial.visitPlan as VisitPlanItem[],
    );
    if (schedule.length > 0) {
      await tx.insert(visits).values(
        schedule.map((v) => ({
          participantId,
          templateId:
            templates.find((t) => t.visitType === v.name)?.id ?? null,
          visitNumber: v.visitNumber,
          name: v.name,
          scheduledDate: v.scheduledDate,
          windowStart: v.windowStart,
          windowEnd: v.windowEnd,
        })),
      );
    }
    return {
      result: p,
      entityType: "participant",
      entityId: participantId,
      before: { status: "screening" },
      after: { status: "enrolled", arm, visitsGenerated: schedule.length },
    };
  });
}

export async function withdrawParticipant(
  db: Db,
  actor: Actor,
  participantId: string,
  reason: string,
) {
  assertCan(actor.role, "participant.manage");
  const { participant } = await loadContext(db, participantId);
  if (participant.status === "withdrawn") {
    throw new EnrolmentError("participant already withdrawn");
  }
  return withAudit(db, actor, "participant.withdraw", async (tx) => {
    const [p] = await tx
      .update(participants)
      .set({
        status: "withdrawn",
        withdrawalReason: reason,
        withdrawnAt: new Date(),
      })
      .where(eq(participants.id, participantId))
      .returning();
    // cancel everything not already completed/missed
    const cancelled = await tx
      .update(visits)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(visits.participantId, participantId),
          ne(visits.status, "completed"),
          ne(visits.status, "missed"),
        ),
      )
      .returning();
    return {
      result: p,
      entityType: "participant",
      entityId: participantId,
      before: { status: participant.status },
      after: {
        status: "withdrawn",
        reason,
        visitsCancelled: cancelled.length,
      },
    };
  });
}
