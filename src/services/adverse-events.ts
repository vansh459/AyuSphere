/**
 * Adverse Event / SAE service (workflow.md §8).
 * Capture starts the escalation clock (deadline computed at insert);
 * every step appends to ae_actions AND the audit trail.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { adverseEvents, aeActions, participants } from "@/db/schema";
import { withAudit, type Actor } from "@/lib/audit";
import { assertCan } from "@/lib/rbac";
import {
  computeDeadlines,
  type DeadlineRule,
} from "@/lib/rules/deadlines";

export const captureAeInput = z.object({
  participantId: z.string().uuid(),
  term: z.string().min(2),
  seriousness: z.enum(["ae", "sae"]),
  severity: z.enum(["mild", "moderate", "severe"]),
  onsetDate: z.coerce.date(),
  narrative: z.string().optional(),
  meddraCode: z.string().optional(),
  whodrugCode: z.string().optional(),
  causality: z.string().optional(),
});

export type CaptureAeInput = z.infer<typeof captureAeInput>;

export class AeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AeError";
  }
}

export async function captureAdverseEvent(
  db: Db,
  actor: Actor,
  input: CaptureAeInput,
  rules?: DeadlineRule[],
  capturedAt = new Date(),
) {
  assertCan(actor.role, "ae.capture");
  const data = captureAeInput.parse(input);

  const [participant] = await db
    .select()
    .from(participants)
    .where(eq(participants.id, data.participantId))
    .limit(1);
  if (!participant) throw new AeError("participant not found");

  // the clock runs from awareness (capture), not onset
  const deadlines = computeDeadlines(data.seriousness, capturedAt, rules);

  return withAudit(db, actor, "ae.capture", async (tx) => {
    const [ae] = await tx
      .insert(adverseEvents)
      .values({
        ...data,
        reportingDeadline: deadlines.reportingDeadline,
        detailedReportDeadline: deadlines.detailedReportDeadline,
        createdBy: actor.id,
      })
      .returning();
    await tx.insert(aeActions).values({
      aeId: ae.id,
      action: "captured",
      actorId: actor.id,
    });
    return {
      result: ae,
      entityType: "adverse_event",
      entityId: ae.id,
      after: {
        term: ae.term,
        seriousness: ae.seriousness,
        reportingDeadline: ae.reportingDeadline.toISOString(),
      },
    };
  });
}

const WALK: Record<string, { from: string[]; action: string }> = {
  under_review: { from: ["open"], action: "review_started" },
  reported: { from: ["open", "under_review"], action: "reported" },
  closed: { from: ["reported"], action: "closed" },
};

export async function advanceAeStatus(
  db: Db,
  actor: Actor,
  aeId: string,
  to: "under_review" | "reported" | "closed",
  note?: string,
) {
  assertCan(actor.role, "ae.review");
  const [ae] = await db
    .select()
    .from(adverseEvents)
    .where(eq(adverseEvents.id, aeId))
    .limit(1);
  if (!ae) throw new AeError("adverse event not found");
  const rule = WALK[to];
  if (!rule.from.includes(ae.status)) {
    throw new AeError(`cannot move AE from '${ae.status}' to '${to}'`);
  }

  return withAudit(db, actor, `ae.${rule.action}`, async (tx) => {
    const [updated] = await tx
      .update(adverseEvents)
      .set({
        status: to,
        ...(to === "reported" ? { reportedAt: new Date() } : {}),
      })
      .where(eq(adverseEvents.id, aeId))
      .returning();
    await tx.insert(aeActions).values({
      aeId,
      action: rule.action,
      actorId: actor.id,
      note: note ?? null,
    });
    return {
      result: updated,
      entityType: "adverse_event",
      entityId: aeId,
      before: { status: ae.status },
      after: { status: to },
    };
  });
}

export async function aeTimeline(db: Db, aeId: string) {
  return db
    .select()
    .from(aeActions)
    .where(eq(aeActions.aeId, aeId))
    .orderBy(aeActions.at);
}
