/** Runs the quality rule set for a trial and raises data_quality alerts. */
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { crfEntries, participants, trialSites, visits } from "@/db/schema";
import { runQualityRules, type QualityFinding } from "@/lib/rules/data-quality";
import { alerts } from "@/db/schema";
import { and } from "drizzle-orm";

export async function runDataQualityChecks(
  db: Db,
  trialId: string,
): Promise<QualityFinding[]> {
  const visitRows = await db
    .select({
      id: visits.id,
      name: visits.name,
      status: visits.status,
    })
    .from(visits)
    .innerJoin(participants, eq(visits.participantId, participants.id))
    .innerJoin(trialSites, eq(participants.trialSiteId, trialSites.id))
    .where(eq(trialSites.trialId, trialId));

  const entryRows = await db
    .select({
      id: crfEntries.id,
      visitId: crfEntries.visitId,
      status: crfEntries.status,
      data: crfEntries.data,
    })
    .from(crfEntries)
    .innerJoin(visits, eq(crfEntries.visitId, visits.id))
    .innerJoin(participants, eq(visits.participantId, participants.id))
    .innerJoin(trialSites, eq(participants.trialSiteId, trialSites.id))
    .where(eq(trialSites.trialId, trialId));

  const findings = runQualityRules(
    visitRows,
    entryRows.map((e) => ({ ...e, data: e.data as Record<string, unknown> })),
  );

  for (const f of findings) {
    await db
      .insert(alerts)
      .values({
        ruleKey: "data_quality",
        entityRef: `${f.kind}:${f.entityRef}`,
        severity: "warning",
        message: f.message,
        trialId,
      })
      .onConflictDoNothing();
  }
  // resolve stale data_quality alerts whose finding disappeared
  const openDq = await db
    .select()
    .from(alerts)
    .where(
      and(
        eq(alerts.ruleKey, "data_quality"),
        eq(alerts.status, "open"),
        eq(alerts.trialId, trialId),
      ),
    );
  const liveRefs = new Set(findings.map((f) => `${f.kind}:${f.entityRef}`));
  for (const a of openDq) {
    if (!liveRefs.has(a.entityRef)) {
      await db
        .update(alerts)
        .set({ status: "resolved", resolvedAt: new Date() })
        .where(eq(alerts.id, a.id));
    }
  }
  return findings;
}
