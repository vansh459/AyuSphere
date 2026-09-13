"use client";

/**
 * Live badge counts for the sidebar + topbar bell. The (app) layout is a
 * server component that renders ONCE per hard load, so its counts freeze
 * across client-side navigation — this hook keeps them honest: it refetches
 * /api/badges on mount, on a slow poll, and IMMEDIATELY when anything calls
 * refreshBadges() (e.g. the messages page after marking a thread read).
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";

const REFRESH_EVENT = "ayusphere:badges-refresh";
const POLL_MS = 15_000;

/** ask every mounted badge consumer to refetch right now */
export function refreshBadges() {
  window.dispatchEvent(new Event(REFRESH_EVENT));
}

export function useLiveBadges(
  initial: Record<string, number>,
): Record<string, number> {
  const [badges, setBadges] = useState(initial);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/badges", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { badges?: Record<string, number> };
        if (alive && json.badges) setBadges(json.badges);
      } catch {
        /* transient — next tick retries */
      }
    };
    const onPing = () => void load();
    window.addEventListener(REFRESH_EVENT, onPing);
    const timer = setInterval(load, POLL_MS);
    void load(); // sync immediately on mount
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener(REFRESH_EVENT, onPing);
    };
  }, []);

  return badges;
}

/** the topbar alerts bell with a LIVE count (same staleness fix) */
export function TopbarBell({ initialCount }: { initialCount: number }) {
  const badges = useLiveBadges({ "/alerts": initialCount });
  const count = badges["/alerts"] ?? 0;
  return (
    <Link
      href="/alerts"
      className="flex h-10 w-10 items-center justify-center rounded-xl text-ink transition-colors duration-200 hover:bg-primary-soft"
      aria-label={`Alerts (${count} open)`}
    >
      <span className="relative inline-flex items-center justify-center">
        <Bell className="h-5 w-5 text-ink" />
        {count > 0 ? (
          <span className="pointer-events-none absolute right-0 top-0 flex items-center justify-center rounded-full bg-danger text-white shadow-xs topbar-bell-badge">
            {count > 9 ? "9+" : count}
          </span>
        ) : null}
      </span>
    </Link>
  );
}
