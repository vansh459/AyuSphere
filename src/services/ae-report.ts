/**
 * SAE regulatory report artifact (T8.2, gap-analysis G14) — assembles the
 * printable CIOMS-style per-event summary (representative demo layout, not
 * the licensed CIOMS I form): reaction, suspect formulation, study context,
 * escalation timeline, and deadline compliance. Generation by PV is audited
 * (`ae.report_generated`); viewing is read-only.
 */
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import {
  adverseEvents,
  aeActions,
  participants,
  sites,
  trialSites,
  trials,
  users,
} from "@/db/schema";
import { withAudit, type Actor } from "@/lib/audit";
import { assertCan } from "@/lib/rbac";
import { decodeMeddra } from "@/lib/dictionaries/meddra-subset";
import { decodeWhodrug } from "@/lib/dictionaries/whodrug-subset";

export class AeReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AeReportError";
  }
}

const HOUR = 3_600_000;

export type AeReport = {
  ae: typeof adverseEvents.$inferSelect;
  subjectCode: string;
  trial: {
    protocolCode: string;
    title: string;
    ctriNumber: string | null;
    intervention: string;
    dosageForm: string | null;
  };
  site: { name: string; city: string; state: string };
  meddra: { code: string; pt: string; soc: string } | null;
  whodrug: { code: string; drugName: string; drugClass: string } | null;
  timeline: { action: string; actorName: string; actorRole: string; note: string | null; at: Date }[];
  /** hours between reporting deadline and filing (negative = filed early/on time) */
  deadlineDeltaHours: number | null;
  onTime: boolean | null;
};

/** read-only assembly — the report page renders exactly this */
export async function assembleAeReport(
  db: Db,
  aeId: string,
): Promise<AeReport> {
  const [row] = await db
    .select({
      ae: adverseEvents,
      subjectCode: participants.subjectCode,
      trial: trials,
      site: sites,
    })
    .from(adverseEvents)
    .innerJoin(participants, eq(adverseEvents.participantId, participants.id))
    .innerJoin(trialSites, eq(participants.trialSiteId, trialSites.id))
    .innerJoin(trials, eq(trialSites.trialId, trials.id))
    .innerJoin(sites, eq(trialSites.siteId, sites.id))
    .where(eq(adverseEvents.id, aeId))
    .limit(1);
  if (!row) throw new AeReportError("adverse event not found");

  const actions = await db
    .select({
      action: aeActions.action,
      note: aeActions.note,
      at: aeActions.at,
      actorName: users.name,
      actorRole: users.role,
    })
    .from(aeActions)
    .leftJoin(users, eq(aeActions.actorId, users.id))
    .where(eq(aeActions.aeId, aeId))
    .orderBy(aeActions.at);

  const { ae } = row;
  const meddra = decodeMeddra(ae.meddraCode) ?? null;
  const whodrug = decodeWhodrug(ae.whodrugCode) ?? null;
  const deadlineDeltaHours = ae.reportedAt
    ? Math.round(
        ((ae.reportedAt.getTime() - ae.reportingDeadline.getTime()) / HOUR) * 10,
      ) / 10
    : null;

  return {
    ae,
    subjectCode: row.subjectCode,
    trial: {
      protocolCode: row.trial.protocolCode,
      title: row.trial.title,
      ctriNumber: row.trial.ctriNumber,
      intervention: row.trial.intervention,
      dosageForm: row.trial.dosageForm,
    },
    site: { name: row.site.name, city: row.site.city, state: row.site.state },
    meddra,
    whodrug,
    timeline: actions.map((a) => ({
      action: a.action,
      actorName: a.actorName ?? "system",
      actorRole: a.actorRole ?? "system",
      note: a.note,
      at: a.at,
    })),
    deadlineDeltaHours,
    onTime: deadlineDeltaHours === null ? null : deadlineDeltaHours <= 0,
  };
}

/**
 * The audited generation step (PV/admin): records WHO produced the
 * regulatory artifact and WHEN — the report page itself stays a read.
 */
export async function generateAeReport(db: Db, actor: Actor, aeId: string) {
  assertCan(actor.role, "ae.review");
  const report = await assembleAeReport(db, aeId);
  return withAudit(db, actor, "ae.report_generated", async () => ({
    result: report,
    entityType: "adverse_event",
    entityId: aeId,
    after: {
      term: report.ae.term,
      seriousness: report.ae.seriousness,
      status: report.ae.status,
      onTime: report.onTime,
    },
  }));
}
