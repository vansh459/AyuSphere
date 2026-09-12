/**
 * NPvCC spontaneous ADR intake (T8.3, D-025) — suspected adverse-drug-
 * reaction reports for ASU&H drugs arriving OUTSIDE trials (AIIA hosts the
 * National Pharmacovigilance Coordination Centre). PV receives, assesses,
 * and forwards; every step is audited. Reports feed the safety-signal view
 * as their own "spontaneous" series.
 */
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { suspectedAdrs } from "@/db/schema";
import { withAudit, type Actor } from "@/lib/audit";
import { assertCan } from "@/lib/rbac";
import { decodeMeddra } from "@/lib/dictionaries/meddra-subset";
import { decodeWhodrug } from "@/lib/dictionaries/whodrug-subset";

export class AdrError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdrError";
  }
}

export const captureAdrInput = z
  .object({
    source: z.enum(["hospital", "community", "literature"]),
    term: z.string().min(2),
    meddraCode: z.string().optional(),
    suspectedDrug: z.string().min(2),
    whodrugCode: z.string().optional(),
    eventDate: z.coerce.date(),
    seriousness: z.enum(["ae", "sae"]),
    outcome: z.string().optional(),
    narrative: z.string().optional(),
    /** role word only ("physician", "consumer") — never an identity */
    reporterRole: z.string().max(60).optional(),
  })
  // same coding rule as trial AEs (D-024): codes must exist in the subsets
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

export type CaptureAdrInput = z.infer<typeof captureAdrInput>;

export async function captureSuspectedAdr(
  db: Db,
  actor: Actor,
  input: CaptureAdrInput,
) {
  assertCan(actor.role, "ae.review");
  const data = captureAdrInput.parse(input);
  return withAudit(db, actor, "adr.receive", async (tx) => {
    const [adr] = await tx
      .insert(suspectedAdrs)
      .values({ ...data, createdBy: actor.id })
      .returning();
    return {
      result: adr,
      entityType: "suspected_adr",
      entityId: adr.id,
      after: {
        source: adr.source,
        term: adr.term,
        seriousness: adr.seriousness,
        suspectedDrug: adr.suspectedDrug,
      },
    };
  });
}

const WALK: Record<string, { from: string[]; action: string }> = {
  assessed: { from: ["received"], action: "assess" },
  forwarded: { from: ["assessed"], action: "forward" },
};

export async function advanceAdrStatus(
  db: Db,
  actor: Actor,
  adrId: string,
  to: "assessed" | "forwarded",
  note?: string,
) {
  assertCan(actor.role, "ae.review");
  const [adr] = await db
    .select()
    .from(suspectedAdrs)
    .where(eq(suspectedAdrs.id, adrId))
    .limit(1);
  if (!adr) throw new AdrError("suspected ADR not found");
  const rule = WALK[to];
  if (!rule.from.includes(adr.status)) {
    throw new AdrError(`cannot move ADR from '${adr.status}' to '${to}'`);
  }

  return withAudit(db, actor, `adr.${rule.action}`, async (tx) => {
    const [updated] = await tx
      .update(suspectedAdrs)
      .set({
        status: to,
        ...(note ? { assessmentNote: note } : {}),
      })
      .where(eq(suspectedAdrs.id, adrId))
      .returning();
    return {
      result: updated,
      entityType: "suspected_adr",
      entityId: adrId,
      before: { status: adr.status },
      after: { status: to, ...(note ? { note } : {}) },
    };
  });
}

export async function listSuspectedAdrs(db: Db, limit = 50) {
  return db
    .select()
    .from(suspectedAdrs)
    .orderBy(desc(suspectedAdrs.createdAt))
    .limit(limit);
}
