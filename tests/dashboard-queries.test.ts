/**
 * Regression tests for the "ambiguous column" prod bug (2026-09-11):
 * correlated raw-SQL subqueries over a single-table FROM render unqualified
 * column names. These exercise every rewritten query on real Postgres
 * (PGlite) against the seed — they fail loudly if the pattern regresses.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "./helpers/db";
import { seed } from "@/db/seed";
import { users } from "@/db/schema";
import type { Actor } from "@/lib/audit";
import { listTrialsWithCounts } from "@/services/trials";
import { answerQuestion, type TextClient } from "@/services/copilot";
import {
  aiInsights,
  participantDistribution,
  recentActivities,
  sitePerformanceAggregate,
  statCards,
  trialProgressSeries,
  upcomingVisitList,
} from "@/services/dashboard";

let db: TestDb;
let admin: Actor;

beforeAll(async () => {
  db = await createTestDb();
  await seed(db);
  const [u] = await db.select().from(users).where(eq(users.role, "admin"));
  admin = { id: u.id, role: "admin" };
}, 180_000);

describe("trials list query (the /trials page bug)", () => {
  it("returns per-trial enrolled + site counts against the seed", async () => {
    const rows = await listTrialsWithCounts(db);
    expect(rows).toHaveLength(3);
    const byCode = Object.fromEntries(
      rows.map((r) => [r.trial.protocolCode, r]),
    );
    expect(byCode["AYU-001"].enrolled).toBe(45); // 24+18+3
    expect(byCode["AYU-001"].siteCount).toBe(3);
    expect(byCode["AYU-002"].enrolled).toBe(21); // 12+9
    expect(byCode["AYU-002"].siteCount).toBe(2);
    expect(byCode["AYU-003"].enrolled).toBe(0);
    expect(byCode["AYU-003"].siteCount).toBe(0);
  });
});

describe("copilot portfolio retrieval (same latent bug)", () => {
  it("'summarize the portfolio' retrieves all trials with correct enrolment", async () => {
    const complete = vi.fn(async (_prompt: string) => "Summary [1][2][3].");
    const llm: TextClient = { modelId: "mock", complete };
    const res = await answerQuestion(db, admin, "Summarize the portfolio", llm);
    expect(res.grounded).toBe(true);
    expect(res.citations).toHaveLength(3);
    const prompt = complete.mock.calls[0][0];
    expect(prompt).toContain('"protocolCode":"AYU-001"');
    expect(prompt).toContain('"enrolled":45');
  });
});

describe("dashboard service queries run on real Postgres", () => {
  it("statCards match the seed", async () => {
    const s = await statCards(db);
    expect(s.activeTrials).toBe(2);
    expect(s.totalParticipants).toBe(66);
    expect(s.sites).toBe(3);
    expect(s.states).toBe(3);
    expect(s.openAes).toBe(2);
  });

  it("recruitment insight computes a real (non-zero) portfolio percentage", async () => {
    const insights = await aiInsights(db);
    const recruit = insights.find((i) => i.title.startsWith("Recruitment"))!;
    // seed: 66 enrolled / 320 active-site targets ≈ 21% — the old correlated
    // subquery silently returned 0 enrolled
    expect(recruit.detail).not.toContain(" 0%");
    expect(insights).toHaveLength(4);
  });

  it("distribution, site bars, progress series, activities, visits all execute", async () => {
    const dist = await participantDistribution(db);
    expect(dist.total).toBe(66);
    expect(dist.slices.find((s) => s.name === "Enrolled")?.value).toBe(66);

    const bars = await sitePerformanceAggregate(db);
    expect(bars).toHaveLength(3);
    expect(bars.every((b) => b.rate >= 0 && b.rate <= 1)).toBe(true);

    const series = await trialProgressSeries(db);
    expect(series).toHaveLength(9);
    expect(series[8].enrolled).toBe(66); // cumulative reaches the seed total

    const acts = await recentActivities(db);
    expect(acts.length).toBeGreaterThan(0);
    const visits = await upcomingVisitList(db);
    expect(visits.length).toBeGreaterThan(0);
  });
});
