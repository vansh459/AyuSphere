/** Visit status sweep + completion (workflow.md §5). */
import { eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { visits } from "@/db/schema";
import { SYSTEM_ACTOR, withAudit, type Actor } from "@/lib/audit";
import { assertCan } from "@/lib/rbac";
import { deriveVisitStatus, type VisitStatus } from "@/lib/rules/visits";

/**
 * Applies time-based status transitions (upcoming→due→overdue→missed).
 * Runs on the cron sweep and before dashboard reads. `missed` transitions
 * are audited as system actions (workflow.md §5).
 */
export async function refreshVisitStatuses(db: Db, now = new Date()) {
  const open = await db
    .select()
    .from(visits)
    .where(inArray(visits.status, ["upcoming", "due", "overdue"]));

  let changed = 0;
  for (const v of open) {
    const next = deriveVisitStatus(
      {
        status: v.status as VisitStatus,
        windowStart: v.windowStart,
        windowEnd: v.windowEnd,
      },
      now,
    );
    if (next === v.status) continue;
    changed += 1;
    if (next === "missed") {
      await withAudit(db, SYSTEM_ACTOR, "visit.missed", async (tx) => {
        await tx
          .update(visits)
          .set({ status: "missed" })
          .where(eq(visits.id, v.id));
        return {
          result: undefined,
          entityType: "visit",
          entityId: v.id,
          before: { status: v.status },
          after: { status: "missed" },
        };
      });
    } else {
      await db
        .update(visits)
        .set({ status: next })
        .where(eq(visits.id, v.id));
    }
  }
  return { scanned: open.length, changed };
}

export async function completeVisit(db: Db, actor: Actor, visitId: string) {
  assertCan(actor.role, "crf.enter");
  const [v] = await db
    .select()
    .from(visits)
    .where(eq(visits.id, visitId))
    .limit(1);
  if (!v) throw new Error("visit not found");
  if (v.status === "completed" || v.status === "cancelled") {
    throw new Error(`visit is already ${v.status}`);
  }
  return withAudit(db, actor, "visit.complete", async (tx) => {
    const [updated] = await tx
      .update(visits)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(visits.id, visitId))
      .returning();
    return {
      result: updated,
      entityType: "visit",
      entityId: visitId,
      before: { status: v.status },
      after: { status: "completed" },
    };
  });
}
