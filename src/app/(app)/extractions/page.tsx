import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { requireActor } from "@/lib/actor";
import { getDb } from "@/db";
import { extractions, participants, visits } from "@/db/schema";
import { Card } from "@/components/ui/card";
import {
  DbErrorState,
  EmptyState,
  PageHeader,
  StatusBadge,
} from "@/components/app/shared";

type MappedField = { value: string | number; confidence: number };

export default async function ExtractionsPage() {
  await requireActor("crf.enter");

  let rows: {
    e: typeof extractions.$inferSelect;
    subjectCode: string;
    visitName: string;
    visitId: string;
  }[] = [];
  let dbError = false;
  try {
    rows = await getDb()
      .select({
        e: extractions,
        subjectCode: participants.subjectCode,
        visitName: visits.name,
        visitId: visits.id,
      })
      .from(extractions)
      .innerJoin(visits, eq(extractions.visitId, visits.id))
      .innerJoin(participants, eq(visits.participantId, participants.id))
      .orderBy(desc(extractions.createdAt))
      .limit(60);
  } catch (err) {
    console.error("[extractions] list failed:", err);
    dbError = true;
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Extractions"
        subtitle="Every scanned document: original image, model output, confidences, and outcome — the full Doctor Note pipeline at a glance."
      />
      {dbError ? (
        <DbErrorState />
      ) : rows.length === 0 ? (
        <EmptyState message="No documents scanned yet — upload one from Data Entry (eCRF)." />
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          {rows.map(({ e, subjectCode, visitName, visitId }) => {
            const fields = (e.mappedFields ?? {}) as Record<string, MappedField>;
            const names = Object.keys(fields);
            const avg =
              names.length > 0
                ? names.reduce((a, n) => a + fields[n].confidence, 0) / names.length
                : 0;
            return (
              <Card key={e.id} className="flex flex-col gap-3 p-4">
                {/* original note image = source evidence (data-URL or blob) */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={e.blobUrl}
                  alt={`Scanned note for ${subjectCode}`}
                  className="h-40 w-full rounded-xl border border-line bg-bg object-contain"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={e.status} />
                  <p className="font-bold">{subjectCode}</p>
                  <span className="opacity-50">· {visitName}</span>
                </div>
                <p className="opacity-70">
                  {names.length > 0
                    ? `${names.length} fields · avg confidence ${(avg * 100).toFixed(0)}%`
                    : "no fields extracted"}
                  {e.modelId ? ` · ${e.modelId}` : ""}
                </p>
                <p className="opacity-50">
                  {e.createdAt.toLocaleString()}
                  {e.reviewedAt ? ` · reviewed ${e.reviewedAt.toLocaleDateString()}` : ""}
                </p>
                <Link href={`/visits/${visitId}`} className="font-medium text-primary">
                  Open visit & entries →
                </Link>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
