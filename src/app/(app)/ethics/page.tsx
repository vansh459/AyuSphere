import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq, inArray } from "drizzle-orm";
import { requireActor, withError } from "@/lib/actor";
import { getDb } from "@/db";
import { documents, trials } from "@/db/schema";
import { transitionTrial } from "@/services/trials";
import { decideAmendment, pendingAmendments } from "@/services/amendments";
import { fmtDate } from "@/lib/dates";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  DbErrorState,
  EmptyState,
  ErrorBanner,
  PageHeader,
  StatusBadge,
} from "@/components/app/shared";

export default async function EthicsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireActor("trial.ethicsReview");
  const sp = await props.searchParams;

  let queue: (typeof trials.$inferSelect)[] = [];
  let decided: (typeof trials.$inferSelect)[] = [];
  let amendmentQueue: Awaited<ReturnType<typeof pendingAmendments>> = [];
  let protocolByTrial = new Map<string, string>();
  let dbError = false;
  try {
    const db = getDb();
    queue = await db.select().from(trials).where(eq(trials.status, "iec_review"));
    amendmentQueue = await pendingAmendments(db);
    decided = await db
      .select()
      .from(trials)
      .where(
        inArray(trials.status, [
          "iec_approved",
          "ctri_registered",
          "active",
          "enrolment_closed",
          "followup",
          "closeout",
        ]),
      );
    const docs = await db
      .select()
      .from(documents)
      .where(eq(documents.kind, "protocol"));
    protocolByTrial = new Map(docs.map((d) => [d.trialId, d.title]));
  } catch {
    dbError = true;
  }

  async function decide(formData: FormData) {
    "use server";
    const actor = await requireActor("trial.ethicsReview");
    const trialId = String(formData.get("trialId"));
    const to = formData.get("decision") === "approve" ? "iec_approved" : "draft";
    try {
      await transitionTrial(getDb(), actor, trialId, to);
    } catch (e) {
      redirect(withError("/ethics", e));
    }
    revalidatePath("/ethics");
    revalidatePath("/trials");
    redirect("/ethics");
  }

  async function decideAmendmentAction(formData: FormData) {
    "use server";
    const actor = await requireActor("trial.ethicsReview");
    try {
      await decideAmendment(
        getDb(),
        actor,
        String(formData.get("amendmentId")),
        formData.get("decision") === "approve" ? "approved" : "returned",
        String(formData.get("comment") ?? "").trim() || undefined,
      );
    } catch (e) {
      redirect(withError("/ethics", e));
    }
    revalidatePath("/ethics");
    redirect("/ethics");
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Ethics Review"
        subtitle="Institutional Ethics Committee queue — approvals gate the trial lifecycle."
      />
      <ErrorBanner message={typeof sp.error === "string" ? sp.error : undefined} />

      {dbError ? (
        <DbErrorState />
      ) : (
        <>
          <Card className="flex flex-col gap-4">
            <CardTitle className="text-body font-bold">
              Awaiting decision ({queue.length})
            </CardTitle>
            {queue.length === 0 ? (
              <p className="opacity-70">No trials awaiting IEC review.</p>
            ) : (
              queue.map((t) => (
                <div
                  key={t.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4 last:border-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="font-bold">
                      {t.protocolCode} — {t.title}
                    </p>
                    <p className="mt-1 opacity-70">
                      {t.intervention} · {t.studyType} · target{" "}
                      {t.targetEnrollment}
                    </p>
                    <p className="mt-1 opacity-50">
                      Protocol document:{" "}
                      {protocolByTrial.get(t.id) ?? "— none on file"}
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <form action={decide}>
                      <input type="hidden" name="trialId" value={t.id} />
                      <input type="hidden" name="decision" value="approve" />
                      <Button type="submit">Approve</Button>
                    </form>
                    <form action={decide}>
                      <input type="hidden" name="trialId" value={t.id} />
                      <input type="hidden" name="decision" value="return" />
                      <Button variant="outline" type="submit">
                        Return
                      </Button>
                    </form>
                  </div>
                </div>
              ))
            )}
          </Card>

          <Card className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="text-body font-bold">
                Amendment queue ({amendmentQueue.length})
              </CardTitle>
              <Badge tone="info">protocol changes need IEC approval (T10.3)</Badge>
            </div>
            {amendmentQueue.length === 0 ? (
              <p className="opacity-70">No amendments awaiting review.</p>
            ) : (
              amendmentQueue.map(({ amendment, protocolCode, trialTitle }) => (
                <div
                  key={amendment.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4 last:border-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="font-bold">
                      {protocolCode} · Amendment v{amendment.versionNumber}
                    </p>
                    <p className="mt-1 opacity-70">{amendment.summary}</p>
                    <p className="mt-1 opacity-50">
                      {trialTitle} · submitted{" "}
                      {fmtDate(amendment.createdAt)}
                    </p>
                  </div>
                  <form
                    action={decideAmendmentAction}
                    className="flex flex-wrap items-end gap-2"
                  >
                    <input type="hidden" name="amendmentId" value={amendment.id} />
                    <Input
                      name="comment"
                      placeholder="comment (required to return)"
                      className="w-56"
                    />
                    <Button type="submit" name="decision" value="approve">
                      Approve
                    </Button>
                    <Button
                      type="submit"
                      name="decision"
                      value="return"
                      variant="outline"
                    >
                      Return
                    </Button>
                  </form>
                </div>
              ))
            )}
          </Card>

          <Card className="flex flex-col gap-3">
            <CardTitle className="text-body font-bold">
              Approved registry ({decided.length})
            </CardTitle>
            {decided.length === 0 ? (
              <EmptyState message="No approved trials yet." />
            ) : (
              decided.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-3">
                  <p className="min-w-0 flex-1 opacity-70">
                    {t.protocolCode} — {t.title}
                  </p>
                  <StatusBadge status={t.status} />
                </div>
              ))
            )}
          </Card>
        </>
      )}
    </div>
  );
}
