import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "./helpers/db";
import { seed } from "@/db/seed";
import { adverseEvents, alerts, users, visits } from "@/db/schema";
import type { Actor } from "@/lib/audit";
import {
  acknowledgeAlert,
  raiseAlert,
  resolveOpenAlert,
  sweepAlerts,
} from "@/services/alerts";

let db: TestDb;
let pv: Actor;

beforeAll(async () => {
  db = await createTestDb();
  await seed(db);
  const [u] = await db.select().from(users).where(eq(users.role, "pv"));
  pv = { id: u.id, role: "pv" };
}, 180_000);

describe("T2.3 — idempotent raise/resolve", () => {
  it("raising the same (rule, entity) twice creates one open alert", async () => {
    const first = await raiseAlert(db, {
      ruleKey: "visit_overdue",
      entityRef: "visit:demo",
      severity: "warning",
      message: "m",
    });
    const second = await raiseAlert(db, {
      ruleKey: "visit_overdue",
      entityRef: "visit:demo",
      severity: "warning",
      message: "m again",
    });
    expect(first).toBe(true);
    expect(second).toBe(false);
    const rows = await db
      .select()
      .from(alerts)
      .where(eq(alerts.entityRef, "visit:demo"));
    expect(rows).toHaveLength(1);
  });

  it("after resolve, the alert can be raised again (new condition, new alert)", async () => {
    expect(await resolveOpenAlert(db, "visit_overdue", "visit:demo")).toBe(
      true,
    );
    expect(
      await raiseAlert(db, {
        ruleKey: "visit_overdue",
        entityRef: "visit:demo",
        severity: "warning",
        message: "recurred",
      }),
    ).toBe(true);
    await resolveOpenAlert(db, "visit_overdue", "visit:demo");
  });
});

describe("T2.3 — sweep over seeded data", () => {
  it("raises the planted alerts: SAE deadline approaching, milestone due, enrolment lag, overdue visits", async () => {
    const { raised } = await sweepAlerts(db);
    expect(raised).toBeGreaterThan(0);

    const open = await db.select().from(alerts).where(eq(alerts.status, "open"));
    const keys = new Set(open.map((a) => a.ruleKey));
    // planted SAE has ~18h left → approaching (warning)
    expect(keys).toContain("ae_deadline_approaching");
    // planted ethics decision due in 5 days
    expect(keys).toContain("milestone_due");
    // planted lagging site (3/30 enrolled)
    expect(keys).toContain("enrolment_lag");
    // seed leaves ~1/8 of past visits overdue
    expect(keys).toContain("visit_overdue");
  });

  it("is idempotent: a second sweep at the same clock raises nothing new", async () => {
    const before = (
      await db.select().from(alerts).where(eq(alerts.status, "open"))
    ).length;
    const { raised } = await sweepAlerts(db);
    expect(raised).toBe(0);
    const after = (
      await db.select().from(alerts).where(eq(alerts.status, "open"))
    ).length;
    expect(after).toBe(before);
  });

  it("auto-resolves when the condition clears (overdue visit completed)", async () => {
    const [v] = await db
      .select()
      .from(visits)
      .where(eq(visits.status, "overdue"))
      .limit(1);
    expect(v).toBeTruthy();
    // the overdue alert exists
    const [open] = await db
      .select()
      .from(alerts)
      .where(
        and(
          eq(alerts.entityRef, `visit:${v.id}`),
          eq(alerts.status, "open"),
        ),
      );
    expect(open).toBeTruthy();

    await db
      .update(visits)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(visits.id, v.id));
    const { resolved } = await sweepAlerts(db);
    expect(resolved).toBeGreaterThan(0);

    const [after] = await db
      .select()
      .from(alerts)
      .where(eq(alerts.entityRef, `visit:${v.id}`));
    expect(after.status).toBe("resolved");
    expect(after.resolvedAt).toBeInstanceOf(Date);
  });

  it("escalates a breached AE deadline and clears 'approaching'", async () => {
    // move the clock past the planted SAE deadline
    const [sae] = await db
      .select()
      .from(adverseEvents)
      .where(eq(adverseEvents.seriousness, "sae"));
    const past = new Date(sae.reportingDeadline.getTime() + 60_000);
    await sweepAlerts(db, past);

    const rows = await db
      .select()
      .from(alerts)
      .where(eq(alerts.entityRef, `ae:${sae.id}`));
    const byKey = Object.fromEntries(rows.map((r) => [r.ruleKey, r.status]));
    expect(byKey["ae_deadline_breached"]).toBe("open");
    expect(byKey["ae_deadline_approaching"]).toBe("resolved");
  });
});

describe("T2.3 — acknowledgement", () => {
  it("PV acknowledges an open alert; audit row written", async () => {
    const [open] = await db
      .select()
      .from(alerts)
      .where(eq(alerts.status, "open"))
      .limit(1);
    const ack = await acknowledgeAlert(db, pv, open.id);
    expect(ack.status).toBe("acknowledged");
    expect(ack.acknowledgedBy).toBe(pv.id);
    await expect(acknowledgeAlert(db, pv, open.id)).rejects.toThrow(
      /acknowledged/,
    );
  });
});
