"use client";

import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";
import { APP_LOCALE, APP_TZ } from "@/lib/dates";

export function LiveClock() {
  const [mounted, setMounted] = useState(false);
  const [time, setTime] = useState<Date>(() => new Date());

  useEffect(() => {
    setMounted(true);
    setTime(new Date());
    const interval = setInterval(() => {
      setTime(new Date());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const dateStr = time.toLocaleDateString(APP_LOCALE, {
    timeZone: APP_TZ,
    weekday: "long",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  const timeStr = time.toLocaleTimeString(APP_LOCALE, {
    timeZone: APP_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });

  return (
    <div className="clay flex shrink-0 items-center gap-3 px-4 py-2.5">
      <CalendarDays className="h-5 w-5 text-primary" />
      <div>
        <p className="font-bold leading-tight" suppressHydrationWarning>
          {dateStr}
        </p>
        <p className="leading-tight opacity-50" suppressHydrationWarning>
          {mounted ? timeStr : "--:--"}
        </p>
      </div>
    </div>
  );
}
