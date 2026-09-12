/**
 * T7.2 — Configurable alerts & deadlines (D-023).
 * Gate: saved config changes sweep + deadline behaviour; malformed config is
 * rejected (and a malformed STORED value falls back to defaults); defaults
 * apply when nothing is configured; saves are RBAC-guarded and audited.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "./helpers/db";
import {
  adverseEvents,
  alerts,
  appSettings,
  auditEvents,
  milestones,
  participants,
  sites,
  trialSites,
  trials,
  users,
} from "@/db/schema";
import type { Actor } from "@/lib/audit";
import { RbacError } from "@/lib/rbac";
import {
  ALERT_CONFIG_KEY,
  DEFAULT_ALERT_CONFIG,
  getAlertConfig,
  saveAlertConfig,
} from "@/services/settings";
import { sweepAlerts } from "@/services/alerts";
import { captureAdverseEvent } from "@/services/adverse-events";

const DAY = 86_400_000;
const HOUR = 3_600_000;

let db: TestDb;
let admin: Actor, pi: Actor;
let trialSiteId: string;
let participantId: string;

beforeAll(async () => {
  db = await createTestDb();
  const rows = await db
    .insert(users)
    .values([
      { email: "ad@cfg.demo", passwordHash: "x", name: "AD", role: "admin" },
      { email: "pi@cfg.demo", passwordHash: "x", name: "PI", role: "pi" },
    ])
    .returning();
  admin = { id: rows[0].id, role: "admin" };
  pi = { id: rows[1].id, role: "pi" };

  const [trial] = await db
    .insert(trials)
    .values({
      protocolCode: "AYU-900",
      title: "Config fixture",
      studyType: "interventional",
      intervention: "X",
      targetEnrollment: 5,
      status: "active",
      createdBy: admin.id,
    })
    .returning();
  const [site] = await db
    .insert(sites)
    .values({ name: "S", city: "C", state: "ST" })
    .returning();
  // activated 60 days ago (the lag rule only looks at sites >30d active),
  // target 5, 2 enrolled → 40% of target
  const [ts] = await db
    .insert(trialSites)
    .values({
      trialId: trial.id,
      siteId: site.id,
      activationStatus: "active",
      activatedAt: new Date(Date.now() - 60 * DAY),
      enrollmentTarget: 5,
    })
    .returning();
  trialSiteId = ts.id;
  const enrolled = await db
    .insert(participants)
    .values(
      [1, 2].map((n) => ({
        subjectCode: `AYU-900-P-000${n}`,
        trialSiteId: ts.id,
        status: "enrolled" as const,
        enrolledAt: new Date(),
      })),
    )
    .returning();
  participantId = enrolled[0].id;
});

describe("T7.2 — defaults & validation", () => {
  it("returns the built-in defaults when nothing is configured", async () => {
    expect(await getAlertConfig(db)).toEqual(DEFAULT_ALERT_CONFIG);
  });

  it("a malformed STORED value falls back to defaults instead of breaking", async () => {
    await db.insert(appSettings).values({
      key: ALERT_CONFIG_KEY,
      value: { enrolmentLagThreshold: "not a number" },
    });
    expect(await getAlertConfig(db)).toEqual(DEFAULT_ALERT_CONFIG);
    await db.delete(appSettings).where(eq(appSettings.key, ALERT_CONFIG_KEY));
  });

  it("malformed config is rejected by Zod at save time", async () => {
    await expect(
      saveAlertConfig(db, admin, {
        ...DEFAULT_ALERT_CONFIG,
        enrolmentLagThreshold: 5, // fractions only (0–1)
      }),
    ).rejects.toThrow();
    await expect(
      saveAlertConfig(db, admin, {
        ...DEFAULT_ALERT_CONFIG,
        // missing the 'sae' rule
        deadlineRules: [{ seriousness: "ae", initialHours: 24 }],
      }),
    ).rejects.toThrow(/cover both/);
  });

  it("only users.manage may save; saves are audited with the full config", async () => {
    await expect(
      saveAlertConfig(db, pi, DEFAULT_ALERT_CONFIG),
    ).rejects.toThrow(RbacError);

    await saveAlertConfig(db, admin, {
      ...DEFAULT_ALERT_CONFIG,
      milestoneLookaheadDays: 14,
    });
    const [audit] = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "settings.alert_update"));
    expect(audit).toBeDefined();
    expect(
      (audit.after as { milestoneLookaheadDays: number }).milestoneLookaheadDays,
    ).toBe(14);
  });
});

describe("T7.2 — config drives the sweep", () => {
  it("enrolment lag follows the configured threshold (raise, then auto-resolve)", async () => {
    // 2/5 = 40% < default 50% → lag alert raised
    await saveAlertConfig(db, admin, DEFAULT_ALERT_CONFIG);
    await sweepAlerts(db);
    const ref = `trial_site:${trialSiteId}`;
    let [alert] = await db
      .select()
      .from(alerts)
      .where(and(eq(alerts.entityRef, ref), eq(alerts.status, "open")));
    expect(alert?.ruleKey).toBe("enrolment_lag");

    // lower the bar to 30% → 40% is no longer lagging → auto-resolves
    await saveAlertConfig(db, admin, {
      ...DEFAULT_ALERT_CONFIG,
      enrolmentLagThreshold: 0.3,
    });
    await sweepAlerts(db);
    [alert] = await db
      .select()
      .from(alerts)
      .where(and(eq(alerts.entityRef, ref), eq(alerts.status, "open")));
    expect(alert).toBeUndefined();
  });

  it("AE approaching-deadline window follows the configured hours", async () => {
    // deadline 30h away: outside the default 24h window, inside a 48h one
    const [ae] = await db
      .insert(adverseEvents)
      .values({
        participantId,
        term: "Config window test",
        seriousness: "sae",
        severity: "moderate",
        onsetDate: new Date(),
        reportingDeadline: new Date(Date.now() + 30 * HOUR),
        createdBy: pi.id,
      })
      .returning();
    const ref = `ae:${ae.id}`;

    await saveAlertConfig(db, admin, DEFAULT_ALERT_CONFIG);
    await sweepAlerts(db);
    let open = await db
      .select()
      .from(alerts)
      .where(and(eq(alerts.entityRef, ref), eq(alerts.status, "open")));
    expect(open).toHaveLength(0);

    await saveAlertConfig(db, admin, {
      ...DEFAULT_ALERT_CONFIG,
      aeApproachingHours: 48,
    });
    await sweepAlerts(db);
    open = await db
      .select()
      .from(alerts)
      .where(and(eq(alerts.entityRef, ref), eq(alerts.status, "open")));
    expect(open).toHaveLength(1);
    expect(open[0].ruleKey).toBe("ae_deadline_approaching");
    expect(open[0].message).toContain("48h");
  });

  it("milestone lookahead follows the configured days", async () => {
    const [trial] = await db.select().from(trials).limit(1);
    const [m] = await db
      .insert(milestones)
      .values({
        trialId: trial.id,
        kind: "ctri_registration",
        dueDate: new Date(Date.now() + 10 * DAY),
      })
      .returning();
    const ref = `milestone:${m.id}`;

    // due in 10 days: outside the default 7-day lookahead
    await saveAlertConfig(db, admin, DEFAULT_ALERT_CONFIG);
    await sweepAlerts(db);
    let open = await db
      .select()
      .from(alerts)
      .where(and(eq(alerts.entityRef, ref), eq(alerts.status, "open")));
    expect(open).toHaveLength(0);

    await saveAlertConfig(db, admin, {
      ...DEFAULT_ALERT_CONFIG,
      milestoneLookaheadDays: 14,
    });
    await sweepAlerts(db);
    open = await db
      .select()
      .from(alerts)
      .where(and(eq(alerts.entityRef, ref), eq(alerts.status, "open")));
    expect(open).toHaveLength(1);
    expect(open[0].ruleKey).toBe("milestone_due");
  });
});

describe("T7.2 — config drives the deadline engine", () => {
  it("newly captured AEs use the configured rule table", async () => {
    await saveAlertConfig(db, admin, {
      ...DEFAULT_ALERT_CONFIG,
      deadlineRules: [
        { seriousness: "sae", initialHours: 12, detailedDays: 7 },
        { seriousness: "ae", initialHours: 96 },
      ],
    });
    const capturedAt = new Date("2026-09-12T08:00:00Z");
    const sae = await captureAdverseEvent(
      db,
      pi,
      {
        participantId,
        term: "Configured SAE clock",
        seriousness: "sae",
        severity: "severe",
        onsetDate: capturedAt,
      },
      undefined, // no explicit rules → config applies
      capturedAt,
    );
    expect(sae.reportingDeadline.toISOString()).toBe(
      "2026-09-12T20:00:00.000Z", // +12h, not the default 24h
    );
    expect(sae.detailedReportDeadline!.toISOString()).toBe(
      "2026-09-19T08:00:00.000Z", // +7d, not the default 14d
    );

    // explicit rules still win (test/backfill escape hatch)
    const ae = await captureAdverseEvent(
      db,
      pi,
      {
        participantId,
        term: "Explicit rules",
        seriousness: "ae",
        severity: "mild",
        onsetDate: capturedAt,
      },
      [{ seriousness: "ae", initialHours: 1 }],
      capturedAt,
    );
    expect(ae.reportingDeadline.toISOString()).toBe(
      "2026-09-12T09:00:00.000Z",
    );
  });
});
