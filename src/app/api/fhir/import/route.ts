/**
 * POST /api/fhir/import (T9.3, D-026) — EDC/HIS interoperability stub:
 * accepts an HL7 FHIR R4 Bundle of Observations and creates a DRAFT CRF
 * entry on the subject's visit (optional ?visitId= targets a specific one).
 * Drafts flow through the normal validate → submit → approve (+ e-sign)
 * path — imported data never auto-commits.
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getDb } from "@/db";
import { CrfError } from "@/services/crf";
import {
  FhirImportError,
  importObservationBundle,
} from "@/services/fhir-import";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (!can(session.user.role, "crf.enter")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }
  const visitId =
    new URL(req.url).searchParams.get("visitId") ?? undefined;

  try {
    const result = await importObservationBundle(
      getDb(),
      { id: session.user.id, role: session.user.role },
      body,
      visitId,
    );
    return NextResponse.json(
      {
        ...result,
        status: "draft",
        note: "Draft CRF entry created — requires submit and signed approval before it becomes a record.",
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof FhirImportError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof CrfError) {
      return NextResponse.json(
        { error: err.message, issues: err.issues ?? [] },
        { status: 422 },
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "import failed" },
      { status: 500 },
    );
  }
}
