/** GET /api/search?q= — RBAC-shaped quick-jump results for the topbar. */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/db";
import { quickSearch } from "@/services/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const q = new URL(req.url).searchParams.get("q") ?? "";
  if (q.length > 80) {
    return NextResponse.json({ results: [] });
  }
  try {
    const results = await quickSearch(getDb(), { role: session.user.role }, q);
    return NextResponse.json(
      { results },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ results: [] });
  }
}
