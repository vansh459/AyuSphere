import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { requireActor, withError } from "@/lib/actor";
import { getDb } from "@/db";
import { participants, sites, trialSites, trials } from "@/db/schema";
import {
  addParticipant,
  enrolParticipant,
  recordConsent,
  recordScreening,
  withdrawParticipant,
} from "@/services/participants";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import {
  DbErrorState,
  ErrorBanner,
  PageHeader,
  StatusBadge,
} from "@/components/app/shared";

export default async function ParticipantsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireActor("participant.manage");
  const sp = await props.searchParams;
  const trialFilter = typeof sp.trial === "string" ? sp.trial : "";

  let rows: {
    p: typeof participants.$inferSelect;
    protocolCode: string;
    siteName: string;
  }[] = [];
  let protocolCodes: string[] = [];
  let activeSites: { id: string; label: string }[] = [];
  let dbError = false;
  try {
    const db = getDb();
    rows = await db
      .select({
        p: participants,
        protocolCode: trials.protocolCode,
        siteName: sites.name,
      })
      .from(participants)
      .innerJoin(trialSites, eq(participants.trialSiteId, trialSites.id))
      .innerJoin(trials, eq(trialSites.trialId, trials.id))
      .innerJoin(sites, eq(trialSites.siteId, sites.id))
      .orderBy(participants.subjectCode);
    protocolCodes = [...new Set(rows.map((r) => r.protocolCode))].sort();
    if (trialFilter) {
      rows = rows.filter((r) => r.protocolCode === trialFilter);
    }
    const ts = await db
      .select({
        id: trialSites.id,
        protocolCode: trials.protocolCode,
        siteName: sites.name,
        activation: trialSites.activationStatus,
      })
      .from(trialSites)
      .innerJoin(trials, eq(trialSites.trialId, trials.id))
      .innerJoin(sites, eq(trialSites.siteId, sites.id))
      .where(eq(trialSites.activationStatus, "active"));
    activeSites = ts.map((t) => ({
      id: t.id,
      label: `${t.protocolCode} · ${t.siteName}`,
    }));
  } catch {
    dbError = true;
  }

  async function act(formData: FormData) {
    "use server";
    const actor = await requireActor("participant.manage");
    const db = getDb();
    const action = String(formData.get("action"));
    const pid = String(formData.get("participantId") ?? "");
    try {
      if (action === "add") {
        await addParticipant(db, actor, String(formData.get("trialSiteId")));
      } else if (action === "screen_pass") {
        await recordScreening(db, actor, pid, true);
      } else if (action === "screen_fail") {
        await recordScreening(db, actor, pid, false);
      } else if (action === "consent") {
        await recordConsent(db, actor, pid);
      } else if (action === "enrol") {
        await enrolParticipant(db, actor, pid, String(formData.get("arm") || "intervention"));
      } else if (action === "withdraw") {
        await withdrawParticipant(
          db,
          actor,
          pid,
          String(formData.get("reason") || "not specified"),
        );
      }
    } catch (e) {
      redirect(withError("/participants", e));
    }
    revalidatePath("/participants");
    redirect("/participants");
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Participants"
        subtitle="De-identified subject codes only — screening → consent → enrolment → visits."
      />
      <ErrorBanner message={typeof sp.error === "string" ? sp.error : undefined} />

      {dbError ? (
        <DbErrorState />
      ) : (
        <>
          <Card className="flex flex-col gap-4">
            <CardTitle className="text-body font-bold">Add participant</CardTitle>
            <form action={act} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="action" value="add" />
              <div className="flex flex-col gap-2">
                <Label htmlFor="trialSiteId">Active trial · site</Label>
                <select
                  id="trialSiteId"
                  name="trialSiteId"
                  className="h-10 min-w-64 rounded-[0.875rem] border border-line bg-surface px-3 outline-none focus:border-primary"
                  required
                >
                  {activeSites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit">Add (code auto-generated)</Button>
            </form>
          </Card>

          <form method="get" className="flex flex-wrap items-center gap-2">
            <span className="microlabel">Filter by trial</span>
            <select
              name="trial"
              defaultValue={trialFilter}
              className="h-9 rounded-xl border border-line bg-surface px-3 outline-none focus:border-primary"
            >
              <option value="">All trials ({protocolCodes.length})</option>
              {protocolCodes.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <Button size="sm" variant="outline" type="submit">
              Apply
            </Button>
            <span className="opacity-50">
              {rows.length} participant{rows.length === 1 ? "" : "s"}
            </span>
          </form>

          <Card className="overflow-x-auto p-0">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-line">
                  {["Subject", "Trial · Site", "Screening", "Consent", "Status", "Actions"].map((h) => (
                    <th key={h} className="microlabel px-4 py-3">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ p, protocolCode, siteName }) => (
                  <tr key={p.id} className="border-b border-line align-middle">
                    <td className="px-4 py-3 font-medium">{p.subjectCode}</td>
                    <td className="px-4 py-3 opacity-70">
                      {protocolCode} · {siteName}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={p.screeningStatus} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={p.consentStatus} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={p.status} />
                      {p.arm ? <span className="ml-2 opacity-50">{p.arm}</span> : null}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {p.status === "screening" && p.screeningStatus === "pending" ? (
                          <>
                            <form action={act}>
                              <input type="hidden" name="action" value="screen_pass" />
                              <input type="hidden" name="participantId" value={p.id} />
                              <Button size="sm" variant="outline" type="submit">
                                Pass screening
                              </Button>
                            </form>
                            <form action={act}>
                              <input type="hidden" name="action" value="screen_fail" />
                              <input type="hidden" name="participantId" value={p.id} />
                              <Button size="sm" variant="ghost" type="submit">
                                Fail
                              </Button>
                            </form>
                          </>
                        ) : null}
                        {p.status === "screening" && p.consentStatus === "not_taken" ? (
                          <form action={act}>
                            <input type="hidden" name="action" value="consent" />
                            <input type="hidden" name="participantId" value={p.id} />
                            <Button size="sm" variant="outline" type="submit">
                              Record consent
                            </Button>
                          </form>
                        ) : null}
                        {p.status === "screening" &&
                        p.screeningStatus === "passed" &&
                        p.consentStatus === "given" ? (
                          <form action={act} className="flex items-center gap-2">
                            <input type="hidden" name="action" value="enrol" />
                            <input type="hidden" name="participantId" value={p.id} />
                            <select
                              name="arm"
                              className="h-8 rounded-xl border border-line bg-surface px-2 outline-none"
                            >
                              <option value="intervention">intervention</option>
                              <option value="control">control</option>
                            </select>
                            <Button size="sm" type="submit">
                              Enrol
                            </Button>
                          </form>
                        ) : null}
                        {p.status === "enrolled" ? (
                          <form action={act} className="flex items-center gap-2">
                            <input type="hidden" name="action" value="withdraw" />
                            <input type="hidden" name="participantId" value={p.id} />
                            <Input name="reason" placeholder="withdrawal reason" className="h-8 w-40" required />
                            <Button size="sm" variant="danger" type="submit">
                              Withdraw
                            </Button>
                          </form>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
