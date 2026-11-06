"use client";

import * as React from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  ErrorBar,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { HorizonRow } from "@/lib/intelligence/presentation";
import { formatPercent } from "@/lib/format";

interface Row {
  label: string;
  horizonDays: number;
  mean: number;
  error: [number, number] | null;
  sampleSize: number;
  hitRate: number | null;
  pValue: number | null;
  significant: boolean | null;
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
    <div className="rounded-lg border border-border bg-popover px-2.5 py-2 shadow-xl shadow-black/40">
      <p className="mb-1 font-mono text-[10px] tracking-[0.06em] text-muted-foreground uppercase">
        {row.horizonDays}d horizon
      </p>
      <p className="font-mono text-[12px] tabular text-foreground">
        Mean {formatPercent(row.mean * 100, { digits: 2, signed: true })}
      </p>
      {row.error ? (
        <p className="mt-0.5 font-mono text-[10px] tabular text-muted-foreground">
          CI {formatPercent(row.error[0] * 100, { digits: 2 })} to{" "}
          {formatPercent(row.error[1] * 100, { digits: 2 })}
        </p>
      ) : null}
      <p className="mt-0.5 font-mono text-[10px] tabular text-muted-foreground">
        n={row.sampleSize}
        {row.hitRate !== null
          ? ` · hit ${formatPercent(row.hitRate * 100, { digits: 0 })}`
          : ""}
      </p>
      {row.pValue !== null ? (
        <p className="mt-0.5 font-mono text-[10px] tabular text-muted-foreground">
          p={row.pValue.toFixed(3)}
          {row.significant === false ? " · not significant" : ""}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Mean forward return by holding period, with the confidence interval where the
 * engine supplied one.
 *
 * Renders nothing when no horizon has a measurable mean: an empty axis would
 * read as "zero return", which is a claim the engine has not made.
 */
export function HorizonChart({
  rows,
  height = 220,
}: {
  rows: HorizonRow[];
  height?: number;
}) {
  const data = React.useMemo<Row[]>(
    () =>
      rows
        .filter((row) => row.mean !== null && row.sampleSize > 0)
        .map((row) => ({
          label: `${row.horizonDays}d`,
          horizonDays: row.horizonDays,
          mean: row.mean as number,
          error:
            row.intervalLower !== null && row.intervalUpper !== null
              ? [row.intervalLower, row.intervalUpper]
              : null,
          sampleSize: row.sampleSize,
          hitRate: row.hitRate,
          pValue: row.pValue,
          significant: row.significant,
        })),
    [rows],
  );

  if (data.length === 0) return null;

  const values = data.flatMap((row) =>
    row.error ? [row.mean, row.error[0], row.error[1]] : [row.mean],
  );
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const pad = (max - min) * 0.15 || 0.01;

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 6, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{
              fill: "var(--muted-foreground)",
              fontSize: 10,
              fontFamily: "var(--font-mono)",
            }}
          />
          <YAxis
            domain={[min - pad, max + pad]}
            tickLine={false}
            axisLine={false}
            width={52}
            tick={{
              fill: "var(--muted-foreground)",
              fontSize: 10,
              fontFamily: "var(--font-mono)",
            }}
            tickFormatter={(value: number) => `${(value * 100).toFixed(1)}%`}
          />
          <ReferenceLine y={0} stroke="var(--border)" strokeWidth={1} />
          <Tooltip
            content={<ChartTooltip />}
            cursor={{ fill: "var(--accent)", opacity: 0.4 }}
          />
          <Bar dataKey="mean" isAnimationActive={false} radius={[2, 2, 0, 0]}>
            {data.map((row) => (
              <Cell
                key={row.label}
                fill={row.mean >= 0 ? "var(--profit)" : "var(--loss)"}
                fillOpacity={0.75}
              />
            ))}
            <ErrorBar
              dataKey="error"
              direction="y"
              width={4}
              strokeWidth={1}
              stroke="var(--muted-foreground)"
            />
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
