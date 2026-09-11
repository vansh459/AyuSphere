/**
 * AE/SAE reporting deadline engine (workflow.md §8, architecture.md §7).
 * Rule values are REPRESENTATIVE of NDCT-style timelines and configurable —
 * they are data, not code, and the demo states this plainly.
 */

export type DeadlineRule = {
  seriousness: "ae" | "sae";
  /** hours from capture to the initial report deadline */
  initialHours: number;
  /** days from capture to the detailed report deadline (SAE) */
  detailedDays?: number;
};

export const DEFAULT_DEADLINE_RULES: DeadlineRule[] = [
  { seriousness: "sae", initialHours: 24, detailedDays: 14 },
  { seriousness: "ae", initialHours: 7 * 24 },
];

export type ComputedDeadlines = {
  reportingDeadline: Date;
  detailedReportDeadline: Date | null;
};

export function computeDeadlines(
  seriousness: "ae" | "sae",
  capturedAt: Date,
  rules: DeadlineRule[] = DEFAULT_DEADLINE_RULES,
): ComputedDeadlines {
  const rule = rules.find((r) => r.seriousness === seriousness);
  if (!rule) {
    throw new Error(`no deadline rule configured for seriousness '${seriousness}'`);
  }
  const base = capturedAt.getTime();
  return {
    reportingDeadline: new Date(base + rule.initialHours * 3_600_000),
    detailedReportDeadline:
      rule.detailedDays !== undefined
        ? new Date(base + rule.detailedDays * 86_400_000)
        : null,
  };
}

export type ClockBand = "safe" | "amber" | "red" | "breached";

/** escalation-clock color bands (technology.md §2.2: status colors mean status) */
export function clockBand(deadline: Date, now: Date): {
  band: ClockBand;
  hoursLeft: number;
} {
  const hoursLeft = (deadline.getTime() - now.getTime()) / 3_600_000;
  if (hoursLeft < 0) return { band: "breached", hoursLeft };
  if (hoursLeft <= 6) return { band: "red", hoursLeft };
  if (hoursLeft <= 24) return { band: "amber", hoursLeft };
  return { band: "safe", hoursLeft };
}
