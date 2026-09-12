/**
 * Protocol amendments (T10.3, gap-analysis G10) — IEC oversight beyond the
 * initial review. PI/coordinator submit an amendment; the Ethics Committee
 * approves or returns it (mirroring the initial-review pattern); an
 * APPROVED, not-yet-applied amendment is consumed by `updateProtocol`,
 * which is the only way to change the visit plan or arms of a trial past
 * draft — applying bumps trials.protocol_version. Every step is audited.
 */
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { amendments, trials } from "@/db/schema";
import { withAudit, type Actor } from "@/lib/audit";
import { assertCan } from "@/lib/rbac";
import { armsSchema } from "@/lib/rules/randomization";
import { visitPlanItem } from "@/services/trials";

export class AmendmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AmendmentError";
  }
}

export const submitAmendmentInput = z.object({
  trialId: z.string().uuid(),
  summary: z.string().min(10, "describe the protocol change (min 10 chars)"),
  documentId: z.string().uuid().optional(),
});

export async function submitAmendment(
  db: Db,
  actor: Actor,
  input: z.infer<typeof submitAmendmentInput>,
) {
  assertCan(actor.role, "trial.manage");
  const data = submitAmendmentInput.parse(input);
  const [trial] = await db
    .select()
    .from(trials)
    .where(eq(trials.id, data.trialId))
    .limit(1);
  if (!trial) throw new AmendmentError("trial not found");
  if (trial.status === "draft") {
    throw new AmendmentError(
      "draft protocols are edited directly — amendments apply after IEC submission",
    );
  }

  return withAudit(db, actor, "amendment.submit", async (tx) => {
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(amendments)
      .where(eq(amendments.trialId, data.trialId));
    const [amendment] = await tx
      .insert(amendments)
      .values({
        trialId: data.trialId,
        versionNumber: n + 1,
        summary: data.summary,
        documentId: data.documentId ?? null,
        submittedBy: actor.id,
      })
      .returning();
    return {
      result: amendment,
      entityType: "amendment",
      entityId: amendment.id,
      after: {
        trialId: data.trialId,
        versionNumber: amendment.versionNumber,
        summary: data.summary,
      },
    };
  });
}

export async function decideAmendment(
  db: Db,
  actor: Actor,
  amendmentId: string,
  decision: "approved" | "returned",
  comment?: string,
) {
  // the ethics gate carries its own capability, like the initial review
  assertCan(actor.role, "trial.ethicsReview");
  const [amendment] = await db
    .select()
    .from(amendments)
    .where(eq(amendments.id, amendmentId))
    .limit(1);
  if (!amendment) throw new AmendmentError("amendment not found");
  if (amendment.status !== "submitted") {
    throw new AmendmentError(
      `cannot decide an amendment in status '${amendment.status}'`,
    );
  }
  if (decision === "returned" && !comment?.trim()) {
    throw new AmendmentError("returning an amendment requires a comment");
  }

  const action = decision === "approved" ? "amendment.approve" : "amendment.return";
  return withAudit(db, actor, action, async (tx) => {
    const [updated] = await tx
      .update(amendments)
      .set({
        status: decision,
        comment: comment?.trim() || null,
        decidedBy: actor.id,
        decidedAt: new Date(),
      })
      .where(eq(amendments.id, amendmentId))
      .returning();
    return {
      result: updated,
      entityType: "amendment",
      entityId: amendmentId,
      before: { status: "submitted" },
      after: { status: decision, ...(comment ? { comment } : {}) },
    };
  });
}

export const updateProtocolInput = z
  .object({
    visitPlan: z.array(visitPlanItem).min(1).optional(),
    arms: armsSchema.optional(),
  })
  .refine((d) => d.visitPlan || d.arms, {
    message: "nothing to change — provide a visit plan and/or arms",
  });

/**
 * The version-gated protocol change: free while the trial is still a draft;
 * past draft it CONSUMES the trial's earliest approved, unapplied amendment
 * and bumps protocol_version. Without one, the change is refused.
 */
export async function updateProtocol(
  db: Db,
  actor: Actor,
  trialId: string,
  input: z.infer<typeof updateProtocolInput>,
) {
  assertCan(actor.role, "trial.manage");
  const changes = updateProtocolInput.parse(input);
  const [trial] = await db
    .select()
    .from(trials)
    .where(eq(trials.id, trialId))
    .limit(1);
  if (!trial) throw new AmendmentError("trial not found");

  let gate: typeof amendments.$inferSelect | undefined;
  if (trial.status !== "draft") {
    [gate] = await db
      .select()
      .from(amendments)
      .where(
        and(
          eq(amendments.trialId, trialId),
          eq(amendments.status, "approved"),
          isNull(amendments.appliedAt),
        ),
      )
      .orderBy(amendments.versionNumber)
      .limit(1);
    if (!gate) {
      throw new AmendmentError(
        `protocol changes on a '${trial.status}' trial require an approved, unapplied amendment (IEC oversight)`,
      );
    }
  }

  return withAudit(db, actor, "trial.protocol_update", async (tx) => {
    const [updated] = await tx
      .update(trials)
      .set({
        ...(changes.visitPlan ? { visitPlan: changes.visitPlan } : {}),
        ...(changes.arms ? { arms: changes.arms } : {}),
        ...(gate ? { protocolVersion: trial.protocolVersion + 1 } : {}),
      })
      .where(eq(trials.id, trialId))
      .returning();
    if (gate) {
      await tx
        .update(amendments)
        .set({ appliedAt: new Date() })
        .where(eq(amendments.id, gate.id));
    }
    return {
      result: updated,
      entityType: "trial",
      entityId: trialId,
      before: {
        protocolVersion: trial.protocolVersion,
        visitPlan: trial.visitPlan,
        arms: trial.arms,
      },
      after: {
        protocolVersion: updated.protocolVersion,
        ...(changes.visitPlan ? { visitPlan: changes.visitPlan } : {}),
        ...(changes.arms ? { arms: changes.arms } : {}),
        ...(gate ? { amendmentId: gate.id } : {}),
      },
    };
  });
}

export async function listAmendments(db: Db, trialId: string) {
  return db
    .select()
    .from(amendments)
    .where(eq(amendments.trialId, trialId))
    .orderBy(desc(amendments.versionNumber));
}

/** the ethics amendment queue — pending across all trials, with labels */
export async function pendingAmendments(db: Db) {
  return db
    .select({
      amendment: amendments,
      protocolCode: trials.protocolCode,
      trialTitle: trials.title,
    })
    .from(amendments)
    .innerJoin(trials, eq(amendments.trialId, trials.id))
    .where(eq(amendments.status, "submitted"))
    .orderBy(amendments.createdAt);
}
