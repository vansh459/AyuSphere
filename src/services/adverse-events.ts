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
import { getAlertConfig } from "@/services/settings";
import { decodeMeddra } from "@/lib/dictionaries/meddra-subset";
import { decodeWhodrug } from "@/lib/dictionaries/whodrug-subset";
import {
  recordSignature,
  verifySigner,
  type SignatureRequest,
} from "@/services/signatures";

export const captureAeInput = z
  .object({
    participantId: z.string().uuid(),
    term: z.string().min(2),
    seriousness: z.enum(["ae", "sae"]),
    severity: z.enum(["mild", "moderate", "severe"]),
    onsetDate: z.coerce.date(),
    narrative: z.string().optional(),
    meddraCode: z.string().optional(),
    whodrugCode: z.string().optional(),
    causality: z.string().optional(),
  })
  // dictionary coding (D-024): supplied codes must exist in the bundled
  // demo subsets — free-text codes can no longer enter the record
  .superRefine((data, ctx) => {
    if (data.meddraCode && !decodeMeddra(data.meddraCode)) {
      ctx.addIssue({
        code: "custom",
        path: ["meddraCode"],
        message: `unknown MedDRA code '${data.meddraCode}' (demo subset)`,
      });
    }
    if (data.whodrugCode && !decodeWhodrug(data.whodrugCode)) {
      ctx.addIssue({
        code: "custom",
        path: ["whodrugCode"],
        message: `unknown WHODrug code '${data.whodrugCode}' (demo subset)`,
      });
    }
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

  // the clock runs from awareness (capture), not onset. Rule table comes
  // from the admin-configurable alert config (D-023) unless the caller
  // passes explicit rules (tests, backfills).
  const effectiveRules = rules ?? (await getAlertConfig(db)).deadlineRules;
  const deadlines = computeDeadlines(data.seriousness, capturedAt, effectiveRules);

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
  signature?: SignatureRequest,
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
  // e-signature (D-022): marking an AE as reported to the authority is a
  // record-freezing action — it requires a signature; other steps do not
  if (to === "reported") {
    await verifySigner(db, actor, signature);
  }

  return withAudit(db, actor, `ae.${rule.action}`, async (tx) => {
    const reportedAt = to === "reported" ? new Date() : null;
    const [updated] = await tx
      .update(adverseEvents)
      .set({
        status: to,
        ...(reportedAt ? { reportedAt } : {}),
      })
      .where(eq(adverseEvents.id, aeId))
      .returning();
    await tx.insert(aeActions).values({
      aeId,
      action: rule.action,
      actorId: actor.id,
      note: note ?? null,
    });
    let signatureInfo: Record<string, string> = {};
    if (to === "reported") {
      const sig = await recordSignature(tx, actor, {
        entityType: "adverse_event",
        entityId: aeId,
        action: "report",
        payload: {
          entityId: aeId,
          term: ae.term,
          seriousness: ae.seriousness,
          reportedAt,
        },
      });
      signatureInfo = { signatureId: sig.id, payloadHash: sig.payloadHash };
    }
    return {
      result: updated,
      entityType: "adverse_event",
      entityId: aeId,
      before: { status: ae.status },
      after: { status: to, ...signatureInfo },
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
