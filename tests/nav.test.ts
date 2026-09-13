import { describe, expect, it } from "vitest";
import {
  GROUPED_NAV_THRESHOLD,
  NAV_GROUPS,
  NAV_ITEMS,
  groupedNavForRole,
  navForRole,
} from "@/lib/nav";
import { MUTATING_CAPABILITIES, ROLES } from "@/lib/rbac";

describe("T1.7 — role-gated navigation", () => {
  it("regulator sees only read-only routes plus messaging (dashboard + audit + messages)", () => {
    const items = navForRole("regulator").map((i) => i.href);
    // messaging is communication, not a clinical-record mutation (chat.use)
    expect(items.sort()).toEqual(["/audit", "/dashboard", "/messages"]);
  });

  it("regulator nav contains no mutating capability", () => {
    for (const item of navForRole("regulator")) {
      expect(MUTATING_CAPABILITIES).not.toContain(item.capability);
    }
  });

  it("ethics sees the review queue but not trials/participants", () => {
    const hrefs = navForRole("ethics").map((i) => i.href);
    expect(hrefs).toContain("/ethics");
    expect(hrefs).not.toContain("/trials");
    expect(hrefs).not.toContain("/participants");
  });

  it("pv sees adverse events + exports; monitor sees monitoring but no CRF entry", () => {
    const pv = navForRole("pv").map((i) => i.href);
    expect(pv).toContain("/adverse-events");
    expect(pv).toContain("/exports");
    const monitor = navForRole("monitor").map((i) => i.href);
    expect(monitor).toContain("/monitoring");
    expect(monitor).not.toContain("/doctor-note");
    expect(monitor).not.toContain("/visits");
  });

  it("every role gets a dashboard; every nav item maps to a declared capability", () => {
    for (const role of ROLES) {
      expect(navForRole(role).map((i) => i.href)).toContain("/dashboard");
    }
    for (const item of NAV_ITEMS) {
      expect(item.capability).toBeTruthy();
    }
  });
});

describe("T6.4 — grouped sidebar navigation", () => {
  it("every nav item carries a declared group", () => {
    for (const item of NAV_ITEMS) {
      expect(NAV_GROUPS).toContain(item.group);
    }
  });

  it("grouping preserves exactly the role's RBAC-filtered items, in group order", () => {
    for (const role of ROLES) {
      const flat = navForRole(role).map((i) => i.href).sort();
      const grouped = groupedNavForRole(role)
        .flatMap((g) => g.items.map((i) => i.href))
        .sort();
      expect(grouped, `${role}: grouped nav must equal flat nav`).toEqual(flat);
    }
  });

  it(`section headers only for roles with more than ${GROUPED_NAV_THRESHOLD} items`, () => {
    // long lists chunk into sections…
    for (const role of ["pi", "coordinator", "admin"] as const) {
      const groups = groupedNavForRole(role);
      expect(
        groups.length,
        `${role} (${navForRole(role).length} items) should be sectioned`,
      ).toBeGreaterThan(1);
    }
    // …sparse roles stay one flat list (headers would be noise)
    for (const role of ["ethics", "monitor", "pv", "regulator"] as const) {
      expect(groupedNavForRole(role)).toHaveLength(1);
    }
  });

  it("admin sees all six sections; regulator's flat list never includes Settings", () => {
    expect(groupedNavForRole("admin").map((g) => g.group)).toEqual([
      ...NAV_GROUPS,
    ]);
    const regulator = groupedNavForRole("regulator").flatMap((g) =>
      g.items.map((i) => i.href),
    );
    expect(regulator).not.toContain("/settings");
    expect(regulator).not.toContain("/trials");
  });
});
