/**
 * CDISC SDTM export — DM (demographics) and AE (adverse events) domains as
 * CSV plus a Define-XML stub (D-017). CDASH-aligned capture makes this a
 * projection, not a transformation.
 */
import { eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import {
  adverseEvents,
  participants,
  trialSites,
  trials,
} from "@/db/schema";

export const DM_COLUMNS = [
  "STUDYID",
  "DOMAIN",
  "USUBJID",
  "SUBJID",
  "RFSTDTC",
  "ARM",
  "ARMCD",
  "COUNTRY",
] as const;

export const AE_COLUMNS = [
  "STUDYID",
  "DOMAIN",
  "USUBJID",
  "AESEQ",
  "AETERM",
  "AEDECOD",
  "AESER",
  "AESEV",
  "AESTDTC",
  "AEOUT",
] as const;

function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v;
}

export function toCsv(
  columns: readonly string[],
  rows: Record<string, string>[],
): string {
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => csvEscape(row[c] ?? "")).join(","));
  }
  return lines.join("\n") + "\n";
}

const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

async function loadTrialParticipants(db: Db, trialId: string) {
  const tsRows = await db
    .select({ id: trialSites.id })
    .from(trialSites)
    .where(eq(trialSites.trialId, trialId));
  const tsIds = tsRows.map((r) => r.id);
  return tsIds.length
    ? await db
        .select()
        .from(participants)
        .where(inArray(participants.trialSiteId, tsIds))
    : [];
}

export async function buildDmDomain(db: Db, trialId: string) {
  const [trial] = await db
    .select()
    .from(trials)
    .where(eq(trials.id, trialId))
    .limit(1);
  if (!trial) throw new Error("trial not found");
  const parts = await loadTrialParticipants(db, trialId);

  const rows = parts.map((p) => ({
    STUDYID: trial.protocolCode,
    DOMAIN: "DM",
    USUBJID: p.subjectCode,
    SUBJID: p.subjectCode.split("-P-")[1] ?? p.subjectCode,
    RFSTDTC: isoDate(p.enrolledAt),
    ARM: p.arm ?? "",
    ARMCD: p.arm ? p.arm.slice(0, 8).toUpperCase() : "",
    COUNTRY: "IND",
  }));
  return { columns: DM_COLUMNS, rows, csv: toCsv(DM_COLUMNS, rows) };
}

export async function buildAeDomain(db: Db, trialId: string) {
  const [trial] = await db
    .select()
    .from(trials)
    .where(eq(trials.id, trialId))
    .limit(1);
  if (!trial) throw new Error("trial not found");
  const parts = await loadTrialParticipants(db, trialId);
  const byId = new Map(parts.map((p) => [p.id, p]));
  const aes = parts.length
    ? await db
        .select()
        .from(adverseEvents)
        .where(
          inArray(
            adverseEvents.participantId,
            parts.map((p) => p.id),
          ),
        )
    : [];

  const seq = new Map<string, number>();
  const rows = aes.map((ae) => {
    const subject = byId.get(ae.participantId)!;
    const n = (seq.get(ae.participantId) ?? 0) + 1;
    seq.set(ae.participantId, n);
    return {
      STUDYID: trial.protocolCode,
      DOMAIN: "AE",
      USUBJID: subject.subjectCode,
      AESEQ: String(n),
      AETERM: ae.term,
      AEDECOD: ae.meddraCode ?? "",
      AESER: ae.seriousness === "sae" ? "Y" : "N",
      AESEV: ae.severity.toUpperCase(),
      AESTDTC: isoDate(ae.onsetDate),
      AEOUT: ae.outcome ?? "",
    };
  });
  return { columns: AE_COLUMNS, rows, csv: toCsv(AE_COLUMNS, rows) };
}

/** Define-XML stub describing the two exported domains (roadmap: full ODM). */
export function defineXmlStub(protocolCode: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ODM xmlns="http://www.cdisc.org/ns/odm/v1.3" FileType="Snapshot"
     FileOID="${protocolCode}.define" CreationDateTime="${new Date().toISOString()}">
  <Study OID="${protocolCode}">
    <GlobalVariables>
      <StudyName>${protocolCode}</StudyName>
      <StudyDescription>AyuSphere SDTM export (focused subset: DM, AE)</StudyDescription>
      <ProtocolName>${protocolCode}</ProtocolName>
    </GlobalVariables>
    <MetaDataVersion OID="MDV.1" Name="SDTM subset">
      <ItemGroupDef OID="IG.DM" Name="DM" Repeating="No" Purpose="Tabulation">
        ${DM_COLUMNS.map((c) => `<ItemRef ItemOID="IT.DM.${c}" Mandatory="No"/>`).join("\n        ")}
      </ItemGroupDef>
      <ItemGroupDef OID="IG.AE" Name="AE" Repeating="Yes" Purpose="Tabulation">
        ${AE_COLUMNS.map((c) => `<ItemRef ItemOID="IT.AE.${c}" Mandatory="No"/>`).join("\n        ")}
      </ItemGroupDef>
    </MetaDataVersion>
  </Study>
</ODM>
`;
}
