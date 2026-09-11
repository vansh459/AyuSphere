/** Dashboard KPI queries (workflow.md §10) — every number click-throughs. */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import {
  adverseEvents,
  alerts,
  participants,
  sites,
  trialSites,
  trials,
  visits,
} from "@/db/schema";

export async function portfolioKpis(db: Db) {
  const [row] = await db
    .select({
      activeTrials: sql<number>`(select count(*)::int from ${trials} where status = 'active')`,
      totalTrials: sql<number>`(select count(*)::int from ${trials})`,
      enrolledParticipants: sql<number>`(select count(*)::int from ${participants} where status = 'enrolled')`,
      withdrawnParticipants: sql<number>`(select count(*)::int from ${participants} where status = 'withdrawn')`,
      sites: sql<number>`(select count(*)::int from ${sites})`,
      openVisits: sql<number>`(select count(*)::int from ${visits} where status in ('upcoming','due'))`,
      overdueVisits: sql<number>`(select count(*)::int from ${visits} where status = 'overdue')`,
      openAdverseEvents: sql<number>`(select count(*)::int from ${adverseEvents} where status in ('open','under_review'))`,
      openAlerts: sql<number>`(select count(*)::int from ${alerts} where status = 'open')`,
    })
    .from(sql`(select 1) as one`);
  return row;
}

export type SitePerformance = {
  trialSiteId: string;
  siteName: string;
  target: number;
  enrolled: number;
  /** 0…1, capped at 1 */
  rate: number;
};

export async function sitePerformance(
  db: Db,
  trialId: string,
): Promise<SitePerformance[]> {
  const rows = await db
    .select({
      trialSiteId: trialSites.id,
      siteName: sites.name,
      target: trialSites.enrollmentTarget,
      enrolled: sql<number>`(select count(*)::int from ${participants} p
        where p.trial_site_id = ${trialSites.id} and p.status = 'enrolled')`,
    })
    .from(trialSites)
    .innerJoin(sites, eq(trialSites.siteId, sites.id))
    .where(eq(trialSites.trialId, trialId))
    .orderBy(sites.name);
  return rows.map((r) => ({
    ...r,
    rate: r.target > 0 ? Math.min(r.enrolled / r.target, 1) : 0,
  }));
}

export async function trialEnrolment(db: Db, trialId: string) {
  const [trial] = await db
    .select()
    .from(trials)
    .where(eq(trials.id, trialId))
    .limit(1);
  if (!trial) throw new Error("trial not found");
  const [{ enrolled, withdrawn }] = await db
    .select({
      enrolled: sql<number>`count(*) filter (where ${participants.status} = 'enrolled')::int`,
      withdrawn: sql<number>`count(*) filter (where ${participants.status} = 'withdrawn')::int`,
    })
    .from(participants)
    .innerJoin(trialSites, eq(participants.trialSiteId, trialSites.id))
    .where(eq(trialSites.trialId, trialId));
  return {
    target: trial.targetEnrollment,
    enrolled,
    withdrawn,
    progress:
      trial.targetEnrollment > 0
        ? Math.min(enrolled / trial.targetEnrollment, 1)
        : 0,
    dropoutRate:
      enrolled + withdrawn > 0 ? withdrawn / (enrolled + withdrawn) : 0,
  };
}

export async function openAesByDeadline(db: Db) {
  return db
    .select({
      ae: adverseEvents,
      subjectCode: participants.subjectCode,
    })
    .from(adverseEvents)
    .innerJoin(participants, eq(adverseEvents.participantId, participants.id))
    .where(inArray(adverseEvents.status, ["open", "under_review"]))
    .orderBy(adverseEvents.reportingDeadline);
}

export async function visitCompliance(db: Db, trialId: string) {
  const [row] = await db
    .select({
      completed: sql<number>`count(*) filter (where ${visits.status} = 'completed')::int`,
      missed: sql<number>`count(*) filter (where ${visits.status} = 'missed')::int`,
      overdue: sql<number>`count(*) filter (where ${visits.status} = 'overdue')::int`,
      total: sql<number>`count(*)::int`,
    })
    .from(visits)
    .innerJoin(participants, eq(visits.participantId, participants.id))
    .innerJoin(trialSites, eq(participants.trialSiteId, trialSites.id))
    .where(
      and(eq(trialSites.trialId, trialId), sql`${visits.status} != 'cancelled'`),
    );
  const denominator = row.completed + row.missed + row.overdue;
  return {
    ...row,
    complianceRate: denominator > 0 ? row.completed / denominator : 1,
  };
}
