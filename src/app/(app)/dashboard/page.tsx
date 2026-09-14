import Link from "next/link";
import { eq, inArray } from "drizzle-orm";
import {
  Activity as ActivityIcon,
  AlertTriangle,
  BadgeCheck,
  Calendar,
  FileText,
  FlaskConical,
  Landmark,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
  UserPlus,
  Users,
} from "lucide-react";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { dashboardVariant, type DashboardCard } from "@/lib/dashboard-variants";
import { fmtDate } from "@/lib/dates";
import { appCache } from "@/lib/ttl-cache";
import { getDb } from "@/db";
import { participants, trials, visits } from "@/db/schema";
import {
  aiInsights,
  participantDistribution,
  pendingApprovals,
  recentActivities,
  sitePerformanceAggregate,
  statCards,
  trialProgressSeries,
  upcomingVisitList,
} from "@/services/dashboard";
import { listQueries, queryStats } from "@/services/data-queries";
import { pendingAmendments } from "@/services/amendments";
import { openAesByDeadline } from "@/services/kpi";
import { safetySignals } from "@/services/safety-signals";
import { listActiveTrialSites } from "@/services/monitoring";
import { EscalationClock } from "@/components/app/escalation-clock";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DbErrorState } from "@/components/app/shared";
import {
  ParticipantDonut,
  TrialProgressChart,
} from "@/components/app/dashboard-charts";
import {
  AssistantPanel,
  type VisitOption,
} from "@/components/app/assistant-panel";
import { LiveClock } from "@/components/app/live-clock";

const ACTIVITY_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  participant: UserPlus,
  extraction: FileText,
  ae: AlertTriangle,
  visit: BadgeCheck,
  trial: FlaskConical,
  crf: FileText,
  document: FileText,
  site: Landmark,
  user: Users,
  alert: AlertTriangle,
};

const INSIGHT_ICON = {
  danger: TrendingDown,
  success: TrendingUp,
  info: ActivityIcon,
  warning: ShieldCheck,
} as const;

