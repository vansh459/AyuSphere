import Link from "next/link";
import { requireActor } from "@/lib/actor";
import { getDb } from "@/db";
import { listTrialsWithCounts } from "@/services/trials";
import { Card } from "@/components/ui/card";
import {
  DbErrorState,
  EmptyState,
  ErrorBanner,
  PageHeader,
  ProgressBar,
  StatusBadge,
} from "@/components/app/shared";

export default async function TrialsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireActor("trial.manage");
  const sp = await props.searchParams;

  let rows: Awaited<ReturnType<typeof listTrialsWithCounts>> = [];
  let dbError = false;
  try {
    rows = await listTrialsWithCounts(getDb());
  } catch (e) {
    console.error("[trials] list query failed:", e);
    dbError = true;
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Clinical Trials"
        subtitle="Full lifecycle: protocol → IEC → CTRI → activation → close-out."
        action={
          <Link
            href="/trials/new"
            className="inline-flex h-10 items-center rounded-[0.875rem] bg-primary px-4 font-medium text-white transition-transform duration-200 hover:-translate-y-[2px]"
          >
            New Trial
          </Link>
        }
      />
      <ErrorBanner message={typeof sp.error === "string" ? sp.error : undefined} />

      {dbError ? (
        <DbErrorState />
      ) : rows.length === 0 ? (
        <EmptyState message="No trials yet — create the first one." />
      ) : (
        <div className="flex flex-col gap-4">
          {rows.map(({ trial, enrolled, siteCount }) => (
            <Link key={trial.id} href={`/trials/${trial.id}`}>
              <Card className="flex flex-wrap items-center justify-between gap-4 transition-transform duration-200 hover:-translate-y-[2px]">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-bold">{trial.protocolCode}</p>
                    <StatusBadge status={trial.status} />
                    {trial.ctriNumber ? (
                      <span className="opacity-50">{trial.ctriNumber}</span>
                    ) : null}
                  </div>
                  <p className="mt-1 opacity-70">{trial.title}</p>
                  <p className="mt-1 opacity-50">
                    {trial.intervention} · {trial.studyType}
                    {trial.phase ? ` · Phase ${trial.phase}` : ""} · {siteCount}{" "}
                    site{siteCount === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="microlabel">
                    Enrolment {enrolled}/{trial.targetEnrollment}
                  </span>
                  <ProgressBar
                    value={
                      trial.targetEnrollment > 0
                        ? enrolled / trial.targetEnrollment
                        : 0
                    }
                  />
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
