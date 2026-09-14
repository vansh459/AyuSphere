/**
 * GET /api/fhir/Bundle/[trialId] (T9.3, D-026) — live FHIR R4 read endpoint:
 * the same bundle the export download builds, served as application/fhir+json
 * for EDC/HIS/ABDM-building-block consumers. Authenticated, RBAC-gated
 * (export.run, or read-only audit.view for the regulator), audited.
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getDb } from "@/db";
import { auditEvents } from "@/db/schema";
import { buildTrialBundle } from "@/services/export/fhir";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ trialId: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const role = session.user.role;
  if (!can(role, "export.run") && !can(role, "audit.view")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { trialId } = await ctx.params;

  const db = getDb();
  let bundle;
  try {
    bundle = await buildTrialBundle(db, trialId);
  } catch {
    return NextResponse.json({ error: "trial not found" }, { status: 404 });
  }

  await db.insert(auditEvents).values({
    actorId: session.user.id,
    actorRole: role,
    action: "fhir.read",
    entityType: "trial",
    entityId: trialId,
    after: { resource: "Bundle" },
  });

  return NextResponse.json(bundle, {
    headers: {
      "content-type": "application/fhir+json",
      // never cached (D-030): every FHIR read must write its audit row
      "cache-control": "private, no-store",
    },
  });
}
