/**
 * CDISC SDTM export — DM (demographics) and AE (adverse events) domains as
 * CSV plus a Define-XML stub (D-017). CDASH-aligned capture makes this a
 * projection, not a transformation.
 */
import { eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import {
  adverseEvents,
  participants,
  trialSites,
  trials,
} from "@/db/schema";
import { decodeMeddra } from "@/lib/dictionaries/meddra-subset";
import { parseTemplateFields, type CrfField } from "@/lib/crf";

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
      // AEDECOD is the dictionary-derived Preferred Term (D-024), not the code
      AEDECOD: decodeMeddra(ae.meddraCode)?.pt ?? "",
      AESER: ae.seriousness === "sae" ? "Y" : "N",
      AESEV: ae.severity.toUpperCase(),
      AESTDTC: isoDate(ae.onsetDate),
      AEOUT: ae.outcome ?? "",
    };
  });
  return { columns: AE_COLUMNS, rows, csv: toCsv(AE_COLUMNS, rows) };
}

/**
 * Per-trial row counts for the Exports page (T6.9) — how many data rows each
 * domain will contain, so an empty-but-valid CSV (headers only) is expected
 * before download instead of read as a failure.
 */
export async function exportRowCounts(db: Db) {
  return db
    .select({
      trialId: trials.id,
      participants: sql<number>`count(distinct ${participants.id})::int`,
      aes: sql<number>`count(distinct ${adverseEvents.id})::int`,
    })
    .from(trials)
    .leftJoin(trialSites, eq(trialSites.trialId, trials.id))
    .leftJoin(participants, eq(participants.trialSiteId, trialSites.id))
    .leftJoin(adverseEvents, eq(adverseEvents.participantId, participants.id))
    .groupBy(trials.id);
}

// ---------- Define-XML (T9.1 — real variable-level metadata) ----------

export type DefineDataType = "text" | "integer" | "float" | "date";

export type DefineItem = {
  oid: string;
  name: string;
  label: string;
  dataType: DefineDataType;
  length?: number;
  codeListOid?: string;
  mandatory: boolean;
};

export type DefineCodeList = {
  oid: string;
  name: string;
  /** [codedValue, decode] pairs */
  items: [string, string][];
};

export const DEFINE_CODE_LISTS: DefineCodeList[] = [
  { oid: "CL.NY", name: "No Yes Response", items: [["N", "No"], ["Y", "Yes"]] },
  {
    oid: "CL.AESEV",
    name: "Severity/Intensity Scale for Adverse Events",
    items: [["MILD", "Mild"], ["MODERATE", "Moderate"], ["SEVERE", "Severe"]],
  },
  { oid: "CL.COUNTRY", name: "Country", items: [["IND", "India"]] },
  {
    oid: "CL.EOSSTT",
    name: "End of Study Status",
    items: [
      ["COMPLETED", "Completed"],
      ["DISCONTINUED", "Discontinued"],
      ["ONGOING", "Ongoing"],
      ["NOT STARTED", "Not started (screening)"],
    ],
  },
];

/** DM variable metadata — 1:1 with DM_COLUMNS (tested) */
export const DM_ITEMS: DefineItem[] = [
  { oid: "IT.DM.STUDYID", name: "STUDYID", label: "Study Identifier", dataType: "text", length: 20, mandatory: true },
  { oid: "IT.DM.DOMAIN", name: "DOMAIN", label: "Domain Abbreviation", dataType: "text", length: 2, mandatory: true },
  { oid: "IT.DM.USUBJID", name: "USUBJID", label: "Unique Subject Identifier", dataType: "text", length: 40, mandatory: true },
  { oid: "IT.DM.SUBJID", name: "SUBJID", label: "Subject Identifier for the Study", dataType: "text", length: 20, mandatory: true },
  { oid: "IT.DM.RFSTDTC", name: "RFSTDTC", label: "Subject Reference Start Date/Time", dataType: "date", mandatory: false },
  { oid: "IT.DM.ARM", name: "ARM", label: "Description of Planned Arm", dataType: "text", length: 40, mandatory: false },
  { oid: "IT.DM.ARMCD", name: "ARMCD", label: "Planned Arm Code", dataType: "text", length: 8, mandatory: false },
  { oid: "IT.DM.COUNTRY", name: "COUNTRY", label: "Country", dataType: "text", length: 3, codeListOid: "CL.COUNTRY", mandatory: true },
];

