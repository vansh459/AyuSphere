import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getDb } from "@/db";
import { trials } from "@/db/schema";
import { exportRowCounts } from "@/services/export/sdtm";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const FORMATS = [
  { key: "fhir", label: "FHIR R4 Bundle", note: "ResearchStudy · ResearchSubject · Patient (de-identified) · AdverseEvent", rows: null },
  { key: "dm", label: "SDTM DM (CSV)", note: "Demographics domain", rows: "participants" },
  { key: "ae", label: "SDTM AE (CSV)", note: "Adverse events domain", rows: "aes" },
  { key: "adsl", label: "ADaM ADSL (CSV)", note: "Subject-level analysis dataset", rows: "participants" },
  { key: "define", label: "Define-XML", note: "Variable-level metadata: ItemDefs, codelists, CRF capture metadata", rows: null },
] as const;

export default async function ExportsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!can(session.user.role, "export.run")) redirect("/dashboard");

  let rows: (typeof trials.$inferSelect)[] = [];
  let counts = new Map<string, { participants: number; aes: number }>();
  let dbError = false;
  try {
    const db = getDb();
    rows = await db.select().from(trials);
    counts = new Map(
      (await exportRowCounts(db)).map((c) => [
        c.trialId,
        { participants: c.participants, aes: c.aes },
      ]),
    );
  } catch {
    dbError = true;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-heading font-bold">Submission-Ready Exports</h1>
        <p className="mt-1 opacity-70">
          CDISC/FHIR focused subset — SDTM DM/AE, ADaM ADSL, and Define-XML
          with variable-level metadata; every export is recorded in the audit
          trail. Full domain coverage beyond this subset is a roadmap item,
          stated plainly.
        </p>
      </div>
      {dbError ? (
        <Card>
          <p className="text-warning font-medium">
            Database not configured — set DATABASE_URL and run the seed.
          </p>
        </Card>
      ) : (
        rows.map((t) => {
          const c = counts.get(t.id) ?? { participants: 0, aes: 0 };
          const rowCount = (key: (typeof FORMATS)[number]["rows"]) =>
            key === "participants" ? c.participants : key === "aes" ? c.aes : null;
          return (
            <Card key={t.id} className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-body font-bold">
                  {t.protocolCode} — {t.title}
                </CardTitle>
                <Badge>{t.status}</Badge>
                <Badge tone="neutral">{c.participants} participants</Badge>
                <Badge tone={c.aes > 0 ? "warning" : "neutral"}>
                  {c.aes} adverse events
                </Badge>
              </div>
              <div className="flex flex-wrap gap-3">
                {FORMATS.map((f) => {
                  const n = rowCount(f.rows);
                  return (
                    <a
                      key={f.key}
                      href={`/api/export?trialId=${t.id}&format=${f.key}`}
                      className="clay-btn flex flex-col gap-0.5 px-4 py-2 transition-transform duration-200 hover:-translate-y-[2px]"
                      title={f.note}
                    >
                      <span className="font-medium">{f.label}</span>
                      <span className="opacity-50">
                        {f.note}
                        {n !== null ? ` · ${n} row${n === 1 ? "" : "s"}` : ""}
                      </span>
                    </a>
                  );
                })}
              </div>
              {c.aes === 0 ? (
                <p className="opacity-50">
                  No adverse events recorded for this trial yet — the AE CSV
                  will contain headers only. Capture one under Adverse Events →
                  Capture and it appears here (and in the FHIR bundle).
                </p>
              ) : null}
              <p className="opacity-50">
                Live FHIR R4 endpoints (authenticated, audited — the ABDM-ready
                building block): <code>GET /api/fhir/Bundle/{t.id.slice(0, 8)}…</code>{" "}
                · <code>GET /api/fhir/ResearchStudy/{t.id.slice(0, 8)}…</code> ·
                EDC/HIS inbound: <code>POST /api/fhir/import</code> (Observations
                → draft CRF entry, never auto-approved).
              </p>
            </Card>
          );
        })
      )}
    </div>
  );
}
