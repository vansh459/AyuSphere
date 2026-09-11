import { redirect } from "next/navigation";
import { eq, inArray } from "drizzle-orm";
import { requireActor, withError } from "@/lib/actor";
import { getDb } from "@/db";
import { documents, trials } from "@/db/schema";
import { transitionTrial } from "@/services/trials";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  let protocolByTrial = new Map<string, string>();
  let dbError = false;
  try {
    const db = getDb();
    queue = await db.select().from(trials).where(eq(trials.status, "iec_review"));
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

          <Card className="flex flex-col gap-3">
            <CardTitle className="text-body font-bold">
              Approved registry ({decided.length})
            </CardTitle>
            {decided.length === 0 ? (
              <EmptyState message="No approved trials yet." />
            ) : (
              decided.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-3">
                  <p className="opacity-70">
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
