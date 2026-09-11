/**
 * Trial lifecycle state machine — docs/architecture.md §4.
 * Pure domain logic: no I/O. Services load context and enforce results.
 * PS rule encoded here: a trial can never be `active` without IEC approval
 * AND a CTRI number (prospective registration).
 */
import type { Capability } from "@/lib/rbac";

export const TRIAL_STATUSES = [
  "draft",
  "iec_review",
  "iec_approved",
  "ctri_registered",
  "active",
  "enrolment_closed",
  "followup",
  "closeout",
] as const;

export type TrialStatus = (typeof TRIAL_STATUSES)[number];

/** legal edges of the state graph */
const EDGES: Record<TrialStatus, readonly TrialStatus[]> = {
  draft: ["iec_review"],
  iec_review: ["iec_approved", "draft"], // draft = returned with comments
  iec_approved: ["ctri_registered"],
  ctri_registered: ["active"],
  active: ["enrolment_closed"],
  enrolment_closed: ["followup"],
  followup: ["closeout"],
  closeout: [], // archived, read-only
};

export type TransitionContext = {
  hasIecApproval: boolean;
  hasCtriNumber: boolean;
  hasActiveSite: boolean;
  hasProtocolDocument: boolean;
};

export type TransitionCheck =
  | { ok: true }
  | { ok: false; reason: string };

export function isEdge(from: TrialStatus, to: TrialStatus): boolean {
  return EDGES[from].includes(to);
}

/**
 * Which capability authorizes a given transition.
 * Only the ethics role moves a trial out of iec_review (either direction).
 */
export function capabilityFor(
  from: TrialStatus,
  to: TrialStatus,
): Capability {
  if (from === "iec_review" && (to === "iec_approved" || to === "draft")) {
    return "trial.ethicsReview";
  }
  return "trial.manage";
}

export function validateTransition(
  from: TrialStatus,
  to: TrialStatus,
  ctx: TransitionContext,
): TransitionCheck {
  if (!isEdge(from, to)) {
    return {
      ok: false,
      reason: `illegal transition: ${from} → ${to}`,
    };
  }
  if (to === "iec_review" && !ctx.hasProtocolDocument) {
    return {
      ok: false,
      reason: "cannot submit for ethics review without a protocol document",
    };
  }
  if (to === "ctri_registered" && !ctx.hasCtriNumber) {
    return {
      ok: false,
      reason: "CTRI registration requires a CTRI number",
    };
  }
  if (to === "active") {
    if (!ctx.hasIecApproval) {
      return {
        ok: false,
        reason: "trial cannot be activated without IEC approval",
      };
    }
    if (!ctx.hasCtriNumber) {
      return {
        ok: false,
        reason:
          "trial cannot be activated without prospective CTRI registration",
      };
    }
    if (!ctx.hasActiveSite) {
      return {
        ok: false,
        reason: "trial cannot be activated without at least one active site",
      };
    }
  }
  return { ok: true };
}
