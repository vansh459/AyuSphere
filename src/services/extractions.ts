/**
 * Doctor Note Intelligence pipeline (architecture.md §6, workflow.md §6).
 * image → quality gate → extraction → validation (incl. cross-document
 * consistency) → human review with confidence gating → approved CRF entry
 * with full provenance. NOTHING auto-commits.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import {
  crfEntries,
  crfTemplates,
  extractions,
  visits,
} from "@/db/schema";
import { withAudit, type Actor } from "@/lib/audit";
import { assertCan } from "@/lib/rbac";
import { parseTemplateFields, validateCrfData } from "@/lib/crf";
import {
  recordSignature,
  verifySigner,
  type SignatureRequest,
} from "@/services/signatures";
import {
  extractionOutputSchema,
  imageQualitySchema,
  type VisionClient,
} from "@/lib/ai/types";

/** below this quality score the doctor is asked to recapture */
export const QUALITY_THRESHOLD = 0.6;
/** below this per-field confidence the doctor MUST touch the field */
export const CONFIDENCE_THRESHOLD = 0.75;

export class ExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractionError";
  }
}

export type ValidationFlag = {
  field: string;
  kind: "range" | "contradiction" | "invalid";
  message: string;
};

async function loadVisitTemplate(db: Db, visitId: string) {
  const [row] = await db
    .select({ visit: visits, template: crfTemplates })
    .from(visits)
    .innerJoin(crfTemplates, eq(visits.templateId, crfTemplates.id))
    .where(eq(visits.id, visitId))
    .limit(1);
  if (!row) throw new ExtractionError("visit or its CRF template not found");
  return { ...row, fields: parseTemplateFields(row.template.fields) };
}

/** latest approved entry across this participant's earlier visits */
async function latestApprovedEntry(db: Db, participantId: string) {
  const rows = await db
    .select({ entry: crfEntries })
    .from(crfEntries)
    .innerJoin(visits, eq(crfEntries.visitId, visits.id))
    .where(
      and(
        eq(visits.participantId, participantId),
        eq(crfEntries.status, "approved"),
      ),
    )
    .orderBy(desc(crfEntries.createdAt))
    .limit(1);
  return rows[0]?.entry;
}

export async function startExtraction(
  db: Db,
  actor: Actor,
  input: { visitId: string; blobUrl: string },
  client: VisionClient,
) {
  assertCan(actor.role, "crf.enter");
  const { visit, fields } = await loadVisitTemplate(db, input.visitId);

  // step 2 — quality gate
  const rawQuality = await client.assessQuality(input.blobUrl);
  const quality = imageQualitySchema.safeParse(rawQuality);
  if (!quality.success) {
    throw new ExtractionError("quality assessment returned an invalid shape");
  }
  if (quality.data.score < QUALITY_THRESHOLD) {
    return withAudit(db, actor, "extraction.quality_fail", async (tx) => {
      const [row] = await tx
        .insert(extractions)
        .values({
          visitId: input.visitId,
          blobUrl: input.blobUrl,
          imageQuality: quality.data,
          status: "rejected",
          validationFlags: [
            {
              field: "(image)",
              kind: "invalid",
              message: `Image unreadable (${quality.data.issues.join(", ") || "low quality"}) — please recapture`,
            },
          ],
          modelId: client.modelId,
          promptVersion: client.promptVersion,
          createdBy: actor.id,
        })
        .returning();
      return {
        result: row,
        entityType: "extraction",
        entityId: row.id,
        after: { status: "rejected", reason: "image quality", score: quality.data.score },
      };
    });
  }

  // steps 3–5 — extract against the ACTIVE visit's template
  const rawOutput = await client.extract(input.blobUrl, fields);
  const parsed = extractionOutputSchema.safeParse(rawOutput);
  if (!parsed.success) {
    // invalid AI output is recorded and terminally rejected — never approvable
    return withAudit(db, actor, "extraction.invalid_output", async (tx) => {
      const [row] = await tx
        .insert(extractions)
        .values({
          visitId: input.visitId,
          blobUrl: input.blobUrl,
          imageQuality: quality.data,
          rawOutput: rawOutput ?? null,
          status: "rejected",
          validationFlags: [
            {
              field: "(model)",
              kind: "invalid",
              message: "Model output failed schema validation",
            },
          ],
          modelId: client.modelId,
          promptVersion: client.promptVersion,
          createdBy: actor.id,
        })
        .returning();
      return {
        result: row,
        entityType: "extraction",
        entityId: row.id,
        after: { status: "rejected", reason: "invalid model output" },
      };
    });
  }

  // step 6 — validation
  const flags: ValidationFlag[] = [];
  const draftData: Record<string, unknown> = {};
  for (const [name, f] of Object.entries(parsed.data.fields)) {
    if (!fields.some((t) => t.name === name)) continue; // protocol-aware: drop unknown fields
    draftData[name] = f.value;
  }
  const check = validateCrfData(fields, draftData, "draft");
  if (!check.ok) {
    for (const issue of check.issues) {
      flags.push({ field: issue.field, kind: "range", message: issue.message });
      delete draftData[issue.field]; // invalid values stay visible in rawOutput but never in the draft
    }
  }

  // cross-document consistency (workflow.md §6 step 4)
  const previous = await latestApprovedEntry(db, visit.participantId);
  if (previous) {
    const prevData = previous.data as Record<string, unknown>;
    for (const f of fields) {
      if (f.type !== "number") continue;
      const nowV = draftData[f.name];
      const prevV = prevData[f.name];
      if (typeof nowV === "number" && typeof prevV === "number" && prevV !== 0) {
        const change = Math.abs(nowV - prevV) / Math.abs(prevV);
        if (change >= 0.5) {
          flags.push({
            field: f.name,
            kind: "contradiction",
            message: `${f.label} (${nowV}${f.unit ?? ""}) differs sharply from the last approved record (${prevV}${f.unit ?? ""}) — verify against the note`,
          });
        }
      }
    }
  }

  return withAudit(db, actor, "extraction.create", async (tx) => {
    const [row] = await tx
      .insert(extractions)
      .values({
        visitId: input.visitId,
        blobUrl: input.blobUrl,
        imageQuality: quality.data,
        rawOutput: parsed.data,
        mappedFields: parsed.data.fields,
        validationFlags: flags,
        status: "review",
        modelId: client.modelId,
        promptVersion: client.promptVersion,
        createdBy: actor.id,
      })
      .returning();
    return {
      result: row,
      entityType: "extraction",
      entityId: row.id,
      after: {
        status: "review",
        fieldCount: Object.keys(parsed.data.fields).length,
        flagCount: flags.length,
      },
    };
  });
}

