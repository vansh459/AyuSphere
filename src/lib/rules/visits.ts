/**
 * Visit engine — pure window math + status derivation (workflow.md §5).
 * upcoming → due (inside window) → overdue (past window) → missed
 * (past window by more than the grace period). completed/cancelled are
 * terminal.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

/** days past windowEnd after which an overdue visit counts as missed */
export const MISSED_GRACE_DAYS = 14;

export type VisitPlanItem = {
  visitNumber: number;
  name: string;
  dayOffset: number;
  windowDays: number;
};

export type ScheduledVisit = {
  visitNumber: number;
  name: string;
  scheduledDate: Date;
  windowStart: Date;
  windowEnd: Date;
};

export function generateVisitSchedule(
  enrolledAt: Date,
  plan: VisitPlanItem[],
): ScheduledVisit[] {
  return plan.map((v) => {
    const scheduled = enrolledAt.getTime() + v.dayOffset * DAY_MS;
    const window = v.windowDays * DAY_MS;
    return {
      visitNumber: v.visitNumber,
      name: v.name,
      scheduledDate: new Date(scheduled),
      windowStart: new Date(scheduled - window),
      windowEnd: new Date(scheduled + window),
    };
  });
}

export type VisitStatus =
  | "upcoming"
  | "due"
  | "overdue"
  | "completed"
  | "missed"
  | "cancelled";

export function deriveVisitStatus(
  visit: {
    status: VisitStatus;
    windowStart: Date;
    windowEnd: Date;
  },
  now: Date,
): VisitStatus {
  // terminal states never change
  if (
    visit.status === "completed" ||
    visit.status === "cancelled" ||
    visit.status === "missed"
  ) {
    return visit.status;
  }
  const t = now.getTime();
  if (t < visit.windowStart.getTime()) return "upcoming";
  if (t <= visit.windowEnd.getTime()) return "due";
  if (t <= visit.windowEnd.getTime() + MISSED_GRACE_DAYS * DAY_MS) {
    return "overdue";
  }
  return "missed";
}
