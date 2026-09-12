/**
 * T7.4 — MedDRA/WHODrug demo-subset coding (D-024).
 * Gate: search returns the expected PTs; unknown codes are rejected at AE
 * capture while subset codes are stored; SDTM AEDECOD exports the decoded
 * Preferred Term (not the raw code); FHIR carries the display text.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./helpers/db";
import { participants, sites, trialSites, trials, users } from "@/db/schema";
import type { Actor } from "@/lib/audit";
import {
  MEDDRA_SUBSET,
  decodeMeddra,
  meddraByPt,
  searchMeddra,
} from "@/lib/dictionaries/meddra-subset";
import {
  WHODRUG_SUBSET,
  decodeWhodrug,
  searchWhodrug,
  whodrugByName,
} from "@/lib/dictionaries/whodrug-subset";
import { captureAdverseEvent } from "@/services/adverse-events";
import { buildAeDomain } from "@/services/export/sdtm";
import { toAdverseEvent } from "@/services/export/fhir";

let db: TestDb;
let pi: Actor;
let trialId: string;
let participantId: string;

beforeAll(async () => {
  db = await createTestDb();
  const [u] = await db
    .insert(users)
    .values([{ email: "pi@d.demo", passwordHash: "x", name: "PI", role: "pi" }])
    .returning();
  pi = { id: u.id, role: "pi" };

  const [trial] = await db
    .insert(trials)
    .values({
      protocolCode: "AYU-990",
      title: "Dictionary fixture",
      studyType: "interventional",
      intervention: "X",
      targetEnrollment: 10,
      status: "active",
      createdBy: pi.id,
    })
    .returning();
  trialId = trial.id;
  const [site] = await db
    .insert(sites)
    .values({ name: "S", city: "C", state: "ST" })
    .returning();
  const [ts] = await db
    .insert(trialSites)
    .values({ trialId: trial.id, siteId: site.id, activationStatus: "active" })
    .returning();
  const [p] = await db
    .insert(participants)
    .values({
      subjectCode: "AYU-990-P-0001",
      trialSiteId: ts.id,
      status: "enrolled",
      enrolledAt: new Date(),
    })
    .returning();
  participantId = p.id;
});

describe("T7.4 — dictionary subsets (pure)", () => {
  it("subsets are well-formed: unique codes, meaningful size", () => {
    const meddraCodes = new Set(MEDDRA_SUBSET.map((t) => t.code));
    expect(meddraCodes.size).toBe(MEDDRA_SUBSET.length);
    expect(MEDDRA_SUBSET.length).toBeGreaterThanOrEqual(120);
    for (const t of MEDDRA_SUBSET) expect(t.code).toMatch(/^\d{8}$/);

    const drugCodes = new Set(WHODRUG_SUBSET.map((t) => t.code));
    expect(drugCodes.size).toBe(WHODRUG_SUBSET.length);
    expect(WHODRUG_SUBSET.length).toBeGreaterThanOrEqual(40);
  });

  it("search finds terms by PT/SOC and drug/class substrings", () => {
    expect(searchMeddra("naus").map((t) => t.pt)).toContain("Nausea");
    expect(searchMeddra("hepato").map((t) => t.pt)).toContain("Hepatotoxicity");
    // SOC search: everything under Hepatobiliary
    expect(searchMeddra("Hepatobiliary", 50).length).toBeGreaterThanOrEqual(5);
    expect(searchMeddra("")).toEqual([]);

    expect(searchWhodrug("ashwa").map((t) => t.drugName)).toContain(
      "Ashwagandha churna",
    );
    expect(searchWhodrug("cardiotonic").map((t) => t.drugName)).toContain(
      "Arjunarishta",
    );
  });

  it("decode and exact-name resolution round-trip", () => {
    const nausea = meddraByPt("nausea");
    expect(nausea?.code).toBe("10000101");
    expect(decodeMeddra(nausea!.code)?.pt).toBe("Nausea");
    expect(decodeMeddra("99999999")).toBeUndefined();

    const drug = whodrugByName("ASHWAGANDHA CHURNA");
    expect(drug?.code).toBe("ASU-00001");
    expect(decodeWhodrug(drug!.code)?.drugName).toBe("Ashwagandha churna");
    expect(decodeWhodrug("ASU-99999")).toBeUndefined();
  });
});

describe("T7.4 — coding enforced at AE capture", () => {
  it("unknown codes are rejected; nothing is written", async () => {
    await expect(
      captureAdverseEvent(db, pi, {
        participantId,
        term: "Nausea",
        seriousness: "ae",
        severity: "mild",
        onsetDate: new Date(),
        meddraCode: "99999999",
      }),
    ).rejects.toThrow(/unknown MedDRA code/);
    await expect(
      captureAdverseEvent(db, pi, {
        participantId,
        term: "Nausea",
        seriousness: "ae",
        severity: "mild",
        onsetDate: new Date(),
        whodrugCode: "ASU-99999",
      }),
    ).rejects.toThrow(/unknown WHODrug code/);
  });

  it("subset codes are stored and decode in exports (SDTM AEDECOD, FHIR display)", async () => {
    const ae = await captureAdverseEvent(db, pi, {
      participantId,
      term: "Feeling sick after morning dose",
      seriousness: "sae",
      severity: "moderate",
      onsetDate: new Date("2026-09-10T06:00:00Z"),
      meddraCode: "10000101", // Nausea
      whodrugCode: "ASU-00001", // Ashwagandha churna
    });
    expect(ae.meddraCode).toBe("10000101");
    expect(ae.whodrugCode).toBe("ASU-00001");

    // SDTM: AEDECOD carries the decoded Preferred Term, AETERM the verbatim
    const { rows, csv } = await buildAeDomain(db, trialId);
    const row = rows.find((r) => r.USUBJID === "AYU-990-P-0001")!;
    expect(row.AETERM).toBe("Feeling sick after morning dose");
    expect(row.AEDECOD).toBe("Nausea");
    expect(csv).toContain("Nausea");

    // FHIR: coding block carries code + display
    const resource = toAdverseEvent(ae);
    expect(resource.event.coding?.[0]).toEqual({
      system: "http://terminology.hl7.org/CodeSystem/meddra",
      code: "10000101",
      display: "Nausea",
    });

    // an uncoded AE exports an empty AEDECOD (free text never leaks into it)
    await captureAdverseEvent(db, pi, {
      participantId,
      term: "Unusual metallic taste",
      seriousness: "ae",
      severity: "mild",
      onsetDate: new Date(),
    });
    const again = await buildAeDomain(db, trialId);
    const uncoded = again.rows.find(
      (r) => r.AETERM === "Unusual metallic taste",
    )!;
    expect(uncoded.AEDECOD).toBe("");
  });
});