/** AE variable metadata — 1:1 with AE_COLUMNS (tested) */
export const AE_ITEMS: DefineItem[] = [
  { oid: "IT.AE.STUDYID", name: "STUDYID", label: "Study Identifier", dataType: "text", length: 20, mandatory: true },
  { oid: "IT.AE.DOMAIN", name: "DOMAIN", label: "Domain Abbreviation", dataType: "text", length: 2, mandatory: true },
  { oid: "IT.AE.USUBJID", name: "USUBJID", label: "Unique Subject Identifier", dataType: "text", length: 40, mandatory: true },
  { oid: "IT.AE.AESEQ", name: "AESEQ", label: "Sequence Number", dataType: "integer", mandatory: true },
  { oid: "IT.AE.AETERM", name: "AETERM", label: "Reported Term for the Adverse Event", dataType: "text", length: 200, mandatory: true },
  { oid: "IT.AE.AEDECOD", name: "AEDECOD", label: "Dictionary-Derived Term (MedDRA PT, demo subset)", dataType: "text", length: 200, mandatory: false },
  { oid: "IT.AE.AESER", name: "AESER", label: "Serious Event", dataType: "text", length: 1, codeListOid: "CL.NY", mandatory: true },
  { oid: "IT.AE.AESEV", name: "AESEV", label: "Severity/Intensity", dataType: "text", length: 8, codeListOid: "CL.AESEV", mandatory: false },
  { oid: "IT.AE.AESTDTC", name: "AESTDTC", label: "Start Date/Time of Adverse Event", dataType: "date", mandatory: true },
  { oid: "IT.AE.AEOUT", name: "AEOUT", label: "Outcome of Adverse Event", dataType: "text", length: 100, mandatory: false },
];

// ADaM ADSL metadata (T9.2) lives beside the other Define metadata; the
// dataset builder is src/services/export/adam.ts (imports from here — one
// direction only, no cycle).
export const ADSL_COLUMNS = [
  "STUDYID",
  "USUBJID",
  "SUBJID",
  "SITEID",
  "ARM",
  "ARMCD",
  "TRTSDT",
  "EOSSTT",
  "DCSREAS",
  "SAFFL",
] as const;

/** ADSL variable metadata — 1:1 with ADSL_COLUMNS (tested) */
export const ADSL_ITEMS: DefineItem[] = [
  { oid: "IT.ADSL.STUDYID", name: "STUDYID", label: "Study Identifier", dataType: "text", length: 20, mandatory: true },
  { oid: "IT.ADSL.USUBJID", name: "USUBJID", label: "Unique Subject Identifier", dataType: "text", length: 40, mandatory: true },
  { oid: "IT.ADSL.SUBJID", name: "SUBJID", label: "Subject Identifier for the Study", dataType: "text", length: 20, mandatory: true },
  { oid: "IT.ADSL.SITEID", name: "SITEID", label: "Study Site Identifier", dataType: "text", length: 60, mandatory: true },
  { oid: "IT.ADSL.ARM", name: "ARM", label: "Description of Planned Arm", dataType: "text", length: 40, mandatory: false },
  { oid: "IT.ADSL.ARMCD", name: "ARMCD", label: "Planned Arm Code", dataType: "text", length: 8, mandatory: false },
  { oid: "IT.ADSL.TRTSDT", name: "TRTSDT", label: "Date of First Exposure to Treatment (enrolment)", dataType: "date", mandatory: false },
  { oid: "IT.ADSL.EOSSTT", name: "EOSSTT", label: "End of Study Status", dataType: "text", length: 12, codeListOid: "CL.EOSSTT", mandatory: true },
  { oid: "IT.ADSL.DCSREAS", name: "DCSREAS", label: "Reason for Discontinuation from Study", dataType: "text", length: 200, mandatory: false },
  { oid: "IT.ADSL.SAFFL", name: "SAFFL", label: "Safety Population Flag", dataType: "text", length: 1, codeListOid: "CL.NY", mandatory: true },
];

