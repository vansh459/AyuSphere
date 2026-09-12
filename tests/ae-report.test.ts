/**
 * T8.2 — SAE regulatory report artifact.
 * Gate: report assembly returns the full escalation timeline, decoded
 * dictionary terms, and the correct deadline delta; generation is audited
 * and PV-only (the regulator can view the assembly but cannot generate).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "./helpers/db";
import {
  auditEvents,
  participants,
  sites,
  trialSites,
  trials,
  users,
} from "@/db/schema";
import type { Actor } from "@/lib/audit";
import { hashPassword } from "@/lib/auth-core";
import { RbacError } from "@/lib/rbac";
import {
  advanceAeStatus,
  captureAdverseEvent,
} from "@/services/adverse-events";
import {
  AeReportError,
  assembleAeReport,
  generateAeReport,
} from "@/services/ae-report";

const HOUR = 3_600_000;
const PW = "Sign@1234";

let db: TestDb;
let pv: Actor, regulator: Actor;
let reportedAeId: string;
let openAeId: string;

beforeAll(async () => {
  db = await createTestDb();
  const hash = await hashPassword(PW);
  const rows = await db
    .insert(users)
    .values([
      { email: "pv@rep.demo", passwordHash: hash, name: "PV Officer", role: "pv" },
      { email: "reg@rep.demo", passwordHash: hash, name: "REG", role: "regulator" },
    ])
    .returning();
  pv = { id: rows[0].id, role: "pv" };
  regulator = { id: rows[1].id, role: "regulator" };

  const [trial] = await db
    .insert(trials)
    .values({
      protocolCode: "AYU-REP",
      title: "Report fixture trial",
      ctriNumber: "CTRI/2026/09/012345",
      studyType: "interventional",
      intervention: "Ashwagandha churna",
      dosageForm: "churna",
      targetEnrollment: 10,
      status: "active",
      createdBy: pv.id,
    })
    .returning();
  const [site] = await db
    .insert(sites)
    .values({ name: "AIIA Delhi", city: "New Delhi", state: "DL" })
    .returning();
  const [ts] = await db
    .insert(trialSites)
    .values({ trialId: trial.id, siteId: site.id, activationStatus: "active" })
    .returning();
  const [p] = await db
    .insert(participants)
    .values({ subjectCode: "AYU-REP-P-0001", trialSiteId: ts.id })
    .returning();

  // SAE captured 1h ago with a 48h rule → deadline ≈ now + 47h; reporting
  // now is therefore comfortably ON TIME (negative delta)
  const sae = await captureAdverseEvent(
    db,
    pv,
    {
      participantId: p.id,
      term: "Severe vomiting after dose",
      seriousness: "sae",
      severity: "severe",
      onsetDate: new Date(Date.now() - 2 * HOUR),
      narrative: "Hospitalized overnight for observation.",
      meddraCode: "10000102", // Vomiting
      whodrugCode: "ASU-00001", // Ashwagandha churna
      causality: "probable",
    },
    [{ seriousness: "sae", initialHours: 48, detailedDays: 14 }],
    new Date(Date.now() - 1 * HOUR),
  );
  reportedAeId = sae.id;
  await advanceAeStatus(db, pv, sae.id, "under_review");
  await advanceAeStatus(db, pv, sae.id, "reported", "filed with NPvCC", {
    password: PW,
  });

  const open = await captureAdverseEvent(db, pv, {
    participantId: p.id,
    term: "Mild headache",
    seriousness: "ae",
    severity: "mild",
    onsetDate: new Date(),
  });
  openAeId = open.id;
});

describe("T8.2 — report assembly", () => {
  it("returns the full escalation timeline with actors, in order", async () => {
    const report = await assembleAeReport(db, reportedAeId);
    expect(report.timeline.map((t) => t.action)).toEqual([
      "captured",
      "review_started",
      "reported",
    ]);
    expect(report.timeline[2].actorName).toBe("PV Officer");
    expect(report.timeline[2].actorRole).toBe("pv");
    expect(report.timeline[2].note).toBe("filed with NPvCC");
  });

  it("decodes dictionary terms and carries study context (subject code only)", async () => {
    const report = await assembleAeReport(db, reportedAeId);
    expect(report.subjectCode).toBe("AYU-REP-P-0001");
    expect(report.meddra).toEqual({
      code: "10000102",
      pt: "Vomiting",
      soc: "Gastrointestinal disorders",
    });
    expect(report.whodrug?.drugName).toBe("Ashwagandha churna");
    expect(report.trial.ctriNumber).toBe("CTRI/2026/09/012345");
    expect(report.site.name).toBe("AIIA Delhi");
  });

  it("computes the deadline delta: reported ~47h early → on time", async () => {
    const report = await assembleAeReport(db, reportedAeId);
    expect(report.onTime).toBe(true);
    expect(report.deadlineDeltaHours).toBeLessThan(-46);
    expect(report.deadlineDeltaHours).toBeGreaterThan(-48);
  });

  it("an unreported event has a pending delta; unknown ids throw", async () => {
    const report = await assembleAeReport(db, openAeId);
    expect(report.deadlineDeltaHours).toBeNull();
    expect(report.onTime).toBeNull();
    await expect(
      assembleAeReport(db, "00000000-0000-4000-8000-000000000009"),
    ).rejects.toThrow(AeReportError);
  });
});

describe("T8.2 — audited generation, PV-only", () => {
  it("PV generation writes the ae.report_generated audit row", async () => {
    await generateAeReport(db, pv, reportedAeId);
    const rows = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.entityId, reportedAeId),
          eq(auditEvents.action, "ae.report_generated"),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0].actorId).toBe(pv.id);
    expect((rows[0].after as { onTime: boolean }).onTime).toBe(true);
  });

  it("the regulator can view (read assembly) but cannot generate", async () => {
    // read-only view works — this is what the report page renders
    const report = await assembleAeReport(db, reportedAeId);
    expect(report.ae.id).toBe(reportedAeId);

    await expect(
      generateAeReport(db, regulator, reportedAeId),
    ).rejects.toThrow(RbacError);
    const regulatorRows = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.actorId, regulator.id));
    expect(regulatorRows).toHaveLength(0);
  });
});
