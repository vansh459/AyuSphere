import Link from "next/link";
import { eq, inArray } from "drizzle-orm";
import {
  Activity as ActivityIcon,
  AlertTriangle,
  BadgeCheck,
  Calendar,
  CalendarDays,
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
import { getDb } from "@/db";
import { participants, visits } from "@/db/schema";
import {
  aiInsights,
  participantDistribution,
  recentActivities,
  sitePerformanceAggregate,
  statCards,
  trialProgressSeries,
  upcomingVisitList,
} from "@/services/dashboard";
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
  const now = new Date();

  let data: {
    stats: Awaited<ReturnType<typeof statCards>>;
    progress: Awaited<ReturnType<typeof trialProgressSeries>>;
    distribution: Awaited<ReturnType<typeof participantDistribution>>;
    sitePerf: Awaited<ReturnType<typeof sitePerformanceAggregate>>;
    activities: Awaited<ReturnType<typeof recentActivities>>;
    upcoming: Awaited<ReturnType<typeof upcomingVisitList>>;
    insights: Awaited<ReturnType<typeof aiInsights>>;
    visitOptions: VisitOption[];
  } | null = null;

  try {
    const db = getDb();
    const [stats, progress, distribution, sitePerf, activities, upcoming, insights] =
      await Promise.all([
        statCards(db),
        trialProgressSeries(db),
        participantDistribution(db),
        sitePerformanceAggregate(db),
        recentActivities(db),
        upcomingVisitList(db),
        aiInsights(db),
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
        .limit(30);
      visitOptions = openVisits.map((v) => ({
        id: v.id,
        label: `${v.subjectCode} · ${v.name}`,
      }));
    }
    data = { stats, progress, distribution, sitePerf, activities, upcoming, insights, visitOptions };
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
          <div className="clay flex items-center gap-3 px-4 py-2.5">
            <CalendarDays className="h-5 w-5 text-primary" />
            <div>
              <p className="font-bold leading-tight">
                {now.toLocaleDateString("en-IN", {
                  weekday: "long",
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                })}
              </p>
              <p className="leading-tight opacity-50">
                {now.toLocaleTimeString("en-IN", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
          </div>
        </div>

        {/* stat cards */}
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

        {/* charts row */}
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Card className="flex flex-col gap-3 xl:col-span-1">
            <CardTitle className="text-body font-bold">Trial Progress</CardTitle>
            <TrialProgressChart data={data.progress} />
          </Card>
          <Card className="flex flex-col gap-3 xl:col-span-1">
            <CardTitle className="text-body font-bold">
              Participant Distribution
            </CardTitle>
            <ParticipantDonut
              total={data.distribution.total}
              slices={data.distribution.slices}
            />
          </Card>
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
        </div>

        {/* feeds row */}
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
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
        </div>

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
      {can(user.role, "crf.enter") || can(user.role, "copilot.use") ? (
        <AssistantPanel
          visits={data.visitOptions}
          canUseCopilot={can(user.role, "copilot.use")}
        />
      ) : null}
    </div>
  );
}
