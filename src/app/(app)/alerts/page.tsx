import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { desc, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getDb } from "@/db";
import { alerts } from "@/db/schema";
import { acknowledgeAlert } from "@/services/alerts";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const TONE = {
  info: "info",
  warning: "warning",
  danger: "danger",
} as const;

export default async function AlertsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!can(session.user.role, "alert.acknowledge")) redirect("/dashboard");

  let rows: (typeof alerts.$inferSelect)[] = [];
  let dbError = false;
  try {
    rows = await getDb()
      .select()
      .from(alerts)
      .where(eq(alerts.status, "open"))
      .orderBy(desc(alerts.severity), desc(alerts.createdAt))
      .limit(100);
  } catch {
    dbError = true;
  }

  async function acknowledge(formData: FormData) {
    "use server";
    const s = await auth();
    if (!s?.user) return;
    const id = String(formData.get("alertId") ?? "");
    if (!id) return;
    await acknowledgeAlert(getDb(), { id: s.user.id, role: s.user.role }, id);
    revalidatePath("/alerts");
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-heading font-bold">Alerts</h1>
        <p className="mt-1 opacity-70">
          Open alerts across your scope — enrolment lag, overdue visits,
          safety deadlines, milestone dues, data quality.
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
            No open alerts. The rules engine re-evaluates on every write and
            every 10 minutes.
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((a) => (
            <Card
              key={a.id}
              className="flex flex-wrap items-center justify-between gap-3 p-4"
            >
              <div className="flex min-w-0 items-center gap-3">
                <Badge tone={TONE[a.severity]}>{a.severity}</Badge>
                <div className="min-w-0">
                  <p className="font-medium">{a.message}</p>
                  <p className="opacity-50">
                    {a.ruleKey} · {a.createdAt.toLocaleString()}
                  </p>
                </div>
              </div>
              <form action={acknowledge}>
                <input type="hidden" name="alertId" value={a.id} />
                <Button variant="outline" size="sm" type="submit">
                  Acknowledge
                </Button>
              </form>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
