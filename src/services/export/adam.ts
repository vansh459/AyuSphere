/**
 * CDISC ADaM export (T9.2) — ADSL, the subject-level analysis dataset:
 * one row per subject, pure projection of existing rows (the point of
 * CDASH-aligned capture, D-017). CSV via the shared writer; variable
 * metadata (ADSL_ITEMS) lives in the Define-XML module.
 */
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { participants, sites, trialSites, trials } from "@/db/schema";
import { ADSL_COLUMNS, toCsv } from "@/services/export/sdtm";

const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

/** participant status → End of Study Status (CL.EOSSTT) */
const EOSSTT: Record<string, string> = {
  completed: "COMPLETED",
  withdrawn: "DISCONTINUED",
  enrolled: "ONGOING",
  screening: "NOT STARTED",
};

export async function buildAdsl(db: Db, trialId: string) {
  const [trial] = await db
    .select()
    .from(trials)
    .where(eq(trials.id, trialId))
    .limit(1);
  if (!trial) throw new Error("trial not found");

  const rows = await db
    .select({ p: participants, siteName: sites.name })
    .from(participants)
    .innerJoin(trialSites, eq(participants.trialSiteId, trialSites.id))
    .innerJoin(sites, eq(trialSites.siteId, sites.id))
    .where(eq(trialSites.trialId, trialId));

  const adsl = rows.map(({ p, siteName }) => ({
    STUDYID: trial.protocolCode,
    USUBJID: p.subjectCode,
    SUBJID: p.subjectCode.split("-P-")[1] ?? p.subjectCode,
    SITEID: siteName,
    ARM: p.arm ?? "",
    ARMCD: p.arm ? p.arm.slice(0, 8).toUpperCase() : "",
    TRTSDT: isoDate(p.enrolledAt),
    EOSSTT: EOSSTT[p.status] ?? "ONGOING",
    DCSREAS: p.withdrawalReason ?? "",
    // safety population = subjects who started treatment (enrolment stamps
    // first exposure in this MVP data model)
    SAFFL: p.enrolledAt ? "Y" : "N",
  }));

  return {
    columns: ADSL_COLUMNS,
    rows: adsl,
    csv: toCsv(ADSL_COLUMNS, adsl),
  };
}
