/** POST /api/ai/copilot — grounded Q&A (workflow.md §11), query audited. */
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getDb } from "@/db";
import { auditEvents } from "@/db/schema";
import { answerQuestion } from "@/services/copilot";
import { createClaudeTextClient } from "@/lib/ai/claude-text";

const bodySchema = z.object({ question: z.string().min(3).max(500) });

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (!can(session.user.role, "copilot.use")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY not configured" },
      { status: 501 },
    );
  }
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid question" }, { status: 400 });
  }

  const db = getDb();
  try {
    const result = await answerQuestion(
      db,
      { id: session.user.id, role: session.user.role },
      parsed.data.question,
      createClaudeTextClient(),
    );
    // every Copilot exchange is logged (architecture.md §9)
    await db.insert(auditEvents).values({
      actorId: session.user.id,
      actorRole: session.user.role,
      action: "copilot.query",
      entityType: "copilot",
      entityId: "copilot",
      after: {
        question: parsed.data.question,
        grounded: result.grounded,
        citationCount: result.citations.length,
      },
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "copilot failed" },
      { status: 422 },
    );
  }
}