function xmlEscape(v: string): string {
  return v
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const CRF_TYPE_MAP: Record<CrfField["type"], DefineDataType> = {
  number: "float",
  text: "text",
  date: "date",
  select: "text",
};

/** a CRF template's fields (cdashVar-named) → Define items for its ItemGroup */
export function crfTemplateItems(
  templateIndex: number,
  fields: CrfField[],
): DefineItem[] {
  return fields.map((f) => ({
    oid: `IT.CRF${templateIndex}.${f.cdashVar}`,
    name: f.cdashVar,
    label: `${f.label}${f.unit ? ` (${f.unit})` : ""}${
      f.min !== undefined ? ` [plausible ${f.min}–${f.max}]` : ""
    }`,
    dataType: CRF_TYPE_MAP[f.type],
    ...(f.type === "text" || f.type === "select" ? { length: 200 } : {}),
    mandatory: f.required,
  }));
}

function itemRefXml(items: DefineItem[]): string {
  return items
    .map(
      (it, i) =>
        `<ItemRef ItemOID="${it.oid}" OrderNumber="${i + 1}" Mandatory="${it.mandatory ? "Yes" : "No"}"/>`,
    )
    .join("\n        ");
}

function itemDefXml(items: DefineItem[]): string {
  return items
    .map(
      (it) => `<ItemDef OID="${it.oid}" Name="${xmlEscape(it.name)}" DataType="${it.dataType}"${
        it.length !== undefined ? ` Length="${it.length}"` : ""
      }>
        <Description><TranslatedText xml:lang="en">${xmlEscape(it.label)}</TranslatedText></Description>
        ${it.codeListOid ? `<CodeListRef CodeListOID="${it.codeListOid}"/>` : ""}
      </ItemDef>`,
    )
    .join("\n      ");
}

function codeListXml(lists: DefineCodeList[]): string {
  return lists
    .map(
      (cl) => `<CodeList OID="${cl.oid}" Name="${xmlEscape(cl.name)}" DataType="text">
        ${cl.items
          .map(
            ([value, decode]) =>
              `<CodeListItem CodedValue="${xmlEscape(value)}"><Decode><TranslatedText xml:lang="en">${xmlEscape(decode)}</TranslatedText></Decode></CodeListItem>`,
          )
          .join("\n        ")}
      </CodeList>`,
    )
    .join("\n      ");
}

export type DefineTemplateInput = {
  name: string;
  visitType: string;
  fields: unknown;
};

/**
 * Define-XML with real variable-level metadata (T9.1): ItemDefs carrying
 * DataType/Length/labels and CodeLists for the exported SDTM DM/AE domains,
 * plus one ItemGroup per CRF template whose ItemDefs derive from the
 * template's cdashVar-named field rules (D-012/D-017 — capture metadata IS
 * the submission metadata). ODM 1.3 structure; full def:2.x stylesheet
 * packaging remains a stated roadmap item.
 */
export function defineXml(
  trial: { protocolCode: string; title: string },
  templates: DefineTemplateInput[] = [],
): string {
  const crfGroups = templates.map((t, i) => ({
    oid: `IG.CRF${i + 1}`,
    name: `${t.visitType} — ${t.name}`,
    items: crfTemplateItems(i + 1, parseTemplateFields(t.fields)),
  }));
  const allItems = [
    ...DM_ITEMS,
    ...AE_ITEMS,
    ...ADSL_ITEMS,
    ...crfGroups.flatMap((g) => g.items),
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
<ODM xmlns="http://www.cdisc.org/ns/odm/v1.3" FileType="Snapshot"
     FileOID="${xmlEscape(trial.protocolCode)}.define" CreationDateTime="${new Date().toISOString()}">
  <Study OID="${xmlEscape(trial.protocolCode)}">
    <GlobalVariables>
      <StudyName>${xmlEscape(trial.protocolCode)}</StudyName>
      <StudyDescription>${xmlEscape(trial.title)} — AyuSphere SDTM export (DM, AE) with CRF capture metadata</StudyDescription>
      <ProtocolName>${xmlEscape(trial.protocolCode)}</ProtocolName>
    </GlobalVariables>
    <MetaDataVersion OID="MDV.1" Name="SDTM subset + ADaM ADSL + CRF capture metadata">
      <ItemGroupDef OID="IG.DM" Name="DM" Repeating="No" Purpose="Tabulation">
        ${itemRefXml(DM_ITEMS)}
      </ItemGroupDef>
      <ItemGroupDef OID="IG.AE" Name="AE" Repeating="Yes" Purpose="Tabulation">
        ${itemRefXml(AE_ITEMS)}
      </ItemGroupDef>
      <ItemGroupDef OID="IG.ADSL" Name="ADSL" Repeating="No" Purpose="Analysis">
        ${itemRefXml(ADSL_ITEMS)}
      </ItemGroupDef>
      ${crfGroups
        .map(
          (g) => `<ItemGroupDef OID="${g.oid}" Name="${xmlEscape(g.name)}" Repeating="Yes" Purpose="Tabulation">
        ${itemRefXml(g.items)}
      </ItemGroupDef>`,
        )
        .join("\n      ")}
      ${itemDefXml(allItems)}
      ${codeListXml(DEFINE_CODE_LISTS)}
    </MetaDataVersion>
  </Study>
</ODM>
`;
}
