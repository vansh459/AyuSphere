import { describe, expect, it } from "vitest";
import { analyzeRecruitment } from "@/lib/rules/recruitment";

const WEEK = 7 * 24 * 60 * 60 * 1000;
const now = new Date("2026-09-11T00:00:00Z");
const weeksAgo = (n: number) => new Date(now.getTime() - n * WEEK);
const weeksAhead = (n: number) => new Date(now.getTime() + n * WEEK);

describe("T3.3 — velocity and projection", () => {
  it("computes participants/week and projected completion exactly", () => {
    const a = analyzeRecruitment(
      { enrolled: 20, target: 50, activatedAt: weeksAgo(10), windowEnd: weeksAhead(20) },
      now,
    );
    expect(a.velocity).toBeCloseTo(2, 5); // 20 in 10 weeks
    expect(a.progress).toBeCloseTo(0.4, 5);
    expect(a.projectedWeeksToTarget).toBeCloseTo(15, 5); // 30 remaining at 2/wk
    expect(a.band).toBe("on_track"); // 15 ≤ 20 weeks left
  });

  it("target reached → on_track with zero projection", () => {
    const a = analyzeRecruitment(
      { enrolled: 50, target: 50, activatedAt: weeksAgo(10) },
      now,
    );
    expect(a.band).toBe("on_track");
    expect(a.projectedWeeksToTarget).toBe(0);
  });
});

describe("T3.3 — risk bands against a window", () => {
  const base = { target: 60, activatedAt: weeksAgo(10) };

  it("at_risk when projection overshoots the window by ≤50%", () => {
    // 12 enrolled in 10wk → 1.2/wk; 48 remaining → 40wk vs 30 left → 1.33× → at_risk
    const a = analyzeRecruitment(
      { ...base, enrolled: 12, windowEnd: weeksAhead(30) },
      now,
    );
    expect(a.band).toBe("at_risk");
  });

  it("behind when projection overshoots by >50% or velocity is zero", () => {
    const slow = analyzeRecruitment(
      { ...base, enrolled: 5, windowEnd: weeksAhead(20) },
      now,
    );
    expect(slow.band).toBe("behind");
    const dead = analyzeRecruitment(
      { ...base, enrolled: 0, windowEnd: weeksAhead(20) },
      now,
    );
    expect(dead.band).toBe("behind");
    expect(dead.projectedWeeksToTarget).toBeNull();
  });

  it("closed window below target → behind", () => {
    const a = analyzeRecruitment(
      { ...base, enrolled: 30, windowEnd: weeksAgo(1) },
      now,
    );
    expect(a.band).toBe("behind");
  });
});

describe("T3.3 — no-window heuristic (matches the seeded lagging site)", () => {
  it("3/30 enrolled after 90 days → behind", () => {
    const a = analyzeRecruitment(
      { enrolled: 3, target: 30, activatedAt: weeksAgo(13) },
      now,
    );
    expect(a.band).toBe("behind");
    expect(a.progress).toBeCloseTo(0.1, 5);
  });

  it("24/50 → at_risk boundary vs 26/50 → on_track", () => {
    expect(
      analyzeRecruitment(
        { enrolled: 24, target: 50, activatedAt: weeksAgo(10) },
        now,
      ).band,
    ).toBe("at_risk");
    expect(
      analyzeRecruitment(
        { enrolled: 26, target: 50, activatedAt: weeksAgo(10) },
        now,
      ).band,
    ).toBe("on_track");
  });
});
