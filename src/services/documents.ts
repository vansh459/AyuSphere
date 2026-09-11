/** Document management — versioned uploads per trial (workflow.md §13). */
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { documents } from "@/db/schema";
import { withAudit, type Actor } from "@/lib/audit";
import { assertCan } from "@/lib/rbac";

export const uploadDocumentInput = z.object({
  trialId: z.string().uuid(),
  kind: z.enum([
    "protocol",
    "ethics_approval",
    "consent_form",
    "monitoring_report",
    "regulatory",
  ]),
  title: z.string().min(2),
  blobUrl: z.string().min(8),
});

export async function uploadDocument(
  db: Db,
  actor: Actor,
  input: z.infer<typeof uploadDocumentInput>,
) {
  assertCan(actor.role, "document.upload");
  const data = uploadDocumentInput.parse(input);

  // version history = one row per version of (trial, kind)
  const [latest] = await db
    .select({ version: documents.version })
    .from(documents)
    .where(
      and(eq(documents.trialId, data.trialId), eq(documents.kind, data.kind)),
    )
    .orderBy(desc(documents.version))
    .limit(1);
  const version = (latest?.version ?? 0) + 1;

  return withAudit(db, actor, "document.upload", async (tx) => {
    const [doc] = await tx
      .insert(documents)
      .values({ ...data, version, uploadedBy: actor.id })
      .returning();
    return {
      result: doc,
      entityType: "document",
      entityId: doc.id,
      after: { trialId: data.trialId, kind: data.kind, title: data.title, version },
    };
  });
}
