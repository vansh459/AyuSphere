import { redirect } from "next/navigation";
import { eq, inArray } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getDb } from "@/db";
import { participants, visits } from "@/db/schema";
import { Card } from "@/components/ui/card";
import { DoctorNoteClient, type VisitOption } from "./doctor-note-client";

export default async function DoctorNotePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!can(session.user.role, "crf.enter")) redirect("/dashboard");

  let options: VisitOption[] = [];
  let dbError = false;
  try {
    const db = getDb();
    const rows = await db
      .select({
        id: visits.id,
        name: visits.name,
        subjectCode: participants.subjectCode,
        scheduledDate: visits.scheduledDate,
      })
      .from(visits)
      .innerJoin(participants, eq(visits.participantId, participants.id))
      .where(inArray(visits.status, ["due", "overdue", "upcoming"]))
      .orderBy(visits.scheduledDate)
      .limit(50);
    options = rows.map((r) => ({
      id: r.id,
      label: `${r.subjectCode} · ${r.name} · ${r.scheduledDate.toLocaleDateString()}`,
    }));
  } catch {
    dbError = true;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-heading font-bold">Doctor Note Intelligence</h1>
        <p className="mt-1 opacity-70">
          Photograph a handwritten trial note — the platform drafts the visit
          CRF, validates it, and nothing becomes a record until you approve it.
        </p>
      </div>
      {dbError ? (
        <Card>
          <p className="text-warning font-medium">
            Database not configured — set DATABASE_URL and run the seed.
          </p>
        </Card>
      ) : (
        <DoctorNoteClient
          visits={options}
          canApprove={can(session.user.role, "crf.approve")}
        />
      )}
    </div>
  );
}
