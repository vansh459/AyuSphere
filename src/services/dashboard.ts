/**
 * Dashboard data assembly for the AyushIntel-style overview
 * (stat deltas, chart series, activity/visit/insight feeds).
 */
import { desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import {
  adverseEvents,
  alerts,
  auditEvents,
  participants,
  sites,
  trialSites,
  trials,
  visits,
} from "@/db/schema";

const DAY = 86_400_000;

export type StatCards = {
  activeTrials: number;
  trialsDelta30d: number;
  totalParticipants: number;
  participantsDelta30d: number;
  sites: number;
  states: number;
  openVisits: number;
  overdueVisits: number;
  openAes: number;
};

export async function statCards(db: Db): Promise<StatCards> {
  const cutoff = new Date(Date.now() - 30 * DAY);
  const [row] = await db
    .select({
      activeTrials: sql<number>`(select count(*)::int from ${trials} where status = 'active')`,
      trialsDelta30d: sql<number>`(select count(*)::int from ${trials} where created_at >= ${cutoff})`,
      totalParticipants: sql<number>`(select count(*)::int from ${participants})`,
      participantsDelta30d: sql<number>`(select count(*)::int from ${participants} where enrolled_at >= ${cutoff})`,
      sites: sql<number>`(select count(*)::int from ${sites})`,
      states: sql<number>`(select count(distinct state)::int from ${sites})`,
      openVisits: sql<number>`(select count(*)::int from ${visits} where status in ('upcoming','due'))`,
      overdueVisits: sql<number>`(select count(*)::int from ${visits} where status = 'overdue')`,
      openAes: sql<number>`(select count(*)::int from ${adverseEvents} where status in ('open','under_review'))`,
    })
    .from(sql`(select 1) as one`);
  return row;
}

export type ProgressPoint = {
  month: string;
  enrolled: number;
  completed: number;
  dropouts: number;
};

/** cumulative counts per month over the last 9 months */
export async function trialProgressSeries(db: Db): Promise<ProgressPoint[]> {
  const [enrols, completions, withdrawals] = await Promise.all([
    db
      .select({ at: participants.enrolledAt })
      .from(participants)
      .where(sql`${participants.enrolledAt} is not null`),
    db
      .select({ at: visits.completedAt })
      .from(visits)
      .where(sql`${visits.completedAt} is not null`),
    db
      .select({ at: participants.withdrawnAt })
      .from(participants)
      .where(sql`${participants.withdrawnAt} is not null`),
  ]);

  const now = new Date();
  const points: ProgressPoint[] = [];
  for (let i = 8; i >= 0; i--) {
    const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
    const label = monthEnd.toLocaleString("en", { month: "short" });
    const upTo = (rows: { at: Date | null }[]) =>
      rows.filter((r) => r.at && r.at.getTime() <= monthEnd.getTime()).length;
    points.push({
      month: label,
      enrolled: upTo(enrols),
      completed: upTo(completions),
      dropouts: upTo(withdrawals),
    });
  }
  return points;
}

export type DistributionSlice = { name: string; value: number };

export async function participantDistribution(
  db: Db,
): Promise<{ total: number; slices: DistributionSlice[] }> {
  const [row] = await db
    .select({
      screening: sql<number>`count(*) filter (where status = 'screening')::int`,
      enrolled: sql<number>`count(*) filter (where status = 'enrolled')::int`,
      completed: sql<number>`count(*) filter (where status = 'completed')::int`,
      dropped: sql<number>`count(*) filter (where status = 'withdrawn')::int`,
      total: sql<number>`count(*)::int`,
    })
    .from(participants);
  return {
    total: row.total,
    slices: [
      { name: "Screening", value: row.screening },
      { name: "Enrolled", value: row.enrolled },
      { name: "Completed", value: row.completed },
      { name: "Dropped Out", value: row.dropped },
    ],
  };
}

export type SiteBar = { name: string; rate: number };

/** recruitment rate per site, aggregated across its trial attachments */
export async function sitePerformanceAggregate(db: Db): Promise<SiteBar[]> {
  const rows = await db
    .select({
      name: sites.name,
      target: sql<number>`coalesce(sum(${trialSites.enrollmentTarget}), 0)::int`,
      enrolled: sql<number>`coalesce(sum((select count(*)::int from ${participants} p
        where p.trial_site_id = ${trialSites.id} and p.status = 'enrolled')), 0)::int`,
    })
    .from(sites)
    .leftJoin(trialSites, eq(trialSites.siteId, sites.id))
    .groupBy(sites.id, sites.name);
  return rows
    .map((r) => ({
      name: r.name,
      rate: r.target > 0 ? Math.min(r.enrolled / r.target, 1) : 0,
    }))
    .sort((a, b) => b.rate - a.rate);
}

export function relativeTime(at: Date, now = new Date()): string {
  const mins = Math.max(1, Math.round((now.getTime() - at.getTime()) / 60_000));
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

const ACTIVITY_LABELS: Record<string, string> = {
  "participant.enrol": "New participant enrolled",
  "participant.create": "Participant added",
  "participant.consent": "Consent recorded",
  "participant.withdraw": "Participant withdrawn",
  "trial.create": "Trial created",
  "trial.transition": "Trial status changed",
  "crf.create": "CRF entry drafted",
  "crf.submit": "CRF entry submitted",
  "crf.approve": "CRF entry approved",
  "extraction.create": "Lab report / note processed",
  "extraction.approve": "Note extraction approved",
  "ae.capture": "Adverse event reported",
  "ae.reported": "Adverse event reported to authority",
  "visit.complete": "Visit completed",
  "visit.missed": "Visit missed",
  "document.upload": "Document uploaded",
  "site.create": "Site registered",
  "site.attach": "Site attached to trial",
  "site.activate": "Site activated",
  "copilot.query": "AI Copilot query",
  "settings.ai_update": "AI model settings updated",
  "user.create": "User account created",
  "user.activate": "User account reactivated",
  "user.deactivate": "User account deactivated",
  "alert.acknowledge": "Alert acknowledged",
  "extraction.quality_fail": "Note image rejected (quality)",
  "extraction.invalid_output": "Note extraction failed validation",
  "extraction.reject": "Note extraction rejected",
  "crf.correct": "CRF entry corrected",
  "participant.screen": "Screening recorded",
  "export.fhir": "FHIR bundle exported",
  "export.dm": "SDTM DM exported",
  "export.ae": "SDTM AE exported",
  "export.define": "Define-XML exported",
};

/** friendly label with a prettified fallback — raw dotted keys never render */
export function activityLabel(action: string): string {
  return (
    ACTIVITY_LABELS[action] ??
    action.replaceAll(".", " — ").replaceAll("_", " ")
  );
}

export type Activity = { label: string; detail: string; when: string; kind: string };

export async function recentActivities(db: Db, limit = 4): Promise<Activity[]> {
  const rows = await db
    .select()
    .from(auditEvents)
    .orderBy(desc(auditEvents.at))
    .limit(limit);
  return rows.map((e) => ({
    label: activityLabel(e.action),
    detail: `${e.entityType} · by ${e.actorRole}`,
    when: relativeTime(e.at),
    kind: e.action.split(".")[0],
  }));
}

export type UpcomingVisit = {
  id: string;
  subjectCode: string;
  name: string;
  date: string;
  site: string;
  chip: string;
  overdue: boolean;
};

export function visitChip(scheduled: Date, now = new Date()): { chip: string; overdue: boolean } {
  const days = Math.ceil((scheduled.getTime() - now.getTime()) / DAY);
  if (days < 0) return { chip: `${-days}d overdue`, overdue: true };
  if (days === 0) return { chip: "Today", overdue: false };
  if (days === 1) return { chip: "Tomorrow", overdue: false };
  return { chip: `In ${days} days`, overdue: false };
}

export async function upcomingVisitList(db: Db, limit = 4): Promise<UpcomingVisit[]> {
  const rows = await db
    .select({
      v: visits,
      subjectCode: participants.subjectCode,
      site: sites.name,
    })
    .from(visits)
    .innerJoin(participants, eq(visits.participantId, participants.id))
    .innerJoin(trialSites, eq(participants.trialSiteId, trialSites.id))
    .innerJoin(sites, eq(trialSites.siteId, sites.id))
    .where(inArray(visits.status, ["due", "upcoming", "overdue"]))
    .orderBy(visits.scheduledDate)
    .limit(limit);
  return rows.map(({ v, subjectCode, site }) => {
    const { chip, overdue } = visitChip(v.scheduledDate);
    return {
      id: v.id,
      subjectCode,
      name: v.name,
      date: v.scheduledDate.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }),
      site,
      chip,
      overdue,
    };
  });
}

