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

import type { EquityPoint } from "@/lib/api/contracts";
import { formatCurrency, formatDate } from "@/lib/format";

interface Row {
  t: string;
  label: string;
  equity: number;
  benchmark: number | null;
}

function ChartTooltip({
  active,
  payload,
  currency,
}: {
  active?: boolean;
  payload?: { payload: Row }[];
  currency: "USD" | "EUR" | "GBP" | "JPY" | "AUD" | "CHF";
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;

  return (
    <div className="rounded-lg border border-border bg-popover px-2.5 py-2 shadow-xl shadow-black/40">
      <p className="mb-1 font-mono text-[10px] tracking-[0.06em] text-muted-foreground uppercase">
        {formatDate(row.t)}
      </p>
      <p className="font-mono text-[12px] tabular text-foreground">
        {formatCurrency(row.equity, currency)}
      </p>
      {row.benchmark !== null ? (
        <p className="mt-0.5 font-mono text-[11px] tabular text-muted-foreground">
          Benchmark {formatCurrency(row.benchmark, currency)}
        </p>
      ) : null}
    </div>
  );
}

export function EquityChart({
  data,
  currency = "USD",
  height = 240,
  showBenchmark = true,
}: {
  data: EquityPoint[];
  currency?: "USD" | "EUR" | "GBP" | "JPY" | "AUD" | "CHF";
  height?: number;
  showBenchmark?: boolean;
}) {
  const rows = React.useMemo<Row[]>(
    () =>
      data.map((point) => ({
        t: point.t,
        label: formatDate(point.t),
        equity: point.equity,
        benchmark: point.benchmark,
      })),
    [data],
  );

  const values = rows.flatMap((row) =>
    row.benchmark === null ? [row.equity] : [row.equity, row.benchmark],
  );
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min) * 0.12 || max * 0.02;

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            stroke="var(--grid)"
            strokeDasharray="0"
            vertical={false}
          />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            minTickGap={48}
            tick={{ fill: "var(--muted-foreground)", fontSize: 10, fontFamily: "var(--font-mono)" }}
          />
          <YAxis
            domain={[min - pad, max + pad]}
            tickLine={false}
            axisLine={false}
            width={54}
            tick={{ fill: "var(--muted-foreground)", fontSize: 10, fontFamily: "var(--font-mono)" }}
            tickFormatter={(value: number) =>
              new Intl.NumberFormat("en-US", {
                notation: "compact",
                maximumFractionDigits: 1,
              }).format(value)
            }
          />
          <Tooltip
            content={<ChartTooltip currency={currency} />}
            cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
          />
          {showBenchmark ? (
            <Line
              type="monotone"
              dataKey="benchmark"
              stroke="var(--muted-foreground)"
              strokeWidth={1}
              strokeDasharray="3 3"
              dot={false}
              isAnimationActive={false}
            />
          ) : null}
          <Area
            type="monotone"
            dataKey="equity"
            stroke="var(--primary)"
            strokeWidth={1.75}
            fill="url(#equityFill)"
            dot={false}
            activeDot={{ r: 3, fill: "var(--primary)", stroke: "var(--background)" }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
