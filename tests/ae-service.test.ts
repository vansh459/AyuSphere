import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
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
  AeError,
  advanceAeStatus,
  aeTimeline,
  captureAdverseEvent,
} from "@/services/adverse-events";

let db: TestDb;
let pi: Actor, pv: Actor, monitor: Actor;
let participantId: string;

// e-signature (D-022): marking an AE reported is signed with the PV's password
const PW = "Sign@1234";

beforeAll(async () => {
  db = await createTestDb();
  const hash = await hashPassword(PW);
  const rows = await db
    .insert(users)
    .values([
      { email: "pi@a.demo", passwordHash: hash, name: "PI", role: "pi" },
      { email: "pv@a.demo", passwordHash: hash, name: "PV", role: "pv" },
      { email: "mo@a.demo", passwordHash: hash, name: "MO", role: "monitor" },
    ])
    .returning();
  pi = { id: rows[0].id, role: "pi" };
  pv = { id: rows[1].id, role: "pv" };
  monitor = { id: rows[2].id, role: "monitor" };

  const [trial] = await db
    .insert(trials)
    .values({
      protocolCode: "AYU-600",
      title: "AE fixture",
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
    .values({ subjectCode: "AYU-600-P-0001", trialSiteId: ts.id })
    .returning();
  participantId = p.id;
});

describe("T2.2 — AE capture starts the clock", () => {
  it("SAE insert sets 24h/14d deadlines from capture time and logs the first action", async () => {
    const capturedAt = new Date("2026-09-11T08:00:00Z");
    const ae = await captureAdverseEvent(
      db,
      pi,
      {
        participantId,
        term: "Severe gastric irritation",
        seriousness: "sae",
        severity: "severe",
        onsetDate: new Date("2026-09-11T06:00:00Z"),
        narrative: "Hospitalized for observation",
      },
      undefined,
      capturedAt,
    );
    expect(ae.reportingDeadline.toISOString()).toBe(
      "2026-09-12T08:00:00.000Z",
    );
    expect(ae.detailedReportDeadline!.toISOString()).toBe(
      "2026-09-25T08:00:00.000Z",
    );
    expect(ae.status).toBe("open");

    const timeline = await aeTimeline(db, ae.id);
    expect(timeline).toHaveLength(1);
    expect(timeline[0].action).toBe("captured");
    expect(timeline[0].actorId).toBe(pi.id);

    const audit = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.entityId, ae.id));
    expect(audit.map((a) => a.action)).toEqual(["ae.capture"]);
  });

  it("monitor cannot capture AEs", async () => {
    await expect(
      captureAdverseEvent(db, monitor, {
        participantId,
        term: "X",
        seriousness: "ae",
        severity: "mild",
        onsetDate: new Date(),
      }),
    ).rejects.toThrow(RbacError);
  });
});

describe("T2.2 — PV review walk", () => {
  it("open → under_review → reported → closed, each appending an action + audit", async () => {
    const ae = await captureAdverseEvent(db, pv, {
      participantId,
      term: "Transient dizziness",
      seriousness: "ae",
      severity: "moderate",
      onsetDate: new Date(),
    });

    await advanceAeStatus(db, pv, ae.id, "under_review");
    const reported = await advanceAeStatus(db, pv, ae.id, "reported", "sent to NPvCC", {
      password: PW,
    });
    expect(reported.reportedAt).toBeInstanceOf(Date);
    await advanceAeStatus(db, pv, ae.id, "closed");

    const timeline = await aeTimeline(db, ae.id);
    expect(timeline.map((a) => a.action)).toEqual([
      "captured",
      "review_started",
      "reported",
      "closed",
    ]);

    const audit = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.entityId, ae.id));
    expect(audit.map((a) => a.action).sort()).toEqual([
      "ae.capture",
      "ae.closed",
      "ae.reported",
      "ae.review_started",
    ]);
  });

  it("PI cannot run the PV review; closed cannot reopen via walk", async () => {
    const ae = await captureAdverseEvent(db, pi, {
      participantId,
      term: "Headache",
      seriousness: "ae",
      severity: "mild",
      onsetDate: new Date(),
    });
    await expect(
      advanceAeStatus(db, pi, ae.id, "under_review"),
    ).rejects.toThrow(RbacError);
    await expect(advanceAeStatus(db, pv, ae.id, "closed")).rejects.toThrow(
      AeError,
    );
  });
});
