/**
 * Sidebar/topbar badge counts — ONE source of truth used by the (app)
 * layout's initial render AND the /api/badges live-refresh endpoint.
 * Root cause this fixes: the layout is a server component that renders once
 * per hard load, so counts computed there freeze across client navigation —
 * reading a message (a client fetch) never updated the "Messages" badge.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { adverseEvents, alerts, amendments, messages, trials } from "@/db/schema";
import { can, type Role } from "@/lib/rbac";

export type BadgeCounts = {
  /** keyed by nav href — what the Sidebar consumes directly */
  "/messages": number;
  "/alerts": number;
  "/adverse-events": number;
  "/ethics": number;
};

export async function badgeCounts(
  db: Db,
  user: { id: string; role: Role },
): Promise<BadgeCounts> {
  const zero = Promise.resolve([{ count: 0 }]);
  const [msgRes, alertRes, aeRes, ethicsTrialRes, ethicsAmendRes] =
    await Promise.all([
      can(user.role, "chat.use")
        ? db
            .select({ count: sql<number>`count(*)::int` })
            .from(messages)
            .where(
              and(eq(messages.recipientId, user.id), isNull(messages.readAt)),
            )
            .catch(() => [{ count: 0 }])
        : zero,
      can(user.role, "alert.acknowledge")
        ? db
            .select({ count: sql<number>`count(*)::int` })
            .from(alerts)
            .where(eq(alerts.status, "open"))
            .catch(() => [{ count: 0 }])
        : zero,
      can(user.role, "ae.capture") || can(user.role, "ae.review")
        ? db
            .select({ count: sql<number>`count(*)::int` })
            .from(adverseEvents)
            .where(inArray(adverseEvents.status, ["open", "under_review"]))
            .catch(() => [{ count: 0 }])
        : zero,
      can(user.role, "trial.ethicsReview")
        ? db
            .select({ count: sql<number>`count(*)::int` })
            .from(trials)
            .where(eq(trials.status, "iec_review"))
            .catch(() => [{ count: 0 }])
        : zero,
      can(user.role, "trial.ethicsReview")
        ? db
            .select({ count: sql<number>`count(*)::int` })
            .from(amendments)
            .where(eq(amendments.status, "submitted"))
            .catch(() => [{ count: 0 }])
        : zero,
    ]);

  return {
    "/messages": Number(msgRes[0]?.count ?? 0),
    "/alerts": Number(alertRes[0]?.count ?? 0),
    "/adverse-events": Number(aeRes[0]?.count ?? 0),
    "/ethics":
      Number(ethicsTrialRes[0]?.count ?? 0) +
      Number(ethicsAmendRes[0]?.count ?? 0),
  };
}
