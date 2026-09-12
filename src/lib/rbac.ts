/**
 * RBAC — single source of truth (docs/architecture.md §10).
 * Consumed by: proxy/layout gating, service-level checks, conditional UI.
 * A capability missing here does not exist.
 */

export const ROLES = [
  "pi",
  "coordinator",
  "monitor",
  "ethics",
  "pv",
  "admin",
  "regulator",
] as const;

export type Role = (typeof ROLES)[number];

export const CAPABILITIES = [
  "dashboard.view",
  "trial.manage", // create/edit trials, lifecycle transitions (except ethics gate)
  "trial.ethicsReview", // approve / return from iec_review
  "site.manage",
  "participant.manage", // screening, consent, enrolment, withdrawal
  "crf.enter",
  "crf.approve", // also approves extractions
  "ae.capture",
  "ae.review", // PV review / report / close
  "monitoring.log",
  "alert.acknowledge",
  "copilot.use",
  "export.run",
  "document.upload",
  "users.manage",
  "audit.view",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const MATRIX: Record<Role, readonly Capability[]> = {
  pi: [
    "dashboard.view",
    "trial.manage",
    "site.manage",
    "participant.manage",
    "crf.enter",
    "crf.approve",
    "ae.capture",
    "alert.acknowledge",
    "copilot.use",
    "export.run",
    "document.upload",
  ],
  coordinator: [
    "dashboard.view",
    "trial.manage",
    "participant.manage",
    "crf.enter",
    "ae.capture",
    "alert.acknowledge",
    "copilot.use",
    "document.upload",
  ],
  monitor: ["dashboard.view", "monitoring.log", "alert.acknowledge"],
  ethics: ["dashboard.view", "trial.ethicsReview"],
  pv: [
    "dashboard.view",
    "ae.capture",
    "ae.review",
    "alert.acknowledge",
    "copilot.use",
    "export.run",
  ],
  // admin: full access to every feature (user request, 2026-09-12)
  admin: [...CAPABILITIES],
  // read-only regulator: NOTHING that mutates
  regulator: ["dashboard.view", "audit.view"],
};

/** capabilities that mutate state — the regulator must never hold any */
export const MUTATING_CAPABILITIES: readonly Capability[] = [
  "trial.manage",
  "trial.ethicsReview",
  "site.manage",
  "participant.manage",
  "crf.enter",
  "crf.approve",
  "ae.capture",
  "ae.review",
  "monitoring.log",
  "alert.acknowledge",
  "document.upload",
  "users.manage",
];

export function can(role: Role, capability: Capability): boolean {
  return MATRIX[role].includes(capability);
}

/** throw-on-deny variant for the service layer */
export function assertCan(role: Role, capability: Capability): void {
  if (!can(role, capability)) {
    throw new RbacError(role, capability);
  }
}

export class RbacError extends Error {
  readonly role: Role;
  readonly capability: Capability;
  constructor(role: Role, capability: Capability) {
    super(`role '${role}' lacks capability '${capability}'`);
    this.name = "RbacError";
    this.role = role;
    this.capability = capability;
  }
}
