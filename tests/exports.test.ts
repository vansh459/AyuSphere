import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "./helpers/db";
import { seed } from "@/db/seed";
import { trials } from "@/db/schema";
import { buildTrialBundle, toPatient } from "@/services/export/fhir";
import {
  ADSL_COLUMNS,
  ADSL_ITEMS,
  AE_COLUMNS,
  AE_ITEMS,
  DEFINE_CODE_LISTS,
  DM_COLUMNS,
  DM_ITEMS,
  buildAeDomain,
  buildDmDomain,
  defineXml,
  toCsv,
} from "@/services/export/sdtm";
import { buildAdsl } from "@/services/export/adam";
import { DEFAULT_CRF_FIELDS } from "@/lib/crf";

let db: TestDb;
let ayu1Id: string;

beforeAll(async () => {
  db = await createTestDb();
  await seed(db);
  const [t] = await db
    .select()
    .from(trials)
    .where(eq(trials.protocolCode, "AYU-001"));
  ayu1Id = t.id;
}, 180_000);

describe("T4.1 — FHIR R4 bundle", () => {
  it("bundles ResearchStudy + Patients + ResearchSubjects + AdverseEvents with correct counts", async () => {
    const bundle = await buildTrialBundle(db, ayu1Id);
    expect(bundle.resourceType).toBe("Bundle");
    const byType = new Map<string, number>();
    for (const e of bundle.entry) {
      byType.set(
        e.resource.resourceType,
        (byType.get(e.resource.resourceType) ?? 0) + 1,
      );
    }
    expect(byType.get("ResearchStudy")).toBe(1);
    expect(byType.get("Patient")).toBe(45); // AYU-001: 24+18+3
    expect(byType.get("ResearchSubject")).toBe(45);
    expect(byType.get("AdverseEvent")).toBe(3); // all seeded AEs are on AYU-001 participants
    expect(bundle.total).toBe(1 + 45 + 45 + 3);
  });

  it("ResearchStudy carries protocol + CTRI identifiers", async () => {
    const bundle = await buildTrialBundle(db, ayu1Id);
    const study = bundle.entry[0].resource as {
      identifier: { system: string; value: string }[];
      status: string;
    };
    expect(study.identifier.map((i) => i.value)).toContain("AYU-001");
    expect(study.identifier.map((i) => i.value)).toContain(
      "CTRI/2026/04/012345",
    );
    expect(study.status).toBe("active");
  });

  it("Patient resources are de-identified: subject code only, no identity keys", async () => {
    const bundle = await buildTrialBundle(db, ayu1Id);
    const patients = bundle.entry
      .map((e) => e.resource)
      .filter((r) => r.resourceType === "Patient");
    for (const p of patients) {
      for (const forbidden of ["name", "telecom", "address", "birthDate", "gender"]) {
        expect(p, `Patient must not carry '${forbidden}'`).not.toHaveProperty(
          forbidden,
        );
      }
      const withId = p as { identifier: { system: string; value: string }[] };
      expect(withId.identifier[0].value).toMatch(/^AYU-001-P-\d{4}$/);
    }
  });
});

