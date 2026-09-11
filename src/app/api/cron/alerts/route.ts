/**
 * GET /api/cron/alerts — the 10-minute sweep (architecture.md §8).
 * Vercel Cron calls this; CRON_SECRET (when set) restricts callers.
 */
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { sweepAlerts } from "@/services/alerts";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = req.headers.get("authorization");
    if (header !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  try {
    const result = await sweepAlerts(getDb());
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "sweep failed" },
      { status: 500 },
    );
  }
}
