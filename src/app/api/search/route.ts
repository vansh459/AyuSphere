/** GET /api/search?q= — RBAC-shaped quick-jump results for the topbar. */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/db";
import { quickSearch } from "@/services/search";
import { appCache } from "@/lib/ttl-cache";

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
    // results are role-shaped (not user-specific) — 60s server TTL per
    // (role, q), plus a short private browser cache for repeated keystrokes
    const role = session.user.role;
    const results = await (appCache.getOrCompute(
      `search:${role}:${q.toLowerCase().trim()}`,
      60_000,
      () => quickSearch(getDb(), { role }, q),
    ) as ReturnType<typeof quickSearch>);
    return NextResponse.json(
      { results },
      { headers: { "cache-control": "private, max-age=30" } },
    );
  } catch {
    return NextResponse.json({ results: [] });
  }
}
