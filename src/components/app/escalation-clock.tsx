"use client";

import { useEffect, useState } from "react";
import { clockBand } from "@/lib/rules/deadlines";
import { fmtDateTime } from "@/lib/dates";
import { cn } from "@/lib/utils";

const BAND_CLASS = {
  safe: "text-success",
  amber: "text-warning",
  red: "text-danger",
  breached: "text-danger",
} as const;

function fmt(hoursLeft: number): string {
  if (hoursLeft < 0) {
    const h = Math.abs(hoursLeft);
    return h >= 24
      ? `${Math.floor(h / 24)}d over`
      : `${Math.floor(h)}h over`;
  }
  if (hoursLeft >= 48) return `${Math.floor(hoursLeft / 24)}d left`;
  if (hoursLeft >= 1) return `${Math.floor(hoursLeft)}h left`;
  return `${Math.max(0, Math.floor(hoursLeft * 60))}m left`;
}

/**
 * AE/SAE escalation clock (architecture.md §7): countdown ring that shifts
 * amber → red and pulses when breached. Band thresholds are tested in
 * tests/deadlines.test.ts.
 */
export function EscalationClock({
  deadline,
  totalHours = 24,
}: {
  deadline: Date | string;
  /** full-ring duration, for the progress arc */
  totalHours?: number;
}) {
  const target = typeof deadline === "string" ? new Date(deadline) : deadline;
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const { band, hoursLeft } = clockBand(target, now);
  const frac = Math.max(0, Math.min(1, hoursLeft / totalHours));
  const r = 16;
  const c = 2 * Math.PI * r;

  return (
    <div
      className={cn(
        "flex items-center gap-2",
        BAND_CLASS[band],
        band === "breached" && "animate-pulse",
      )}
      title={`Reporting deadline ${fmtDateTime(target)}`}
    >
      <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden>
        <circle
          cx="20"
          cy="20"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.15"
          strokeWidth="4"
        />
        <circle
          cx="20"
          cy="20"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
          transform="rotate(-90 20 20)"
          style={{ transition: "stroke-dashoffset 0.45s cubic-bezier(0.32,0.72,0,1)" }}
        />
      </svg>
      <span className="font-bold">{fmt(hoursLeft)}</span>
    </div>
  );
}
