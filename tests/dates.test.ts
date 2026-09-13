/**
 * T6.7 — timezone-correct date formatting. The reported bug: a monitoring
 * visit completed at 01:07 IST on 14/09 rendered as "13/09" because the
 * Vercel server (TZ=UTC) formatted the UTC date. These tests pin the exact
 * repro instants from the live audit trail.
 */
import { describe, expect, it } from "vitest";
import { fmtDate, fmtDateTime, fmtTime } from "@/lib/dates";

describe("fmtDate — IST regardless of server timezone", () => {
  it("renders the IST date for a late-UTC instant (the reported bug)", () => {
    // stored completedAt of the user's visit: 13/09 19:37 UTC = 14/09 01:07 IST
    expect(fmtDate(new Date("2026-09-13T19:37:55.380Z"))).toBe("14/09/2026");
  });

  it("renders the same calendar day when UTC and IST agree", () => {
    expect(fmtDate(new Date("2026-09-14T10:00:00Z"))).toBe("14/09/2026");
  });

  it("handles the other edge: IST just past midnight, UTC still yesterday", () => {
    // 18:30 UTC is exactly 00:00 IST next day
    expect(fmtDate(new Date("2026-09-15T18:30:00Z"))).toBe("16/09/2026");
  });

  it("is null-safe", () => {
    expect(fmtDate(null)).toBe("");
    expect(fmtDate(undefined)).toBe("");
  });
});

describe("fmtDateTime / fmtTime", () => {
  it("shows the IST wall-clock time", () => {
    const s = fmtDateTime(new Date("2026-09-13T19:37:55Z")); // 01:07 IST 14/09
    expect(s).toContain("14/09/2026");
    expect(s).toMatch(/1:07/);
  });

  it("fmtTime is IST and null-safe", () => {
    expect(fmtTime(new Date("2026-09-13T19:37:00Z"))).toMatch(/1:07/);
    expect(fmtTime(null)).toBe("");
  });
});
