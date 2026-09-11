import { eq, inArray } from "drizzle-orm";
import { requireActor } from "@/lib/actor";
import { getDb } from "@/db";
import { alerts, trials } from "@/db/schema";
import { sitePerformance } from "@/services/kpi";
import { runDataQualityChecks } from "@/services/data-quality";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DbErrorState,
  PageHeader,
  ProgressBar,
} from "@/components/app/shared";

export default async function MonitoringPage() {
  await requireActor("monitoring.log");

  let dbError = false;
  let perfByTrial: {
    protocolCode: string;
    title: string;
    perf: Awaited<ReturnType<typeof sitePerformance>>;
    findings: Awaited<ReturnType<typeof runDataQualityChecks>>;
  }[] = [];
  let deviationAlerts: (typeof alerts.$inferSelect)[] = [];
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
        inArray(alerts.ruleKey, ["protocol_deviation", "visit_overdue", "data_quality"]),
      )
      .orderBy(alerts.createdAt);
    deviationAlerts = deviationAlerts.filter((a) => a.status === "open");
  } catch {
    dbError = true;
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Monitoring"
        subtitle="Site performance, protocol deviations, and data-quality findings across active trials."
      />

      {dbError ? (
        <DbErrorState />
      ) : (
        <>
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
