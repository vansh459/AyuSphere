/** POST /api/ai/approve — Doctor Note steps 7–8: human approval. */
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getDb } from "@/db";
import {
  approveExtraction,
  rejectExtraction,
} from "@/services/extractions";

const bodySchema = z.union([
  z.object({
    action: z.literal("approve"),
    extractionId: z.string().uuid(),
    finalData: z.record(z.string(), z.unknown()),
    touchedFields: z.array(z.string()),
    // e-signature (D-022): approval is signed with the reviewer's password
    password: z.string().min(1),
  }),
  z.object({
    action: z.literal("reject"),
    extractionId: z.string().uuid(),
    reason: z.string().min(1),
  }),
]);

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (!can(session.user.role, "crf.approve")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const actor = { id: session.user.id, role: session.user.role };
  try {
    if (parsed.data.action === "approve") {
      const result = await approveExtraction(getDb(), actor, {
        extractionId: parsed.data.extractionId,
        finalData: parsed.data.finalData,
        touchedFields: parsed.data.touchedFields,
        signature: { password: parsed.data.password },
      });
      return NextResponse.json(result);
    }
    const rejected = await rejectExtraction(
      getDb(),
      actor,
      parsed.data.extractionId,
      parsed.data.reason,
    );
    return NextResponse.json({ extraction: rejected });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed" },
      { status: 422 },
    );
  }
}