export default async function DashboardPage() {
  const session = await auth();
  const user = session!.user;
  // tailored dashboards (T10.5): the role decides which cards compose
  const cards = dashboardVariant(user.role);
  const show = (c: DashboardCard) => cards.includes(c);

  let data: {
    stats: Awaited<ReturnType<typeof statCards>>;
    progress: Awaited<ReturnType<typeof trialProgressSeries>>;
    distribution: Awaited<ReturnType<typeof participantDistribution>>;
    sitePerf: Awaited<ReturnType<typeof sitePerformanceAggregate>>;
    activities: Awaited<ReturnType<typeof recentActivities>>;
    upcoming: Awaited<ReturnType<typeof upcomingVisitList>>;
    insights: Awaited<ReturnType<typeof aiInsights>>;
    visitOptions: VisitOption[];
    approvals: Awaited<ReturnType<typeof pendingApprovals>> | null;
    queries: {
      stats: Awaited<ReturnType<typeof queryStats>>;
      open: Awaited<ReturnType<typeof listQueries>>;
    } | null;
    ethicsQueues: {
      reviews: { id: string; protocolCode: string; title: string }[];
      amendments: Awaited<ReturnType<typeof pendingAmendments>>;
    } | null;
    safetyClocks: Awaited<ReturnType<typeof openAesByDeadline>> | null;
    signals: Awaited<ReturnType<typeof safetySignals>> | null;
    monitoringSites: Awaited<ReturnType<typeof listActiveTrialSites>> | null;
  } | null = null;

  try {
    const db = getDb();
    // portfolio-wide aggregates tolerate ~45s staleness (D-030); the
    // action-driven feeds below (approvals, queries, activities…) stay live
    const cached = <T,>(key: string, fn: () => Promise<T>) =>
      appCache.getOrCompute(`dash:${key}`, 45_000, fn as () => Promise<unknown>) as Promise<T>;
    const [stats, progress, distribution, sitePerf, activities, upcoming, insights] =
      await Promise.all([
        cached("stats", () => statCards(db)),
        cached("progress", () => trialProgressSeries(db)),
        cached("distribution", () => participantDistribution(db)),
        cached("site-perf", () => sitePerformanceAggregate(db)),
        recentActivities(db),
        upcomingVisitList(db),
        cached("insights", () => aiInsights(db)),
      ]);
    let visitOptions: VisitOption[] = [];
    if (can(user.role, "crf.enter")) {
      const openVisits = await db
        .select({
          id: visits.id,
          name: visits.name,
          subjectCode: participants.subjectCode,
        })
        .from(visits)
        .innerJoin(participants, eq(visits.participantId, participants.id))
        .where(inArray(visits.status, ["due", "overdue", "upcoming"]))
        .orderBy(visits.scheduledDate)
        .limit(300);
      visitOptions = openVisits.map((v) => ({
        id: v.id,
        label: `${v.subjectCode} · ${v.name}`,
      }));
    }
    // role-specific cards load only when the variant shows them
    const approvals = show("pending-approvals") ? await pendingApprovals(db) : null;
    const queries = show("open-queries")
      ? {
          stats: await queryStats(db),
          open: (await listQueries(db, 30)).filter(
            (q) => q.query.status === "open",
          ).slice(0, 5),
        }
      : null;
    const ethicsQueues = show("ethics-queues")
      ? {
          reviews: (
            await db
              .select({
                id: trials.id,
                protocolCode: trials.protocolCode,
                title: trials.title,
              })
              .from(trials)
              .where(eq(trials.status, "iec_review"))
          ).slice(0, 5),
          amendments: await pendingAmendments(db),
        }
      : null;
    const safetyClocks = show("safety-clocks")
      ? (await openAesByDeadline(db)).slice(0, 4)
      : null;
    const signals = show("safety-signals")
      ? (await cached("signals", () => safetySignals(db))).slice(0, 5)
      : null;
    const monitoringSites = show("monitoring-panel")
      ? await listActiveTrialSites(db)
      : null;

    data = {
      stats,
      progress,
      distribution,
      sitePerf,
      activities,
      upcoming,
      insights,
      visitOptions,
      approvals,
      queries,
      ethicsQueues,
      safetyClocks,
      signals,
      monitoringSites,
    };
  } catch {
    data = null;
  }

  if (!data) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-heading font-bold">Welcome, {user.name}</h1>
        <DbErrorState />
      </div>
    );
  }

  const { stats } = data;
  const statTiles = [
    {
      label: "Active Trials",
      value: stats.activeTrials,
      note: `↑ +${stats.trialsDelta30d} this month`,
      noteTone: "text-success",
      icon: FlaskConical,
      iconBg: "bg-primary-soft text-primary",
      href: "/trials",
      cap: "trial.manage" as const,
    },
    {
      label: "Total Participants",
      value: stats.totalParticipants,
      note: `↑ +${stats.participantsDelta30d} this month`,
      noteTone: "text-success",
      icon: Users,
      iconBg: "bg-info/10 text-info",
      href: "/participants",
      cap: "participant.manage" as const,
    },
    {
      label: "Sites",
      value: stats.sites,
      note: `Across ${stats.states} state${stats.states === 1 ? "" : "s"}`,
      noteTone: "opacity-50",
      icon: Landmark,
      iconBg: "bg-primary-soft text-primary-deep",
      href: "/sites",
      cap: "site.manage" as const,
    },
    {
      label: "Upcoming Visits",
      value: stats.openVisits,
      note: `⏱ ${stats.overdueVisits} overdue`,
      noteTone: stats.overdueVisits > 0 ? "text-danger" : "text-success",
      icon: Calendar,
      iconBg: "bg-danger/10 text-danger",
      href: "/visits",
      cap: "crf.enter" as const,
    },
    {
      label: "Adverse Events",
      value: stats.openAes,
      note: "Under review",
      noteTone: "opacity-50",
      icon: ShieldCheck,
      iconBg: "bg-success/10 text-success",
      href: "/adverse-events",
      cap: "ae.capture" as const,
    },
  ];

  return (
    <div className="flex flex-col gap-6 xl:flex-row">
      {/* main column */}
      <div className="flex min-w-0 flex-1 flex-col gap-6">
        {/* welcome + date */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-heading font-bold">Welcome, {user.name}</h1>
            <p className="mt-1 opacity-70">
              AI-powered platform for efficient, transparent and impactful
              Ayurveda clinical trials
            </p>
          </div>
          <LiveClock />
        </div>

        {/* stat cards */}
        {show("portfolio-stats") ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
          {statTiles.map((t) => {
            const Icon = t.icon;
            const card = (
              <Card className="h-full p-4 transition-transform duration-200 hover:-translate-y-[2px]">
                <div className="flex items-start gap-3">
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${t.iconBg}`}
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate opacity-70">{t.label}</p>
                    <p className="text-heading font-bold">{t.value}</p>
                    <p className={`truncate font-medium ${t.noteTone}`}>
                      {t.note}
                    </p>
                  </div>
                </div>
              </Card>
            );
            return can(user.role, t.cap) ? (
              <Link key={t.label} href={t.href}>
                {card}
              </Link>
            ) : (
              <div key={t.label}>{card}</div>
            );
          })}
        </div>
        ) : null}

        {/* role-specific work queues (T10.5) */}
        {show("safety-clocks") && data.safetyClocks ? (
          <Card className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-body font-bold">
                Safety portfolio — by reporting deadline
              </CardTitle>
              <Link href="/adverse-events" className="font-medium text-primary">
                Open AE/SAE →
              </Link>
            </div>
            {data.safetyClocks.length === 0 ? (
              <p className="opacity-70">No open adverse events.</p>
            ) : (
              <div className="flex flex-wrap gap-6">
                {data.safetyClocks.map(({ ae, subjectCode }) => (
                  <div key={ae.id} className="flex items-center gap-3">
                    <EscalationClock
                      deadline={ae.reportingDeadline}
                      totalHours={ae.seriousness === "sae" ? 24 : 168}
                    />
                    <div className="min-w-0">
                      <p className="font-medium">{ae.term}</p>
                      <p className="opacity-50">
                        {subjectCode} · {ae.seriousness.toUpperCase()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        ) : null}

        {show("ethics-queues") && data.ethicsQueues ? (
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <Card className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-body font-bold">
                  Awaiting IEC review ({data.ethicsQueues.reviews.length})
                </CardTitle>
                <Link href="/ethics" className="font-medium text-primary">
                  Review queue →
                </Link>
              </div>
              {data.ethicsQueues.reviews.length === 0 ? (
                <p className="opacity-70">No trials awaiting review.</p>
              ) : (
                data.ethicsQueues.reviews.map((t) => (
                  <p key={t.id} className="opacity-70">
                    <span className="font-medium">{t.protocolCode}</span> —{" "}
                    {t.title}
                  </p>
                ))
              )}
            </Card>
            <Card className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-body font-bold">
                  Amendment queue ({data.ethicsQueues.amendments.length})
                </CardTitle>
                <Link href="/ethics" className="font-medium text-primary">
                  Decide →
                </Link>
              </div>
              {data.ethicsQueues.amendments.length === 0 ? (
                <p className="opacity-70">No amendments awaiting review.</p>
              ) : (
                data.ethicsQueues.amendments.map(({ amendment, protocolCode }) => (
                  <p key={amendment.id} className="opacity-70">
                    <span className="font-medium">
                      {protocolCode} v{amendment.versionNumber}
                    </span>{" "}
                    — {amendment.summary}
                  </p>
                ))
              )}
            </Card>
          </div>
        ) : null}

        {(show("pending-approvals") && data.approvals) ||
        (show("open-queries") && data.queries) ||
        (show("safety-signals") && data.signals) ? (
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            {show("pending-approvals") && data.approvals ? (
              <Card className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-body font-bold">
                    Pending your signature
                  </CardTitle>
                  <Badge
                    tone={
                      data.approvals.submittedEntries +
                        data.approvals.extractionsInReview >
                      0
                        ? "warning"
                        : "success"
                    }
                  >
                    {data.approvals.submittedEntries} CRF ·{" "}
                    {data.approvals.extractionsInReview} extractions
                  </Badge>
                </div>
                {data.approvals.queue.length === 0 ? (
                  <p className="opacity-70">Nothing awaiting approval.</p>
                ) : (
                  data.approvals.queue.map((q) => (
                    <Link
                      key={q.entryId}
                      href={`/visits/${q.visitId}`}
                      className="opacity-70 hover:opacity-100"
                    >
                      <span className="font-medium">{q.subjectCode}</span> ·{" "}
                      {q.visitName} — sign &amp; approve →
                    </Link>
                  ))
                )}
              </Card>
            ) : null}

            {show("open-queries") && data.queries ? (
              <Card className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-body font-bold">
                    Data queries
                  </CardTitle>
                  <Badge tone={data.queries.stats.open > 0 ? "warning" : "success"}>
                    {data.queries.stats.open} open
                  </Badge>
                </div>
                {data.queries.open.length === 0 ? (
                  <p className="opacity-70">No open queries.</p>
                ) : (
                  data.queries.open.map(({ query, subjectCode, visitName }) => (
                    <p key={query.id} className="opacity-70">
                      <span className="font-medium">{subjectCode}</span> ·{" "}
                      {visitName} — {query.question}
                    </p>
                  ))
                )}
              </Card>
            ) : null}

            {show("safety-signals") && data.signals ? (
              <Card className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-body font-bold">
                    Safety signals
                  </CardTitle>
                  <Link
                    href="/adverse-events/dsmb"
                    className="font-medium text-primary"
                  >
                    DSMB summary →
                  </Link>
                </div>
                {data.signals.length === 0 ? (
                  <p className="opacity-70">No events recorded yet.</p>
                ) : (
                  data.signals.map((s) => (
                    <div
                      key={`${s.trialId}-${s.termKey}`}
                      className="flex items-center gap-2"
                    >
                      {s.flagged ? <Badge tone="danger">signal</Badge> : null}
                      <p className="min-w-0 truncate opacity-70">
                        <span className="font-medium">{s.termLabel}</span> ·{" "}
                        {s.protocolCode} · {s.count}/{s.trialTotal} ·{" "}
                        {s.ratio.toFixed(2)}×
                      </p>
                    </div>
                  ))
                )}
              </Card>
            ) : null}
          </div>
        ) : null}

        {show("monitoring-panel") && data.monitoringSites ? (
          <Card className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-body font-bold">
                Monitoring — site due dates
              </CardTitle>
              <Link href="/monitoring" className="font-medium text-primary">
                Log a visit →
              </Link>
            </div>
            {data.monitoringSites.length === 0 ? (
              <p className="opacity-70">No activated trial sites.</p>
            ) : (
              data.monitoringSites.map((s) => {
                const overdue =
                  s.monitoringVisitDue &&
                  s.monitoringVisitDue.getTime() < Date.now();
                return (
                  <div
                    key={s.trialSiteId}
                    className="flex flex-wrap items-center justify-between gap-3"
                  >
                    <p className="font-medium">
                      {s.protocolCode} · {s.siteName}
                    </p>
                    {s.monitoringVisitDue ? (
                      <Badge tone={overdue ? "danger" : "success"}>
                        {overdue ? "overdue since " : "due "}
                        {fmtDate(s.monitoringVisitDue)}
                      </Badge>
                    ) : (
                      <Badge tone="neutral">not scheduled</Badge>
                    )}
                  </div>
                );
              })
            )}
          </Card>
        ) : null}

        {/* charts row */}
        {show("trial-progress") ||
        show("participant-distribution") ||
        show("site-performance") ? (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          {show("trial-progress") ? (
          <Card className="flex flex-col gap-3 xl:col-span-1">
            <CardTitle className="text-body font-bold">Trial Progress</CardTitle>
            <TrialProgressChart data={data.progress} />
          </Card>
          ) : null}
          {show("participant-distribution") ? (
          <Card className="flex flex-col gap-3 xl:col-span-1">
            <CardTitle className="text-body font-bold">
              Participant Distribution
            </CardTitle>
            <ParticipantDonut
              total={data.distribution.total}
              slices={data.distribution.slices}
            />
          </Card>
          ) : null}
          {show("site-performance") ? (
          <Card className="flex flex-col gap-3 xl:col-span-1">
            <div className="flex items-center justify-between">
              <CardTitle className="text-body font-bold">
                Site Performance
              </CardTitle>
              <span className="microlabel">Recruitment rate</span>
            </div>
            <div className="flex flex-1 flex-col justify-center gap-3">
              {data.sitePerf.map((s) => (
                <div key={s.name} className="flex items-center gap-3">
                  <p className="w-24 shrink-0 truncate opacity-70">{s.name}</p>
                  <div className="h-3 flex-1 overflow-hidden rounded-full bg-primary-soft">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${Math.round(s.rate * 100)}%` }}
                    />
                  </div>
                  <p className="w-10 shrink-0 text-right font-medium">
                    {Math.round(s.rate * 100)}%
                  </p>
                </div>
              ))}
            </div>
          </Card>
          ) : null}
        </div>
        ) : null}

        {/* feeds row */}
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          {show("recent-activity") ? (
          <Card className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-body font-bold">
                Recent Activities
              </CardTitle>
              {can(user.role, "audit.view") ? (
                <Link href="/audit" className="font-medium text-primary">
                  View All
                </Link>
              ) : null}
            </div>
            {data.activities.map((a, i) => {
              const Icon = ACTIVITY_ICON[a.kind] ?? ActivityIcon;
              return (
                <div key={i} className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{a.label}</p>
                    <p className="truncate opacity-50">{a.detail}</p>
                  </div>
                  <p className="shrink-0 opacity-50">{a.when}</p>
                </div>
              );
            })}
          </Card>
          ) : null}

          {show("upcoming-visits") ? (
          <Card className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-body font-bold">
                Upcoming Visits
              </CardTitle>
              {can(user.role, "crf.enter") ? (
                <Link href="/visits" className="font-medium text-primary">
                  View All
                </Link>
              ) : null}
            </div>
            {data.upcoming.map((v) => (
              <div key={v.id} className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-danger/10 text-danger">
                  <Calendar className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {v.subjectCode} · {v.name}
                  </p>
                  <p className="truncate opacity-50">
                    {v.date} | {v.site}
                  </p>
                </div>
                <Badge tone={v.overdue ? "danger" : "success"}>{v.chip}</Badge>
              </div>
            ))}
          </Card>
          ) : null}

          {show("insights") ? (
          <Card className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-body font-bold">AI Insights</CardTitle>
              <Badge tone="success">New</Badge>
            </div>
            {data.insights.map((ins) => {
              const Icon = INSIGHT_ICON[ins.tone];
              const tones = {
                danger: "bg-danger/10 text-danger",
                success: "bg-success/10 text-success",
                info: "bg-info/10 text-info",
                warning: "bg-warning/10 text-warning",
              } as const;
              return (
                <div key={ins.title} className="flex items-start gap-3">
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${tones[ins.tone]}`}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="font-medium">{ins.title}</p>
                    <p className="opacity-60">{ins.detail}</p>
                  </div>
                </div>
              );
            })}
          </Card>
          ) : null}
        </div>

        {show("audit-shortcut") ? (
          <Link href="/audit">
            <Card className="flex flex-wrap items-center justify-between gap-3 transition-transform duration-200 hover:-translate-y-[2px]">
              <div>
                <CardTitle className="text-body font-bold">
                  Audit trail — full provenance
                </CardTitle>
                <p className="mt-1 opacity-70">
                  Immutable, time-stamped record of every action (ALCOA+),
                  filterable by actor, entity, and action.
                </p>
              </div>
              <Badge tone="info">open browser →</Badge>
            </Card>
          </Link>
        ) : null}

        {/* quote banner */}
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-primary-soft px-6 py-4">
          <div>
            <p className="font-bold italic">
              “Bridging Ancient Wisdom with Modern Science”
            </p>
            <p className="mt-0.5 opacity-60">Evidence | Safety | Better Lives</p>
          </div>
          <div className="flex items-center gap-5">
            {[
              { icon: Sparkles, label: "AI-Powered" },
              { icon: BadgeCheck, label: "Standardized" },
              { icon: ShieldCheck, label: "Compliant" },
            ].map(({ icon: Icon, label }) => (
              <span key={label} className="flex flex-col items-center gap-1 opacity-70">
                <Icon className="h-5 w-5 text-primary-deep" />
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* right rail — AI Assistant */}
      {show("assistant") ? (
        <AssistantPanel
          visits={data.visitOptions}
          canUseCopilot={can(user.role, "copilot.use")}
        />
      ) : null}
    </div>
  );
}
