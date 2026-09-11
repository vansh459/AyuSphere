import Link from "next/link";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getDb } from "@/db";
import { portfolioKpis } from "@/services/kpi";
import { Card } from "@/components/ui/card";
import { DbErrorState } from "@/components/app/shared";

type Kpis = Awaited<ReturnType<typeof portfolioKpis>>;

const KPI_TILES: {
  key: keyof Kpis;
  label: string;
  href: string;
  danger?: boolean;
}[] = [
  { key: "activeTrials", label: "Active Trials", href: "/trials" },
  { key: "enrolledParticipants", label: "Enrolled Participants", href: "/participants" },
  { key: "sites", label: "Sites", href: "/sites" },
  { key: "openVisits", label: "Open Visits", href: "/visits" },
  { key: "overdueVisits", label: "Overdue Visits", href: "/visits", danger: true },
  { key: "openAdverseEvents", label: "Open AE / SAE", href: "/adverse-events", danger: true },
  { key: "openAlerts", label: "Open Alerts", href: "/alerts", danger: true },
  { key: "withdrawnParticipants", label: "Withdrawn", href: "/participants" },
];

const ROLE_SHORTCUTS: Record<string, { title: string; hint: string; href: string }[]> = {
  pi: [
    { title: "Clinical Trials", hint: "Lifecycle, sites and enrolment for your studies", href: "/trials" },
    { title: "Doctor Note Intelligence", hint: "Scan a note → reviewed CRF draft", href: "/doctor-note" },
    { title: "Adverse Events", hint: "Escalation clocks on open AE/SAE", href: "/adverse-events" },
  ],
  coordinator: [
    { title: "Visit Schedule", hint: "Due and overdue visits with CRF capture", href: "/visits" },
    { title: "Participants", hint: "Screening, consent, enrolment", href: "/participants" },
    { title: "Clinical Trials", hint: "Milestones incl. CTRI dues", href: "/trials" },
  ],
  monitor: [
    { title: "Monitoring", hint: "Site performance, deviations, data quality", href: "/monitoring" },
    { title: "Alerts", hint: "Open findings to verify", href: "/alerts" },
  ],
  ethics: [
    { title: "Ethics Review", hint: "Trials awaiting IEC decision", href: "/ethics" },
  ],
  pv: [
    { title: "Adverse Events", hint: "Sorted by reporting deadline", href: "/adverse-events" },
    { title: "Alerts", hint: "Breached and approaching deadlines", href: "/alerts" },
    { title: "Exports", hint: "SDTM AE domain, FHIR bundle", href: "/exports" },
  ],
  admin: [
    { title: "Alerts", hint: "Everything open, portfolio-wide", href: "/alerts" },
    { title: "Audit Trail", hint: "Immutable event history", href: "/audit" },
    { title: "Settings", hint: "Users and roles", href: "/settings" },
  ],
  regulator: [
    { title: "Audit Trail", hint: "Complete, read-only, filterable", href: "/audit" },
  ],
};

export default async function DashboardPage() {
  const session = await auth();
  const role = session!.user.role;

  let kpis: Kpis | null = null;
  let dbError = false;
  try {
    kpis = await portfolioKpis(getDb());
  } catch {
    dbError = true;
  }

  const shortcuts = (ROLE_SHORTCUTS[role] ?? []).filter(Boolean);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-heading font-bold">
          Welcome, {session!.user.name}
        </h1>
        <p className="mt-1 opacity-70">
          Real-time view of the Ayurveda clinical-research portfolio.
        </p>
      </div>

      {dbError ? (
        <DbErrorState />
      ) : kpis ? (
        <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
          {KPI_TILES.map((t) => {
            const value = kpis[t.key] as number;
            const inner = (
              <Card className="transition-transform duration-200 hover:-translate-y-[2px]">
                <p className="microlabel">{t.label}</p>
                <p
                  className={`mt-2 text-heading font-bold ${
                    t.danger && value > 0 ? "text-danger" : ""
                  }`}
                >
                  {value}
                </p>
              </Card>
            );
            // only link where this role can actually go
            const navigable =
              (t.href === "/trials" && can(role, "trial.manage")) ||
              (t.href === "/participants" && can(role, "participant.manage")) ||
              (t.href === "/sites" && can(role, "site.manage")) ||
              (t.href === "/visits" && can(role, "crf.enter")) ||
              (t.href === "/adverse-events" &&
                (can(role, "ae.capture") || can(role, "ae.review"))) ||
              (t.href === "/alerts" && can(role, "alert.acknowledge"));
            return navigable ? (
              <Link key={t.label} href={t.href}>
                {inner}
              </Link>
            ) : (
              <div key={t.label}>{inner}</div>
            );
          })}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
        {shortcuts.map((s) => (
          <Link key={s.href + s.title} href={s.href}>
            <Card className="h-full transition-transform duration-200 hover:-translate-y-[2px]">
              <p className="font-bold">{s.title}</p>
              <p className="mt-1 opacity-70">{s.hint}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
