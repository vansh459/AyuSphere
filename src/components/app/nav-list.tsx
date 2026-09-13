"use client";

/**
 * Shared grouped navigation list (UI audit T6.4) — rendered identically by
 * the desktop Sidebar and the mobile drawer. Section headers appear only
 * when there is more than one group (sparse roles get a clean flat list);
 * badges stay live via useLiveBadges at the caller.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertTriangle,
  Bell,
  Bot,
  Calendar,
  ClipboardList,
  Download,
  FileText,
  FlaskConical,
  History,
  Home,
  MapPin,
  MessageSquare,
  ScanLine,
  Settings,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { GroupedNav, NavItem } from "@/lib/nav";

export const NAV_ICONS: Record<
  NavItem["icon"],
  React.ComponentType<{ className?: string }>
> = {
  home: Home,
  flask: FlaskConical,
  users: Users,
  "map-pin": MapPin,
  calendar: Calendar,
  clipboard: ClipboardList,
  "alert-triangle": AlertTriangle,
  message: MessageSquare,
  scan: ScanLine,
  bell: Bell,
  bot: Bot,
  "file-text": FileText,
  download: Download,
  history: History,
  settings: Settings,
};

export function NavList({
  groups,
  badges,
  onNavigate,
}: {
  groups: GroupedNav;
  badges: Record<string, number>;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const showHeaders = groups.length > 1;

  return (
    <>
      {groups.map(({ group, items }) => (
        <div key={group} className={cn(showHeaders && "mt-2 first:mt-0")}>
          {showHeaders ? (
            <p className="microlabel px-3 pb-1 pt-1.5 text-white/40">{group}</p>
          ) : null}
          {items.map((item) => {
            const Icon = NAV_ICONS[item.icon];
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            const count = badges[item.href] ?? 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2 font-medium transition-colors duration-200",
                  active
                    ? "bg-primary text-white"
                    : "text-white/70 hover:bg-white/10 hover:text-white",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {count > 0 ? (
                  <span
                    className={cn(
                      "flex shrink-0 items-center justify-center rounded-full font-bold shadow-xs sidebar-count-badge",
                      active ? "bg-primary-deep text-white" : "bg-white/20 text-white",
                    )}
                  >
                    {count > 9 ? "9+" : count}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      ))}
    </>
  );
}
