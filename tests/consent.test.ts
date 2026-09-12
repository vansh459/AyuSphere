/**
 * T10.4 — Consent versioning & re-consent.
 * Gate: consent cannot be recorded without a consent form on file and binds
 * the signed version; a foreign/wrong document id is refused; uploading a
 * consent-form v2 raises reconsent_due for participants consented on v1
 * (idempotent), and re-recording consent (binding v2) resolves it; legacy
 * unbound consents are never flagged; the consent register reports it all.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "./helpers/db";
import {
  alerts,
  auditEvents,
  documents,
  participants,
  sites,
  trialSites,
  trials,
  users,
} from "@/db/schema";
import type { Actor } from "@/lib/audit";
import {
  addParticipant,
  consentRegister,
  recordConsent,
  recordScreening,
} from "@/services/participants";
import { sweepAlerts } from "@/services/alerts";

let db: TestDb;
let pi: Actor;
let trialId: string;
let trialSiteId: string;
let participantId: string;
let formV1Id: string;

beforeAll(async () => {
  db = await createTestDb();
  const [u] = await db
    .insert(users)
    .values([{ email: "pi@cn.demo", passwordHash: "x", name: "PI", role: "pi" }])
    .returning();
  pi = { id: u.id, role: "pi" };

  const [trial] = await db
    .insert(trials)
    .values({
      protocolCode: "AYU-CNS",
      title: "Consent fixture",
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
    .values({ trialId, siteId: site.id, activationStatus: "active" })
    .returning();
  trialSiteId = ts.id;
  const p = await addParticipant(db, pi, trialSiteId);
  participantId = p.id;
  await recordScreening(db, pi, participantId, true);
});

describe("T10.4 — consent binds the signed form version", () => {
  it("consent is refused while the trial has NO consent form on file", async () => {
    await expect(recordConsent(db, pi, participantId)).rejects.toThrow(
      /no consent form on file/,
    );
  });

  it("with a form on file, consent binds it; wrong document ids are refused", async () => {
    const [v1] = await db
      .insert(documents)
      .values({
        trialId,
        kind: "consent_form",
        title: "ICF v1",
        version: 1,
        blobUrl: "blob://icf1",
        uploadedBy: pi.id,
      })
      .returning();
    formV1Id = v1.id;
    // a protocol document is NOT a consent form
    const [protocolDoc] = await db
      .insert(documents)
      .values({
        trialId,
        kind: "protocol",
        title: "Protocol v1",
        blobUrl: "blob://p1",
        uploadedBy: pi.id,
      })
      .returning();
    await expect(
      recordConsent(db, pi, participantId, protocolDoc.id),
    ).rejects.toThrow(/consent-form documents/);

    const consented = await recordConsent(db, pi, participantId);
    expect(consented.consentStatus).toBe("given");
    expect(consented.consentDocumentId).toBe(formV1Id);

    const [audit] = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.entityId, participantId),
          eq(auditEvents.action, "participant.consent"),
        ),
      );
    expect(
      (audit.after as { consentFormVersion: number }).consentFormVersion,
    ).toBe(1);
  });
});

describe("T10.4 — re-consent loop", () => {
  it("uploading ICF v2 raises reconsent_due (idempotent) for v1 signers", async () => {
    await db.insert(documents).values({
      trialId,
      kind: "consent_form",
      title: "ICF v2",
      version: 2,
      blobUrl: "blob://icf2",
      uploadedBy: pi.id,
    });
    await sweepAlerts(db);
    await sweepAlerts(db); // no duplicates
    const ref = `participant:${participantId}`;
    const open = await db
      .select()
      .from(alerts)
      .where(
        and(
          eq(alerts.ruleKey, "reconsent_due"),
          eq(alerts.entityRef, ref),
          eq(alerts.status, "open"),
        ),
      );
    expect(open).toHaveLength(1);
    expect(open[0].message).toContain("v1");
    expect(open[0].message).toContain("v2");

    // the register shows the same picture
    const register = await consentRegister(db, trialId);
    const row = register.find((r) => r.participantId === participantId)!;
    expect(row.consentFormVersion).toBe(1);
    expect(row.latestFormVersion).toBe(2);
    expect(row.reconsentDue).toBe(true);
  });

  it("re-recording consent binds the current version and the alert resolves", async () => {
    const reconsented = await recordConsent(db, pi, participantId);
    const [v2doc] = await db
      .select()
      .from(documents)
      .where(and(eq(documents.trialId, trialId), eq(documents.version, 2)));
    expect(reconsented.consentDocumentId).toBe(v2doc.id);

    await sweepAlerts(db);
    const open = await db
      .select()
      .from(alerts)
      .where(
        and(
          eq(alerts.ruleKey, "reconsent_due"),
          eq(alerts.entityRef, `participant:${participantId}`),
          eq(alerts.status, "open"),
        ),
      );
    expect(open).toHaveLength(0);

    const register = await consentRegister(db, trialId);
    const row = register.find((r) => r.participantId === participantId)!;
    expect(row.consentFormVersion).toBe(2);
    expect(row.reconsentDue).toBe(false);
  });

  it("legacy consents without a bound document are never flagged", async () => {
    const [legacy] = await db
      .insert(participants)
      .values({
        subjectCode: "AYU-CNS-P-9999",
        trialSiteId,
        screeningStatus: "passed",
        consentStatus: "given", // unbound — pre-T10.4 data
        consentDate: new Date(),
      })
      .returning();
    await sweepAlerts(db);
    const open = await db
      .select()
      .from(alerts)
      .where(
        and(
          eq(alerts.ruleKey, "reconsent_due"),
          eq(alerts.entityRef, `participant:${legacy.id}`),
        ),
      );
    expect(open).toHaveLength(0);

    const register = await consentRegister(db, trialId);
    const row = register.find((r) => r.participantId === legacy.id)!;
    expect(row.consentFormVersion).toBeNull();
    expect(row.reconsentDue).toBe(false);
  });
});
