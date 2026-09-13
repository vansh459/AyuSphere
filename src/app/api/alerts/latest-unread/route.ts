import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getDb } from "@/db";
import { alerts } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (!can(session.user.role, "alert.acknowledge")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const db = getDb();
    const [latest] = await db
      .select({
        id: alerts.id,
        ruleKey: alerts.ruleKey,
        entityRef: alerts.entityRef,
        severity: alerts.severity,
        message: alerts.message,
        createdAt: alerts.createdAt,
      })
      .from(alerts)
      .where(
        and(
          eq(alerts.status, "open"),
          inArray(alerts.severity, ["danger", "warning"]),
        ),
      )
      .orderBy(desc(alerts.createdAt))
      .limit(1);

    return NextResponse.json(
      { alert: latest ?? null },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        },
      },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to fetch latest alert" },
      { status: 500 },
    );
  }
}
