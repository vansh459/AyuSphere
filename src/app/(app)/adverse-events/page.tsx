import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getDb } from "@/db";
import { openAesByDeadline } from "@/services/kpi";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EscalationClock } from "@/components/app/escalation-clock";

export default async function AdverseEventsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!can(session.user.role, "ae.capture") && !can(session.user.role, "ae.review")) {
    redirect("/dashboard");
  }

  let rows: Awaited<ReturnType<typeof openAesByDeadline>> = [];
  let dbError = false;
  try {
    rows = await openAesByDeadline(getDb());
  } catch {
    dbError = true;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-heading font-bold">Adverse Events</h1>
        <p className="mt-1 opacity-70">
          Open AE/SAE sorted by reporting deadline — the escalation clock runs
          from capture.
        </p>
      </div>

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
          {rows.map(({ ae, subjectCode }) => (
            <Card key={ae.id} className="flex flex-wrap items-center justify-between gap-4">
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
                </p>
                {ae.narrative ? (
                  <p className="mt-2 opacity-70">{ae.narrative}</p>
                ) : null}
              </div>
              <EscalationClock
                deadline={ae.reportingDeadline}
                totalHours={ae.seriousness === "sae" ? 24 : 168}
              />
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
