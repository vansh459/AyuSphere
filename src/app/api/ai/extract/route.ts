/**
 * POST /api/ai/extract — Doctor Note step 1–6 (workflow.md §6).
 * multipart form: visitId + image. Returns the extraction row (status
 * "review" with confidence-mapped fields, or "rejected" with the reason).
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getDb } from "@/db";
import { createClaudeVisionClient } from "@/lib/ai/claude";
import { startExtraction } from "@/services/extractions";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (!can(session.user.role, "crf.enter")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY not configured" },
      { status: 501 },
    );
  }

  const form = await req.formData();
  const visitId = String(form.get("visitId") ?? "");
  const image = form.get("image");
  if (!visitId || !(image instanceof File)) {
    return NextResponse.json(
      { error: "visitId and image are required" },
      { status: 400 },
    );
  }
  if (image.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "image too large" }, { status: 413 });
  }

  // Vercel Blob when configured; data-URL fallback keeps local dev working
  let blobUrl: string;
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put } = await import("@vercel/blob");
    const stored = await put(`doctor-notes/${crypto.randomUUID()}-${image.name}`, image, {
      access: "public",
    });
    blobUrl = stored.url;
  } else {
    const buf = Buffer.from(await image.arrayBuffer());
    blobUrl = `data:${image.type || "image/jpeg"};base64,${buf.toString("base64")}`;
  }

  try {
    const extraction = await startExtraction(
      getDb(),
      { id: session.user.id, role: session.user.role },
      { visitId, blobUrl },
      createClaudeVisionClient(),
    );
    return NextResponse.json({ extraction });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "extraction failed" },
      { status: 422 },
    );
  }
}
