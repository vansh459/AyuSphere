import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq, inArray } from "drizzle-orm";
import { requireActor, withError } from "@/lib/actor";
import { fmtDate } from "@/lib/dates";
import { getDb } from "@/db";
import { alerts, trials } from "@/db/schema";
import { sitePerformance } from "@/services/kpi";
import { runDataQualityChecks } from "@/services/data-quality";
import {
  completeMonitoringVisit,
  listActiveTrialSites,
  listMonitoringVisits,
  scheduleMonitoringVisit,
} from "@/services/monitoring";
import {
  closeQuery,
  listQueries,
  listQueryableEntries,
  queryStats,
  raiseQuery,
} from "@/services/data-queries";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import {
  DbErrorState,
  ErrorBanner,
  PageHeader,
  ProgressBar,
} from "@/components/app/shared";

export default async function MonitoringPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireActor("monitoring.log");
  const sp = await props.searchParams;

  let dbError = false;
  let perfByTrial: {
    protocolCode: string;
    title: string;
    perf: Awaited<ReturnType<typeof sitePerformance>>;
    findings: Awaited<ReturnType<typeof runDataQualityChecks>>;
  }[] = [];
  let deviationAlerts: (typeof alerts.$inferSelect)[] = [];
  let monitoringRows: Awaited<ReturnType<typeof listMonitoringVisits>> = [];
  let siteOptions: Awaited<ReturnType<typeof listActiveTrialSites>> = [];
  let queries: Awaited<ReturnType<typeof listQueries>> = [];
  let entryOptions: Awaited<ReturnType<typeof listQueryableEntries>> = [];
  let stats: Awaited<ReturnType<typeof queryStats>> | null = null;
  try {
    const db = getDb();
    const activeTrials = await db
      .select()
      .from(trials)
      .where(inArray(trials.status, ["active", "enrolment_closed", "followup"]));
    perfByTrial = await Promise.all(
      activeTrials.map(async (t) => ({
        protocolCode: t.protocolCode,
        title: t.title,
        perf: await sitePerformance(db, t.id),
        findings: await runDataQualityChecks(db, t.id),
      })),
    );
    deviationAlerts = await db
      .select()
      .from(alerts)
      .where(
        inArray(alerts.ruleKey, [
          "protocol_deviation",
          "visit_overdue",
          "data_quality",
          "monitoring_overdue",
        ]),
      )
      .orderBy(alerts.createdAt);
    deviationAlerts = deviationAlerts.filter((a) => a.status === "open");
    monitoringRows = await listMonitoringVisits(db);
    siteOptions = await listActiveTrialSites(db);
    queries = await listQueries(db);
    entryOptions = await listQueryableEntries(db);
    stats = await queryStats(db);
  } catch {
    dbError = true;
  }

  async function schedule(formData: FormData) {
    "use server";
    const actor = await requireActor("monitoring.log");
    try {
      await scheduleMonitoringVisit(getDb(), actor, {
        trialSiteId: String(formData.get("trialSiteId")),
        scheduledDate: new Date(String(formData.get("scheduledDate"))),
      });
    } catch (e) {
      redirect(withError("/monitoring", e));
    }
    revalidatePath("/monitoring");
    redirect("/monitoring");
  }

  async function raise(formData: FormData) {
    "use server";
    const actor = await requireActor("query.manage");
    try {
      await raiseQuery(getDb(), actor, {
        crfEntryId: String(formData.get("crfEntryId")),
        question: String(formData.get("question") ?? ""),
      });
    } catch (e) {
      redirect(withError("/monitoring", e));
    }
    revalidatePath("/monitoring");
    redirect("/monitoring");
  }

  async function close(formData: FormData) {
    "use server";
    const actor = await requireActor("query.manage");
    try {
      await closeQuery(
        getDb(),
        actor,
        String(formData.get("queryId")),
        String(formData.get("note") ?? "").trim() || undefined,
      );
    } catch (e) {
      redirect(withError("/monitoring", e));
    }
    revalidatePath("/monitoring");
    redirect("/monitoring");
  }

  async function complete(formData: FormData) {
    "use server";
    const actor = await requireActor("monitoring.log");
    try {
      const findings = String(formData.get("findings") ?? "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      await completeMonitoringVisit(getDb(), actor, {
        visitId: String(formData.get("visitId")),
        summary: String(formData.get("summary") ?? ""),
        findings,
      });
    } catch (e) {
      redirect(withError("/monitoring", e));
    }
    revalidatePath("/monitoring");
    redirect("/monitoring");
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Monitoring"
        subtitle="Monitoring visits, site performance, protocol deviations, and data-quality findings across active trials."
      />
      <ErrorBanner message={typeof sp.error === "string" ? sp.error : undefined} />

      {dbError ? (
        <DbErrorState />
      ) : (
        <>
          <Card className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="text-body font-bold">
                Monitoring visits
              </CardTitle>
              <Badge tone="info">completing advances the site&apos;s due date</Badge>
            </div>
            <form
              action={schedule}
              className="grid grid-cols-1 items-end gap-3 md:grid-cols-3"
            >
              <div className="flex flex-col gap-2">
                <Label htmlFor="trialSiteId">Trial site</Label>
                <select
                  id="trialSiteId"
                  name="trialSiteId"
                  required
                  className="h-10 rounded-[0.875rem] border border-line bg-surface px-3 text-body outline-none focus:border-primary"
                >
                  {siteOptions.map((s) => (
                    <option key={s.trialSiteId} value={s.trialSiteId}>
                      {s.protocolCode} · {s.siteName}
                      {s.monitoringVisitDue
                        ? ` (due ${fmtDate(s.monitoringVisitDue)})`
                        : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="scheduledDate">Visit date</Label>
                <Input id="scheduledDate" name="scheduledDate" type="date" required />
              </div>
              <Button type="submit">Schedule monitoring visit</Button>
            </form>

            {monitoringRows.length === 0 ? (
              <p className="opacity-70">
                No monitoring visits yet — schedule the first one above.
              </p>
            ) : (
              monitoringRows.map(({ visit, protocolCode, siteName }) => (
                <div
                  key={visit.id}
                  className="flex flex-col gap-2 border-t border-line pt-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={visit.completedAt ? "success" : "warning"}>
                      {visit.completedAt ? "completed" : "scheduled"}
                    </Badge>
                    <p className="font-medium">
                      {protocolCode} · {siteName}
                    </p>
                    <span className="opacity-50">
                      scheduled {fmtDate(visit.scheduledDate)}
                      {visit.completedAt
                        ? ` · completed ${fmtDate(visit.completedAt)}`
                        : ""}
                    </span>
                  </div>
                  {visit.completedAt ? (
                    <>
                      {visit.summary ? (
                        <p className="opacity-70">{visit.summary}</p>
                      ) : null}
                      {(visit.findings as string[]).map((f, i) => (
                        <p key={i} className="opacity-70">
                          · {f}
                        </p>
                      ))}
                    </>
                  ) : (
                    <form
                      action={complete}
                      className="grid grid-cols-1 items-end gap-3 md:grid-cols-3"
                    >
                      <input type="hidden" name="visitId" value={visit.id} />
                      <div className="flex flex-col gap-2">
                        <Label htmlFor={`summary-${visit.id}`}>Summary</Label>
                        <Input
                          id={`summary-${visit.id}`}
                          name="summary"
                          required
                          minLength={3}
                          placeholder="What was reviewed on site"
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label htmlFor={`findings-${visit.id}`}>
                          Findings (one per line)
                        </Label>
                        <textarea
                          id={`findings-${visit.id}`}
                          name="findings"
                          rows={2}
                          className="rounded-[0.875rem] border border-line bg-surface px-3 py-2 text-body outline-none focus:border-primary"
                          placeholder="e.g. 2 consent forms missing version number"
                        />
                      </div>
                      <Button size="sm" type="submit">
                        Complete visit
                      </Button>
                    </form>
                  )}
                </div>
              ))
            )}
            <p className="opacity-50">
              Monitoring reports can be uploaded under Documents (kind
              &ldquo;monitoring report&rdquo;) and referenced from the visit
              record.
            </p>
          </Card>

          <Card className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="text-body font-bold">
                Data queries
              </CardTitle>
              {stats ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={stats.open > 0 ? "warning" : "success"}>
                    {stats.open} open
                  </Badge>
                  <Badge tone="info">{stats.answered} answered</Badge>
                  <Badge tone="neutral">{stats.closed} closed</Badge>
                  {stats.medianCycleDays !== null ? (
                    <span className="opacity-50">
                      median cycle {stats.medianCycleDays}d
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
            <p className="opacity-70">
              An open query blocks the entry&apos;s approval until the
              data-entry team answers; you close it once resolved.
            </p>
            <form
              action={raise}
              className="grid grid-cols-1 items-end gap-3 md:grid-cols-3"
            >
              <div className="flex flex-col gap-2">
                <Label htmlFor="crfEntryId">CRF entry</Label>
                <select
                  id="crfEntryId"
                  name="crfEntryId"
                  required
                  className="h-10 rounded-[0.875rem] border border-line bg-surface px-3 text-body outline-none focus:border-primary"
                >
                  {entryOptions.map((e) => (
                    <option key={e.entryId} value={e.entryId}>
                      {e.subjectCode} · {e.visitName} · {e.status}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="question">Query</Label>
                <Input
                  id="question"
                  name="question"
                  required
                  minLength={5}
                  placeholder="e.g. SBP 128 conflicts with the source note — please verify"
                />
              </div>
              <Button type="submit">Raise query</Button>
            </form>

            {queries.length === 0 ? (
              <p className="opacity-70">No data queries yet.</p>
            ) : (
              queries.map(({ query, subjectCode, visitName }) => (
                <div
                  key={query.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        tone={
                          query.status === "open"
                            ? "warning"
                            : query.status === "answered"
                              ? "info"
                              : "success"
                        }
                      >
                        {query.status}
                      </Badge>
                      <p className="font-medium">{query.question}</p>
                    </div>
                    <p className="mt-1 opacity-50">
                      {subjectCode} · {visitName} ·{" "}
                      {fmtDate(query.createdAt)}
                    </p>
                  </div>
                  {query.status !== "closed" ? (
                    <form action={close} className="flex items-end gap-2">
                      <input type="hidden" name="queryId" value={query.id} />
                      <Input
                        name="note"
                        placeholder="resolution note (optional)"
                        className="w-52"
                      />
                      <Button size="sm" variant="outline" type="submit">
                        Close query
                      </Button>
                    </form>
                  ) : null}
                </div>
              ))
            )}
          </Card>

          {perfByTrial.map((t) => (
            <Card key={t.protocolCode} className="flex flex-col gap-4">
              <CardTitle className="text-body font-bold">
                {t.protocolCode} — {t.title}
              </CardTitle>
              {t.perf.map((s) => (
                <div
                  key={s.trialSiteId}
                  className="flex flex-wrap items-center justify-between gap-3"
                >
                  <p className="font-medium">{s.siteName}</p>
                  <div className="flex items-center gap-3">
                    <span className="opacity-70">
                      {s.enrolled}/{s.target}
                    </span>
                    <ProgressBar value={s.rate} />
                  </div>
                </div>
              ))}
              {t.findings.length > 0 ? (
                <div className="flex flex-col gap-2 border-t border-line pt-3">
                  <p className="microlabel">
                    Data-quality findings ({t.findings.length})
                  </p>
                  {t.findings.map((f, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Badge tone="warning">{f.kind.replaceAll("_", " ")}</Badge>
                      <p className="opacity-70">{f.message}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="border-t border-line pt-3 text-success">
                  No open data-quality findings.
                </p>
              )}
            </Card>
          ))}

          <Card className="flex flex-col gap-3">
            <CardTitle className="text-body font-bold">
              Open deviation & visit alerts ({deviationAlerts.length})
            </CardTitle>
            {deviationAlerts.length === 0 ? (
              <p className="opacity-70">Nothing open.</p>
            ) : (
              deviationAlerts.map((a) => (
                <div key={a.id} className="flex items-center gap-3">
                  <Badge tone={a.severity === "danger" ? "danger" : "warning"}>
                    {a.ruleKey.replaceAll("_", " ")}
                  </Badge>
                  <p className="opacity-70">{a.message}</p>
                </div>
              ))
            )}
          </Card>
        </>
      )}
    </div>
  );
}
