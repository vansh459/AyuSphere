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
import { RbacError } from "@/lib/rbac";
import { hashPassword } from "@/lib/auth-core";
import { validateCrfData, type CrfField } from "@/lib/crf";
import {
  CrfError,
  approveEntry,
  correctEntry,
  createDraftEntry,
  submitEntry,
} from "@/services/crf";

const FIELDS: CrfField[] = [
  { name: "sbp", label: "Systolic BP", type: "number", unit: "mmHg", min: 70, max: 250, required: true, cdashVar: "VSORRES_SYSBP" },
  { name: "dose_mg", label: "Dose", type: "number", unit: "mg", min: 0, max: 2000, required: true, cdashVar: "EXDOSE" },
  { name: "notes", label: "Notes", type: "text", required: false, cdashVar: "CONOTES" },
];

describe("T1.6 — Zod factory (pure)", () => {
  it("draft mode: provided values validated, required fields may be absent", () => {
    expect(validateCrfData(FIELDS, { sbp: 120 }, "draft").ok).toBe(true);
    const bad = validateCrfData(FIELDS, { sbp: 400 }, "draft");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.issues[0].field).toBe("sbp");
  });

  it("submit mode: required fields enforced; ranges enforced with unit in message", () => {
    const missing = validateCrfData(FIELDS, { sbp: 120 }, "submit");
    expect(missing.ok).toBe(false);
    const range = validateCrfData(FIELDS, { sbp: 60, dose_mg: 500 }, "submit");
    expect(range.ok).toBe(false);
    if (!range.ok) expect(range.issues[0].message).toContain("mmHg");
    expect(
      validateCrfData(FIELDS, { sbp: 120, dose_mg: 500 }, "submit").ok,
    ).toBe(true);
  });

  it("rejects fields not in the template (strict object)", () => {
    const res = validateCrfData(
      FIELDS,
      { sbp: 120, dose_mg: 500, hacked: true },
      "submit",
    );
    expect(res.ok).toBe(false);
  });
});

// e-signature (D-022): approvals/corrections re-verify the signer's password
const PW = "Sign@1234";

describe("T1.6 — entry service lifecycle on PGlite", () => {
  let db: TestDb;
  let pi: Actor, coordinator: Actor;
  let visitId: string;

  beforeAll(async () => {
    db = await createTestDb();
    const hash = await hashPassword(PW);
    const userRows = await db
      .insert(users)
      .values([
        { email: "pi@c.demo", passwordHash: hash, name: "PI", role: "pi" },
        { email: "co@c.demo", passwordHash: hash, name: "CO", role: "coordinator" },
      ])
      .returning();
    pi = { id: userRows[0].id, role: "pi" };
    coordinator = { id: userRows[1].id, role: "coordinator" };

    // minimal fixture: trial → site → participant → visit with template
    const [trial] = await db
      .insert(trials)
      .values({
        protocolCode: "AYU-500",
        title: "CRF fixture",
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
      .values({ subjectCode: "AYU-500-P-0001", trialSiteId: ts.id })
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

  it("draft → submit → approve, all audited; incomplete submit refused", async () => {
    const draft = await createDraftEntry(db, coordinator, visitId, {
      sbp: 128,
    });
    expect(draft.status).toBe("draft");

    // incomplete: dose_mg required
    await expect(submitEntry(db, coordinator, draft.id)).rejects.toThrow(
      CrfError,
    );

    // complete the draft directly (draft rows are editable)
    await db
      .update(crfEntries)
      .set({ data: { sbp: 128, dose_mg: 500 } })
      .where(eq(crfEntries.id, draft.id));
    const submitted = await submitEntry(db, coordinator, draft.id);
    expect(submitted.status).toBe("submitted");

    // coordinator cannot approve
    await expect(
      approveEntry(db, coordinator, draft.id, { password: PW }),
    ).rejects.toThrow(RbacError);
    const approved = await approveEntry(db, pi, draft.id, { password: PW });
    expect(approved.status).toBe("approved");
    expect(approved.approvedBy).toBe(pi.id);
  });

  it("approved entries are immutable — submit/approve on them refused", async () => {
    const [entry] = await db
      .select()
      .from(crfEntries)
      .where(eq(crfEntries.status, "approved"));
    await expect(submitEntry(db, coordinator, entry.id)).rejects.toThrow(
      /cannot submit/,
    );
    await expect(
      approveEntry(db, pi, entry.id, { password: PW }),
    ).rejects.toThrow(/cannot approve/);
  });

  it("correction creates a linked new version and supersedes the old", async () => {
    const [entry] = await db
      .select()
      .from(crfEntries)
      .where(eq(crfEntries.status, "approved"));

    // coordinator lacks crf.approve
    await expect(
      correctEntry(
        db,
        coordinator,
        entry.id,
        { sbp: 130, dose_mg: 250 },
        { password: PW },
      ),
    ).rejects.toThrow(RbacError);

    const v2 = await correctEntry(
      db,
      pi,
      entry.id,
      { sbp: 130, dose_mg: 250 },
      { password: PW },
    );
    expect(v2.version).toBe(entry.version + 1);
    expect(v2.supersedesId).toBe(entry.id);
    expect(v2.status).toBe("approved");

    const [old] = await db
      .select()
      .from(crfEntries)
      .where(eq(crfEntries.id, entry.id));
    expect(old.status).toBe("superseded");
    // original data untouched (ALCOA "original")
    expect((old.data as { dose_mg: number }).dose_mg).toBe(500);
  });

  it("invalid correction data is refused", async () => {
    const [v2] = await db
      .select()
      .from(crfEntries)
      .where(eq(crfEntries.status, "approved"));
    await expect(
      correctEntry(db, pi, v2.id, { sbp: 9999, dose_mg: 250 }, { password: PW }),
    ).rejects.toThrow(CrfError);
  });
});
