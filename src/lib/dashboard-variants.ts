/**
 * Tailored dashboards (T10.5, gap-analysis G12) — the PS's "tailored
 * dashboards for Investigators, the Ethics Committee, pharmacovigilance and
 * institutional leadership". One selector decides which cards each role's
 * /dashboard composes; the cards themselves are shared components (one code
 * path — the regulator sees read-only views, never stripped-down forks).
 */
import { can, type Role } from "@/lib/rbac";

export const DASHBOARD_CARDS = [
  "portfolio-stats",
  "trial-progress",
  "participant-distribution",
  "site-performance",
  "recent-activity",
  "upcoming-visits",
  "insights",
  "pending-approvals",
  "open-queries",
  "ethics-queues",
  "safety-clocks",
  "safety-signals",
  "monitoring-panel",
  "audit-shortcut",
  "assistant",
] as const;

export type DashboardCard = (typeof DASHBOARD_CARDS)[number];

/** which cards each role's dashboard composes, in render order */
export function dashboardVariant(role: Role): DashboardCard[] {
  const byRole: Record<Role, DashboardCard[]> = {
    // Investigator: their approvals and queries first, then portfolio context
    pi: [
      "portfolio-stats",
      "pending-approvals",
      "open-queries",
      "upcoming-visits",
      "trial-progress",
      "insights",
      "recent-activity",
      "assistant",
    ],
    // Coordinator: today's data-entry work
    coordinator: [
      "portfolio-stats",
      "upcoming-visits",
      "open-queries",
      "trial-progress",
      "recent-activity",
      "assistant",
    ],
    // Monitor: sites, deviations, and the query loop
    monitor: [
      "monitoring-panel",
      "open-queries",
      "site-performance",
      "recent-activity",
    ],
    // Ethics Committee: the two review queues
    ethics: ["ethics-queues", "recent-activity"],
    // Pharmacovigilance: safety portfolio ordered by deadline + signals
    pv: [
      "safety-clocks",
      "safety-signals",
      "portfolio-stats",
      "recent-activity",
      "assistant",
    ],
    // Institutional leadership: the whole portfolio + safety + audit
    admin: [
      "portfolio-stats",
      "trial-progress",
      "participant-distribution",
      "site-performance",
      "safety-clocks",
      "safety-signals",
      "pending-approvals",
      "open-queries",
      "upcoming-visits",
      "insights",
      "recent-activity",
      "audit-shortcut",
      "assistant",
    ],
    // Regulator: the leadership view, read-only, no AI assistant
    regulator: [
      "portfolio-stats",
      "trial-progress",
      "participant-distribution",
      "site-performance",
      "safety-signals",
      "recent-activity",
      "audit-shortcut",
    ],
  };

  // capability-consistency: a card never appears for a role that could not
  // use what it links to (defense in depth on top of the curated lists)
  return byRole[role].filter((card) => {
    switch (card) {
      case "assistant":
        return can(role, "copilot.use") || can(role, "crf.enter");
      case "audit-shortcut":
        return can(role, "audit.view");
      case "pending-approvals":
        return can(role, "crf.approve");
      case "ethics-queues":
        return can(role, "trial.ethicsReview");
      case "monitoring-panel":
        return can(role, "monitoring.log");
      case "open-queries":
        return can(role, "query.manage") || can(role, "crf.enter");
      case "safety-clocks":
        return can(role, "ae.review") || can(role, "ae.capture");
      default:
        return true;
    }
  });
}
