/**
 * Printable CIOMS-style SAE/AE regulatory report (T8.2) — representative
 * demo layout. Viewable read-only (incl. regulator); generation is the
 * audited step on the AE list.
 */
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getDb } from "@/db";
import { AeReportError, assembleAeReport } from "@/services/ae-report";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PrintButton } from "@/components/app/print-button";
import { BackLink, PageHeader } from "@/components/app/shared";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="microlabel">{label}</span>
      <span className="font-medium">{value ?? "—"}</span>
    </div>
  );
}

const ACTION_LABEL: Record<string, string> = {
  captured: "Event captured — escalation clock started",
  review_started: "Pharmacovigilance review started",
  reported: "Reported to regulatory authority",
  closed: "Case closed",
};

export default async function AeReportPage(props: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const role = session.user.role;
  // read-only view: PV, capture roles, and audit viewers (admin + regulator)
  if (
    !can(role, "ae.review") &&
    !can(role, "ae.capture") &&
    !can(role, "audit.view")
  ) {
    redirect("/dashboard");
  }
  const { id } = await props.params;

  let report;
  try {
    report = await assembleAeReport(getDb(), id);
  } catch (e) {
    if (e instanceof AeReportError) notFound();
    throw e;
  }
  const { ae } = report;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div className="print:hidden">
        <BackLink href="/adverse-events" label="Adverse Events" />
      </div>
      <PageHeader
        title={`${ae.seriousness === "sae" ? "Serious Adverse Event" : "Adverse Event"} Report`}
        subtitle={`CIOMS-style summary (representative demo layout) · generated ${new Date().toLocaleString("en-IN")} · case ${ae.id.slice(0, 8)}`}
        action={<PrintButton label="Print report" />}
      />

      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-body font-bold">
            I · Reaction information
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge tone={ae.seriousness === "sae" ? "danger" : "warning"}>
              {ae.seriousness.toUpperCase()}
            </Badge>
            <Badge tone="info">{ae.status.replace("_", " ")}</Badge>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <Field label="Subject (de-identified)" value={report.subjectCode} />
          <Field label="Onset date" value={ae.onsetDate.toLocaleDateString("en-IN")} />
          <Field label="Severity" value={ae.severity} />
          <Field label="Verbatim term" value={ae.term} />
          <Field
            label="MedDRA PT (demo subset)"
            value={
              report.meddra
                ? `${report.meddra.pt} · ${report.meddra.code}`
                : "uncoded"
            }
          />
          <Field label="System Organ Class" value={report.meddra?.soc ?? "—"} />
          <Field label="Outcome" value={ae.outcome ?? "—"} />
          <Field label="Causality (WHO-UMC style)" value={ae.causality ?? "not assessed"} />
        </div>
        {ae.narrative ? (
          <div className="flex flex-col gap-1 border-t border-line pt-3">
            <span className="microlabel">Case narrative</span>
            <p className="opacity-80">{ae.narrative}</p>
          </div>
        ) : null}
      </Card>

      <Card className="flex flex-col gap-4">
        <CardTitle className="text-body font-bold">
          II · Suspect formulation
        </CardTitle>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <Field
            label="WHODrug (demo subset)"
            value={
              report.whodrug
                ? `${report.whodrug.drugName} · ${report.whodrug.code}`
                : "not coded"
            }
          />
          <Field label="Class" value={report.whodrug?.drugClass ?? "—"} />
          <Field
            label="Trial intervention"
            value={`${report.trial.intervention}${report.trial.dosageForm ? ` (${report.trial.dosageForm})` : ""}`}
          />
        </div>
      </Card>

      <Card className="flex flex-col gap-4">
        <CardTitle className="text-body font-bold">III · Study context</CardTitle>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <Field label="Protocol" value={report.trial.protocolCode} />
          <Field label="CTRI number" value={report.trial.ctriNumber ?? "pending"} />
          <Field
            label="Site"
            value={`${report.site.name}, ${report.site.city} (${report.site.state})`}
          />
        </div>
        <p className="opacity-70">{report.trial.title}</p>
      </Card>

      <Card className="flex flex-col gap-4">
        <CardTitle className="text-body font-bold">
          IV · Regulatory timeline (NDCT-style, configurable rules)
        </CardTitle>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <Field
            label="Initial report deadline"
            value={ae.reportingDeadline.toLocaleString("en-IN")}
          />
          <Field
            label="Detailed report deadline"
            value={ae.detailedReportDeadline?.toLocaleString("en-IN") ?? "—"}
          />
          <Field
            label="Reported at"
            value={ae.reportedAt?.toLocaleString("en-IN") ?? "not yet reported"}
          />
          <Field
            label="Deadline compliance"
            value={
              report.onTime === null ? (
                <Badge tone="warning">pending</Badge>
              ) : report.onTime ? (
                <Badge tone="success">
                  on time ({Math.abs(report.deadlineDeltaHours!)}h early)
                </Badge>
              ) : (
                <Badge tone="danger">
                  late by {report.deadlineDeltaHours}h
                </Badge>
              )
            }
          />
        </div>
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <span className="microlabel">Escalation timeline (ae_actions)</span>
          {report.timeline.map((t, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <span className="opacity-50">{t.at.toLocaleString("en-IN")}</span>
              <span className="font-medium">
                {ACTION_LABEL[t.action] ?? t.action}
              </span>
              <span className="opacity-70">
                — {t.actorName} ({t.actorRole})
              </span>
              {t.note ? <span className="opacity-50">· {t.note}</span> : null}
            </div>
          ))}
        </div>
        <p className="opacity-50">
          Deadlines computed by the configurable rule table (D-023) from
          capture time; a signed reporting step (D-022) stamps
          &ldquo;reported&rdquo;. Full provenance in the audit trail.
        </p>
      </Card>
    </div>
  );
}
