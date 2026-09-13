/**
 * Monitoring-visit workflow (T7.3, gap-analysis G9) — the monitor role's
 * mutation behind the `monitoring.log` capability. Scheduling a visit sets
 * the site's monitoring due date; completing it records summary/findings and
 * advances the due date by the configured cadence (D-023). The alert sweep
 * raises `monitoring_overdue` when a due date passes without a visit.
 */
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { monitoringVisits, sites, trialSites, trials } from "@/db/schema";
import { withAudit, type Actor } from "@/lib/audit";
import { assertCan } from "@/lib/rbac";
import { getAlertConfig } from "@/services/settings";

const DAY = 86_400_000;

export class MonitoringError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MonitoringError";
  }
}

export const scheduleMonitoringVisitInput = z.object({
  trialSiteId: z.string().uuid(),
  scheduledDate: z.coerce.date(),
});

export async function scheduleMonitoringVisit(
  db: Db,
  actor: Actor,
  input: z.infer<typeof scheduleMonitoringVisitInput>,
) {
  assertCan(actor.role, "monitoring.log");
  const data = scheduleMonitoringVisitInput.parse(input);

  const [ts] = await db
    .select()
    .from(trialSites)
    .where(eq(trialSites.id, data.trialSiteId))
    .limit(1);
  if (!ts) throw new MonitoringError("trial site not found");
  if (ts.activationStatus !== "active") {
    throw new MonitoringError("monitoring visits require an activated site");
  }

  return withAudit(db, actor, "monitoring.schedule", async (tx) => {
    const [visit] = await tx
      .insert(monitoringVisits)
      .values({
        trialSiteId: data.trialSiteId,
        monitorId: actor.id,
        scheduledDate: data.scheduledDate,
      })
      .returning();
    // the scheduled visit IS the next due monitoring activity for the site
    await tx
      .update(trialSites)
      .set({ monitoringVisitDue: data.scheduledDate })
      .where(eq(trialSites.id, data.trialSiteId));
    return {
      result: visit,
      entityType: "monitoring_visit",
      entityId: visit.id,
      after: {
        trialSiteId: data.trialSiteId,
        scheduledDate: data.scheduledDate.toISOString(),
      },
    };
  });
}

export const completeMonitoringVisitInput = z.object({
  visitId: z.string().uuid(),
  summary: z.string().min(3),
  findings: z.array(z.string().min(1)).default([]),
  reportDocumentId: z.string().uuid().optional(),
});

export async function completeMonitoringVisit(
  db: Db,
  actor: Actor,
  input: z.infer<typeof completeMonitoringVisitInput>,
  completedAt = new Date(),
) {
  assertCan(actor.role, "monitoring.log");
  const data = completeMonitoringVisitInput.parse(input);

  const [visit] = await db
    .select()
    .from(monitoringVisits)
    .where(eq(monitoringVisits.id, data.visitId))
    .limit(1);
  if (!visit) throw new MonitoringError("monitoring visit not found");
  if (visit.completedAt) {
    throw new MonitoringError("monitoring visit is already completed");
  }

  // next due date = completion + configured cadence (D-023)
  const { monitoringCadenceDays } = await getAlertConfig(db);
  const nextDue = new Date(
    completedAt.getTime() + monitoringCadenceDays * DAY,
  );

  return withAudit(db, actor, "monitoring.complete", async (tx) => {
    const [updated] = await tx
      .update(monitoringVisits)
      .set({
        completedAt,
        summary: data.summary,
        findings: data.findings,
        reportDocumentId: data.reportDocumentId ?? null,
      })
      .where(eq(monitoringVisits.id, data.visitId))
      .returning();
    await tx
      .update(trialSites)
      .set({ monitoringVisitDue: nextDue })
      .where(eq(trialSites.id, visit.trialSiteId));
    return {
      result: updated,
      entityType: "monitoring_visit",
      entityId: visit.id,
      before: { completedAt: null },
      after: {
        completedAt: completedAt.toISOString(),
        findingCount: data.findings.length,
        nextDue: nextDue.toISOString(),
      },
    };
  });
}

/** monitoring visits with trial/site labels — drives the /monitoring list */
export async function listMonitoringVisits(db: Db, limit = 50) {
  return db
    .select({
      visit: monitoringVisits,
      protocolCode: trials.protocolCode,
      trialTitle: trials.title,
      siteName: sites.name,
    })
    .from(monitoringVisits)
    .innerJoin(trialSites, eq(monitoringVisits.trialSiteId, trialSites.id))
    .innerJoin(trials, eq(trialSites.trialId, trials.id))
    .innerJoin(sites, eq(trialSites.siteId, sites.id))
    // newest-created first: a just-scheduled visit is always the top card,
    // so the monitor completes the visit they actually created
    .orderBy(desc(monitoringVisits.createdAt))
    .limit(limit);
}

/** activated trial-sites — the schedule form's picker */
export async function listActiveTrialSites(db: Db) {
  return db
    .select({
      trialSiteId: trialSites.id,
      protocolCode: trials.protocolCode,
      siteName: sites.name,
      monitoringVisitDue: trialSites.monitoringVisitDue,
    })
    .from(trialSites)
    .innerJoin(trials, eq(trialSites.trialId, trials.id))
    .innerJoin(sites, eq(trialSites.siteId, sites.id))
    .where(eq(trialSites.activationStatus, "active"))
    .orderBy(trials.protocolCode);
}