describe("T4.2 — SDTM domains", () => {
  it("DM: exact column set and one row per participant", async () => {
    const dm = await buildDmDomain(db, ayu1Id);
    expect([...dm.columns]).toEqual([...DM_COLUMNS]);
    expect(dm.rows).toHaveLength(45);
    const first = dm.rows[0];
    expect(first.DOMAIN).toBe("DM");
    expect(first.STUDYID).toBe("AYU-001");
    expect(first.USUBJID).toMatch(/^AYU-001-P-/);
    expect(first.COUNTRY).toBe("IND");
    expect(first.RFSTDTC).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("AE: seriousness maps to Y/N, sequence numbers per subject", async () => {
    const ae = await buildAeDomain(db, ayu1Id);
    expect([...ae.columns]).toEqual([...AE_COLUMNS]);
    expect(ae.rows).toHaveLength(3);
    const sae = ae.rows.find((r) => r.AESER === "Y");
    expect(sae).toBeTruthy();
    expect(sae!.AETERM).toBe("Severe gastric irritation");
    expect(sae!.AESEV).toBe("SEVERE");
    for (const row of ae.rows) expect(["Y", "N"]).toContain(row.AESER);
  });

  it("CSV escapes commas and quotes", () => {
    const csv = toCsv(["A", "B"], [{ A: 'has "quotes"', B: "with, comma" }]);
    expect(csv).toBe('A,B\n"has ""quotes""","with, comma"\n');
  });
});

describe("T9.2 — ADaM ADSL", () => {
  it("exact column set, one row per subject, SAFFL consistent with enrolment", async () => {
    const adsl = await buildAdsl(db, ayu1Id);
    expect([...adsl.columns]).toEqual([...ADSL_COLUMNS]);
    expect(adsl.rows).toHaveLength(45);
    for (const row of adsl.rows) {
      expect(row.STUDYID).toBe("AYU-001");
      expect(row.USUBJID).toMatch(/^AYU-001-P-/);
      // safety population flag ↔ first-exposure (enrolment) date
      expect(row.SAFFL).toBe(row.TRTSDT ? "Y" : "N");
      expect(["COMPLETED", "DISCONTINUED", "ONGOING", "NOT STARTED"]).toContain(
        row.EOSSTT,
      );
      // only discontinued subjects may carry a discontinuation reason
      if (row.EOSSTT !== "DISCONTINUED") expect(row.DCSREAS).toBe("");
    }
  });

  it("a withdrawn subject carries EOSSTT=DISCONTINUED and DCSREAS", async () => {
    const schema = await import("@/db/schema");
    // plant a withdrawal on one enrolled AYU-001 subject
    const [{ participant: enrolled }] = await db
      .select({ participant: schema.participants })
      .from(schema.participants)
      .innerJoin(
        schema.trialSites,
        eq(schema.participants.trialSiteId, schema.trialSites.id),
      )
      .where(eq(schema.trialSites.trialId, ayu1Id))
      .limit(50)
      .then((rows) =>
        rows.filter((r) => r.participant.status === "enrolled").slice(0, 1),
      );
    await db
      .update(schema.participants)
      .set({
        status: "withdrawn",
        withdrawalReason: "consent withdrawn by participant",
        withdrawnAt: new Date(),
      })
      .where(eq(schema.participants.id, enrolled.id));

    const adsl = await buildAdsl(db, ayu1Id);
    const row = adsl.rows.find((r) => r.USUBJID === enrolled.subjectCode)!;
    expect(row.EOSSTT).toBe("DISCONTINUED");
    expect(row.DCSREAS).toBe("consent withdrawn by participant");
    expect(row.SAFFL).toBe("Y"); // was enrolled → in the safety population
    expect(adsl.csv).toContain("consent withdrawn by participant");
  });

  it("ADSL is listed in the Define-XML as an Analysis ItemGroup, 1:1 with columns", () => {
    expect(ADSL_ITEMS.map((i) => i.name)).toEqual([...ADSL_COLUMNS]);
    const xml = defineXml({ protocolCode: "AYU-001", title: "T" });
    expect(xml).toContain(
      'ItemGroupDef OID="IG.ADSL" Name="ADSL" Repeating="No" Purpose="Analysis"',
    );
    expect(xml).toContain('ItemDef OID="IT.ADSL.EOSSTT"');
    expect(xml).toContain('CodeListRef CodeListOID="CL.EOSSTT"');
  });
});

describe("T9.1 — Define-XML with real variable-level metadata", () => {
  const TRIAL = { protocolCode: "AYU-001", title: "Fixture & trial <title>" };
  const TEMPLATES = [
    { name: "Baseline CRF", visitType: "Baseline", fields: DEFAULT_CRF_FIELDS },
  ];
  const xml = defineXml(TRIAL, TEMPLATES);

  it("variable metadata is 1:1 with the exported CSV columns", () => {
    expect(DM_ITEMS.map((i) => i.name)).toEqual([...DM_COLUMNS]);
    expect(AE_ITEMS.map((i) => i.name)).toEqual([...AE_COLUMNS]);
  });

  it("every ItemRef resolves to an ItemDef; every CodeListRef to a CodeList", () => {
    const refOids = [...xml.matchAll(/ItemRef ItemOID="([^"]+)"/g)].map((m) => m[1]);
    const defOids = new Set(
      [...xml.matchAll(/ItemDef OID="([^"]+)"/g)].map((m) => m[1]),
    );
    expect(refOids.length).toBeGreaterThan(0);
    for (const oid of refOids) {
      expect(defOids.has(oid), `ItemRef ${oid} must have an ItemDef`).toBe(true);
    }
    // and no orphan ItemDefs either
    expect(defOids.size).toBe(new Set(refOids).size);

    const clRefs = [...xml.matchAll(/CodeListRef CodeListOID="([^"]+)"/g)].map(
      (m) => m[1],
    );
    const clDefs = new Set(
      [...xml.matchAll(/CodeList OID="([^"]+)"/g)].map((m) => m[1]),
    );
    expect(clRefs.length).toBeGreaterThan(0);
    for (const oid of clRefs) {
      expect(clDefs.has(oid), `CodeListRef ${oid} must resolve`).toBe(true);
    }
    expect(clDefs.size).toBe(DEFINE_CODE_LISTS.length);
  });

  it("datatypes match column semantics; codelists carry decodes", () => {
    expect(xml).toContain('ItemDef OID="IT.DM.RFSTDTC" Name="RFSTDTC" DataType="date"');
    expect(xml).toContain('ItemDef OID="IT.AE.AESTDTC" Name="AESTDTC" DataType="date"');
    expect(xml).toContain('ItemDef OID="IT.AE.AESEQ" Name="AESEQ" DataType="integer"');
    expect(xml).toContain('ItemDef OID="IT.AE.AESER" Name="AESER" DataType="text" Length="1"');
    expect(xml).toContain('CodeListItem CodedValue="MODERATE"');
    expect(xml).toContain("<Decode><TranslatedText xml:lang=\"en\">Moderate</TranslatedText></Decode>");
    // mandatory flags flow into ItemRefs
    expect(xml).toMatch(/ItemRef ItemOID="IT\.AE\.AETERM"[^/]*Mandatory="Yes"/);
    expect(xml).toMatch(/ItemRef ItemOID="IT\.AE\.AEOUT"[^/]*Mandatory="No"/);
  });

  it("CRF templates become ItemGroups with cdashVar-named, typed, unit-labeled ItemDefs", () => {
    expect(xml).toContain('ItemGroupDef OID="IG.CRF1" Name="Baseline — Baseline CRF"');
    // number field → float, label carries unit + plausible range
    expect(xml).toContain('ItemDef OID="IT.CRF1.VSORRES_SYSBP" Name="VSORRES_SYSBP" DataType="float"');
    expect(xml).toContain("Systolic BP (mmHg) [plausible 70–250]");
    // text field → text
    expect(xml).toContain('ItemDef OID="IT.CRF1.CONOTES" Name="CONOTES" DataType="text"');
  });

  it("is well-formed XML (balanced tags) and escapes the trial title", () => {
    expect(xml).toContain("Fixture &amp; trial &lt;title&gt;");
    // lightweight well-formedness: every open tag closes in order
    const tags = [...xml.matchAll(/<(\/?)([A-Za-z][\w:.-]*)((?:"[^"]*"|[^"<>])*?)(\/?)>/g)];
    const stack: string[] = [];
    for (const [, closing, name, , selfClosing] of tags) {
      if (name.startsWith("?")) continue;
      if (selfClosing) continue;
      if (closing) {
        expect(stack.pop(), `closing </${name}> must match`).toBe(name);
      } else {
        stack.push(name);
      }
    }
    expect(stack).toEqual([]);
  });
});
