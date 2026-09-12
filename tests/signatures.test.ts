/**
 * T7.1 — Electronic signatures (D-022).
 * Gate: wrong/missing password refuses the action and writes nothing
 * (atomic); the stored hash matches an independent recomputation; the
 * signature row and its audit row commit together; the regulator cannot
 * sign anything; AE "reported" requires a signature, other steps do not.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "./helpers/db";
import {
  auditEvents,
  crfEntries,
  crfTemplates,
  participants,
  signatures,
  sites,
  trialSites,
  trials,
  users,
  visits,
} from "@/db/schema";
import type { Actor } from "@/lib/audit";
import { hashPassword } from "@/lib/auth-core";
import { RbacError } from "@/lib/rbac";
import type { CrfField } from "@/lib/crf";
import { approveEntry, createDraftEntry, submitEntry } from "@/services/crf";
import {
  advanceAeStatus,
  captureAdverseEvent,
} from "@/services/adverse-events";
import {
  SIGNATURE_MEANINGS,
  SignatureError,
  canonicalJson,
  payloadHash,
} from "@/services/signatures";

const FIELDS: CrfField[] = [
  { name: "sbp", label: "Systolic BP", type: "number", unit: "mmHg", min: 70, max: 250, required: true, cdashVar: "VSORRES_SYSBP" },
];

const PW = "Sign@1234";

let db: TestDb;
let pi: Actor, coordinator: Actor, pv: Actor, regulator: Actor, inactivePi: Actor;
let visitId: string;
let participantId: string;

/** draft → submitted entry ready for approval */
async function makeSubmittedEntry(): Promise<string> {
  const draft = await createDraftEntry(db, coordinator, visitId, { sbp: 120 });
  const submitted = await submitEntry(db, coordinator, draft.id);
  return submitted.id;
}

beforeAll(async () => {
  db = await createTestDb();
  const hash = await hashPassword(PW);
  const rows = await db
    .insert(users)
    .values([
      { email: "pi@s.demo", passwordHash: hash, name: "PI", role: "pi" },
      { email: "co@s.demo", passwordHash: hash, name: "CO", role: "coordinator" },
      { email: "pv@s.demo", passwordHash: hash, name: "PV", role: "pv" },
      { email: "reg@s.demo", passwordHash: hash, name: "REG", role: "regulator" },
      { email: "off@s.demo", passwordHash: hash, name: "OFF", role: "pi", active: false },
    ])
    .returning();
  pi = { id: rows[0].id, role: "pi" };
  coordinator = { id: rows[1].id, role: "coordinator" };
  pv = { id: rows[2].id, role: "pv" };
  regulator = { id: rows[3].id, role: "regulator" };
  inactivePi = { id: rows[4].id, role: "pi" };

  const [trial] = await db
    .insert(trials)
    .values({
      protocolCode: "AYU-800",
      title: "Signature fixture",
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
    .values({ subjectCode: "AYU-800-P-0001", trialSiteId: ts.id })
    .returning();
  participantId = p.id;
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

describe("T7.1 — canonical payload hashing (pure)", () => {
  it("is independent of object key order and array-order sensitive", () => {
    expect(payloadHash({ a: 1, b: "x" })).toBe(payloadHash({ b: "x", a: 1 }));
    expect(payloadHash({ a: 1 })).not.toBe(payloadHash({ a: 2 }));
    expect(payloadHash([1, 2])).not.toBe(payloadHash([2, 1]));
  });

  it("serializes nested objects and dates deterministically", () => {
    const at = new Date("2026-09-12T10:00:00Z");
    expect(canonicalJson({ z: { b: 2, a: 1 }, at })).toBe(
      `{"at":"2026-09-12T10:00:00.000Z","z":{"a":1,"b":2}}`,
    );
  });
});

describe("T7.1 — CRF approval requires a valid signature", () => {
  it("wrong password refuses the approval and writes NOTHING (atomic)", async () => {
    const entryId = await makeSubmittedEntry();

    await expect(
      approveEntry(db, pi, entryId, { password: "wrong-password" }),
    ).rejects.toThrow(SignatureError);

    const [entry] = await db
      .select()
      .from(crfEntries)
      .where(eq(crfEntries.id, entryId));
    expect(entry.status).toBe("submitted"); // untouched
    const sigs = await db
      .select()
      .from(signatures)
      .where(eq(signatures.entityId, entryId));
    expect(sigs).toHaveLength(0);
    const audit = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.entityId, entryId),
          eq(auditEvents.action, "crf.approve"),
        ),
      );
    expect(audit).toHaveLength(0);
  });

  it("missing password is refused before anything runs", async () => {
    const entryId = await makeSubmittedEntry();
    await expect(
      approveEntry(db, pi, entryId, { password: "" }),
    ).rejects.toThrow(/signature required/);
  });

  it("an inactive account cannot sign", async () => {
    const entryId = await makeSubmittedEntry();
    await expect(
      approveEntry(db, inactivePi, entryId, { password: PW }),
    ).rejects.toThrow(/not found or inactive/);
  });

  it("valid signature: signature + audit commit together, hash recomputes", async () => {
    const entryId = await makeSubmittedEntry();
    const approved = await approveEntry(db, pi, entryId, { password: PW });
    expect(approved.status).toBe("approved");

    const [sig] = await db
      .select()
      .from(signatures)
      .where(eq(signatures.entityId, entryId));
    expect(sig).toBeDefined();
    expect(sig.actorId).toBe(pi.id);
    expect(sig.actorRole).toBe("pi");
    expect(sig.action).toBe("approve");
    expect(sig.meaning).toBe(SIGNATURE_MEANINGS.approve);

    // independent recomputation of the SHA-256 over the canonical payload
    expect(sig.payloadHash).toBe(
      payloadHash({
        entityId: entryId,
        data: approved.data,
        version: approved.version,
      }),
    );

    // the audit row for the approval references this signature
    const [audit] = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.entityId, entryId),
          eq(auditEvents.action, "crf.approve"),
        ),
      );
    expect(audit).toBeDefined();
    expect((audit.after as { signatureId: string }).signatureId).toBe(sig.id);
    expect((audit.after as { payloadHash: string }).payloadHash).toBe(
      sig.payloadHash,
    );
  });

  it("the regulator cannot sign anything (RBAC before signature)", async () => {
    const entryId = await makeSubmittedEntry();
    await expect(
      approveEntry(db, regulator, entryId, { password: PW }),
    ).rejects.toThrow(RbacError);
    const sigs = await db
      .select()
      .from(signatures)
      .where(eq(signatures.actorId, regulator.id));
    expect(sigs).toHaveLength(0);
  });
});

