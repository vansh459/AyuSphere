/**
 * e-CRF entry service — draft → submitted → approved, with versioned
 * corrections (workflow.md §7). Approved entries are immutable: a
 * correction creates a NEW linked version, never an in-place edit.
 */
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { crfEntries, crfTemplates, visits } from "@/db/schema";
import { withAudit, type Actor } from "@/lib/audit";
import { assertCan } from "@/lib/rbac";
import { parseTemplateFields, validateCrfData } from "@/lib/crf";

export class CrfError extends Error {
  readonly issues?: { field: string; message: string }[];
  constructor(message: string, issues?: { field: string; message: string }[]) {
    super(message);
    this.name = "CrfError";
    this.issues = issues;
  }
}

async function loadVisitTemplate(db: Db, visitId: string) {
  const [row] = await db
    .select({ visit: visits, template: crfTemplates })
    .from(visits)
    .innerJoin(crfTemplates, eq(visits.templateId, crfTemplates.id))
    .where(eq(visits.id, visitId))
    .limit(1);
  if (!row) throw new CrfError("visit or its CRF template not found");
  return { ...row, fields: parseTemplateFields(row.template.fields) };
}

export async function createDraftEntry(
  db: Db,
  actor: Actor,
  visitId: string,
  data: Record<string, unknown>,
) {
  assertCan(actor.role, "crf.enter");
  const { template, fields } = await loadVisitTemplate(db, visitId);
  const check = validateCrfData(fields, data, "draft");
  if (!check.ok) throw new CrfError("invalid CRF data", check.issues);

  return withAudit(db, actor, "crf.create", async (tx) => {
    const [entry] = await tx
      .insert(crfEntries)
      .values({
        visitId,
        templateId: template.id,
        data: check.data,
        status: "draft",
        source: "manual",
        enteredBy: actor.id,
      })
      .returning();
    return {
      result: entry,
      entityType: "crf_entry",
      entityId: entry.id,
      after: { status: "draft", visitId },
    };
  });
}

export async function submitEntry(db: Db, actor: Actor, entryId: string) {
  assertCan(actor.role, "crf.enter");
  const [entry] = await db
    .select()
    .from(crfEntries)
    .where(eq(crfEntries.id, entryId))
    .limit(1);
  if (!entry) throw new CrfError("entry not found");
  if (entry.status !== "draft") {
    throw new CrfError(`cannot submit an entry in status '${entry.status}'`);
  }
  const { fields } = await loadVisitTemplate(db, entry.visitId);
  const check = validateCrfData(fields, entry.data, "submit");
  if (!check.ok) {
    throw new CrfError("entry incomplete or invalid", check.issues);
  }

  return withAudit(db, actor, "crf.submit", async (tx) => {
    const [updated] = await tx
      .update(crfEntries)
      .set({ status: "submitted" })
      .where(eq(crfEntries.id, entryId))
      .returning();
    return {
      result: updated,
      entityType: "crf_entry",
      entityId: entryId,
      before: { status: "draft" },
      after: { status: "submitted" },
    };
  });
}

export async function approveEntry(db: Db, actor: Actor, entryId: string) {
  assertCan(actor.role, "crf.approve");
  const [entry] = await db
    .select()
    .from(crfEntries)
    .where(eq(crfEntries.id, entryId))
    .limit(1);
  if (!entry) throw new CrfError("entry not found");
  if (entry.status !== "submitted") {
    throw new CrfError(`cannot approve an entry in status '${entry.status}'`);
  }

  return withAudit(db, actor, "crf.approve", async (tx) => {
    const [updated] = await tx
      .update(crfEntries)
      .set({ status: "approved", approvedBy: actor.id, approvedAt: new Date() })
      .where(eq(crfEntries.id, entryId))
      .returning();
    return {
      result: updated,
      entityType: "crf_entry",
      entityId: entryId,
      before: { status: "submitted" },
      after: { status: "approved", approvedBy: actor.id },
    };
  });
}

/**
 * Corrections: approved entries are frozen. A correction inserts a new
 * approved version (version + 1) linked via supersedesId, and marks the old
 * row superseded — the full ALCOA+ chain stays walkable.
 */
export async function correctEntry(
  db: Db,
  actor: Actor,
  entryId: string,
  newData: Record<string, unknown>,
) {
  assertCan(actor.role, "crf.approve");
  const [entry] = await db
    .select()
    .from(crfEntries)
    .where(eq(crfEntries.id, entryId))
    .limit(1);
  if (!entry) throw new CrfError("entry not found");
  if (entry.status !== "approved") {
    throw new CrfError("only approved entries can be corrected");
  }
  const { fields } = await loadVisitTemplate(db, entry.visitId);
  const check = validateCrfData(fields, newData, "submit");
  if (!check.ok) throw new CrfError("invalid correction", check.issues);

  return withAudit(db, actor, "crf.correct", async (tx) => {
    await tx
      .update(crfEntries)
      .set({ status: "superseded" })
      .where(eq(crfEntries.id, entryId));
    const [next] = await tx
      .insert(crfEntries)
      .values({
        visitId: entry.visitId,
        templateId: entry.templateId,
        data: check.data,
        status: "approved",
        source: entry.source,
        version: entry.version + 1,
        supersedesId: entry.id,
        enteredBy: actor.id,
        approvedBy: actor.id,
        approvedAt: new Date(),
      })
      .returning();
    return {
      result: next,
      entityType: "crf_entry",
      entityId: next.id,
      before: { supersedes: entry.id, data: entry.data },
      after: { version: next.version, data: check.data },
    };
  });
}
