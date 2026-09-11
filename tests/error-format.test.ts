import { describe, expect, it } from "vitest";
import { errorMessage } from "@/lib/errors";
import { createTrialInput } from "@/services/trials";

describe("server-action error formatting (no raw Zod JSON in banners)", () => {
  it("formats a short-title ZodError as a readable sentence", () => {
    const res = createTrialInput.safeParse({
      protocolCode: "AYU-999",
      title: "abc",
      studyType: "interventional",
      intervention: "Guduchi",
      targetEnrollment: 10,
      visitPlan: [{ visitNumber: 1, name: "Baseline", dayOffset: 0, windowDays: 3 }],
    });
    expect(res.success).toBe(false);
    const msg = errorMessage(res.success ? null : res.error);
    expect(msg).toBe("Title: needs at least 5 characters — describe the study");
    expect(msg).not.toContain("{");
    expect(msg).not.toContain("too_small");
  });

  it("joins multiple issues with a separator and labels fields", () => {
    const res = createTrialInput.safeParse({
      protocolCode: "AY",
      title: "ok title here",
      studyType: "interventional",
      intervention: "Guduchi",
      targetEnrollment: -5,
      visitPlan: [],
    });
    const msg = errorMessage(res.success ? null : res.error);
    expect(msg).toContain("Protocol code: needs at least 3 characters");
    expect(msg).toContain("Target enrolment: must be greater than zero");
    expect(msg).toContain("Visit plan: add at least one visit row");
    expect(msg).toContain(" · ");
    expect(msg).not.toContain('"path"');
  });

  it("plain errors pass through; non-errors get a generic message", () => {
    expect(errorMessage(new Error("trial not found"))).toBe("trial not found");
    expect(errorMessage("weird")).toBe("The action failed.");
  });
});
