"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { shortDay, type DayPoint } from "@/lib/admin/series";

/**
 * Daily trend for a single metric.
 *
 * The series is already gap-filled by `fillSeries`, so a day with no activity
 * draws at zero rather than being interpolated away. The y-axis starts at zero
 * for the same reason: a truncated axis makes a two-signup week look like a
 * surge.
 */
export function TrendChart({
  data,
  label,
  color = "var(--primary)",
  height = 168,
  emptyLabel = "No activity recorded in this window.",
}: {
  data: DayPoint[];
  label: string;
  color?: string;
  height?: number;
  emptyLabel?: string;
}) {
  const total = data.reduce((sum, point) => sum + point.value, 0);

  if (data.length === 0 || total === 0) {
    return (
      <div
        style={{ height }}
        className="flex items-center justify-center rounded-lg border border-dashed border-border px-4 text-center"
      >
        <p className="text-[11px] leading-relaxed text-muted-foreground">{emptyLabel}</p>
      </div>
    );
  }

  const rows = data.map((point) => ({
    day: point.day,
    label: shortDay(point.day),
    value: point.value,
  }));

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 6, right: 4, bottom: 0, left: -22 }}>
          <defs>
            <linearGradient id={`fill-${label.replace(/\W+/g, "-")}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--grid)" strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            tickLine={false}
            axisLine={false}
            minTickGap={24}
          />
          <YAxis
            allowDecimals={false}
            domain={[0, "auto"]}
            tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            tickLine={false}
            axisLine={false}
            width={40}
          />
          <Tooltip
            cursor={{ stroke: "var(--border)" }}
            contentStyle={{
              background: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 11,
              color: "var(--popover-foreground)",
            }}
            labelStyle={{ color: "var(--muted-foreground)", fontSize: 10 }}
          />
          <Area
            type="monotone"
            dataKey="value"
            name={label}
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#fill-${label.replace(/\W+/g, "-")})`}
            dot={false}
            activeDot={{ r: 2.5 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
