import { auth } from "@/lib/auth";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const ROLE_TILES: Record<string, { title: string; hint: string }[]> = {
  pi: [
    { title: "My Trials", hint: "Enrolment vs target across your studies" },
    { title: "Pending Approvals", hint: "CRF entries and note extractions awaiting you" },
    { title: "Open Adverse Events", hint: "Events on your participants" },
    { title: "Overdue Visits", hint: "Visits past their protocol window" },
  ],
  coordinator: [
    { title: "Today's Visits", hint: "Due and upcoming participant visits" },
    { title: "Data Entry Queue", hint: "Visits missing CRF entries" },
    { title: "Milestones Due", hint: "CTRI / ethics dates approaching" },
  ],
  monitor: [
    { title: "Assigned Sites", hint: "Monitoring schedule and status" },
    { title: "Deviations", hint: "Protocol deviations at your sites" },
    { title: "Data Quality Flags", hint: "Open findings to verify" },
  ],
  ethics: [
    { title: "Awaiting Review", hint: "Trials submitted for IEC decision" },
    { title: "Approved Trials", hint: "Registry of approvals" },
  ],
  pv: [
    { title: "Open AE / SAE", hint: "Sorted by reporting deadline" },
    { title: "Breached Deadlines", hint: "Requires immediate action" },
    { title: "Safety Signals", hint: "Clusters flagged for human review" },
  ],
  admin: [
    { title: "Portfolio", hint: "All trials, sites and participants" },
    { title: "Open Alerts", hint: "Across every study" },
    { title: "Users", hint: "Role and account management" },
  ],
  regulator: [
    { title: "Portfolio (read-only)", hint: "Every trial, no mutations" },
    { title: "Audit Trail", hint: "Complete, immutable event history" },
  ],
};

export default async function DashboardPage() {
  const session = await auth();
  const role = session!.user.role;
  const tiles = ROLE_TILES[role] ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-heading font-bold">
          Welcome, {session!.user.name}
        </h1>
        <p className="mt-1 opacity-70">
          Real-time view of your Ayurveda clinical research portfolio.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
        {tiles.map((tile) => (
          <Card key={tile.title}>
            <CardHeader className="mb-0">
              <CardTitle className="text-body font-bold">
                {tile.title}
              </CardTitle>
              <CardDescription>{tile.hint}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
}
