/**
 * T8.1 — Safety-signal aggregation + DSMB summary.
 * Gate: a planted cluster (same coded term ×3 in one trial) is flagged while
 * background noise is not; the disproportionality ratio is exact on
 * fixtures; uncoded terms group by verbatim text; timeliness stats count
 * on-time / late / overdue correctly.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./helpers/db";
import {
  adverseEvents,
  participants,
  sites,
  trialSites,
  trials,
  users,
} from "@/db/schema";
import {
  computeSignals,
  safetySignals,
  timelinessStats,
  type SignalInputRow,
} from "@/services/safety-signals";

const HOUR = 3_600_000;

function row(
  overrides: Partial<SignalInputRow> & Pick<SignalInputRow, "termKey" | "trialId">,
): SignalInputRow {
  return {
    termLabel: overrides.termKey,
    soc: null,
    protocolCode: overrides.trialId,
    trialTitle: overrides.trialId,
    siteName: "Site A",
    seriousness: "ae",
    ...overrides,
  };
}

describe("T8.1 — computeSignals (pure, exact math)", () => {
  it("flags the planted cluster and leaves background noise unflagged", () => {
    // Trial A: 3× nausea + 1 headache (4). Trial B: 1 nausea + 7 distinct (8).
    // Portfolio: 12 events, nausea = 4 → share 1/3.
    const rows: SignalInputRow[] = [
      ...[1, 2, 3].map(() => row({ termKey: "nausea", trialId: "A" })),
      row({ termKey: "headache", trialId: "A" }),
      row({ termKey: "nausea", trialId: "B", siteName: "Site B" }),
      ...["a", "b", "c", "d", "e", "f", "g"].map((t) =>
        row({ termKey: t, trialId: "B", siteName: "Site B" }),
      ),
    ];
    const signals = computeSignals(rows);

    const clusterA = signals.find(
      (s) => s.trialId === "A" && s.termKey === "nausea",
    )!;
    // trial share 3/4 = 0.75 ÷ portfolio share 4/12 = 1/3 → 2.25×
    expect(clusterA.ratio).toBe(2.25);
    expect(clusterA.count).toBe(3);
    expect(clusterA.trialTotal).toBe(4);
    expect(clusterA.flagged).toBe(true);

    // same term in trial B: share 1/8 ÷ 1/3 = 0.375× → noise
    const noiseB = signals.find(
      (s) => s.trialId === "B" && s.termKey === "nausea",
    )!;
    expect(noiseB.ratio).toBe(0.38); // rounded to 2 decimals
    expect(noiseB.flagged).toBe(false);

    // headache in A: ratio 3× but only n=1 → below SIGNAL_MIN_COUNT
    const headache = signals.find((s) => s.termKey === "headache")!;
    expect(headache.ratio).toBe(3);
    expect(headache.flagged).toBe(false);

    // flagged signals sort first
    expect(signals[0]).toBe(clusterA);
  });

  it("aggregates the per-site breakdown, SAE count, and empty input", () => {
    const rows: SignalInputRow[] = [
      row({ termKey: "rash", trialId: "A", siteName: "Site A" }),
      row({ termKey: "rash", trialId: "A", siteName: "Site A", seriousness: "sae" }),
      row({ termKey: "rash", trialId: "A", siteName: "Site B" }),
    ];
    const [signal] = computeSignals(rows);
    expect(signal.siteBreakdown).toBe("Site A ×2 · Site B ×1");
    expect(signal.saeCount).toBe(1);
    expect(computeSignals([])).toEqual([]);
  });
});

describe("T8.1 — DB integration: coded grouping + timeliness", () => {
  let db: TestDb;
  let participantId: string;

  beforeAll(async () => {
    db = await createTestDb();
    const [u] = await db
      .insert(users)
      .values([{ email: "pv@sig.demo", passwordHash: "x", name: "PV", role: "pv" }])
      .returning();
    const [trial] = await db
      .insert(trials)
      .values({
        protocolCode: "AYU-SIG",
        title: "Signal fixture",
        studyType: "interventional",
        intervention: "X",
        targetEnrollment: 10,
        status: "active",
        createdBy: u.id,
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
      .values({ subjectCode: "AYU-SIG-P-0001", trialSiteId: ts.id })
      .returning();
    participantId = p.id;

    const now = Date.now();
    await db.insert(adverseEvents).values([
      // coded (10000101 = Nausea) — groups by code, decodes to PT
      ...[1, 2].map((n) => ({
        participantId,
        term: `verbatim nausea wording ${n}`,
        meddraCode: "10000101",
        seriousness: "ae" as const,
        severity: "mild" as const,
        onsetDate: new Date(),
        reportingDeadline: new Date(now + 24 * HOUR),
        createdBy: u.id,
        // reported ON TIME
        reportedAt: new Date(now - 1 * HOUR),
        status: "reported" as const,
      })),
      // uncoded — groups by lower-cased verbatim term; reported LATE
      {
        participantId,
        term: "Metallic taste",
        seriousness: "ae" as const,
        severity: "mild" as const,
        onsetDate: new Date(),
        reportingDeadline: new Date(now - 2 * HOUR),
        reportedAt: new Date(now - 1 * HOUR),
        status: "reported" as const,
        createdBy: u.id,
      },
      // open past deadline
      {
        participantId,
        term: "metallic taste",
        seriousness: "sae" as const,
        severity: "moderate" as const,
        onsetDate: new Date(),
        reportingDeadline: new Date(now - 5 * HOUR),
        status: "open" as const,
        createdBy: u.id,
      },
    ]);
  });

  it("groups coded events by code (decoded label) and uncoded by verbatim term", async () => {
    const signals = await safetySignals(db);
    const nausea = signals.find((s) => s.termKey === "10000101")!;
    expect(nausea.termLabel).toBe("Nausea");
    expect(nausea.soc).toBe("Gastrointestinal disorders");
    expect(nausea.count).toBe(2);
    expect(nausea.siteBreakdown).toBe("AIIA Delhi ×2");

    // "Metallic taste" and "metallic taste" collapse into one group
    const metallic = signals.find((s) => s.termKey === "metallic taste")!;
    expect(metallic.count).toBe(2);
    expect(metallic.saeCount).toBe(1);
  });

  it("timeliness stats count on-time, late, and open-overdue exactly", async () => {
    const stats = await timelinessStats(db);
    expect(stats.total).toBe(4);
    expect(stats.reported).toBe(3);
    expect(stats.reportedOnTime).toBe(2);
    expect(stats.reportedLate).toBe(1);
    expect(stats.openOverdue).toBe(1);
    expect(stats.onTimeRate).toBeCloseTo(2 / 3, 5);
  });
});
