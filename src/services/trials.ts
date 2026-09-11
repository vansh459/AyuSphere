/**
 * Trial service — create + lifecycle transitions (workflow.md §2).
 * RBAC-checked, state-machine-guarded, fully audited.
 */
import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import {
  documents,
  milestones,
  participants,
  trialSites,
  trials,
} from "@/db/schema";
import { withAudit, type Actor } from "@/lib/audit";
import { assertCan } from "@/lib/rbac";
import {
  capabilityFor,
  validateTransition,
  type TrialStatus,
} from "@/lib/rules/lifecycle";
import { z } from "zod";

export const visitPlanItem = z.object({
  visitNumber: z.number().int().positive(),
  name: z.string().min(1),
  dayOffset: z.number().int().min(0),
  windowDays: z.number().int().min(0),
});

export const createTrialInput = z.object({
  protocolCode: z
    .string()
    .min(3, "needs at least 3 characters (e.g. AYU-004)")
    .max(40, "keep it under 40 characters"),
  title: z.string().min(5, "needs at least 5 characters — describe the study"),
  studyType: z.enum(["interventional", "observational"]),
  phase: z.string().optional(),
  intervention: z.string().min(2, "name the Ayurveda intervention"),
  dosageForm: z.string().optional(),
  targetEnrollment: z
    .number()
    .int("must be a whole number")
    .positive("must be greater than zero"),
  visitPlan: z
    .array(visitPlanItem)
    .min(1, "add at least one visit row (name + day offset + window)"),
});

export type CreateTrialInput = z.infer<typeof createTrialInput>;

export async function createTrial(
  db: Db,
  actor: Actor,
  input: CreateTrialInput,
) {
  assertCan(actor.role, "trial.manage");
  const data = createTrialInput.parse(input);

  return withAudit(db, actor, "trial.create", async (tx) => {
    const [trial] = await tx
      .insert(trials)
      .values({ ...data, createdBy: actor.id })
      .returning();
    // scaffold the regulatory milestones (workflow.md §2)
    await tx.insert(milestones).values(
      (["iec_submission", "iec_approval", "ctri_registration"] as const).map(
        (kind) => ({ trialId: trial.id, kind }),
      ),
    );
    return {
      result: trial,
      entityType: "trial",
      entityId: trial.id,
      after: { protocolCode: trial.protocolCode, status: trial.status },
    };
  });
}

/**
 * Trial list with enrolment/site counts. Join + group-by, NOT correlated
 * raw-SQL subqueries: with a single-table FROM drizzle emits unqualified
 * column names, so `${trials.id}` inside a subquery renders as bare "id"
 * and Postgres rejects it as ambiguous (prod bug, 2026-09-11).
 */
export async function listTrialsWithCounts(db: Db) {
  return db
    .select({
      trial: trials,
      enrolled: sql<number>`(count(distinct ${participants.id}) filter (where ${participants.status} = 'enrolled'))::int`,
      siteCount: sql<number>`count(distinct ${trialSites.id})::int`,
    })
    .from(trials)
    .leftJoin(trialSites, eq(trialSites.trialId, trials.id))
    .leftJoin(participants, eq(participants.trialSiteId, trialSites.id))
    .groupBy(trials.id)
    .orderBy(trials.createdAt);
}

export class TransitionError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "TransitionError";
  }
}

export async function transitionTrial(
  db: Db,
  actor: Actor,
  trialId: string,
  to: TrialStatus,
  extra?: { ctriNumber?: string },
) {
  const [trial] = await db
    .select()
    .from(trials)
    .where(eq(trials.id, trialId))
    .limit(1);
  if (!trial) throw new TransitionError("trial not found");
  const from = trial.status as TrialStatus;

  // the ethics gate carries its own capability (T1.1)
  assertCan(actor.role, capabilityFor(from, to));

  // context for the guards
  const [iec] = await db
    .select()
    .from(milestones)
    .where(
      and(
        eq(milestones.trialId, trialId),
        eq(milestones.kind, "iec_approval"),
        isNotNull(milestones.completedAt),
      ),
    )
    .limit(1);
  const activeSites = await db
    .select()
    .from(trialSites)
    .where(
      and(
        eq(trialSites.trialId, trialId),
        eq(trialSites.activationStatus, "active"),
      ),
    );
  const protocolDocs = await db
    .select()
    .from(documents)
    .where(
      and(eq(documents.trialId, trialId), eq(documents.kind, "protocol")),
    );

  const ctriNumber = extra?.ctriNumber ?? trial.ctriNumber ?? undefined;
  const check = validateTransition(from, to, {
    hasIecApproval: Boolean(iec),
    hasCtriNumber: Boolean(ctriNumber),
    hasActiveSite: activeSites.length > 0,
    hasProtocolDocument: protocolDocs.length > 0,
  });
  if (!check.ok) throw new TransitionError(check.reason);

  return withAudit(db, actor, "trial.transition", async (tx) => {
    const [updated] = await tx
      .update(trials)
      .set({
        status: to,
        ...(to === "ctri_registered" && extra?.ctriNumber
          ? { ctriNumber: extra.ctriNumber }
          : {}),
      })
      .where(eq(trials.id, trialId))
      .returning();

    // complete the matching milestone as lifecycle advances
    if (to === "iec_review") {
      await tx
        .update(milestones)
        .set({ completedAt: new Date() })
        .where(
          and(
            eq(milestones.trialId, trialId),
            eq(milestones.kind, "iec_submission"),
          ),
        );
    }
    if (to === "iec_approved") {
      await tx
        .update(milestones)
        .set({ completedAt: new Date() })
        .where(
          and(
            eq(milestones.trialId, trialId),
            eq(milestones.kind, "iec_approval"),
          ),
        );
    }
    if (to === "ctri_registered") {
      await tx
        .update(milestones)
        .set({ completedAt: new Date() })
        .where(
          and(
            eq(milestones.trialId, trialId),
            eq(milestones.kind, "ctri_registration"),
          ),
        );
    }

    return {
      result: updated,
      entityType: "trial",
      entityId: trialId,
      before: { status: from },
      after: {
        status: to,
        ...(extra?.ctriNumber ? { ctriNumber: extra.ctriNumber } : {}),
      },
    };
  });
}
