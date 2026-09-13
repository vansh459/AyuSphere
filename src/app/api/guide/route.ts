/**
 * /api/guide — Sphera, the role-aware floating guide (LangGraph + ChatGroq,
 * D-029). The role and name come from the SESSION, never the client body,
 * and only that role's knowledge slice is injected. Memory is server-side:
 * per-user threads persisted in guide_messages — POST streams a turn,
 * GET returns the thread history for rehydration.
 *
 * The Admin-stored key (Settings → Guide Assistant) powers the guide for
 * EVERY role — the route itself only requires dashboard.view.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getDb } from "@/db";
import { getGuideConfig, type GuideConfig } from "@/services/settings";
import { createGuideModel } from "@/lib/guide/model";
import { getThreadHistory, runGuideTurn } from "@/services/guide-chat";

export const runtime = "nodejs";
export const maxDuration = 60;

const THREAD_ID = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9-]+$/, "invalid thread id");

const bodySchema = z.object({
  message: z.string().max(500).optional(),
  greet: z.boolean().optional(),
  threadId: THREAD_ID.default("default"),
});

const NO_GUIDE_MESSAGE =
  "Sphera isn't configured yet — an Administrator can add a Groq API key under Settings → Guide Assistant.";

/**
 * Config lookup that can never eat the whole function budget: the DB read
 * (Settings row saved by the Admin — the primary source) is capped at 3s;
 * on a hang we fall back to env-only rather than riding into a platform 504.
 */
async function resolveGuideConfig(): Promise<GuideConfig | null> {
  const envOnly = (): GuideConfig | null => {
    const key = process.env.GROQ_API_KEY ?? process.env.GROQ_API;
    return key
      ? { model: process.env.GROQ_MODEL ?? "openai/gpt-oss-20b", apiKey: key }
      : null;
  };
  try {
    return await Promise.race([
      getGuideConfig(getDb()),
      new Promise<GuideConfig | null>((resolve) =>
        setTimeout(() => resolve(envOnly()), 3_000),
      ),
    ]);
  } catch {
    return envOnly();
  }
}

async function requireGuideSession() {
  const session = await auth();
  if (!session?.user) {
    return { error: NextResponse.json({ error: "unauthenticated" }, { status: 401 }) };
  }
  if (!can(session.user.role, "dashboard.view")) {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { user: session.user };
}

/** thread history for widget rehydration — memory visible across sessions */
export async function GET(req: Request) {
  const gate = await requireGuideSession();
  if ("error" in gate) return gate.error;

  const raw = new URL(req.url).searchParams.get("threadId") ?? "default";
  const threadId = THREAD_ID.safeParse(raw);
  if (!threadId.success) {
    return NextResponse.json({ error: "invalid thread id" }, { status: 400 });
  }
  try {
    const turns = await getThreadHistory(getDb(), gate.user.id, threadId.data);
    return NextResponse.json({
      turns: turns.map((t) => ({ role: t.role, content: t.content })),
    });
  } catch {
    // no DB (or a hiccup) must not break the widget — it just starts fresh
    return NextResponse.json({ turns: [] });
  }
}

export async function POST(req: Request) {
  const gate = await requireGuideSession();
  if ("error" in gate) return gate.error;

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { greet, threadId } = parsed.data;
  const message = parsed.data.message?.trim();
  if (!greet && !message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  const cfg = await resolveGuideConfig();
  if (!cfg) {
    return NextResponse.json({ error: NO_GUIDE_MESSAGE }, { status: 501 });
  }

  try {
    const { stream } = await runGuideTurn(getDb(), {
      userId: gate.user.id,
      role: gate.user.role,
      userName: gate.user.name ?? "there",
      threadId,
      message,
      greet,
      model: createGuideModel(cfg),
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
