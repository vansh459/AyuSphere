/**
 * POST /api/ai/extract — Doctor Note step 1–6 (workflow.md §6).
 * multipart form: visitId + image. Returns the extraction row (status
 * "review" with confidence-mapped fields, or "rejected" with the reason).
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getDb } from "@/db";
import {
  NO_AI_MESSAGE,
  createVisionClientFor,
  getAiConfig,
} from "@/lib/ai/provider";
import { startExtraction } from "@/services/extractions";

export const runtime = "nodejs";
export const maxDuration = 60;

// Vercel rejects request bodies over 4.5MB before the function runs, so a
// higher cap here would be a false promise; the client downscales photos
// to ~3MB (src/lib/image.ts) before uploading.
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (!can(session.user.role, "crf.enter")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const db = getDb();
  const cfg = await getAiConfig(db);
  if (!cfg) {
    return NextResponse.json({ error: NO_AI_MESSAGE }, { status: 501 });
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
    return NextResponse.json(
      { error: "image too large (max 4MB) — please retake at a lower resolution" },
      { status: 413 },
    );
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
      db,
      { id: session.user.id, role: session.user.role },
      { visitId, blobUrl },
      createVisionClientFor(cfg),
    );
    return NextResponse.json({ extraction });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "extraction failed" },
      { status: 422 },
    );
  }
}