export type Insight = {
  title: string;
  detail: string;
  tone: "danger" | "success" | "info" | "warning";
};

/** rule-derived decision support — every line traces to live records */
export async function aiInsights(db: Db): Promise<Insight[]> {
  const [dropoutRisk] = await db
    .select({
      n: sql<number>`count(distinct ${participants.id})::int`,
    })
    .from(participants)
    .innerJoin(visits, eq(visits.participantId, participants.id))
    .where(
      sql`${participants.status} = 'enrolled' and ${visits.status} in ('overdue','missed')`,
    );

  const openAlerts = await db
    .select({ ruleKey: alerts.ruleKey, n: sql<number>`count(*)::int` })
    .from(alerts)
    .where(eq(alerts.status, "open"))
    .groupBy(alerts.ruleKey);
  const byRule = Object.fromEntries(openAlerts.map((a) => [a.ruleKey, a.n]));

  // two plain queries — a correlated subquery here silently resolved "id"
  // to participants.id (wrong join), always yielding 0
  const [recruitTarget] = await db
    .select({
      target: sql<number>`coalesce(sum(${trialSites.enrollmentTarget}), 0)::int`,
    })
    .from(trialSites)
    .where(eq(trialSites.activationStatus, "active"));
  const [recruitEnrolled] = await db
    .select({ enrolled: sql<number>`count(*)::int` })
    .from(participants)
    .innerJoin(trialSites, eq(participants.trialSiteId, trialSites.id))
    .where(
      sql`${participants.status} = 'enrolled' and ${trialSites.activationStatus} = 'active'`,
    );
  const recruit = {
    target: recruitTarget.target,
    enrolled: recruitEnrolled.enrolled,
  };

  const [aeReview] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(adverseEvents)
    .where(inArray(adverseEvents.status, ["open", "under_review"]));

  const insights: Insight[] = [];
  insights.push(
    dropoutRisk.n > 0
      ? {
          title: "Dropout Risk",
          detail: `${dropoutRisk.n} participants show early signs (overdue or missed visits).`,
          tone: "danger",
        }
      : { title: "Dropout Risk", detail: "No early dropout signals detected.", tone: "success" },
  );
  const lagging = byRule["enrolment_lag"] ?? 0;
  insights.push(
    lagging > 0
      ? {
          title: "Recruitment",
          detail: `${lagging} site${lagging === 1 ? "" : "s"} behind enrolment target.`,
          tone: "warning",
        }
      : {
          title: "Recruitment On Track",
          detail: `Portfolio at ${recruit.target > 0 ? Math.round((recruit.enrolled / recruit.target) * 100) : 0}% of active-site targets.`,
          tone: "success",
        },
  );
  insights.push({
    title: "Protocol Deviations",
    detail: `${byRule["protocol_deviation"] ?? 0} potential deviations flagged for review.`,
    tone: "info",
  });
  insights.push({
    title: "Safety Signal",
    detail: `${aeReview.n} adverse event${aeReview.n === 1 ? "" : "s"} open or under review.`,
    tone: "warning",
  });
  return insights;
}
