import Link from "next/link";
import { eq, inArray } from "drizzle-orm";
import { requireActor } from "@/lib/actor";
import { getDb } from "@/db";
import { participants, visits } from "@/db/schema";
import { refreshVisitStatuses } from "@/services/visits";
import { Card } from "@/components/ui/card";
import {
  DbErrorState,
  EmptyState,
  ErrorBanner,
  PageHeader,
  StatusBadge,
} from "@/components/app/shared";

export default async function VisitsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireActor("crf.enter");
  const sp = await props.searchParams;

  let rows: {
    v: typeof visits.$inferSelect;
    subjectCode: string;
  }[] = [];
  let dbError = false;
  try {
    const db = getDb();
    // apply time-based transitions before showing the schedule
    await refreshVisitStatuses(db);
    rows = await db
      .select({ v: visits, subjectCode: participants.subjectCode })
      .from(visits)
      .innerJoin(participants, eq(visits.participantId, participants.id))
      .where(inArray(visits.status, ["overdue", "due", "upcoming"]))
      .orderBy(visits.scheduledDate)
      .limit(150);
  } catch {
    dbError = true;
  }

  const groups: Record<string, typeof rows> = {
    overdue: [],
    due: [],
    upcoming: [],
  };
  for (const r of rows) groups[r.v.status]?.push(r);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Visit Schedule"
        subtitle="Protocol windows computed from enrolment — open a visit to capture its CRF."
      />
      <ErrorBanner message={typeof sp.error === "string" ? sp.error : undefined} />

      {dbError ? (
        <DbErrorState />
      ) : rows.length === 0 ? (
        <EmptyState message="No open visits — enrol participants to generate schedules." />
      ) : (
        (["overdue", "due", "upcoming"] as const).map((status) =>
          groups[status].length === 0 ? null : (
            <div key={status} className="flex flex-col gap-3">
              <p className="microlabel">
                {status} ({groups[status].length})
              </p>
              {groups[status].map(({ v, subjectCode }) => (
                <Link key={v.id} href={`/visits/${v.id}`}>
                  <Card className="flex flex-wrap items-center justify-between gap-3 p-4 transition-transform duration-200 hover:-translate-y-[2px]">
                    <div className="flex flex-wrap items-center gap-3">
                      <p className="font-bold">{subjectCode}</p>
                      <p className="opacity-70">{v.name}</p>
                      <StatusBadge status={v.status} />
                    </div>
                    <p className="opacity-50">
                      window {v.windowStart.toLocaleDateString()} –{" "}
                      {v.windowEnd.toLocaleDateString()} · scheduled{" "}
                      {v.scheduledDate.toLocaleDateString()}
                    </p>
                  </Card>
                </Link>
              ))}
            </div>
          ),
        )
      )}
    </div>
  );
}
