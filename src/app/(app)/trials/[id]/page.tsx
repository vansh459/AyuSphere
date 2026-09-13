import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { requireActor, withError } from "@/lib/actor";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getDb } from "@/db";
import { documents, milestones, trials } from "@/db/schema";
import { transitionTrial } from "@/services/trials";
import { listAmendments, submitAmendment } from "@/services/amendments";
import { consentRegister } from "@/services/participants";
import {
  sitePerformance,
  trialEnrolment,
  visitCompliance,
} from "@/services/kpi";
import { analyzeRecruitment } from "@/lib/rules/recruitment";
import { fmtDate } from "@/lib/dates";
import type { TrialStatus } from "@/lib/rules/lifecycle";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { DocPreview } from "@/components/app/doc-preview";
import {
  BackLink,
  ErrorBanner,
  PageHeader,
  ProgressBar,
  StatusBadge,
} from "@/components/app/shared";

const NEXT_ACTIONS: Partial<
  Record<TrialStatus, { to: TrialStatus; label: string; needsCtri?: boolean }[]>
> = {
  draft: [{ to: "iec_review", label: "Submit for ethics review" }],
  iec_approved: [
    { to: "ctri_registered", label: "Record CTRI registration", needsCtri: true },
  ],
  ctri_registered: [{ to: "active", label: "Activate trial" }],
  active: [{ to: "enrolment_closed", label: "Close enrolment" }],
  enrolment_closed: [{ to: "followup", label: "Move to follow-up" }],
  followup: [{ to: "closeout", label: "Close out trial" }],
};

