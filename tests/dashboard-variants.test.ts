/**
 * T10.5 — Tailored dashboards.
 * Gate: the variant selector returns the expected card set per role
 * (Investigator, Ethics Committee, pharmacovigilance, monitor, leadership,
 * regulator), every card is declared, and capability-sensitive cards never
 * leak to roles that lack the capability.
 */
import { describe, expect, it } from "vitest";
import {
  DASHBOARD_CARDS,
  dashboardVariant,
  type DashboardCard,
} from "@/lib/dashboard-variants";
import { ROLES, can } from "@/lib/rbac";

describe("T10.5 — variant selector", () => {
  it("every role gets a non-empty set of declared cards", () => {
    for (const role of ROLES) {
      const cards = dashboardVariant(role);
      expect(cards.length, `${role} dashboard must not be empty`).toBeGreaterThan(0);
      for (const card of cards) expect(DASHBOARD_CARDS).toContain(card);
      // no duplicates
      expect(new Set(cards).size).toBe(cards.length);
    }
  });

  it("returns the expected composition per role", () => {
    expect(dashboardVariant("pi")).toEqual([
      "portfolio-stats",
      "pending-approvals",
      "open-queries",
      "upcoming-visits",
      "trial-progress",
      "insights",
      "recent-activity",
      "assistant",
    ]);
    expect(dashboardVariant("ethics")).toEqual([
      "ethics-queues",
      "recent-activity",
    ]);
    expect(dashboardVariant("pv")).toEqual([
      "safety-clocks",
      "safety-signals",
      "portfolio-stats",
      "recent-activity",
      "assistant",
    ]);
    expect(dashboardVariant("monitor")).toEqual([
      "monitoring-panel",
      "open-queries",
      "site-performance",
      "recent-activity",
    ]);
    expect(dashboardVariant("regulator")).toEqual([
      "portfolio-stats",
      "trial-progress",
      "participant-distribution",
      "site-performance",
      "safety-signals",
      "recent-activity",
      "audit-shortcut",
    ]);
  });

  it("capability-sensitive cards never leak to roles without the capability", () => {
    const guards: [DashboardCard, (r: (typeof ROLES)[number]) => boolean][] = [
      ["assistant", (r) => can(r, "copilot.use") || can(r, "crf.enter")],
      ["audit-shortcut", (r) => can(r, "audit.view")],
      ["pending-approvals", (r) => can(r, "crf.approve")],
      ["ethics-queues", (r) => can(r, "trial.ethicsReview")],
      ["monitoring-panel", (r) => can(r, "monitoring.log")],
      ["safety-clocks", (r) => can(r, "ae.review") || can(r, "ae.capture")],
      ["open-queries", (r) => can(r, "query.manage") || can(r, "crf.enter")],
    ];
    for (const role of ROLES) {
      const cards = dashboardVariant(role);
      for (const [card, allowed] of guards) {
        if (cards.includes(card)) {
          expect(allowed(role), `${role} must not see '${card}'`).toBe(true);
        }
      }
    }
  });

  it("role-defining cards land where the PS expects them", () => {
    // the regulator is read-only: no AI assistant, no approval queue
    expect(dashboardVariant("regulator")).not.toContain("assistant");
    expect(dashboardVariant("regulator")).not.toContain("pending-approvals");
    // the coordinator enters data but does not approve
    expect(dashboardVariant("coordinator")).not.toContain("pending-approvals");
    // leadership (admin) sees safety + audit + the whole portfolio
    const admin = dashboardVariant("admin");
    for (const card of [
      "safety-signals",
      "safety-clocks",
      "audit-shortcut",
      "portfolio-stats",
      "pending-approvals",
    ] as DashboardCard[]) {
      expect(admin).toContain(card);
    }
  });
});
