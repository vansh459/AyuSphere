/**
 * DSMB / leadership aggregate safety summary (T8.1) — printable artifact:
 * flagged signals, portfolio timeliness, and open SAE clocks in one page.
 */
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getDb } from "@/db";
import {
  SIGNAL_MIN_COUNT,
  SIGNAL_RATIO_THRESHOLD,
  safetySignals,
  timelinessStats,
} from "@/services/safety-signals";
import { openAesByDeadline } from "@/services/kpi";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PrintButton } from "@/components/app/print-button";
import { BackLink, DbErrorState, PageHeader } from "@/components/app/shared";

export default async function DsmbSummaryPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const role = session.user.role;
  if (!can(role, "ae.review") && !can(role, "audit.view")) {
    redirect("/dashboard");
  }

  let signals: Awaited<ReturnType<typeof safetySignals>> = [];
  let stats: Awaited<ReturnType<typeof timelinessStats>> | null = null;
  let openSaes: Awaited<ReturnType<typeof openAesByDeadline>> = [];
  let dbError = false;
  try {
    const db = getDb();
    signals = await safetySignals(db);
    stats = await timelinessStats(db);
    openSaes = (await openAesByDeadline(db)).filter(
      ({ ae }) => ae.seriousness === "sae",
    );
  } catch {
    dbError = true;
  }
  const flagged = signals.filter((s) => s.flagged);

  return (
    <div className="flex flex-col gap-6">
      <div className="print:hidden">
        <BackLink href="/adverse-events" label="Adverse Events" />
      </div>
      <PageHeader
        title="DSMB Safety Summary"
        subtitle={`Aggregate portfolio safety for the Data Safety Monitoring Board and institutional leadership · generated ${new Date().toLocaleString("en-IN")}`}
        action={<PrintButton label="Print DSMB summary" />}
      />
      <p className="opacity-70">
        Signal flags are rule-based decision support (≥{SIGNAL_MIN_COUNT}{" "}
        events and ≥{SIGNAL_RATIO_THRESHOLD}× the portfolio share) — for human
        review, never confirmed causality.
      </p>

      {dbError ? (
        <DbErrorState />
      ) : (
        <>
          {stats ? (
            <Card className="flex flex-wrap items-center gap-6">
              {[
                ["Total AEs", String(stats.total)],
                ["Reported", String(stats.reported)],
                [
                  "Reported on time",
                  `${stats.reportedOnTime} (${Math.round(stats.onTimeRate * 100)}%)`,
                ],
                ["Reported late", String(stats.reportedLate)],
                ["Open past deadline", String(stats.openOverdue)],
                ["Flagged signals", String(flagged.length)],
              ].map(([label, value]) => (
                <div key={label} className="flex flex-col">
                  <span className="microlabel">{label}</span>
                  <span className="text-heading font-bold">{value}</span>
                </div>
              ))}
            </Card>
          ) : null}

          <Card className="flex flex-col gap-3 overflow-x-auto">
            <CardTitle className="text-body font-bold">
              Safety signals by term × trial ({signals.length})
            </CardTitle>
            {signals.length === 0 ? (
              <p className="opacity-70">No adverse events recorded yet.</p>
            ) : (
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-line">
                    {["Term", "SOC", "Trial", "Sites", "n", "SAE", "Ratio", "Flag"].map(
                      (h) => (
                        <th key={h} className="microlabel px-3 py-2">
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {signals.map((s) => (
                    <tr
                      key={`${s.trialId}-${s.termKey}`}
                      className="border-b border-line align-top"
                    >
                      <td className="px-3 py-2 font-medium">{s.termLabel}</td>
                      <td className="px-3 py-2 opacity-70">{s.soc ?? "—"}</td>
                      <td className="px-3 py-2 opacity-70">{s.protocolCode}</td>
                      <td className="px-3 py-2 opacity-70">{s.siteBreakdown}</td>
                      <td className="px-3 py-2">
                        {s.count}/{s.trialTotal}
                      </td>
                      <td className="px-3 py-2">{s.saeCount}</td>
                      <td className="px-3 py-2">{s.ratio.toFixed(2)}×</td>
                      <td className="px-3 py-2">
                        {s.flagged ? (
                          <Badge tone="danger">signal</Badge>
                        ) : (
                          <span className="opacity-40">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card className="flex flex-col gap-3">
            <CardTitle className="text-body font-bold">
              Open SAEs by reporting deadline ({openSaes.length})
            </CardTitle>
            {openSaes.length === 0 ? (
              <p className="opacity-70">No open SAEs.</p>
            ) : (
              openSaes.map(({ ae, subjectCode }) => (
                <div
                  key={ae.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-2 last:border-0 last:pb-0"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{ae.term}</p>
                    <Badge tone="danger">SAE</Badge>
                    <span className="opacity-50">{subjectCode}</span>
                  </div>
                  <p className="opacity-70">
                    deadline {ae.reportingDeadline.toLocaleString("en-IN")}
                  </p>
                </div>
              ))
            )}
          </Card>
        </>
      )}
    </div>
  );
}