export default async function TrialDetailPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const role = session.user.role;
  if (!can(role, "trial.manage") && !can(role, "trial.ethicsReview")) {
    redirect("/dashboard");
  }
  const { id } = await props.params;
  const sp = await props.searchParams;

  const db = getDb();
  const [trial] = await db.select().from(trials).where(eq(trials.id, id)).limit(1);
  if (!trial) notFound();

  const [ms, docs, enrolment, perf, compliance, trialAmendments, consents] =
    await Promise.all([
      db.select().from(milestones).where(eq(milestones.trialId, id)),
      db.select().from(documents).where(eq(documents.trialId, id)),
      trialEnrolment(db, id),
      sitePerformance(db, id),
      visitCompliance(db, id),
      listAmendments(db, id),
      consentRegister(db, id),
    ]);
  const consented = consents.filter((c) => c.consentStatus === "given");
  const reconsentDue = consents.filter((c) => c.reconsentDue);
  const hasProtocolDoc = docs.some((d) => d.kind === "protocol");
  const status = trial.status as TrialStatus;
  const actions = (NEXT_ACTIONS[status] ?? []).filter(() =>
    can(role, "trial.manage"),
  );

  async function submitAmendmentAction(formData: FormData) {
    "use server";
    const actor = await requireActor("trial.manage");
    try {
      await submitAmendment(getDb(), actor, {
        trialId: id,
        summary: String(formData.get("summary") ?? ""),
      });
    } catch (e) {
      redirect(withError(`/trials/${id}`, e));
    }
    revalidatePath(`/trials/${id}`);
    revalidatePath("/ethics");
    redirect(`/trials/${id}`);
  }

  async function transition(formData: FormData) {
    "use server";
    const actor = await requireActor();
    const to = String(formData.get("to")) as TrialStatus;
    const ctriNumber = String(formData.get("ctriNumber") ?? "").trim();
    try {
      await transitionTrial(getDb(), actor, id, to, ctriNumber ? { ctriNumber } : undefined);
    } catch (e) {
      redirect(withError(`/trials/${id}`, e));
    }
    revalidatePath("/trials");
    revalidatePath(`/trials/${id}`);
    redirect(`/trials/${id}`);
  }

  return (
    <div className="flex flex-col gap-6">
      <BackLink href="/trials" label="Clinical Trials" />
      <PageHeader
        title={`${trial.protocolCode} — ${trial.title}`}
        subtitle={`${trial.intervention}${trial.dosageForm ? ` (${trial.dosageForm})` : ""} · ${trial.studyType}${trial.phase ? ` · Phase ${trial.phase}` : ""}`}
        action={<StatusBadge status={trial.status} />}
      />
      <ErrorBanner message={typeof sp.error === "string" ? sp.error : undefined} />

      {/* lifecycle actions */}
      {(actions.length > 0 || status === "iec_review") && (
        <Card className="flex flex-col gap-4">
          <CardTitle className="text-body font-bold">Lifecycle</CardTitle>
          {status === "draft" && !hasProtocolDoc ? (
            <p className="text-warning">
              Upload a protocol document first (Documents page) — ethics
              submission is gated on it.
            </p>
          ) : null}
          {status === "iec_review" ? (
            can(role, "trial.ethicsReview") ? (
              <div className="flex gap-3">
                <form action={transition}>
                  <input type="hidden" name="to" value="iec_approved" />
                  <Button type="submit">Approve (IEC)</Button>
                </form>
                <form action={transition}>
                  <input type="hidden" name="to" value="draft" />
                  <Button variant="outline" type="submit">
                    Return with comments
                  </Button>
                </form>
              </div>
            ) : (
              <p className="opacity-70">
                Awaiting Ethics Committee review — only the ethics role can
                approve or return.
              </p>
            )
          ) : null}
          {actions.map((a) => (
            <form key={a.to} action={transition} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="to" value={a.to} />
              {a.needsCtri ? (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="ctriNumber">CTRI number</Label>
                  <Input id="ctriNumber" name="ctriNumber" placeholder="CTRI/2026/09/012345" required className="w-64" />
                </div>
              ) : null}
              <Button type="submit">{a.label}</Button>
            </form>
          ))}
          {status === "closeout" ? (
            <p className="opacity-70">Trial closed out — read-only archive.</p>
          ) : null}
        </Card>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <Card>
          <p className="microlabel">Enrolment</p>
          <p className="mt-2 text-heading font-bold">
            {enrolment.enrolled}/{enrolment.target}
          </p>
          <div className="mt-2">
            <ProgressBar value={enrolment.progress} />
          </div>
        </Card>
        <Card>
          <p className="microlabel">Dropout rate</p>
          <p className="mt-2 text-heading font-bold">
            {(enrolment.dropoutRate * 100).toFixed(1)}%
          </p>
          <p className="mt-2 opacity-50">{enrolment.withdrawn} withdrawn</p>
        </Card>
        <Card>
          <p className="microlabel">Visit compliance</p>
          <p className="mt-2 text-heading font-bold">
            {(compliance.complianceRate * 100).toFixed(0)}%
          </p>
          <p className="mt-2 opacity-50">
            {compliance.completed} done · {compliance.overdue} overdue ·{" "}
            {compliance.missed} missed
          </p>
        </Card>
      </div>

      {/* site performance + recruitment risk */}
      <Card className="flex flex-col gap-4">
        <CardTitle className="text-body font-bold">Site performance</CardTitle>
        {perf.length === 0 ? (
          <p className="opacity-70">
            No sites attached yet — attach and activate sites on the Sites page.
          </p>
        ) : (
          perf.map((s) => {
            const risk = analyzeRecruitment({
              enrolled: s.enrolled,
              target: s.target,
              activatedAt: trial.plannedStart ?? trial.createdAt,
            });
            return (
              <div key={s.trialSiteId} className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <p className="font-medium">{s.siteName}</p>
                  <Badge
                    tone={
                      risk.band === "on_track"
                        ? "success"
                        : risk.band === "at_risk"
                          ? "warning"
                          : "danger"
                    }
                  >
                    {risk.band.replaceAll("_", " ")}
                  </Badge>
                </div>
                <div className="flex items-center gap-3">
                  <span className="opacity-70">
                    {s.enrolled}/{s.target}
                  </span>
                  <ProgressBar value={s.rate} />
                </div>
              </div>
            );
          })
        )}
      </Card>

      {/* milestones + documents */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card className="flex flex-col gap-3">
          <CardTitle className="text-body font-bold">Milestones</CardTitle>
          {ms.map((m) => (
            <div key={m.id} className="flex items-center justify-between gap-3">
              <p className="opacity-70">{m.kind.replaceAll("_", " ")}</p>
              {m.completedAt ? (
                <Badge tone="success">
                  done · {fmtDate(m.completedAt)}
                </Badge>
              ) : m.dueDate ? (
                <Badge tone="warning">
                  due {fmtDate(m.dueDate)}
                </Badge>
              ) : (
                <Badge>pending</Badge>
              )}
            </div>
          ))}
        </Card>
        <Card className="flex flex-col gap-3">
          <CardTitle className="text-body font-bold">Documents</CardTitle>
          {docs.length === 0 ? (
            <p className="opacity-70">No documents uploaded.</p>
          ) : (
            docs.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-3">
                <p className="opacity-70">
                  {d.title}{" "}
                  <span className="opacity-50">
                    v{d.version} · {d.kind.replaceAll("_", " ")}
                  </span>
                </p>
                <DocPreview url={d.blobUrl} name={d.title} />
              </div>
            ))
          )}
          <Link href={`/documents?trial=${id}`} className="font-medium text-primary">
            Manage documents →
          </Link>
        </Card>
      </div>

      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-body font-bold">
            Consent register (T10.4)
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge tone="success">{consented.length} consented</Badge>
            {reconsentDue.length > 0 ? (
              <Badge tone="warning">{reconsentDue.length} re-consent due</Badge>
            ) : null}
          </div>
        </div>
        <p className="opacity-70">
          Consent is bound to the consent-form version signed; uploading a new
          consent-form version flags everyone consented on older versions.
        </p>
        {consents.length === 0 ? (
          <p className="opacity-70">No participants yet.</p>
        ) : (
          consents.slice(0, 20).map((c) => (
            <div
              key={c.participantId}
              className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{c.subjectCode}</p>
                <Badge tone={c.consentStatus === "given" ? "success" : "neutral"}>
                  consent {c.consentStatus.replaceAll("_", " ")}
                </Badge>
                {c.reconsentDue ? (
                  <Badge tone="warning">re-consent due</Badge>
                ) : null}
              </div>
              <p className="opacity-50">
                {c.consentFormVersion !== null
                  ? `signed form v${c.consentFormVersion} of v${c.latestFormVersion ?? "?"}`
                  : "no form binding (legacy)"}
                {c.consentDate ? ` · ${fmtDate(c.consentDate)}` : ""}
              </p>
            </div>
          ))
        )}
        {consents.length > 20 ? (
          <p className="opacity-50">
            … and {consents.length - 20} more — see Participants.
          </p>
        ) : null}
      </Card>

      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-body font-bold">
            Protocol amendments
          </CardTitle>
          <Badge tone="info">protocol v{trial.protocolVersion}</Badge>
        </div>
        <p className="opacity-70">
          Past draft, protocol changes (visit plan, arms) require an approved
          amendment from the Ethics Committee — applying one bumps the
          protocol version (T10.3).
        </p>
        {can(role, "trial.manage") && status !== "draft" ? (
          <form
            action={submitAmendmentAction}
            className="flex flex-wrap items-end gap-3"
          >
            <div className="flex min-w-64 flex-1 flex-col gap-2">
              <Label htmlFor="summary">Amendment summary</Label>
              <Input
                id="summary"
                name="summary"
                required
                minLength={10}
                placeholder="e.g. add a day-90 follow-up visit; change arm ratio to 2:1"
              />
            </div>
            <Button type="submit">Submit to Ethics</Button>
          </form>
        ) : null}
        {trialAmendments.length === 0 ? (
          <p className="opacity-70">No amendments submitted.</p>
        ) : (
          trialAmendments.map((a) => (
            <div
              key={a.id}
              className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    tone={
                      a.status === "approved"
                        ? "success"
                        : a.status === "returned"
                          ? "danger"
                          : "warning"
                    }
                  >
                    {a.status}
                  </Badge>
                  {a.appliedAt ? <Badge tone="neutral">applied</Badge> : null}
                  <p className="font-medium">
                    v{a.versionNumber} · {a.summary}
                  </p>
                </div>
                {a.comment ? (
                  <p className="mt-1 opacity-70">IEC: {a.comment}</p>
                ) : null}
                <p className="mt-1 opacity-50">
                  submitted {fmtDate(a.createdAt)}
                  {a.decidedAt ? ` · decided ${fmtDate(a.decidedAt)}` : ""}
                </p>
              </div>
            </div>
          ))
        )}
      </Card>
    </div>
  );
}
