/**
 * GET /api/fhir/ResearchStudy/[id] (T9.3, D-026) — single-resource FHIR R4
 * read endpoint. Authenticated, RBAC-gated, audited (see Bundle route).
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getDb } from "@/db";
import { auditEvents, trials } from "@/db/schema";
import { toResearchStudy } from "@/services/export/fhir";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const role = session.user.role;
  if (!can(role, "export.run") && !can(role, "audit.view")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await ctx.params;

  const db = getDb();
  const [trial] = await db
    .select()
    .from(trials)
    .where(eq(trials.id, id))
    .limit(1);
  if (!trial) {
    return NextResponse.json({ error: "trial not found" }, { status: 404 });
  }

  await db.insert(auditEvents).values({
    actorId: session.user.id,
    actorRole: role,
    action: "fhir.read",
    entityType: "trial",
    entityId: id,
    after: { resource: "ResearchStudy" },
  });

  return NextResponse.json(toResearchStudy(trial), {
    headers: { "content-type": "application/fhir+json" },
  });
}
