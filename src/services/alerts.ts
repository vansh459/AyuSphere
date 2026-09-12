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
  documents,
  milestones,
  participants,
  trialSites,
  trials,
  visits,
} from "@/db/schema";
import { withAudit, type Actor } from "@/lib/audit";
import { assertCan } from "@/lib/rbac";
import { getAlertConfig } from "@/services/settings";
import { refreshVisitStatuses } from "@/services/visits";

export type RuleKey =
  | "visit_overdue"
  | "protocol_deviation"
  | "ae_deadline_approaching"
  | "ae_deadline_breached"
  | "milestone_due"
  | "enrolment_lag"
  | "monitoring_overdue"
  | "reconsent_due";

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

/**
 * The time-based sweep — runs from Vercel Cron and before dashboard reads.
 * Every rule here maps to a PS-named alert (workflow.md §9). Thresholds come
 * from the admin-configurable alert config (D-023) with built-in defaults.
 */
export async function sweepAlerts(db: Db, now = new Date()) {
  const config = await getAlertConfig(db);
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
    } else if (
      ae.reportingDeadline.getTime() - now.getTime() <=
      config.aeApproachingHours * HOUR
    ) {
      raised += Number(
        await raiseAlert(db, {
          ruleKey: "ae_deadline_approaching",
          entityRef: ref,
          severity: "warning",
          message: `Reporting deadline within ${config.aeApproachingHours}h for '${ae.term}' (${ae.seriousness.toUpperCase()})`,
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

  // 4) milestones due within the configured lookahead (CTRI / ethics dues)
  const dueMilestones = await db
    .select()
    .from(milestones)
    .where(
      and(
        isNull(milestones.completedAt),
        lte(
          milestones.dueDate,
          new Date(now.getTime() + config.milestoneLookaheadDays * DAY),
        ),
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
    if (
      row.target > 0 &&
      row.enrolled / row.target < config.enrolmentLagThreshold
    ) {
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

  // 6) overdue monitoring visits per activated trial-site (T7.3) — the due
  // date is set by scheduling and advanced by completing a monitoring visit
  const monitoringRows = await db
    .select({
      id: trialSites.id,
      trialId: trialSites.trialId,
      siteId: trialSites.siteId,
      due: trialSites.monitoringVisitDue,
    })
    .from(trialSites)
    .where(eq(trialSites.activationStatus, "active"));
  for (const row of monitoringRows) {
    const ref = `trial_site:${row.id}`;
    if (row.due && row.due.getTime() < now.getTime()) {
      raised += Number(
        await raiseAlert(db, {
          ruleKey: "monitoring_overdue",
          entityRef: ref,
          severity: "warning",
          message: `Monitoring visit overdue since ${row.due.toISOString().slice(0, 10)}`,
          trialId: row.trialId,
          siteId: row.siteId,
        }),
      );
    } else {
      resolved += Number(
        await resolveOpenAlert(db, "monitoring_overdue", ref),
      );
    }
  }

  // 7) re-consent due (T10.4): participants whose SIGNED consent-form
  // version is older than the trial's latest consent form. Legacy consents
  // with no bound document are skipped (nothing to compare against).
  const consentRows = await db
    .select({
      participantId: participants.id,
      subjectCode: participants.subjectCode,
      consentStatus: participants.consentStatus,
      signedVersion: documents.version,
      trialId: trialSites.trialId,
      siteId: trialSites.siteId,
    })
    .from(participants)
    .innerJoin(trialSites, eq(participants.trialSiteId, trialSites.id))
    .innerJoin(documents, eq(participants.consentDocumentId, documents.id));
  const latestFormVersion = new Map<string, number>();
  const consentForms = await db
    .select({ trialId: documents.trialId, version: documents.version })
    .from(documents)
    .where(eq(documents.kind, "consent_form"));
  for (const f of consentForms) {
    latestFormVersion.set(
      f.trialId,
      Math.max(latestFormVersion.get(f.trialId) ?? 0, f.version),
    );
  }
  for (const row of consentRows) {
    const ref = `participant:${row.participantId}`;
    const latest = latestFormVersion.get(row.trialId) ?? 0;
    if (row.consentStatus === "given" && row.signedVersion < latest) {
      raised += Number(
        await raiseAlert(db, {
          ruleKey: "reconsent_due",
          entityRef: ref,
          severity: "warning",
          message: `${row.subjectCode} consented on form v${row.signedVersion} — v${latest} now current, re-consent required`,
          trialId: row.trialId,
          siteId: row.siteId,
        }),
      );
    } else {
      resolved += Number(await resolveOpenAlert(db, "reconsent_due", ref));
    }
  }

  return { raised, resolved };
}
