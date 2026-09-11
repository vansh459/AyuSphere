import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getDb } from "@/db";
import { trials } from "@/db/schema";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const FORMATS = [
  { key: "fhir", label: "FHIR R4 Bundle", note: "ResearchStudy · ResearchSubject · Patient (de-identified) · AdverseEvent" },
  { key: "dm", label: "SDTM DM (CSV)", note: "Demographics domain" },
  { key: "ae", label: "SDTM AE (CSV)", note: "Adverse events domain" },
  { key: "define", label: "Define-XML stub", note: "Metadata for the exported domains" },
] as const;

export default async function ExportsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!can(session.user.role, "export.run")) redirect("/dashboard");

  let rows: (typeof trials.$inferSelect)[] = [];
  let dbError = false;
  try {
    rows = await getDb().select().from(trials);
  } catch {
    dbError = true;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-heading font-bold">Submission-Ready Exports</h1>
        <p className="mt-1 opacity-70">
          CDISC/FHIR focused subset — every export is recorded in the audit
          trail. Full SDTM/ADaM coverage is a roadmap item, stated plainly.
        </p>
      </div>
      {dbError ? (
        <Card>
          <p className="text-warning font-medium">
            Database not configured — set DATABASE_URL and run the seed.
          </p>
        </Card>
      ) : (
        rows.map((t) => (
          <Card key={t.id} className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-body font-bold">
                {t.protocolCode} — {t.title}
              </CardTitle>
              <Badge>{t.status}</Badge>
            </div>
            <div className="flex flex-wrap gap-3">
              {FORMATS.map((f) => (
                <a
                  key={f.key}
                  href={`/api/export?trialId=${t.id}&format=${f.key}`}
                  className="clay-btn flex flex-col gap-0.5 px-4 py-2 transition-transform duration-200 hover:-translate-y-[2px]"
                  title={f.note}
                >
                  <span className="font-medium">{f.label}</span>
                  <span className="opacity-50">{f.note}</span>
                </a>
              ))}
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
