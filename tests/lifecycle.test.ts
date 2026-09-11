import { describe, expect, it } from "vitest";
import {
  TRIAL_STATUSES,
  capabilityFor,
  isEdge,
  validateTransition,
  type TransitionContext,
  type TrialStatus,
} from "@/lib/rules/lifecycle";

const fullCtx: TransitionContext = {
  hasIecApproval: true,
  hasCtriNumber: true,
  hasActiveSite: true,
  hasProtocolDocument: true,
};

const LEGAL: [TrialStatus, TrialStatus][] = [
  ["draft", "iec_review"],
  ["iec_review", "iec_approved"],
  ["iec_review", "draft"],
  ["iec_approved", "ctri_registered"],
  ["ctri_registered", "active"],
  ["active", "enrolment_closed"],
  ["enrolment_closed", "followup"],
  ["followup", "closeout"],
];

describe("T1.1 — lifecycle state machine (architecture.md §4)", () => {
  it("allows every legal transition with full context", () => {
    for (const [from, to] of LEGAL) {
      expect(validateTransition(from, to, fullCtx).ok, `${from}→${to}`).toBe(
        true,
      );
    }
  });

  it("rejects every non-edge pair", () => {
    for (const from of TRIAL_STATUSES) {
      for (const to of TRIAL_STATUSES) {
        const legal = LEGAL.some(([f, t]) => f === from && t === to);
        if (!legal) {
          const res = validateTransition(from, to, fullCtx);
          expect(res.ok, `${from}→${to} must be rejected`).toBe(false);
        }
      }
    }
  });

  it("closeout is terminal", () => {
    for (const to of TRIAL_STATUSES) {
      expect(isEdge("closeout", to)).toBe(false);
    }
  });

  it("activation requires IEC approval + CTRI number + an active site — each independently", () => {
    expect(
      validateTransition("ctri_registered", "active", {
        ...fullCtx,
        hasIecApproval: false,
      }).ok,
    ).toBe(false);
    expect(
      validateTransition("ctri_registered", "active", {
        ...fullCtx,
        hasCtriNumber: false,
      }).ok,
    ).toBe(false);
    expect(
      validateTransition("ctri_registered", "active", {
        ...fullCtx,
        hasActiveSite: false,
      }).ok,
    ).toBe(false);
  });

  it("ethics submission requires a protocol document; CTRI step requires the number", () => {
    expect(
      validateTransition("draft", "iec_review", {
        ...fullCtx,
        hasProtocolDocument: false,
      }).ok,
    ).toBe(false);
    expect(
      validateTransition("iec_approved", "ctri_registered", {
        ...fullCtx,
        hasCtriNumber: false,
      }).ok,
    ).toBe(false);
  });

  it("only the ethics capability moves a trial out of iec_review", () => {
    expect(capabilityFor("iec_review", "iec_approved")).toBe(
      "trial.ethicsReview",
    );
    expect(capabilityFor("iec_review", "draft")).toBe("trial.ethicsReview");
    expect(capabilityFor("draft", "iec_review")).toBe("trial.manage");
    expect(capabilityFor("ctri_registered", "active")).toBe("trial.manage");
  });
});
