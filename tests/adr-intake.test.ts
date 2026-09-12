/**
 * T8.3 — NPvCC spontaneous ADR intake (D-025).
 * Gate: the receive → assess → forward walk is RBAC-guarded and audited;
 * coding rules apply (unknown codes rejected); spontaneous reports appear in
 * the safety-signal aggregation under their own "NPvCC" series without
 * touching trial groups.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "./helpers/db";
import {
  adverseEvents,
  auditEvents,
  participants,
  sites,
  trialSites,
  trials,
  users,
} from "@/db/schema";
import type { Actor } from "@/lib/audit";
import { RbacError } from "@/lib/rbac";
import {
  AdrError,
  advanceAdrStatus,
  captureSuspectedAdr,
  listSuspectedAdrs,
} from "@/services/adr";
import {
  SPONTANEOUS_SERIES_ID,
  safetySignals,
} from "@/services/safety-signals";

let db: TestDb;
let pv: Actor, coordinator: Actor;

beforeAll(async () => {
  db = await createTestDb();
  const rows = await db
    .insert(users)
    .values([
      { email: "pv@adr.demo", passwordHash: "x", name: "PV", role: "pv" },
      { email: "co@adr.demo", passwordHash: "x", name: "CO", role: "coordinator" },
    ])
    .returning();
  pv = { id: rows[0].id, role: "pv" };
  coordinator = { id: rows[1].id, role: "coordinator" };

  // one trial AE so the signal view carries both series
  const [trial] = await db
    .insert(trials)
    .values({
      protocolCode: "AYU-ADR",
      title: "ADR fixture trial",
      studyType: "interventional",
      intervention: "X",
      targetEnrollment: 5,
      status: "active",
      createdBy: pv.id,
    })
    .returning();
  const [site] = await db
    .insert(sites)
    .values({ name: "AIIA Delhi", city: "Delhi", state: "DL" })
    .returning();
  const [ts] = await db
    .insert(trialSites)
    .values({ trialId: trial.id, siteId: site.id, activationStatus: "active" })
    .returning();
  const [p] = await db
    .insert(participants)
    .values({ subjectCode: "AYU-ADR-P-0001", trialSiteId: ts.id })
    .returning();
  await db.insert(adverseEvents).values({
    participantId: p.id,
    term: "Nausea",
    meddraCode: "10000101",
    seriousness: "ae",
    severity: "mild",
    onsetDate: new Date(),
    reportingDeadline: new Date(Date.now() + 86_400_000),
    createdBy: pv.id,
  });
});

describe("T8.3 — intake walk (RBAC + audit)", () => {
  it("only ae.review roles may receive; unknown codes are rejected", async () => {
    await expect(
      captureSuspectedAdr(db, coordinator, {
        source: "hospital",
        term: "Jaundice",
        suspectedDrug: "Arogyavardhini vati",
        eventDate: new Date(),
        seriousness: "sae",
      }),
    ).rejects.toThrow(RbacError);

    await expect(
      captureSuspectedAdr(db, pv, {
        source: "hospital",
        term: "Jaundice",
        meddraCode: "99999999",
        suspectedDrug: "Arogyavardhini vati",
        eventDate: new Date(),
        seriousness: "sae",
      }),
    ).rejects.toThrow(/unknown MedDRA code/);
  });

  it("receive → assess → forward, each step audited; illegal moves refused", async () => {
    const adr = await captureSuspectedAdr(db, pv, {
      source: "community",
      term: "Jaundice",
      meddraCode: "10000502", // Jaundice (Hepatobiliary)
      suspectedDrug: "Arogyavardhini vati",
      whodrugCode: "ASU-00021",
      eventDate: new Date("2026-09-01"),
      seriousness: "sae",
      reporterRole: "physician",
      narrative: "Icterus after 3 weeks of self-medication.",
    });
    expect(adr.status).toBe("received");

    // cannot forward before assessment
    await expect(
      advanceAdrStatus(db, pv, adr.id, "forwarded"),
    ).rejects.toThrow(AdrError);

    const assessed = await advanceAdrStatus(
      db,
      pv,
      adr.id,
      "assessed",
      "probable causality — hepatic panel requested",
    );
    expect(assessed.assessmentNote).toContain("hepatic panel");
    const forwarded = await advanceAdrStatus(db, pv, adr.id, "forwarded");
    expect(forwarded.status).toBe("forwarded");

    const audit = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.entityId, adr.id));
    expect(audit.map((a) => a.action).sort()).toEqual([
      "adr.assess",
      "adr.forward",
      "adr.receive",
    ]);

    const list = await listSuspectedAdrs(db);
    expect(list).toHaveLength(1);
  });
});

describe("T8.3 — spontaneous series in the signal view", () => {
  it("spontaneous reports aggregate under the NPvCC series, separate from trials", async () => {
    // a second spontaneous jaundice report clusters the term
    await captureSuspectedAdr(db, pv, {
      source: "hospital",
      term: "deep jaundice",
      meddraCode: "10000502",
      suspectedDrug: "Arogyavardhini vati",
      whodrugCode: "ASU-00021",
      eventDate: new Date("2026-09-05"),
      seriousness: "sae",
    });

    const signals = await safetySignals(db);
    const spontaneous = signals.find(
      (s) => s.trialId === SPONTANEOUS_SERIES_ID && s.termKey === "10000502",
    )!;
    expect(spontaneous).toBeDefined();
    expect(spontaneous.protocolCode).toBe("NPvCC");
    expect(spontaneous.termLabel).toBe("Jaundice"); // decoded, both wordings grouped
    expect(spontaneous.count).toBe(2);
    expect(spontaneous.saeCount).toBe(2);
    // sites = report sources for the spontaneous series
    expect(spontaneous.siteBreakdown).toContain("community ×1");
    expect(spontaneous.siteBreakdown).toContain("hospital ×1");

    // the trial series is untouched by spontaneous rows
    const trialNausea = signals.find(
      (s) => s.termKey === "10000101" && s.trialId !== SPONTANEOUS_SERIES_ID,
    )!;
    expect(trialNausea.protocolCode).toBe("AYU-ADR");
    expect(trialNausea.count).toBe(1);
  });
});
