/**
 * Internal messaging API.
 * GET  /api/messages?with=<userId> — the thread with that user (marks their
 *      incoming messages as read) + refreshed contact list.
 * GET  /api/messages                — contact list only.
 * POST /api/messages (multipart)    — recipientId, body, optional file ≤2MB.
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getDb } from "@/db";
import { contacts, conversation, sendMessage } from "@/services/messages";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (!can(session.user.role, "chat.use")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const actor = { id: session.user.id, role: session.user.role };
  const db = getDb();
  const withUserId = new URL(req.url).searchParams.get("with");
  try {
    if (withUserId) {
      // reading the thread marks its incoming messages as read
      const thread = await conversation(db, actor, withUserId);
      const list = await contacts(db, actor);
      return NextResponse.json({ messages: thread, contacts: list });
    }
    return NextResponse.json({ contacts: await contacts(db, actor) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to load messages" },
      { status: 422 },
    );
  }
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (!can(session.user.role, "chat.use")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const actor = { id: session.user.id, role: session.user.role };

  const form = await req.formData();
  const recipientId = String(form.get("recipientId") ?? "");
  const body = String(form.get("body") ?? "");
  const file = form.get("file");

  if (!recipientId) {
    return NextResponse.json({ error: "recipientId is required" }, { status: 400 });
  }
  if (file !== null && !(file instanceof File)) {
    return NextResponse.json({ error: "invalid attachment" }, { status: 400 });
  }
  if (file && file.size > MAX_ATTACHMENT_BYTES) {
    return NextResponse.json(
      { error: "attachment too large (max 2MB)" },
      { status: 413 },
    );
  }

  // attachment storage: Vercel Blob when configured; data-URL fallback keeps
  // local dev working (same pattern as /api/ai/extract)
  let attachment: { url: string; name: string; type: string } | undefined;
  if (file && file.size > 0) {
    const type = file.type || "application/octet-stream";
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      const { put } = await import("@vercel/blob");
      const stored = await put(
        `messages/${crypto.randomUUID()}-${file.name}`,
        file,
        { access: "public" },
      );
      attachment = { url: stored.url, name: file.name, type };
    } else {
      const buf = Buffer.from(await file.arrayBuffer());
      attachment = {
        url: `data:${type};base64,${buf.toString("base64")}`,
        name: file.name,
        type,
      };
    }
  }

  try {
    const message = await sendMessage(getDb(), actor, {
      recipientId,
      body,
      attachment,
    });
    return NextResponse.json({ message });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "send failed" },
      { status: 422 },
    );
  }
}
