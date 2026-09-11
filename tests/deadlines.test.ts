import { describe, expect, it } from "vitest";
import {
  clockBand,
  computeDeadlines,
  type DeadlineRule,
} from "@/lib/rules/deadlines";

const t0 = new Date("2026-09-11T10:00:00Z");

describe("T2.1 — deadline engine", () => {
  it("SAE: initial report 24h, detailed report 14d — exact", () => {
    const d = computeDeadlines("sae", t0);
    expect(d.reportingDeadline.toISOString()).toBe("2026-09-12T10:00:00.000Z");
    expect(d.detailedReportDeadline!.toISOString()).toBe(
      "2026-09-25T10:00:00.000Z",
    );
  });

  it("AE: 7 days, no detailed report", () => {
    const d = computeDeadlines("ae", t0);
    expect(d.reportingDeadline.toISOString()).toBe("2026-09-18T10:00:00.000Z");
    expect(d.detailedReportDeadline).toBeNull();
  });

  it("honors a custom rule table (rules are configuration, not code)", () => {
    const custom: DeadlineRule[] = [
      { seriousness: "sae", initialHours: 12, detailedDays: 7 },
      { seriousness: "ae", initialHours: 48 },
    ];
    const d = computeDeadlines("sae", t0, custom);
    expect(d.reportingDeadline.toISOString()).toBe("2026-09-11T22:00:00.000Z");
    expect(d.detailedReportDeadline!.toISOString()).toBe(
      "2026-09-18T10:00:00.000Z",
    );
  });

  it("throws when no rule matches", () => {
    expect(() => computeDeadlines("sae", t0, [])).toThrow(/no deadline rule/);
  });
});

describe("T2.1 — escalation clock bands", () => {
  const deadline = new Date("2026-09-12T10:00:00Z");
  const at = (iso: string) => clockBand(deadline, new Date(iso)).band;

  it("safe > 24h, amber ≤ 24h, red ≤ 6h, breached past deadline", () => {
    expect(at("2026-09-11T09:00:00Z")).toBe("safe"); // 25h left
    expect(at("2026-09-11T10:00:00Z")).toBe("amber"); // exactly 24h
    expect(at("2026-09-12T03:59:59Z")).toBe("amber");
    expect(at("2026-09-12T04:00:00Z")).toBe("red"); // exactly 6h
    expect(at("2026-09-12T09:59:59Z")).toBe("red");
    expect(at("2026-09-12T10:00:01Z")).toBe("breached");
  });

  it("reports hours left, negative when breached", () => {
    expect(
      clockBand(deadline, new Date("2026-09-12T22:00:00Z")).hoursLeft,
    ).toBe(-12);
  });
});
