"use client";

import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DistributionSlice, ProgressPoint } from "@/services/dashboard";

/**
 * Chart palette — validated with the dataviz six-checks script (light surface):
 * lines  #1B7A43 / #2563EB / #C0392B   donut + #7C3AED   → ALL CHECKS PASS.
 * Identity is never color-alone: legends + direct % labels everywhere.
 */
const C = {
  enrolled: "#1B7A43",
  completed: "#2563EB",
  dropouts: "#C0392B",
  screening: "#2563EB",
  violet: "#7C3AED",
  grid: "#E5E3DE",
  ink: "#1C1E1D",
};

const DONUT_COLORS: Record<string, string> = {
  Screening: C.screening,
  Enrolled: C.enrolled,
  Completed: C.violet,
  "Dropped Out": C.dropouts,
};

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color?: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="clay-btn px-3 py-2">
      {label ? <p className="font-bold">{label}</p> : null}
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-2 opacity-70">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: p.color }}
          />
          {p.name}: <span className="font-medium">{p.value}</span>
        </p>
      ))}
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      <span className="opacity-70">{label}</span>
    </span>
  );
}

export function TrialProgressChart({ data }: { data: ProgressPoint[] }) {
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap gap-4">
        <LegendDot color={C.enrolled} label="Enrolled" />
        <LegendDot color={C.completed} label="Completed" />
        <LegendDot color={C.dropouts} label="Dropouts" />
      </div>
      <div className="min-h-52 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid stroke={C.grid} strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="month"
              tickLine={false}
              axisLine={false}
              tick={{ fill: C.ink, opacity: 0.5 }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={{ fill: C.ink, opacity: 0.5 }}
              allowDecimals={false}
            />
            <Tooltip content={<ChartTooltip />} cursor={{ stroke: C.grid }} />
            <Line
              type="monotone"
              dataKey="enrolled"
              name="Enrolled"
              stroke={C.enrolled}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
            <Line
              type="monotone"
              dataKey="completed"
              name="Completed"
              stroke={C.completed}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
            <Line
              type="monotone"
              dataKey="dropouts"
              name="Dropouts"
              stroke={C.dropouts}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function ParticipantDonut({
  total,
  slices,
}: {
  total: number;
  slices: DistributionSlice[];
}) {
  const sum = slices.reduce((a, s) => a + s.value, 0) || 1;
  return (
    <div className="flex h-full flex-wrap items-center gap-4">
      <div className="relative h-52 w-52 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip content={<ChartTooltip />} />
            <Pie
              data={slices}
              dataKey="value"
              nameKey="name"
              innerRadius="68%"
              outerRadius="92%"
              paddingAngle={2}
              strokeWidth={0}
            >
              {slices.map((s) => (
                <Cell key={s.name} fill={DONUT_COLORS[s.name]} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <p className="text-heading font-bold">{total}</p>
          <p className="opacity-70">Participants</p>
        </div>
      </div>
      <div className="flex min-w-36 flex-1 flex-col gap-2">
        {slices.map((s) => (
          <div key={s.name} className="flex items-center justify-between gap-3">
            <LegendDot color={DONUT_COLORS[s.name]} label={s.name} />
            <span className="font-medium">
              {Math.round((s.value / sum) * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
