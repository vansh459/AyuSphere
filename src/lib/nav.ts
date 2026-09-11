/**
 * Role-gated navigation — driven by the RBAC matrix, never hand-filtered
 * in components (architecture.md §10).
 */
import { can, type Capability, type Role } from "@/lib/rbac";

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
    | "scan"
    | "bell"
    | "bot"
    | "file-text"
    | "download"
    | "history"
    | "settings";
  capability: Capability;
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "home", capability: "dashboard.view" },
  { href: "/trials", label: "Clinical Trials", icon: "flask", capability: "trial.manage" },
  { href: "/ethics", label: "Ethics Review", icon: "clipboard", capability: "trial.ethicsReview" },
  { href: "/participants", label: "Participants", icon: "users", capability: "participant.manage" },
  { href: "/sites", label: "Site Management", icon: "map-pin", capability: "site.manage" },
  { href: "/visits", label: "Visit Schedule", icon: "calendar", capability: "crf.enter" },
  { href: "/doctor-note", label: "Data Entry (eCRF)", icon: "scan", capability: "crf.enter" },
  { href: "/adverse-events", label: "Adverse Events", icon: "alert-triangle", capability: "ae.capture" },
  { href: "/monitoring", label: "Monitoring", icon: "clipboard", capability: "monitoring.log" },
  { href: "/alerts", label: "Alerts", icon: "bell", capability: "alert.acknowledge" },
  { href: "/copilot", label: "AI Assistant", icon: "bot", capability: "copilot.use" },
  { href: "/documents", label: "Documents", icon: "file-text", capability: "document.upload" },
  { href: "/exports", label: "Reports & Exports", icon: "download", capability: "export.run" },
  { href: "/audit", label: "Audit Trail", icon: "history", capability: "audit.view" },
  { href: "/settings", label: "Settings", icon: "settings", capability: "users.manage" },
];

export function navForRole(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => can(role, item.capability));
}
