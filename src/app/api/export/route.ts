/**
 * GET /api/export?trialId=…&format=fhir|dm|ae|define — audited downloads
 * (workflow.md §13).
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getDb } from "@/db";
import { auditEvents, crfTemplates, trials } from "@/db/schema";
import { buildTrialBundle } from "@/services/export/fhir";
import { buildAdsl } from "@/services/export/adam";
import {
  buildAeDomain,
  buildDmDomain,
  defineXml,
} from "@/services/export/sdtm";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (!can(session.user.role, "export.run")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const url = new URL(req.url);
  const trialId = url.searchParams.get("trialId") ?? "";
  const format = url.searchParams.get("format") ?? "";
  if (!trialId || !["fhir", "dm", "ae", "adsl", "define"].includes(format)) {
    return NextResponse.json(
      { error: "trialId and format (fhir|dm|ae|adsl|define) required" },
      { status: 400 },
    );
  }

  const db = getDb();
  const [trial] = await db
    .select()
    .from(trials)
    .where(eq(trials.id, trialId))
    .limit(1);
  if (!trial) {
    return NextResponse.json({ error: "trial not found" }, { status: 404 });
  }

  let body: string;
  let contentType: string;
  let filename: string;
  if (format === "fhir") {
    body = JSON.stringify(await buildTrialBundle(db, trialId), null, 2);
    contentType = "application/fhir+json";
    filename = `${trial.protocolCode}-fhir-bundle.json`;
  } else if (format === "dm") {
    body = (await buildDmDomain(db, trialId)).csv;
    contentType = "text/csv";
    filename = `${trial.protocolCode}-sdtm-dm.csv`;
  } else if (format === "ae") {
    body = (await buildAeDomain(db, trialId)).csv;
    contentType = "text/csv";
    filename = `${trial.protocolCode}-sdtm-ae.csv`;
  } else if (format === "adsl") {
    body = (await buildAdsl(db, trialId)).csv;
    contentType = "text/csv";
    filename = `${trial.protocolCode}-adam-adsl.csv`;
  } else {
    // real variable-level metadata (T9.1): CRF templates feed the ItemDefs
    const templates = await db
      .select()
      .from(crfTemplates)
      .where(eq(crfTemplates.trialId, trialId));
    body = defineXml(trial, templates);
    contentType = "application/xml";
    filename = `${trial.protocolCode}-define.xml`;
  }

  // exports are audited: who exported what, when (workflow.md §13)
  await db.insert(auditEvents).values({
    actorId: session.user.id,
    actorRole: session.user.role,
    action: `export.${format}`,
    entityType: "trial",
    entityId: trialId,
    after: { filename },
  });

  return new NextResponse(body, {
    headers: {
      "content-type": contentType,
      "content-disposition": `attachment; filename="${filename}"`,
      // never cached (D-030): every download must write its audit row
      "cache-control": "private, no-store",
    },
  });
}
