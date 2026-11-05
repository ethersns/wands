"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import type { AllocationSlice } from "@/lib/api/contracts";
import { formatCurrency, formatPercent } from "@/lib/format";

const SLICE_COLORS = ["var(--primary)", "var(--profit)", "var(--muted-foreground)"];

export function AllocationChart({
  data,
  currency = "USD",
  height = 168,
  centerLabel,
  centerValue,
}: {
  data: AllocationSlice[];
  currency?: "USD" | "EUR" | "GBP" | "JPY" | "AUD" | "CHF";
  height?: number;
  centerLabel?: string;
  centerValue?: string;
}) {
  return (
    <div style={{ height }} className="relative w-full">
      {centerValue ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-[15px] tabular text-foreground">
            {centerValue}
          </span>
          {centerLabel ? (
            <span className="mt-0.5 text-[10px] tracking-[0.06em] text-muted-foreground uppercase">
              {centerLabel}
            </span>
          ) : null}
        </div>
      ) : null}
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="label"
            innerRadius="62%"
            outerRadius="94%"
            paddingAngle={2}
            stroke="var(--card)"
            strokeWidth={2}
            isAnimationActive={false}
          >
            {data.map((slice, index) => (
              <Cell
                key={slice.key}
                fill={SLICE_COLORS[index % SLICE_COLORS.length]}
              />
            ))}
          </Pie>
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const slice = payload[0].payload as AllocationSlice;
              return (
                <div className="rounded-lg border border-border bg-popover px-2.5 py-1.5 shadow-xl shadow-black/40">
                  <p className="text-[11px] text-muted-foreground">{slice.label}</p>
                  <p className="font-mono text-[12px] tabular text-foreground">
                    {formatCurrency(slice.value, currency)}
                  </p>
                  <p className="font-mono text-[10px] tabular text-muted-foreground">
                    {formatPercent(slice.pct, { digits: 1 })}
                  </p>
                </div>
              );
            }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

export function AllocationLegend({
  data,
  currency = "USD",
}: {
  data: AllocationSlice[];
  currency?: "USD" | "EUR" | "GBP" | "JPY" | "AUD" | "CHF";
}) {
  return (
    <ul className="flex flex-col gap-2">
      {data.map((slice, index) => (
        <li key={slice.key} className="flex items-center gap-2">
          <span
            className="size-2 shrink-0 rounded-[2px]"
            style={{ backgroundColor: SLICE_COLORS[index % SLICE_COLORS.length] }}
            aria-hidden
          />
          <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
            {slice.label}
          </span>
          <span className="font-mono text-[11px] tabular text-foreground">
            {formatCurrency(slice.value, currency, { compact: true })}
          </span>
          <span className="w-10 text-right font-mono text-[11px] tabular text-muted-foreground">
            {formatPercent(slice.pct, { digits: 1 })}
          </span>
        </li>
      ))}
    </ul>
  );
}
