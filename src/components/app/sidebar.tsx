"use client";

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
  ScanLine,
  Settings,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { NavItem } from "@/lib/nav";

const ICONS: Record<NavItem["icon"], React.ComponentType<{ className?: string }>> = {
  home: Home,
  flask: FlaskConical,
  users: Users,
  "map-pin": MapPin,
  calendar: Calendar,
  clipboard: ClipboardList,
  "alert-triangle": AlertTriangle,
  scan: ScanLine,
  bell: Bell,
  bot: Bot,
  "file-text": FileText,
  download: Download,
  history: History,
  settings: Settings,
};

export function Sidebar({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <aside className="glass sticky top-4 flex max-h-[calc(100vh-2rem)] w-56 shrink-0 flex-col gap-1 overflow-y-auto p-3 max-md:hidden">
      <p className="px-3 py-2 text-heading font-bold text-primary-deep">
        AyuSphere
      </p>
      <nav className="flex flex-col gap-0.5">
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2 font-medium transition-colors duration-200",
                active
                  ? "bg-primary text-white"
                  : "text-ink/70 hover:bg-primary-soft hover:text-ink",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
