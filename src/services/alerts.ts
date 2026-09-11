/**
 * Alerts engine (architecture.md §8, workflow.md §9).
 * Idempotent by design: the partial unique index allows at most one OPEN
 * alert per (rule, entity); re-raising is a no-op. Alerts auto-resolve
 * when their condition clears.
 */
import { and, eq, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import type { Db } from "@/db";
import {
  adverseEvents,
  alerts,
  milestones,
  participants,
  trialSites,
  trials,
  visits,
} from "@/db/schema";
import { withAudit, type Actor } from "@/lib/audit";
import { assertCan } from "@/lib/rbac";
import { refreshVisitStatuses } from "@/services/visits";

export type RuleKey =
  | "visit_overdue"
  | "protocol_deviation"
  | "ae_deadline_approaching"
  | "ae_deadline_breached"
  | "milestone_due"
  | "enrolment_lag";

type RaiseInput = {
  ruleKey: RuleKey;
  entityRef: string;
  severity: "info" | "warning" | "danger";
  message: string;
  trialId?: string;
  siteId?: string;
};

/** insert-if-absent; returns true when a new alert was created */
export async function raiseAlert(db: Db, input: RaiseInput): Promise<boolean> {
  const res = await db
    .insert(alerts)
    .values(input)
    .onConflictDoNothing()
    .returning({ id: alerts.id });
  return res.length > 0;
}

export async function resolveOpenAlert(
  db: Db,
  ruleKey: RuleKey,
  entityRef: string,
): Promise<boolean> {
  const res = await db
    .update(alerts)
    .set({ status: "resolved", resolvedAt: new Date() })
    .where(
      and(
        eq(alerts.ruleKey, ruleKey),
        eq(alerts.entityRef, entityRef),
        eq(alerts.status, "open"),
      ),
    )
    .returning({ id: alerts.id });
  return res.length > 0;
}

export async function acknowledgeAlert(db: Db, actor: Actor, alertId: string) {
  assertCan(actor.role, "alert.acknowledge");
  const [alert] = await db
    .select()
    .from(alerts)
    .where(eq(alerts.id, alertId))
    .limit(1);
  if (!alert) throw new Error("alert not found");
  if (alert.status !== "open") throw new Error(`alert is ${alert.status}`);
  return withAudit(db, actor, "alert.acknowledge", async (tx) => {
    const [updated] = await tx
      .update(alerts)
      .set({ status: "acknowledged", acknowledgedBy: actor.id })
      .where(eq(alerts.id, alertId))
      .returning();
    return {
      result: updated,
      entityType: "alert",
      entityId: alertId,
      before: { status: "open" },
      after: { status: "acknowledged" },
    };
  });
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** recruitment below this fraction of target counts as lagging */
export const ENROLMENT_LAG_THRESHOLD = 0.5;

/**
 * The time-based sweep — runs from Vercel Cron and before dashboard reads.
 * Every rule here maps to a PS-named alert (workflow.md §9).
 */
export async function sweepAlerts(db: Db, now = new Date()) {
  await refreshVisitStatuses(db, now);
  let raised = 0;
  let resolved = 0;

  // 1) overdue visits → warning; missed → protocol deviation (danger)
  const overdue = await db
    .select()
    .from(visits)
    .where(inArray(visits.status, ["overdue", "missed"]));
  for (const v of overdue) {
    if (v.status === "overdue") {
      raised += Number(
        await raiseAlert(db, {
          ruleKey: "visit_overdue",
          entityRef: `visit:${v.id}`,
          severity: "warning",
          message: `Visit '${v.name}' is past its protocol window`,
        }),
      );
    } else {
      raised += Number(
        await raiseAlert(db, {
          ruleKey: "protocol_deviation",
          entityRef: `visit:${v.id}`,
          severity: "danger",
          message: `Visit '${v.name}' was missed — protocol deviation`,
        }),
      );
      // a missed visit supersedes its overdue alert
      resolved += Number(
        await resolveOpenAlert(db, "visit_overdue", `visit:${v.id}`),
      );
    }
  }

  // 2) completed/cancelled visits clear their overdue alerts
  const closedVisits = await db
    .select({ id: visits.id })
    .from(visits)
    .where(inArray(visits.status, ["completed", "cancelled"]));
  for (const v of closedVisits) {
    resolved += Number(
      await resolveOpenAlert(db, "visit_overdue", `visit:${v.id}`),
    );
  }

  // 3) AE deadlines
  const openAes = await db
    .select()
    .from(adverseEvents)
    .where(inArray(adverseEvents.status, ["open", "under_review"]));
  for (const ae of openAes) {
    const ref = `ae:${ae.id}`;
    if (ae.reportingDeadline.getTime() < now.getTime()) {
      raised += Number(
        await raiseAlert(db, {
          ruleKey: "ae_deadline_breached",
          entityRef: ref,
          severity: "danger",
          message: `Reporting deadline BREACHED for '${ae.term}' (${ae.seriousness.toUpperCase()})`,
        }),
      );
      resolved += Number(
        await resolveOpenAlert(db, "ae_deadline_approaching", ref),
      );
    } else if (ae.reportingDeadline.getTime() - now.getTime() <= 24 * HOUR) {
      raised += Number(
        await raiseAlert(db, {
          ruleKey: "ae_deadline_approaching",
          entityRef: ref,
          severity: "warning",
          message: `Reporting deadline within 24h for '${ae.term}' (${ae.seriousness.toUpperCase()})`,
        }),
      );
    }
  }
  // reported/closed AEs clear their deadline alerts
  const settledAes = await db
    .select({ id: adverseEvents.id })
    .from(adverseEvents)
    .where(inArray(adverseEvents.status, ["reported", "closed"]));
  for (const ae of settledAes) {
    resolved += Number(
      await resolveOpenAlert(db, "ae_deadline_approaching", `ae:${ae.id}`),
    );
    resolved += Number(
      await resolveOpenAlert(db, "ae_deadline_breached", `ae:${ae.id}`),
    );
  }

  // 4) milestones due within 7 days and not completed (CTRI / ethics dues)
  const dueMilestones = await db
    .select()
    .from(milestones)
    .where(
      and(
        isNull(milestones.completedAt),
        lte(milestones.dueDate, new Date(now.getTime() + 7 * DAY)),
      ),
    );
  for (const m of dueMilestones) {
    raised += Number(
      await raiseAlert(db, {
        ruleKey: "milestone_due",
        entityRef: `milestone:${m.id}`,
        severity: m.dueDate && m.dueDate.getTime() < now.getTime() ? "danger" : "warning",
        message: `Milestone '${m.kind}' is due`,
        trialId: m.trialId,
      }),
    );
  }

  // 5) enrolment lag per active trial-site
  const lagRows = await db
    .select({
      id: trialSites.id,
      trialId: trialSites.trialId,
      siteId: trialSites.siteId,
      target: trialSites.enrollmentTarget,
      enrolled: sql<number>`(select count(*)::int from ${participants} p
        where p.trial_site_id = ${trialSites.id} and p.status = 'enrolled')`,
    })
    .from(trialSites)
    .innerJoin(trials, eq(trialSites.trialId, trials.id))
    .where(
      and(
        eq(trialSites.activationStatus, "active"),
        eq(trials.status, "active"),
        lt(trialSites.activatedAt, new Date(now.getTime() - 30 * DAY)),
      ),
    );
  for (const row of lagRows) {
    const ref = `trial_site:${row.id}`;
    if (row.target > 0 && row.enrolled / row.target < ENROLMENT_LAG_THRESHOLD) {
      raised += Number(
        await raiseAlert(db, {
          ruleKey: "enrolment_lag",
          entityRef: ref,
          severity: "warning",
          message: `Site enrolment at ${row.enrolled}/${row.target} — behind target`,
          trialId: row.trialId,
          siteId: row.siteId,
        }),
      );
    } else {
      resolved += Number(await resolveOpenAlert(db, "enrolment_lag", ref));
    }
  }

  return { raised, resolved };
}