/** fields the doctor is REQUIRED to touch before approval */
export function requiredTouches(extraction: {
  mappedFields: unknown;
  validationFlags: unknown;
}): string[] {
  const mapped = extractionOutputSchema.shape.fields.parse(
    extraction.mappedFields ?? {},
  );
  const flags = (extraction.validationFlags ?? []) as ValidationFlag[];
  const set = new Set<string>();
  for (const [name, f] of Object.entries(mapped)) {
    if (f.confidence < CONFIDENCE_THRESHOLD) set.add(name);
  }
  for (const flag of flags) {
    if (flag.field !== "(image)" && flag.field !== "(model)") set.add(flag.field);
  }
  return [...set];
}

export async function approveExtraction(
  db: Db,
  actor: Actor,
  input: {
    extractionId: string;
    finalData: Record<string, unknown>;
    touchedFields: string[];
    signature: SignatureRequest;
  },
) {
  assertCan(actor.role, "crf.approve");
  const [extraction] = await db
    .select()
    .from(extractions)
    .where(eq(extractions.id, input.extractionId))
    .limit(1);
  if (!extraction) throw new ExtractionError("extraction not found");
  if (extraction.status !== "review") {
    throw new ExtractionError(
      `extraction is '${extraction.status}' — only 'review' can be approved`,
    );
  }

  // confidence + flag gating: every required field must have been touched
  const required = requiredTouches(extraction);
  const untouched = required.filter((f) => !input.touchedFields.includes(f));
  if (untouched.length > 0) {
    throw new ExtractionError(
      `low-confidence or flagged fields must be confirmed first: ${untouched.join(", ")}`,
    );
  }

  const { template, fields } = await loadVisitTemplate(db, extraction.visitId);
  const check = validateCrfData(fields, input.finalData, "submit");
  if (!check.ok) {
    throw new ExtractionError(
      `final data invalid: ${check.issues.map((i) => `${i.field}: ${i.message}`).join("; ")}`,
    );
  }
  // e-signature (D-022): re-auth BEFORE the transaction — nothing commits
  // on a refused signature
  await verifySigner(db, actor, input.signature);

  return withAudit(db, actor, "extraction.approve", async (tx) => {
    const [entry] = await tx
      .insert(crfEntries)
      .values({
        visitId: extraction.visitId,
        templateId: template.id,
        data: check.data,
        status: "approved",
        source: "extraction",
        extractionId: extraction.id,
        enteredBy: extraction.createdBy,
        approvedBy: actor.id,
        approvedAt: new Date(),
      })
      .returning();
    await tx
      .update(extractions)
      .set({ status: "approved", reviewedBy: actor.id, reviewedAt: new Date() })
      .where(eq(extractions.id, extraction.id));
    const sig = await recordSignature(tx, actor, {
      entityType: "crf_entry",
      entityId: entry.id,
      action: "approve",
      payload: {
        entityId: entry.id,
        data: check.data,
        extractionId: extraction.id,
      },
    });
    return {
      result: { entry, extractionId: extraction.id },
      entityType: "crf_entry",
      entityId: entry.id,
      after: {
        source: "extraction",
        extractionId: extraction.id,
        modelId: extraction.modelId,
        promptVersion: extraction.promptVersion,
        signatureId: sig.id,
        payloadHash: sig.payloadHash,
      },
    };
  });
}

export async function rejectExtraction(
  db: Db,
  actor: Actor,
  extractionId: string,
  reason: string,
) {
  assertCan(actor.role, "crf.approve");
  const [extraction] = await db
    .select()
    .from(extractions)
    .where(
      and(
        eq(extractions.id, extractionId),
        inArray(extractions.status, ["review", "pending"]),
      ),
    )
    .limit(1);
  if (!extraction) throw new ExtractionError("no reviewable extraction found");
  return withAudit(db, actor, "extraction.reject", async (tx) => {
    const [row] = await tx
      .update(extractions)
      .set({ status: "rejected", reviewedBy: actor.id, reviewedAt: new Date() })
      .where(eq(extractions.id, extractionId))
      .returning();
    return {
      result: row,
      entityType: "extraction",
      entityId: extractionId,
      before: { status: extraction.status },
      after: { status: "rejected", reason },
    };
  });
}
