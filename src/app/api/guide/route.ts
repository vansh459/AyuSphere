/**
 * POST /api/guide — Sphera, the role-aware floating guide.
 * The role and name come from the SESSION, never the client body, and only
 * that role's knowledge slice is injected — the guide cannot describe
 * another role's screens. Streams plain-text chunks.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getDb } from "@/db";
import { getGuideConfig } from "@/services/settings";
import {
  GREETING_REQUEST,
  buildGuideSystemPrompt,
  trimHistory,
} from "@/lib/guide/prompt";
import { streamGroqChat, type GroqMessage } from "@/lib/guide/groq";

export const runtime = "nodejs";
export const maxDuration = 30;

const bodySchema = z.object({
  message: z.string().max(500).optional(),
  greet: z.boolean().optional(),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(4000),
      }),
    )
    .max(24)
    .default([]),
});

const NO_GUIDE_MESSAGE =
  "Sphera isn't configured yet — an Administrator can add a Groq API key under Settings → Guide Assistant.";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (!can(session.user.role, "dashboard.view")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { greet, history } = parsed.data;
  const message = greet
    ? GREETING_REQUEST
    : parsed.data.message?.trim();
  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  const cfg = await getGuideConfig(getDb());
  if (!cfg) {
    return NextResponse.json({ error: NO_GUIDE_MESSAGE }, { status: 501 });
  }

  const messages: GroqMessage[] = [
    {
      role: "system",
      content: buildGuideSystemPrompt({
        role: session.user.role,
        userName: session.user.name ?? "there",
      }),
    },
    ...trimHistory(history),
    { role: "user", content: message },
  ];

  try {
    const stream = await streamGroqChat({
      apiKey: cfg.apiKey,
      model: cfg.model,
      messages,
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "guide request failed" },
      { status: 422 },
    );
  }
}
