/**
 * Role-gated navigation — driven by the RBAC matrix, never hand-filtered
 * in components (architecture.md §10).
 */
import { can, type Capability, type Role } from "@/lib/rbac";

export const NAV_GROUPS = [
  "Overview",
  "Study Conduct",
  "Data Capture",
  "Safety & Quality",
  "Intelligence",
  "System",
] as const;

export type NavGroup = (typeof NAV_GROUPS)[number];

export type NavItem = {
  href: string;
  label: string;
  icon:
    | "home"
    | "flask"
    | "users"
    | "map-pin"
    | "calendar"
    | "clipboard"
    | "alert-triangle"
    | "message"
    | "scan"
    | "bell"
    | "bot"
    | "file-text"
    | "download"
    | "history"
    | "settings";
  capability: Capability;
  /** sidebar section (UI audit T6.4) — chunks the long flat list */
  group: NavGroup;
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "home", capability: "dashboard.view", group: "Overview" },
  { href: "/messages", label: "Messages", icon: "message", capability: "chat.use", group: "Overview" },
  { href: "/trials", label: "Clinical Trials", icon: "flask", capability: "trial.manage", group: "Study Conduct" },
  { href: "/ethics", label: "Ethics Review", icon: "clipboard", capability: "trial.ethicsReview", group: "Study Conduct" },
  { href: "/participants", label: "Participants", icon: "users", capability: "participant.manage", group: "Study Conduct" },
  { href: "/sites", label: "Site Management", icon: "map-pin", capability: "site.manage", group: "Study Conduct" },
  { href: "/visits", label: "Visit Schedule", icon: "calendar", capability: "crf.enter", group: "Study Conduct" },
  { href: "/doctor-note", label: "Data Entry (eCRF)", icon: "scan", capability: "crf.enter", group: "Data Capture" },
  { href: "/extractions", label: "Extractions", icon: "file-text", capability: "crf.enter", group: "Data Capture" },
  { href: "/documents", label: "Documents", icon: "file-text", capability: "document.upload", group: "Data Capture" },
  { href: "/adverse-events", label: "Adverse Events", icon: "alert-triangle", capability: "ae.capture", group: "Safety & Quality" },
  { href: "/monitoring", label: "Monitoring", icon: "clipboard", capability: "monitoring.log", group: "Safety & Quality" },
  { href: "/alerts", label: "Alerts", icon: "bell", capability: "alert.acknowledge", group: "Safety & Quality" },
  { href: "/copilot", label: "AI Assistant", icon: "bot", capability: "copilot.use", group: "Intelligence" },
  { href: "/exports", label: "Reports & Exports", icon: "download", capability: "export.run", group: "Intelligence" },
  { href: "/audit", label: "Audit Trail", icon: "history", capability: "audit.view", group: "System" },
  { href: "/settings", label: "Settings", icon: "settings", capability: "users.manage", group: "System" },
];

export function navForRole(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => can(role, item.capability));
}

/** section headers only help when the list is long enough to need chunking */
export const GROUPED_NAV_THRESHOLD = 6;

export type GroupedNav = { group: NavGroup; items: NavItem[] }[];

/**
 * The role's nav chunked into sections, in NAV_GROUPS order, empty groups
 * dropped. Returns a single unlabeled group when the role has too few items
 * for headers to earn their space (ethics/monitor/pv/regulator).
 */
export function groupedNavForRole(role: Role): GroupedNav {
  const items = navForRole(role);
  if (items.length <= GROUPED_NAV_THRESHOLD) {
    return items.length > 0 ? [{ group: "Overview", items }] : [];
  }
  return NAV_GROUPS.map((group) => ({
    group,
    items: items.filter((i) => i.group === group),
  })).filter((g) => g.items.length > 0);
}
