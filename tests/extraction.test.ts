import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "./helpers/db";
import {
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
import type { CrfField } from "@/lib/crf";
import type { VisionClient } from "@/lib/ai/types";
import {
  ExtractionError,
  approveExtraction,
  rejectExtraction,
  requiredTouches,
  startExtraction,
} from "@/services/extractions";
import { RbacError } from "@/lib/rbac";

const FIELDS: CrfField[] = [
  { name: "sbp", label: "Systolic BP", type: "number", unit: "mmHg", min: 70, max: 250, required: true, cdashVar: "VSORRES_SYSBP" },
  { name: "dose_mg", label: "Dose", type: "number", unit: "mg", min: 0, max: 2000, required: true, cdashVar: "EXDOSE" },
  { name: "notes", label: "Notes", type: "text", required: false, cdashVar: "CONOTES" },
];

/** configurable mock implementing the same interface as the Claude client */
function mockClient(overrides: {
  quality?: unknown;
  output?: unknown;
}): VisionClient {
  return {
    modelId: "mock-vision-1",
    promptVersion: "extract-v1",
    async assessQuality() {
      return overrides.quality ?? { score: 0.92, issues: [] };
    },
    async extract() {
      return (
        overrides.output ?? {
          fields: {
            sbp: { value: 132, confidence: 0.93, sourceText: "BP 132/86" },
            dose_mg: { value: 250, confidence: 0.55, sourceText: "dose 250mg?" },
            notes: { value: "tolerating well", confidence: 0.88 },
          },
        }
      );
    },
  };
}

let db: TestDb;
let pi: Actor, coordinator: Actor;
let visit1: string; // has a previous approved entry with dose 500
let visit2: string;

beforeAll(async () => {
  db = await createTestDb();
  const userRows = await db
    .insert(users)
    .values([
      { email: "pi@e.demo", passwordHash: "x", name: "PI", role: "pi" },
      { email: "co@e.demo", passwordHash: "x", name: "CO", role: "coordinator" },
    ])
    .returning();
  pi = { id: userRows[0].id, role: "pi" };
  coordinator = { id: userRows[1].id, role: "coordinator" };

  const [trial] = await db
    .insert(trials)
    .values({
      protocolCode: "AYU-700",
      title: "Extraction fixture",
      studyType: "interventional",
      intervention: "X",
      targetEnrollment: 10,
      status: "active",
      createdBy: pi.id,
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
    .values({ subjectCode: "AYU-700-P-0001", trialSiteId: ts.id })
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
  const mkVisit = async (n: number, offsetDays: number) => {
    const [v] = await db
      .insert(visits)
      .values({
        participantId: p.id,
        templateId: template.id,
        visitNumber: n,
        name: n === 1 ? "Baseline" : "Follow-up",
        scheduledDate: new Date(now + offsetDays * 86_400_000),
        windowStart: new Date(now + (offsetDays - 3) * 86_400_000),
        windowEnd: new Date(now + (offsetDays + 3) * 86_400_000),
        status: "due",
      })
      .returning();
    return v.id;
  };
  visit1 = await mkVisit(1, -30);
  visit2 = await mkVisit(2, 0);

  // previous APPROVED record: dose 500 (the cross-document anchor)
  await db.insert(crfEntries).values({
    visitId: visit1,
    templateId: template.id,
    data: { sbp: 128, dose_mg: 500 },
    status: "approved",
    source: "manual",
    enteredBy: coordinator.id,
    approvedBy: pi.id,
    approvedAt: new Date(now - 25 * 86_400_000),
  });
});

describe("T2.4 — quality gate", () => {
  it("rejects a low-quality image with the recapture reason", async () => {
    const row = await startExtraction(
      db,
      pi,
      { visitId: visit2, blobUrl: "blob://blurry" },
      mockClient({ quality: { score: 0.3, issues: ["blur", "glare"] } }),
    );
    expect(row.status).toBe("rejected");
    const flags = row.validationFlags as { message: string }[];
    expect(flags[0].message).toMatch(/blur, glare.*recapture/);
    // rejected extractions can never be approved
    await expect(
      approveExtraction(db, pi, {
        extractionId: row.id,
        finalData: { sbp: 120, dose_mg: 500 },
        touchedFields: [],
      }),
    ).rejects.toThrow(/only 'review'/);
  });

  it("rejects malformed model output terminally", async () => {
    const row = await startExtraction(
      db,
      pi,
      { visitId: visit2, blobUrl: "blob://weird" },
      mockClient({ output: { totally: "wrong shape" } }),
    );
    expect(row.status).toBe("rejected");
  });
});

describe("T2.4 — extraction → review with confidence + contradiction gating", () => {
  it("produces a review row with the cross-document contradiction flagged", async () => {
    const row = await startExtraction(
      db,
      pi,
      { visitId: visit2, blobUrl: "blob://note1" },
      mockClient({}),
    );
    expect(row.status).toBe("review");
    expect(row.modelId).toBe("mock-vision-1");

    // dose 250 vs previously approved 500 → contradiction; confidence 0.55 → low
    const required = requiredTouches(row);
    expect(required).toContain("dose_mg");

    const flags = row.validationFlags as { field: string; kind: string }[];
    expect(
      flags.some((f) => f.field === "dose_mg" && f.kind === "contradiction"),
    ).toBe(true);
  });

  it("blocks approval until flagged/low-confidence fields are touched", async () => {
    const [row] = await db
      .select()
      .from((await import("@/db/schema")).extractions)
      .where(
        eq((await import("@/db/schema")).extractions.status, "review"),
      );
    await expect(
      approveExtraction(db, pi, {
        extractionId: row.id,
        finalData: { sbp: 132, dose_mg: 250, notes: "tolerating well" },
        touchedFields: [], // doctor confirmed nothing
      }),
    ).rejects.toThrow(/dose_mg/);
  });

  it("coordinator cannot approve; PI approval creates the linked CRF entry with provenance", async () => {
    const schema = await import("@/db/schema");
    const [row] = await db
      .select()
      .from(schema.extractions)
      .where(eq(schema.extractions.status, "review"));

    await expect(
      approveExtraction(db, coordinator, {
        extractionId: row.id,
        finalData: { sbp: 132, dose_mg: 500, notes: "tolerating well" },
        touchedFields: ["dose_mg"],
      }),
    ).rejects.toThrow(RbacError);

    const { entry } = await approveExtraction(db, pi, {
      extractionId: row.id,
      finalData: { sbp: 132, dose_mg: 500, notes: "corrected vs note" },
      touchedFields: ["dose_mg"],
    });
    expect(entry.source).toBe("extraction");
    expect(entry.extractionId).toBe(row.id);
    expect(entry.status).toBe("approved");
    expect(entry.approvedBy).toBe(pi.id);
    expect(entry.enteredBy).toBe(pi.id); // extraction was started by PI

    const [updated] = await db
      .select()
      .from(schema.extractions)
      .where(eq(schema.extractions.id, row.id));
    expect(updated.status).toBe("approved");
    expect(updated.reviewedBy).toBe(pi.id);
    expect(updated.reviewedAt).toBeInstanceOf(Date);
    // original image retained as source evidence
    expect(updated.blobUrl).toBe("blob://note1");
  });

  it("final data must still pass submit validation (AI can never bypass Zod)", async () => {
    const row = await startExtraction(
      db,
      pi,
      { visitId: visit2, blobUrl: "blob://note2" },
      mockClient({
        output: {
          fields: {
            sbp: { value: 130, confidence: 0.95 },
            dose_mg: { value: 500, confidence: 0.95 },
          },
        },
      }),
    );
    await expect(
      approveExtraction(db, pi, {
        extractionId: row.id,
        finalData: { sbp: 9000, dose_mg: 500 },
        touchedFields: [],
      }),
    ).rejects.toThrow(/final data invalid/);
    // reject it instead
    const rejected = await rejectExtraction(db, pi, row.id, "unusable");
    expect(rejected.status).toBe("rejected");
  });

  it("out-of-range extracted values are excluded from the draft and flagged", async () => {
    const row = await startExtraction(
      db,
      pi,
      { visitId: visit2, blobUrl: "blob://note3" },
      mockClient({
        output: {
          fields: {
            sbp: { value: 400, confidence: 0.9, sourceText: "BP 400?" },
            dose_mg: { value: 500, confidence: 0.9 },
          },
        },
      }),
    );
    expect(row.status).toBe("review");
    const flags = row.validationFlags as { field: string; kind: string }[];
    expect(flags.some((f) => f.field === "sbp" && f.kind === "range")).toBe(
      true,
    );
    expect(requiredTouches(row)).toContain("sbp");
  });
});