describe("T7.1 — AE 'reported' is the signed safety step", () => {
  it("under_review needs no signature; reported requires a valid one", async () => {
    const ae = await captureAdverseEvent(db, pv, {
      participantId,
      term: "Nausea",
      seriousness: "sae",
      severity: "moderate",
      onsetDate: new Date(),
    });

    // unsigned non-freezing step is fine
    await advanceAeStatus(db, pv, ae.id, "under_review");

    // reported without / with a wrong signature is refused, status unchanged
    await expect(
      advanceAeStatus(db, pv, ae.id, "reported", "to authority"),
    ).rejects.toThrow(SignatureError);
    await expect(
      advanceAeStatus(db, pv, ae.id, "reported", "to authority", {
        password: "nope",
      }),
    ).rejects.toThrow(SignatureError);
    const [unchanged] = await db
      .select()
      .from((await import("@/db/schema")).adverseEvents)
      .where(eq((await import("@/db/schema")).adverseEvents.id, ae.id));
    expect(unchanged.status).toBe("under_review");
    expect(unchanged.reportedAt).toBeNull();

    // signed report succeeds and stores the signature with the report meaning
    const reported = await advanceAeStatus(db, pv, ae.id, "reported", "to authority", {
      password: PW,
    });
    expect(reported.reportedAt).toBeInstanceOf(Date);
    const [sig] = await db
      .select()
      .from(signatures)
      .where(
        and(
          eq(signatures.entityId, ae.id),
          eq(signatures.entityType, "adverse_event"),
        ),
      );
    expect(sig.action).toBe("report");
    expect(sig.meaning).toBe(SIGNATURE_MEANINGS.report);
    expect(sig.payloadHash).toBe(
      payloadHash({
        entityId: ae.id,
        term: "Nausea",
        seriousness: "sae",
        reportedAt: reported.reportedAt,
      }),
    );
  });
});
