/**
 * T7.3 — Monitoring-visit workflow + monitoring_overdue rule.
 * Gate: an overdue due-date raises exactly one open alert (idempotent);
 * completing the visit resolves it and advances the due date by the
 * configured cadence (D-023); scheduling sets the due date; the coordinator
 * cannot log monitoring visits; everything is audited.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "./helpers/db";
import {
  alerts,
  auditEvents,
  monitoringVisits,
  sites,
  trialSites,
  trials,
  users,
} from "@/db/schema";
import type { Actor } from "@/lib/audit";
import { RbacError } from "@/lib/rbac";
import {
  DEFAULT_ALERT_CONFIG,
  saveAlertConfig,
} from "@/services/settings";
import { sweepAlerts } from "@/services/alerts";
import {
  MonitoringError,
  completeMonitoringVisit,
  scheduleMonitoringVisit,
} from "@/services/monitoring";

const DAY = 86_400_000;

let db: TestDb;
let monitor: Actor, coordinator: Actor, admin: Actor;
let trialSiteId: string;

beforeAll(async () => {
  db = await createTestDb();
  const rows = await db
    .insert(users)
    .values([
      { email: "mo@m.demo", passwordHash: "x", name: "MO", role: "monitor" },
      { email: "co@m.demo", passwordHash: "x", name: "CO", role: "coordinator" },
      { email: "ad@m.demo", passwordHash: "x", name: "AD", role: "admin" },
    ])
    .returning();
  monitor = { id: rows[0].id, role: "monitor" };
  coordinator = { id: rows[1].id, role: "coordinator" };
  admin = { id: rows[2].id, role: "admin" };

  const [trial] = await db
    .insert(trials)
    .values({
      protocolCode: "AYU-950",
      title: "Monitoring fixture",
      studyType: "interventional",
      intervention: "X",
      targetEnrollment: 10,
      status: "active",
      createdBy: admin.id,
    })
    .returning();
  const [site] = await db
    .insert(sites)
    .values({ name: "S", city: "C", state: "ST" })
    .returning();
  // monitoring due 10 days ago → overdue from the start
  const [ts] = await db
    .insert(trialSites)
    .values({
      trialId: trial.id,
      siteId: site.id,
      activationStatus: "active",
      activatedAt: new Date(Date.now() - 60 * DAY),
      monitoringVisitDue: new Date(Date.now() - 10 * DAY),
    })
    .returning();
  trialSiteId = ts.id;
});

describe("T7.3 — monitoring_overdue sweep rule", () => {
  it("an overdue due-date raises exactly ONE open alert (idempotent)", async () => {
    await sweepAlerts(db);
    await sweepAlerts(db); // second sweep must not duplicate
    const open = await db
      .select()
      .from(alerts)
      .where(
        and(
          eq(alerts.ruleKey, "monitoring_overdue"),
          eq(alerts.entityRef, `trial_site:${trialSiteId}`),
          eq(alerts.status, "open"),
        ),
      );
    expect(open).toHaveLength(1);
    expect(open[0].severity).toBe("warning");
    expect(open[0].message).toMatch(/Monitoring visit overdue/);
  });
});

describe("T7.3 — RBAC", () => {
  it("the coordinator cannot schedule or complete monitoring visits", async () => {
    await expect(
      scheduleMonitoringVisit(db, coordinator, {
        trialSiteId,
        scheduledDate: new Date(),
      }),
    ).rejects.toThrow(RbacError);
    await expect(
      completeMonitoringVisit(db, coordinator, {
        visitId: "00000000-0000-0000-0000-000000000001",
        summary: "nope",
        findings: [],
      }),
    ).rejects.toThrow(RbacError);
  });
});

describe("T7.3 — schedule → complete walk", () => {
  it("scheduling sets the site's due date and is audited", async () => {
    const scheduledDate = new Date(Date.now() - 1 * DAY); // visit was yesterday
    const visit = await scheduleMonitoringVisit(db, monitor, {
      trialSiteId,
      scheduledDate,
    });
    expect(visit.completedAt).toBeNull();

    const [ts] = await db
      .select()
      .from(trialSites)
      .where(eq(trialSites.id, trialSiteId));
    expect(ts.monitoringVisitDue!.getTime()).toBe(scheduledDate.getTime());

    const audit = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.entityId, visit.id),
          eq(auditEvents.action, "monitoring.schedule"),
        ),
      );
    expect(audit).toHaveLength(1);
  });

  it("completing records summary/findings, advances the due date by the configured cadence, and the alert auto-resolves", async () => {
    // configure a 30-day cadence (default is 90)
    await saveAlertConfig(db, admin, {
      ...DEFAULT_ALERT_CONFIG,
      monitoringCadenceDays: 30,
    });

    const [pending] = await db
      .select()
      .from(monitoringVisits)
      .where(eq(monitoringVisits.trialSiteId, trialSiteId));
    const completedAt = new Date();
    const done = await completeMonitoringVisit(
      db,
      monitor,
      {
        visitId: pending.id,
        summary: "Source-data verification for 4 participants",
        findings: ["1 consent form missing version number"],
      },
      completedAt,
    );
    expect(done.completedAt).toBeInstanceOf(Date);
    expect(done.findings).toEqual(["1 consent form missing version number"]);

    // due date advanced by the CONFIGURED 30 days, not the default 90
    const [ts] = await db
      .select()
      .from(trialSites)
      .where(eq(trialSites.id, trialSiteId));
    expect(ts.monitoringVisitDue!.getTime()).toBe(
      completedAt.getTime() + 30 * DAY,
    );

    // the overdue alert resolves on the next sweep
    await sweepAlerts(db);
    const open = await db
      .select()
      .from(alerts)
      .where(
        and(
          eq(alerts.ruleKey, "monitoring_overdue"),
          eq(alerts.entityRef, `trial_site:${trialSiteId}`),
          eq(alerts.status, "open"),
        ),
      );
    expect(open).toHaveLength(0);

    const audit = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.entityId, pending.id),
          eq(auditEvents.action, "monitoring.complete"),
        ),
      );
    expect(audit).toHaveLength(1);
    expect((audit[0].after as { nextDue: string }).nextDue).toBe(
      ts.monitoringVisitDue!.toISOString(),
    );
  });

  it("a completed visit cannot be completed twice; unknown visit refused", async () => {
    const [done] = await db
      .select()
      .from(monitoringVisits)
      .where(eq(monitoringVisits.trialSiteId, trialSiteId));
    await expect(
      completeMonitoringVisit(db, monitor, {
        visitId: done.id,
        summary: "again",
        findings: [],
      }),
    ).rejects.toThrow(/already completed/);
    await expect(
      completeMonitoringVisit(db, monitor, {
        visitId: "00000000-0000-4000-8000-000000000002",
        summary: "ghost",
        findings: [],
      }),
    ).rejects.toThrow(MonitoringError);
  });

  it("scheduling at an inactive site is refused", async () => {
    const [trial] = await db.select().from(trials).limit(1);
    const [site2] = await db
      .insert(sites)
      .values({ name: "S2", city: "C", state: "ST" })
      .returning();
    const [tsPending] = await db
      .insert(trialSites)
      .values({
        trialId: trial.id,
        siteId: site2.id,
        activationStatus: "pending",
      })
      .returning();
    await expect(
      scheduleMonitoringVisit(db, monitor, {
        trialSiteId: tsPending.id,
        scheduledDate: new Date(),
      }),
    ).rejects.toThrow(/activated site/);
  });
});
