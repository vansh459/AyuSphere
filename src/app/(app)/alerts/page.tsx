import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getDb } from "@/db";
import { alerts } from "@/db/schema";
import { Card } from "@/components/ui/card";
import { AlertsList } from "@/components/app/alerts-list";

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
      ) : (
        <AlertsList initialAlerts={rows} />
      )}
    </div>
  );
}
