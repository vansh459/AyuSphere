import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "./helpers/db";
import { seed } from "@/db/seed";
import { trials } from "@/db/schema";
import { buildTrialBundle, toPatient } from "@/services/export/fhir";
import {
  AE_COLUMNS,
  DM_COLUMNS,
  buildAeDomain,
  buildDmDomain,
  defineXmlStub,
  toCsv,
} from "@/services/export/sdtm";

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
}, 60_000);

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

  it("CSV escapes commas/quotes and Define-XML stub names both domains", () => {
    const csv = toCsv(["A", "B"], [{ A: 'has "quotes"', B: "with, comma" }]);
    expect(csv).toBe('A,B\n"has ""quotes""","with, comma"\n');
    const xml = defineXmlStub("AYU-001");
    expect(xml).toContain('ItemGroupDef OID="IG.DM"');
    expect(xml).toContain('ItemGroupDef OID="IG.AE"');
    expect(xml).toContain("AYU-001");
  });
});
