import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq, inArray } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { requireActor, withError } from "@/lib/actor";
import { can } from "@/lib/rbac";
import { getDb } from "@/db";
import { participants, trialSites, trials } from "@/db/schema";
import Link from "next/link";
import { openAesByDeadline } from "@/services/kpi";
import {
  advanceAeStatus,
  captureAdverseEvent,
} from "@/services/adverse-events";
import { generateAeReport } from "@/services/ae-report";
import {
  advanceAdrStatus,
  captureSuspectedAdr,
  listSuspectedAdrs,
} from "@/services/adr";
import { SIGNATURE_MEANINGS } from "@/services/signatures";
import { safetySignals } from "@/services/safety-signals";
import {
  MEDDRA_SUBSET,
  decodeMeddra,
  meddraByPt,
} from "@/lib/dictionaries/meddra-subset";
import {
  WHODRUG_SUBSET,
  decodeWhodrug,
  whodrugByName,
} from "@/lib/dictionaries/whodrug-subset";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { ErrorBanner } from "@/components/app/shared";
import { EscalationClock } from "@/components/app/escalation-clock";

const CAUSALITY = ["certain", "probable", "possible", "unlikely", "unrelated"];

export default async function AdverseEventsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!can(session.user.role, "ae.capture") && !can(session.user.role, "ae.review")) {
    redirect("/dashboard");
  }
  const sp = await props.searchParams;
  const canCapture = can(session.user.role, "ae.capture");
  const canReview = can(session.user.role, "ae.review");

  let rows: Awaited<ReturnType<typeof openAesByDeadline>> = [];
  let signals: Awaited<ReturnType<typeof safetySignals>> = [];
  let adrs: Awaited<ReturnType<typeof listSuspectedAdrs>> = [];
  let participantOptions: { id: string; label: string }[] = [];
  let dbError = false;
  try {
    const db = getDb();
    rows = await openAesByDeadline(db);
    signals = await safetySignals(db);
    if (canReview) adrs = await listSuspectedAdrs(db, 20);
    if (canCapture) {
      const pRows = await db
        .select({
          id: participants.id,
          subjectCode: participants.subjectCode,
          protocolCode: trials.protocolCode,
        })
        .from(participants)
        .innerJoin(trialSites, eq(participants.trialSiteId, trialSites.id))
        .innerJoin(trials, eq(trialSites.trialId, trials.id))
        .where(inArray(participants.status, ["enrolled", "completed"]))
        .orderBy(participants.subjectCode)
        .limit(300);
      participantOptions = pRows.map((p) => ({
        id: p.id,
        label: `${p.subjectCode} (${p.protocolCode})`,
      }));
    }
  } catch {
    dbError = true;
  }

  async function capture(formData: FormData) {
    "use server";
    const actor = await requireActor("ae.capture");
    try {
      const term = String(formData.get("term") ?? "").trim();
      const drugName = String(formData.get("suspectedDrug") ?? "").trim();
      // picker resolution (D-024): an exact PT match auto-codes the term; a
      // typed drug MUST resolve to the subset (it is stored only as a code)
      const meddra = meddraByPt(term);
      const whodrug = drugName ? whodrugByName(drugName) : undefined;
      if (drugName && !whodrug) {
        throw new Error(
          "suspected formulation not recognized — pick one from the list",
        );
      }
      await captureAdverseEvent(getDb(), actor, {
        participantId: String(formData.get("participantId")),
        term,
        seriousness: formData.get("seriousness") === "sae" ? "sae" : "ae",
        severity: ["mild", "moderate", "severe"].includes(
          String(formData.get("severity")),
        )
          ? (String(formData.get("severity")) as "mild" | "moderate" | "severe")
          : "mild",
        onsetDate: new Date(String(formData.get("onsetDate"))),
        narrative: String(formData.get("narrative") ?? "").trim() || undefined,
        causality: String(formData.get("causality") ?? "") || undefined,
        meddraCode: meddra?.code,
        whodrugCode: whodrug?.code,
      });
    } catch (e) {
      redirect(withError("/adverse-events", e));
    }
    revalidatePath("/adverse-events");
    redirect("/adverse-events");
  }

  async function startReview(formData: FormData) {
    "use server";
    const actor = await requireActor("ae.review");
    try {
      await advanceAeStatus(
        getDb(),
        actor,
        String(formData.get("aeId")),
        "under_review",
      );
    } catch (e) {
      redirect(withError("/adverse-events", e));
    }
    revalidatePath("/adverse-events");
    redirect("/adverse-events");
  }

  async function markReported(formData: FormData) {
    "use server";
    const actor = await requireActor("ae.review");
    try {
      // e-signature (D-022): reporting to the authority is a signed step
      await advanceAeStatus(
        getDb(),
        actor,
        String(formData.get("aeId")),
        "reported",
        String(formData.get("note") ?? "").trim() || undefined,
        { password: String(formData.get("password") ?? "") },
      );
    } catch (e) {
      redirect(withError("/adverse-events", e));
    }
    revalidatePath("/adverse-events");
    redirect("/adverse-events");
  }

  async function generateReport(formData: FormData) {
    "use server";
    const actor = await requireActor("ae.review");
    const aeId = String(formData.get("aeId"));
    try {
      await generateAeReport(getDb(), actor, aeId);
    } catch (e) {
      redirect(withError("/adverse-events", e));
    }
    redirect(`/adverse-events/${aeId}/report`);
  }

  async function captureAdr(formData: FormData) {
    "use server";
    const actor = await requireActor("ae.review");
    try {
      const term = String(formData.get("adrTerm") ?? "").trim();
      const drug = String(formData.get("adrDrug") ?? "").trim();
      const source = String(formData.get("source"));
      // lenient coding for spontaneous reports: exact picker matches code,
      // anything else stays verbatim and uncoded
      await captureSuspectedAdr(getDb(), actor, {
        source: ["hospital", "community", "literature"].includes(source)
          ? (source as "hospital" | "community" | "literature")
          : "hospital",
        term,
        meddraCode: meddraByPt(term)?.code,
        suspectedDrug: drug,
        whodrugCode: whodrugByName(drug)?.code,
        eventDate: new Date(String(formData.get("adrEventDate"))),
        seriousness: formData.get("adrSeriousness") === "sae" ? "sae" : "ae",
        outcome: String(formData.get("adrOutcome") ?? "").trim() || undefined,
        narrative: String(formData.get("adrNarrative") ?? "").trim() || undefined,
        reporterRole:
          String(formData.get("reporterRole") ?? "").trim() || undefined,
      });
    } catch (e) {
      redirect(withError("/adverse-events", e));
    }
    revalidatePath("/adverse-events");
    redirect("/adverse-events");
  }

  async function advanceAdr(formData: FormData) {
    "use server";
    const actor = await requireActor("ae.review");
    try {
      const to = formData.get("to") === "forwarded" ? "forwarded" : "assessed";
      await advanceAdrStatus(
        getDb(),
        actor,
        String(formData.get("adrId")),
        to,
        String(formData.get("note") ?? "").trim() || undefined,
      );
    } catch (e) {
      redirect(withError("/adverse-events", e));
    }
    revalidatePath("/adverse-events");
    redirect("/adverse-events");
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-heading font-bold">Adverse Events</h1>
        <p className="mt-1 opacity-70">
          Open AE/SAE sorted by reporting deadline — the escalation clock runs
          from capture. Terms code to bundled MedDRA/WHODrug demo subsets
          (D-024).
        </p>
      </div>
      <ErrorBanner message={typeof sp.error === "string" ? sp.error : undefined} />

      {canCapture && !dbError ? (
        <Card className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-body font-bold">
              Capture adverse event
            </CardTitle>
            <Badge tone="info">demo dictionary subsets</Badge>
          </div>
          <form
            action={capture}
            className="grid grid-cols-1 gap-3 md:grid-cols-3"
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="participantId">Participant</Label>
              <select
                id="participantId"
                name="participantId"
                required
                className="h-10 rounded-[0.875rem] border border-line bg-surface px-3 text-body outline-none focus:border-primary"
              >
                {participantOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="term">Event term (MedDRA picker)</Label>
              <Input
                id="term"
                name="term"
                list="meddra-terms"
                required
                minLength={2}
                placeholder="start typing — e.g. Nausea"
              />
              <datalist id="meddra-terms">
                {MEDDRA_SUBSET.map((t) => (
                  <option key={t.code} value={t.pt}>
                    {t.soc}
                  </option>
                ))}
              </datalist>
              <p className="opacity-50">
                an exact match auto-codes the term; free text stays uncoded
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="suspectedDrug">
                Suspected formulation (WHODrug picker)
              </Label>
              <Input
                id="suspectedDrug"
                name="suspectedDrug"
                list="whodrug-terms"
                placeholder="e.g. Ashwagandha churna"
              />
              <datalist id="whodrug-terms">
                {WHODRUG_SUBSET.map((t) => (
                  <option key={t.code} value={t.drugName}>
                    {t.drugClass}
                  </option>
                ))}
              </datalist>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="seriousness">Seriousness</Label>
              <select
                id="seriousness"
                name="seriousness"
                className="h-10 rounded-[0.875rem] border border-line bg-surface px-3 text-body outline-none focus:border-primary"
              >
                <option value="ae">AE</option>
                <option value="sae">SAE</option>
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="severity">Severity</Label>
              <select
                id="severity"
                name="severity"
                className="h-10 rounded-[0.875rem] border border-line bg-surface px-3 text-body outline-none focus:border-primary"
              >
                <option value="mild">mild</option>
                <option value="moderate">moderate</option>
                <option value="severe">severe</option>
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="onsetDate">Onset date</Label>
              <Input id="onsetDate" name="onsetDate" type="date" required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="causality">Causality (WHO-UMC style)</Label>
              <select
                id="causality"
                name="causality"
                className="h-10 rounded-[0.875rem] border border-line bg-surface px-3 text-body outline-none focus:border-primary"
              >
                <option value="">not assessed</option>
                {CAUSALITY.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2 md:col-span-2">
              <Label htmlFor="narrative">Narrative</Label>
              <Input
                id="narrative"
                name="narrative"
                placeholder="short clinical narrative"
              />
            </div>
            <div className="md:col-span-3">
              <Button type="submit">
                Capture — starts the escalation clock
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      {!dbError ? (
        <Card className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-body font-bold">
              Safety signals — term × trial
            </CardTitle>
            <Link
              href="/adverse-events/dsmb"
              className="font-medium text-primary"
            >
              Full DSMB summary →
            </Link>
          </div>
          {signals.length === 0 ? (
            <p className="opacity-70">
              No events recorded yet — signals aggregate coded terms across the
              portfolio.
            </p>
          ) : (
            signals.slice(0, 6).map((s) => (
              <div
                key={`${s.trialId}-${s.termKey}`}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-2 last:border-0 last:pb-0"
              >
                <div className="flex flex-wrap items-center gap-2">
                  {s.flagged ? <Badge tone="danger">signal</Badge> : null}
                  <p className="font-medium">{s.termLabel}</p>
                  <span className="opacity-50">
                    {s.protocolCode} · {s.siteBreakdown}
                  </span>
                </div>
                <p className="opacity-70">
                  {s.count}/{s.trialTotal} events · {s.saeCount} SAE ·{" "}
                  {s.ratio.toFixed(2)}× portfolio share
                </p>
              </div>
            ))
          )}
        </Card>
      ) : null}

      {dbError ? (
        <Card>
          <p className="text-warning font-medium">
            Database not configured — set DATABASE_URL and run the seed.
          </p>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <p className="opacity-70">
            No open adverse events. Captured events appear here with their
            reporting countdown.
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {rows.map(({ ae, subjectCode }) => {
            const meddra = decodeMeddra(ae.meddraCode);
            const whodrug = decodeWhodrug(ae.whodrugCode);
            return (
              <Card
                key={ae.id}
                className="flex flex-wrap items-center justify-between gap-4"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-bold">{ae.term}</p>
                    <Badge tone={ae.seriousness === "sae" ? "danger" : "warning"}>
                      {ae.seriousness.toUpperCase()}
                    </Badge>
                    <Badge tone="neutral">{ae.severity}</Badge>
                    <Badge tone="info">{ae.status.replace("_", " ")}</Badge>
                  </div>
                  <p className="mt-1 opacity-70">
                    {subjectCode} · onset {ae.onsetDate.toLocaleDateString()}
                    {ae.causality ? ` · causality: ${ae.causality}` : ""}
                  </p>
                  {meddra || whodrug ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {meddra ? (
                        <Badge tone="neutral">
                          {meddra.pt} · {meddra.soc} · {meddra.code}
                        </Badge>
                      ) : null}
                      {whodrug ? (
                        <Badge tone="neutral">
                          {whodrug.drugName} · {whodrug.code}
                        </Badge>
                      ) : null}
                    </div>
                  ) : null}
                  {ae.narrative ? (
                    <p className="mt-2 opacity-70">{ae.narrative}</p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  {canReview ? (
                    <div className="flex flex-col items-end gap-2">
                      {ae.status === "open" ? (
                        <form action={startReview}>
                          <input type="hidden" name="aeId" value={ae.id} />
                          <Button size="sm" variant="outline" type="submit">
                            Start PV review
                          </Button>
                        </form>
                      ) : null}
                      {ae.status === "under_review" ? (
                        <form
                          action={markReported}
                          className="flex flex-col items-end gap-2"
                        >
                          <input type="hidden" name="aeId" value={ae.id} />
                          <Input
                            name="password"
                            type="password"
                            required
                            autoComplete="current-password"
                            placeholder="Password to sign"
                            className="w-44"
                          />
                          <Button size="sm" type="submit">
                            Sign &amp; mark reported
                          </Button>
                          <p className="max-w-[220px] text-right opacity-50">
                            “{SIGNATURE_MEANINGS.report}”
                          </p>
                        </form>
                      ) : null}
                      <form action={generateReport}>
                        <input type="hidden" name="aeId" value={ae.id} />
                        <Button size="sm" variant="ghost" type="submit">
                          Generate regulatory report →
                        </Button>
                      </form>
                    </div>
                  ) : null}
                  <EscalationClock
                    deadline={ae.reportingDeadline}
                    totalHours={ae.seriousness === "sae" ? 24 : 168}
                  />
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {canReview && !dbError ? (
        <Card className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-body font-bold">
              Spontaneous ADRs — NPvCC surveillance
            </CardTitle>
            <Badge tone="info">outside-trial reports (D-025)</Badge>
          </div>
          <p className="opacity-70">
            Suspected ASU&amp;H drug reactions reported from outside trials.
            De-identified by design; reports feed the safety-signal view as
            their own series.
          </p>
          <form
            action={captureAdr}
            className="grid grid-cols-1 gap-3 md:grid-cols-3"
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="source">Report source</Label>
              <select
                id="source"
                name="source"
                className="h-10 rounded-[0.875rem] border border-line bg-surface px-3 text-body outline-none focus:border-primary"
              >
                <option value="hospital">hospital</option>
                <option value="community">community</option>
                <option value="literature">literature</option>
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="adrTerm">Reaction (MedDRA picker)</Label>
              <Input
                id="adrTerm"
                name="adrTerm"
                list="meddra-terms"
                required
                minLength={2}
                placeholder="e.g. Hepatotoxicity"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="adrDrug">Suspected formulation</Label>
              <Input
                id="adrDrug"
                name="adrDrug"
                list="whodrug-terms"
                required
                minLength={2}
                placeholder="e.g. Arogyavardhini vati"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="adrEventDate">Event date</Label>
              <Input id="adrEventDate" name="adrEventDate" type="date" required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="adrSeriousness">Seriousness</Label>
              <select
                id="adrSeriousness"
                name="adrSeriousness"
                className="h-10 rounded-[0.875rem] border border-line bg-surface px-3 text-body outline-none focus:border-primary"
              >
                <option value="ae">AE</option>
                <option value="sae">SAE</option>
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="reporterRole">Reporter role (no identity)</Label>
              <Input
                id="reporterRole"
                name="reporterRole"
                placeholder="physician / consumer / pharmacist"
              />
            </div>
            <div className="flex flex-col gap-2 md:col-span-2">
              <Label htmlFor="adrNarrative">Narrative / outcome</Label>
              <Input
                id="adrNarrative"
                name="adrNarrative"
                placeholder="short description"
              />
            </div>
            <div className="flex items-end">
              <Button type="submit">Receive ADR report</Button>
            </div>
          </form>

          {adrs.length === 0 ? (
            <p className="opacity-70">No spontaneous reports received yet.</p>
          ) : (
            adrs.map((adr) => {
              const meddra = decodeMeddra(adr.meddraCode);
              return (
                <div
                  key={adr.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        tone={
                          adr.status === "received"
                            ? "warning"
                            : adr.status === "assessed"
                              ? "info"
                              : "success"
                        }
                      >
                        {adr.status}
                      </Badge>
                      <p className="font-medium">{adr.term}</p>
                      <Badge tone={adr.seriousness === "sae" ? "danger" : "neutral"}>
                        {adr.seriousness.toUpperCase()}
                      </Badge>
                      <span className="opacity-50">
                        {adr.suspectedDrug} · {adr.source} ·{" "}
                        {adr.eventDate.toLocaleDateString()}
                      </span>
                    </div>
                    {meddra ? (
                      <p className="mt-1 opacity-50">
                        {meddra.pt} · {meddra.soc} · {meddra.code}
                      </p>
                    ) : null}
                    {adr.assessmentNote ? (
                      <p className="mt-1 opacity-70">{adr.assessmentNote}</p>
                    ) : null}
                  </div>
                  {adr.status !== "forwarded" ? (
                    <form action={advanceAdr} className="flex items-end gap-2">
                      <input type="hidden" name="adrId" value={adr.id} />
                      <input
                        type="hidden"
                        name="to"
                        value={adr.status === "received" ? "assessed" : "forwarded"}
                      />
                      {adr.status === "received" ? (
                        <Input
                          name="note"
                          placeholder="assessment note"
                          className="w-52"
                        />
                      ) : null}
                      <Button size="sm" variant="outline" type="submit">
                        {adr.status === "received"
                          ? "Mark assessed"
                          : "Forward to authority"}
                      </Button>
                    </form>
                  ) : null}
                </div>
              );
            })
          )}
        </Card>
      ) : null}
    </div>
  );
}
