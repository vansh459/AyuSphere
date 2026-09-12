/**
 * FHIR EDC/HIS import stub (T9.3, D-026) — accepts an HL7 FHIR R4 Bundle of
 * Observation resources (as an EDC or hospital system would POST it) and
 * lands it as a DRAFT CRF entry on the subject's visit, mapped through the
 * visit's own template. Nothing auto-commits: the draft flows through the
 * normal validate → submit → approve (+ e-signature, D-022) path, so
 * imported data can never bypass validation or human oversight.
 */
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { auditEvents, participants, visits } from "@/db/schema";
import type { Actor } from "@/lib/audit";
import { assertCan } from "@/lib/rbac";
import { parseTemplateFields } from "@/lib/crf";
import { crfTemplates } from "@/db/schema";
import { createDraftEntry } from "@/services/crf";

export class FhirImportError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "FhirImportError";
    this.status = status;
  }
}

const observationSchema = z.object({
  resourceType: z.literal("Observation"),
  subject: z.object({
    identifier: z.object({ value: z.string().min(1) }),
  }),
  code: z.object({
    coding: z.array(z.object({ code: z.string() })).optional(),
    text: z.string().optional(),
  }),
  valueQuantity: z
    .object({ value: z.number(), unit: z.string().optional() })
    .optional(),
  valueString: z.string().optional(),
});

export const fhirBundleSchema = z.object({
  resourceType: z.literal("Bundle"),
  type: z.string().optional(),
  entry: z
    .array(z.object({ resource: observationSchema }))
    .min(1, "bundle carries no Observation entries"),
});

export type FhirBundle = z.infer<typeof fhirBundleSchema>;

export type ImportResult = {
  entryId: string;
  visitId: string;
  subjectCode: string;
  /** field name → imported value */
  mapped: Record<string, unknown>;
  /** observation codes that matched no template field (reported, never stored) */
  ignored: string[];
};

/**
 * Maps each Observation onto the visit's CRF template: coding[].code matches
 * a field's cdashVar, code.text matches a field name/label. Unmatched
 * observations are reported back, never stored (protocol-aware, like the
 * Doctor Note pipeline).
 */
export async function importObservationBundle(
  db: Db,
  actor: Actor,
  rawBundle: unknown,
  explicitVisitId?: string,
): Promise<ImportResult> {
  assertCan(actor.role, "crf.enter");
  const parsed = fhirBundleSchema.safeParse(rawBundle);
  if (!parsed.success) {
    throw new FhirImportError(
      `invalid FHIR bundle: ${parsed.error.issues[0]?.message ?? "shape mismatch"}`,
    );
  }
  const observations = parsed.data.entry.map((e) => e.resource);

  const subjectCodes = new Set(
    observations.map((o) => o.subject.identifier.value),
  );
  if (subjectCodes.size !== 1) {
    throw new FhirImportError(
      "all Observations in one import must reference the same subject",
    );
  }
  const subjectCode = [...subjectCodes][0];

  const [participant] = await db
    .select()
    .from(participants)
    .where(eq(participants.subjectCode, subjectCode))
    .limit(1);
  if (!participant) {
    throw new FhirImportError(`unknown subject '${subjectCode}'`, 404);
  }

  // resolve the target visit: explicit id (must belong to the subject and
  // carry a template) or the subject's earliest open templated visit
  let visit;
  if (explicitVisitId) {
    [visit] = await db
      .select()
      .from(visits)
      .where(
        and(
          eq(visits.id, explicitVisitId),
          eq(visits.participantId, participant.id),
        ),
      )
      .limit(1);
    if (!visit) {
      throw new FhirImportError("visit not found for this subject", 404);
    }
  } else {
    [visit] = await db
      .select()
      .from(visits)
      .where(
        and(
          eq(visits.participantId, participant.id),
          inArray(visits.status, ["due", "overdue", "upcoming"]),
        ),
      )
      .orderBy(visits.scheduledDate)
      .limit(1);
    if (!visit) {
      throw new FhirImportError(
        `subject '${subjectCode}' has no open visit to import into`,
        409,
      );
    }
  }
  if (!visit.templateId) {
    throw new FhirImportError("target visit has no CRF template", 409);
  }

  const [template] = await db
    .select()
    .from(crfTemplates)
    .where(eq(crfTemplates.id, visit.templateId))
    .limit(1);
  const fields = parseTemplateFields(template.fields);

  const data: Record<string, unknown> = {};
  const ignored: string[] = [];
  for (const obs of observations) {
    const codingCode = obs.code.coding?.[0]?.code;
    const codeText = obs.code.text;
    const field =
      fields.find((f) => codingCode && f.cdashVar === codingCode) ??
      fields.find(
        (f) =>
          codeText &&
          (f.name.toLowerCase() === codeText.toLowerCase() ||
            f.label.toLowerCase() === codeText.toLowerCase()),
      );
    const value = obs.valueQuantity?.value ?? obs.valueString;
    if (!field || value === undefined) {
      ignored.push(codingCode ?? codeText ?? "(uncoded observation)");
      continue;
    }
    data[field.name] = value;
  }
  if (Object.keys(data).length === 0) {
    throw new FhirImportError(
      "no Observation matched the visit's CRF template — nothing to import",
      422,
    );
  }

  // DRAFT only — same validation as manual entry; approval later requires
  // submit + PI e-signature, exactly like every other CRF entry
  const entry = await createDraftEntry(db, actor, visit.id, data);

  // interop marker beside the crf.create row (audited-reads precedent:
  // the export route)
  await db.insert(auditEvents).values({
    actorId: actor.id,
    actorRole: actor.role,
    action: "fhir.import",
    entityType: "crf_entry",
    entityId: entry.id,
    after: {
      subjectCode,
      visitId: visit.id,
      mappedFields: Object.keys(data),
      ignored,
    },
  });

  return {
    entryId: entry.id,
    visitId: visit.id,
    subjectCode,
    mapped: data,
    ignored,
  };
}
