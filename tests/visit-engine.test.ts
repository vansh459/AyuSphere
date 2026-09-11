import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "./helpers/db";
import { auditEvents, visits } from "@/db/schema";
import {
  DAY_MS,
  MISSED_GRACE_DAYS,
  deriveVisitStatus,
  generateVisitSchedule,
} from "@/lib/rules/visits";
import { refreshVisitStatuses } from "@/services/visits";
import { seed } from "@/db/seed";

describe("T1.5 — window math (pure)", () => {
  const enrolled = new Date("2026-09-01T00:00:00Z");
  const plan = [
    { visitNumber: 1, name: "Baseline", dayOffset: 0, windowDays: 3 },
    { visitNumber: 2, name: "Week 4", dayOffset: 28, windowDays: 7 },
  ];

  it("computes exact scheduled dates and window boundaries", () => {
    const [baseline, week4] = generateVisitSchedule(enrolled, plan);
    expect(baseline.scheduledDate.toISOString()).toBe(
      "2026-09-01T00:00:00.000Z",
    );
    expect(baseline.windowStart.toISOString()).toBe(
      "2026-08-29T00:00:00.000Z",
    );
    expect(baseline.windowEnd.toISOString()).toBe("2026-09-04T00:00:00.000Z");
    expect(week4.scheduledDate.toISOString()).toBe("2026-09-29T00:00:00.000Z");
    expect(week4.windowStart.toISOString()).toBe("2026-09-22T00:00:00.000Z");
    expect(week4.windowEnd.toISOString()).toBe("2026-10-06T00:00:00.000Z");
  });

  it("derives upcoming → due → overdue → missed across the clock", () => {
    const v = {
      status: "upcoming" as const,
      windowStart: new Date("2026-09-22T00:00:00Z"),
      windowEnd: new Date("2026-10-06T00:00:00Z"),
    };
    const at = (iso: string) => deriveVisitStatus(v, new Date(iso));
    expect(at("2026-09-21T23:59:59Z")).toBe("upcoming");
    expect(at("2026-09-22T00:00:00Z")).toBe("due"); // window opens
    expect(at("2026-10-06T00:00:00Z")).toBe("due"); // last moment inside
    expect(at("2026-10-06T00:00:01Z")).toBe("overdue");
    // still overdue at the grace boundary…
    expect(
      deriveVisitStatus(
        v,
        new Date(v.windowEnd.getTime() + MISSED_GRACE_DAYS * DAY_MS),
      ),
    ).toBe("overdue");
    // …missed one ms past it
    expect(
      deriveVisitStatus(
        v,
        new Date(v.windowEnd.getTime() + MISSED_GRACE_DAYS * DAY_MS + 1),
      ),
    ).toBe("missed");
  });

  it("terminal states never change", () => {
    const base = {
      windowStart: new Date("2026-01-01T00:00:00Z"),
      windowEnd: new Date("2026-01-02T00:00:00Z"),
    };
    const far = new Date("2027-01-01T00:00:00Z");
    expect(deriveVisitStatus({ ...base, status: "completed" }, far)).toBe(
      "completed",
    );
    expect(deriveVisitStatus({ ...base, status: "cancelled" }, far)).toBe(
      "cancelled",
    );
    expect(deriveVisitStatus({ ...base, status: "missed" }, far)).toBe(
      "missed",
    );
  });
});

describe("T1.5 — sweep against seeded data", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    await seed(db);
  }, 60_000);

  it("flips statuses on clock change and audits missed visits as system actions", async () => {
    // far future: everything open becomes missed
    const farFuture = new Date(Date.now() + 400 * DAY_MS);
    const before = await db
      .select()
      .from(visits)
      .where(eq(visits.status, "upcoming"));
    expect(before.length).toBeGreaterThan(0);

    const { changed } = await refreshVisitStatuses(db, farFuture);
    expect(changed).toBeGreaterThan(0);

    const stillOpen = await db
      .select()
      .from(visits)
      .where(eq(visits.status, "upcoming"));
    expect(stillOpen).toHaveLength(0);

    const missedAudits = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "visit.missed"));
    expect(missedAudits.length).toBeGreaterThan(0);
    expect(missedAudits[0].actorRole).toBe("admin"); // SYSTEM_ACTOR
  });

  it("is idempotent: a second sweep at the same instant changes nothing", async () => {
    const farFuture = new Date(Date.now() + 400 * DAY_MS);
    const second = await refreshVisitStatuses(db, farFuture);
    expect(second.changed).toBe(0);
  });
});
