"use client";

import * as React from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface Row {
  t: string;
  label: string;
  strategy: number;
  benchmark: number | null;
}

/**
 * Keeps the series readable without changing its shape.
 *
 * A 966-session curve drawn into a 300px box has more points than pixels, so
 * every point past the target is dropped rather than averaged. Averaging would
 * smooth away the drawdowns the chart exists to show.
 */
function thin<T>(items: T[], target: number): T[] {
  if (items.length <= target) return items;
  const step = items.length / target;
  return Array.from({ length: target }, (_, index) => items[Math.floor(index * step)]);
}

function percent(value: number): string {
  const change = (value - 1) * 100;
  return `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`;
}

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: Row }[];
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;

  return (
    <div className="rounded-lg border border-mk-line-strong bg-mk-raised px-2.5 py-2 shadow-xl shadow-black/50">
      <p className="mb-1 font-marketing-mono text-[10px] uppercase tracking-[0.12em] text-mk-dim">
        {row.t}
      </p>
      <p className="font-marketing-mono text-[12px] tabular-nums text-mk-accent">
        Rule {percent(row.strategy)}
      </p>
      {row.benchmark !== null ? (
        <p className="mt-0.5 font-marketing-mono text-[11px] tabular-nums text-mk-silver">
          Hold {percent(row.benchmark)}
        </p>
      ) : null}
    </div>
  );
}

export function QuantEquityChart({
  dates,
  curve,
  benchmark,
  height = 260,
}: {
  dates: string[];
  curve: number[];
  benchmark?: number[];
  height?: number;
}) {
  const rows = React.useMemo<Row[]>(() => {
    const points = dates.map((t, index) => ({
      t: t.slice(0, 10),
      label: t.slice(0, 10),
      strategy: curve[index] ?? 1,
      benchmark: benchmark?.[index] ?? null,
    }));
    return thin(points, 240);
  }, [dates, curve, benchmark]);

  if (rows.length < 2) {
    return (
      <div
        style={{ height }}
        className="flex items-center justify-center rounded-lg border border-dashed border-mk-line"
      >
        <p className="text-xs text-mk-muted">Not enough sessions to draw a curve.</p>
      </div>
    );
  }

  const values = rows.flatMap((row) =>
    row.benchmark === null ? [row.strategy] : [row.strategy, row.benchmark],
  );
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min) * 0.1 || 0.02;

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 6, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="quantFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--mk-accent)" stopOpacity={0.22} />
              <stop offset="100%" stopColor="var(--mk-accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--mk-line)" vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            minTickGap={56}
            tick={{
              fill: "var(--mk-dim)",
              fontSize: 10,
              fontFamily: "var(--font-marketing-mono)",
            }}
          />
          <YAxis
            domain={[min - pad, max + pad]}
            tickLine={false}
            axisLine={false}
            width={52}
            tick={{
              fill: "var(--mk-dim)",
              fontSize: 10,
              fontFamily: "var(--font-marketing-mono)",
            }}
            tickFormatter={(value: number) => percent(value)}
          />
          <Tooltip
            content={<ChartTooltip />}
            cursor={{ stroke: "var(--mk-line-strong)", strokeWidth: 1 }}
          />
          <Line
            type="monotone"
            dataKey="benchmark"
            stroke="var(--mk-silver)"
            strokeWidth={1}
            strokeDasharray="3 3"
            dot={false}
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="strategy"
            stroke="var(--mk-accent)"
            strokeWidth={1.75}
            fill="url(#quantFill)"
            dot={false}
            activeDot={{ r: 3, fill: "var(--mk-accent)", stroke: "var(--mk-bg)" }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
