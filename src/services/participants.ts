/**
 * Participant service — de-identified lifecycle (workflow.md §4).
 * Subject codes are system-generated; enrolment is triple-guarded
 * (screening passed + consent given + trial active + site active) and
 * generates the visit schedule in the same transaction.
 */
import { and, desc, eq, ne, sql } from "drizzle-orm";
import type { Db } from "@/db";
import {
  crfTemplates,
  documents,
  participants,
  trialSites,
  trials,
  visits,
} from "@/db/schema";
import { withAudit, type Actor } from "@/lib/audit";
import { assertCan } from "@/lib/rbac";
import { assignArm, parseArms } from "@/lib/rules/randomization";
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

/** latest consent-form document for a trial (highest version), or undefined */
export async function latestConsentForm(db: Db, trialId: string) {
  const [doc] = await db
    .select()
    .from(documents)
    .where(
      and(eq(documents.trialId, trialId), eq(documents.kind, "consent_form")),
    )
    .orderBy(desc(documents.version))
    .limit(1);
  return doc;
}

/**
 * Consent is BOUND to the consent-form version signed (T10.4): with no
 * explicit document id, the trial's latest consent form is bound; a trial
 * without a consent form on file cannot record consent at all. An explicit
 * id must be one of this trial's consent-form documents.
 */
export async function recordConsent(
  db: Db,
  actor: Actor,
  participantId: string,
  consentDocumentId?: string,
) {
  assertCan(actor.role, "participant.manage");
  const { participant, trial } = await loadContext(db, participantId);

  let consentDoc;
  if (consentDocumentId) {
    [consentDoc] = await db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.id, consentDocumentId),
          eq(documents.trialId, trial.id),
          eq(documents.kind, "consent_form"),
        ),
      )
      .limit(1);
    if (!consentDoc) {
      throw new EnrolmentError(
        "consent must reference one of this trial's consent-form documents",
      );
    }
  } else {
    consentDoc = await latestConsentForm(db, trial.id);
    if (!consentDoc) {
      throw new EnrolmentError(
        "no consent form on file for this trial — upload one under Documents first",
      );
    }
  }

  return withAudit(db, actor, "participant.consent", async (tx) => {
    const [p] = await tx
      .update(participants)
      .set({
        consentStatus: "given",
        consentDate: new Date(),
        consentDocumentId: consentDoc.id,
      })
      .where(eq(participants.id, participantId))
      .returning();
    return {
      result: p,
      entityType: "participant",
      entityId: participantId,
      before: {
        consentStatus: participant.consentStatus,
        consentDocumentId: participant.consentDocumentId,
      },
      after: {
        consentStatus: "given",
        consentDocumentId: consentDoc.id,
        consentFormVersion: consentDoc.version,
      },
    };
  });
}

export type ConsentRegisterRow = {
  participantId: string;
  subjectCode: string;
  status: string;
  consentStatus: string;
  consentDate: Date | null;
  /** version actually signed (null = legacy unbound consent) */
  consentFormVersion: number | null;
  latestFormVersion: number | null;
  reconsentDue: boolean;
};

/** who consented on which consent-form version — the trial's consent register */
export async function consentRegister(
  db: Db,
  trialId: string,
): Promise<ConsentRegisterRow[]> {
  const latest = await latestConsentForm(db, trialId);
  const rows = await db
    .select({
      p: participants,
      docVersion: documents.version,
    })
    .from(participants)
    .innerJoin(trialSites, eq(participants.trialSiteId, trialSites.id))
    .leftJoin(documents, eq(participants.consentDocumentId, documents.id))
    .where(eq(trialSites.trialId, trialId))
    .orderBy(participants.subjectCode);
  return rows.map(({ p, docVersion }) => ({
    participantId: p.id,
    subjectCode: p.subjectCode,
    status: p.status,
    consentStatus: p.consentStatus,
    consentDate: p.consentDate,
    consentFormVersion: docVersion ?? null,
    latestFormVersion: latest?.version ?? null,
    reconsentDue: Boolean(
      p.consentStatus === "given" &&
        docVersion !== null &&
        latest &&
        docVersion < latest.version,
    ),
  }));
}

export async function enrolParticipant(
  db: Db,
  actor: Actor,
  participantId: string,
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

    // randomization (T10.2, D-027): permuted-block allocation — the
    // enrolment sequence is the count of prior allocations in this trial
    // (withdrawn subjects keep their consumed slot), seeded by the trial id
    const [{ n: sequence }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(participants)
      .innerJoin(trialSites, eq(participants.trialSiteId, trialSites.id))
      .where(
        and(
          eq(trialSites.trialId, trial.id),
          sql`${participants.enrolledAt} is not null`,
        ),
      );
    const allocation = assignArm(parseArms(trial.arms), sequence, trial.id);

    const [p] = await tx
      .update(participants)
      .set({ status: "enrolled", arm: allocation.arm, enrolledAt })
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
      after: {
        status: "enrolled",
        arm: allocation.arm,
        blockIndex: allocation.blockIndex,
        visitsGenerated: schedule.length,
      },
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
