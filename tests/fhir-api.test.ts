/**
 * T9.3 — FHIR import service (the EDC/HIS inbound stub, D-026).
 * Gate: an Observation bundle creates a DRAFT CRF entry mapped through the
 * visit's template (cdashVar first, name/label fallback; unmatched reported,
 * never stored) — never an approved one; malformed bundles, unknown
 * subjects, and out-of-range values are refused; RBAC-guarded; the import is
 * audited alongside the crf.create row.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "./helpers/db";
import {
  auditEvents,
  crfEntries,
  crfTemplates,
  participants,
  sites,
  trialSites,
  trials,
  users,
  visits,
} from "@/db/schema";
import type { Actor } from "@/lib/audit";
import { RbacError } from "@/lib/rbac";
import type { CrfField } from "@/lib/crf";
import { CrfError } from "@/services/crf";
import {
  FhirImportError,
  importObservationBundle,
} from "@/services/fhir-import";

const FIELDS: CrfField[] = [
  { name: "sbp", label: "Systolic BP", type: "number", unit: "mmHg", min: 70, max: 250, required: true, cdashVar: "VSORRES_SYSBP" },
  { name: "dose_mg", label: "Dose", type: "number", unit: "mg", min: 0, max: 2000, required: true, cdashVar: "EXDOSE" },
  { name: "notes", label: "Clinical notes", type: "text", required: false, cdashVar: "CONOTES" },
];

function observation(overrides: {
  subject?: string;
  code?: { coding?: { code: string }[]; text?: string };
  value?: number | string;
}) {
  return {
    resourceType: "Observation" as const,
    subject: { identifier: { value: overrides.subject ?? "AYU-FHIR-P-0001" } },
    code: overrides.code ?? { coding: [{ code: "VSORRES_SYSBP" }] },
    ...(typeof overrides.value === "number"
      ? { valueQuantity: { value: overrides.value, unit: "u" } }
      : { valueString: overrides.value ?? "" }),
  };
}

function bundle(observations: unknown[]) {
  return {
    resourceType: "Bundle" as const,
    type: "collection",
    entry: observations.map((resource) => ({ resource })),
  };
}

let db: TestDb;
let coordinator: Actor, regulator: Actor;
let visitId: string;

beforeAll(async () => {
  db = await createTestDb();
  const rows = await db
    .insert(users)
    .values([
      { email: "co@fhir.demo", passwordHash: "x", name: "CO", role: "coordinator" },
      { email: "reg@fhir.demo", passwordHash: "x", name: "REG", role: "regulator" },
    ])
    .returning();
  coordinator = { id: rows[0].id, role: "coordinator" };
  regulator = { id: rows[1].id, role: "regulator" };

  const [trial] = await db
    .insert(trials)
    .values({
      protocolCode: "AYU-FHIR",
      title: "FHIR import fixture",
      studyType: "interventional",
      intervention: "X",
      targetEnrollment: 5,
      status: "active",
      createdBy: coordinator.id,
    })
    .returning();
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
    .values({ subjectCode: "AYU-FHIR-P-0001", trialSiteId: ts.id })
    .returning();
  const [template] = await db
    .insert(crfTemplates)
    .values({
      trialId: trial.id,
      visitType: "Baseline",
      name: "Baseline CRF",
      fields: FIELDS,
    })
    .returning();
  const now = Date.now();
  const [visit] = await db
    .insert(visits)
    .values({
      participantId: p.id,
      templateId: template.id,
      visitNumber: 1,
      name: "Baseline",
      scheduledDate: new Date(now),
      windowStart: new Date(now - 86_400_000),
      windowEnd: new Date(now + 86_400_000),
      status: "due",
    })
    .returning();
  visitId = visit.id;
});

describe("T9.3 — guards", () => {
  it("RBAC: roles without crf.enter are refused", async () => {
    await expect(
      importObservationBundle(db, regulator, bundle([observation({ value: 120 })])),
    ).rejects.toThrow(RbacError);
  });

  it("malformed bundles are rejected by Zod", async () => {
    await expect(
      importObservationBundle(db, coordinator, { totally: "wrong" }),
    ).rejects.toThrow(FhirImportError);
    await expect(
      importObservationBundle(db, coordinator, {
        resourceType: "Bundle",
        entry: [],
      }),
    ).rejects.toThrow(/no Observation entries/);
  });

  it("unknown subjects and mixed subjects are refused", async () => {
    await expect(
      importObservationBundle(
        db,
        coordinator,
        bundle([observation({ subject: "AYU-GHOST-P-0001", value: 120 })]),
      ),
    ).rejects.toThrow(/unknown subject/);
    await expect(
      importObservationBundle(
        db,
        coordinator,
        bundle([
          observation({ value: 120 }),
          observation({ subject: "AYU-OTHER-P-0002", value: 500 }),
        ]),
      ),
    ).rejects.toThrow(/same subject/);
  });

  it("out-of-range imported values fail the SAME validation as manual entry", async () => {
    await expect(
      importObservationBundle(
        db,
        coordinator,
        bundle([observation({ value: 9000 })]), // sbp way out of range
      ),
    ).rejects.toThrow(CrfError);
    // nothing was written
    const entries = await db.select().from(crfEntries);
    expect(entries).toHaveLength(0);
  });
});

describe("T9.3 — a valid bundle lands as a reviewable DRAFT", () => {
  it("maps by cdashVar and by code.text, reports unmatched, creates a draft, audited", async () => {
    const result = await importObservationBundle(
      db,
      coordinator,
      bundle([
        observation({ value: 128 }), // cdashVar VSORRES_SYSBP → sbp
        observation({ code: { coding: [{ code: "EXDOSE" }] }, value: 250 }),
        observation({ code: { text: "Clinical notes" }, value: "imported from HIS" }),
        observation({ code: { coding: [{ code: "LOINC-99999" }] }, value: 1 }), // unmatched
      ]),
    );

    expect(result.visitId).toBe(visitId); // auto-resolved the open visit
    expect(result.mapped).toEqual({
      sbp: 128,
      dose_mg: 250,
      notes: "imported from HIS",
    });
    expect(result.ignored).toEqual(["LOINC-99999"]);

    // DRAFT, never approved — the normal submit/approve(+sign) path remains
    const [entry] = await db
      .select()
      .from(crfEntries)
      .where(eq(crfEntries.id, result.entryId));
    expect(entry.status).toBe("draft");
    expect(entry.approvedBy).toBeNull();
    expect(entry.data).toEqual(result.mapped);

    // audited twice: the crf.create mutation + the fhir.import marker
    const marker = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.entityId, result.entryId),
          eq(auditEvents.action, "fhir.import"),
        ),
      );
    expect(marker).toHaveLength(1);
    expect(
      (marker[0].after as { mappedFields: string[] }).mappedFields.sort(),
    ).toEqual(["dose_mg", "notes", "sbp"]);

    const create = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.entityId, result.entryId),
          eq(auditEvents.action, "crf.create"),
        ),
      );
    expect(create).toHaveLength(1);
  });

  it("an explicit visitId is honored; a foreign visitId is refused", async () => {
    const result = await importObservationBundle(
      db,
      coordinator,
      bundle([observation({ value: 130 })]),
      visitId,
    );
    expect(result.visitId).toBe(visitId);

    await expect(
      importObservationBundle(
        db,
        coordinator,
        bundle([observation({ value: 130 })]),
        "00000000-0000-4000-8000-000000000042",
      ),
    ).rejects.toThrow(/visit not found/);
  });

  it("a bundle matching nothing on the template imports nothing", async () => {
    await expect(
      importObservationBundle(
        db,
        coordinator,
        bundle([
          observation({ code: { coding: [{ code: "UNKNOWN_VAR" }] }, value: 1 }),
        ]),
      ),
    ).rejects.toThrow(/nothing to import/);
  });
});
