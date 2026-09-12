import { describe, expect, it } from "vitest";
import { NAV_ITEMS, navForRole } from "@/lib/nav";
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
