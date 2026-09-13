/**
 * GET /api/badges — live sidebar/topbar badge counts. The (app) layout only
 * renders on hard loads, so client code (Sidebar, topbar bell) refreshes
 * counts through this endpoint — instantly after reading a thread, and on a
 * slow poll otherwise.
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/db";
import { badgeCounts } from "@/services/badges";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  try {
    const badges = await badgeCounts(getDb(), {
      id: session.user.id,
      role: session.user.role,
    });
    return NextResponse.json(
      { badges },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "failed to load badges" }, { status: 500 });
  }
}
