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
  Leaf,
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
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col bg-primary-deep text-white max-md:hidden">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary">
          <Leaf className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="font-bold leading-tight">AyuSphere</p>
          <p className="leading-tight opacity-60">
            Research Today · Healthier Tomorrow
          </p>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 pb-4">
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 font-medium transition-colors duration-200",
                active
                  ? "bg-primary text-white"
                  : "text-white/70 hover:bg-white/10 hover:text-white",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-white/10 px-5 py-4">
        <p className="font-bold tracking-widest">AYUSH</p>
        <p className="mt-1 leading-snug opacity-60">
          Traditional Wisdom
          <br />
          Modern Evidence
        </p>
      </div>
    </aside>
  );
}
