"use client";

import * as React from "react";

import { QuantEquityChart } from "@/components/member/quant-equity-chart";
import { Badge } from "@/components/member/ui";
import type { QuantStudySeries } from "@/lib/api/research-contract";
import { formatPercent, formatRatio, statusLabel, statusTone } from "@/lib/member/quant";
import { cn } from "@/lib/utils";

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="font-marketing-mono text-[10px] uppercase tracking-[0.14em] text-mk-dim">
        {label}
      </p>
      <p className="mt-0.5 font-marketing-mono text-sm tabular-nums text-mk-fg">{value}</p>
    </div>
  );
}

/**
 * One instrument at a time, with the buy-and-hold curve drawn beside the rule.
 *
 * The comparison is the point: a rule that returned 50% while the instrument
 * returned 160% lost, and a chart that showed only the rule would hide that.
 */
export function QuantSeriesExplorer({ series }: { series: QuantStudySeries[] }) {
  const drawable = series.filter((item) => (item.equityCurve?.length ?? 0) > 1);
  const [selected, setSelected] = React.useState(drawable[0]?.symbol ?? series[0]?.symbol ?? "");

  const active = series.find((item) => item.symbol === selected) ?? series[0];

  if (!active) {
    return (
      <p className="text-sm text-mk-muted">No instrument was simulated for this study.</p>
    );
  }

  const metrics = active.metrics ?? {};

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {series.map((item) => (
          <button
            key={item.symbol}
            type="button"
            onClick={() => setSelected(item.symbol)}
            aria-pressed={item.symbol === active.symbol}
            className={cn(
              "rounded-md border px-2.5 py-1 font-marketing-mono text-[11px] uppercase tracking-[0.1em] transition-colors",
              item.symbol === active.symbol
                ? "border-mk-accent/40 bg-mk-accent-soft text-mk-accent"
                : "border-mk-line text-mk-muted hover:border-mk-line-strong hover:text-mk-fg",
            )}
          >
            {item.symbol}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={statusTone(active.status)}>{statusLabel(active.status)}</Badge>
        <span className="font-marketing-mono text-[10px] uppercase tracking-[0.12em] text-mk-dim">
          Solid: rule · Dashed: buy and hold
        </span>
      </div>

      {active.equityCurve && active.curveDates ? (
        <QuantEquityChart
          dates={active.curveDates}
          curve={active.equityCurve}
          benchmark={active.benchmarkCurve}
        />
      ) : (
        <p className="rounded-lg border border-dashed border-mk-line px-4 py-8 text-sm text-mk-muted">
          {active.note ?? "No equity curve was produced for this instrument."}
        </p>
      )}

      <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-mk-line pt-4 sm:grid-cols-4">
        <Metric label="Rule return" value={formatPercent(metrics.totalReturn)} />
        <Metric label="Hold return" value={formatPercent(metrics.benchmarkReturn)} />
        <Metric label="Excess" value={formatPercent(metrics.excessReturn)} />
        <Metric label="Trades" value={String(metrics.tradeCount ?? 0)} />
        <Metric label="Win rate" value={formatPercent(metrics.winRate)} />
        <Metric label="Max drawdown" value={formatPercent(metrics.maxDrawdown)} />
        <Metric label="Exposure" value={formatPercent(metrics.exposure)} />
        <Metric
          label="Sharpe"
          value={
            metrics.sharpe?.appropriate
              ? formatRatio(metrics.sharpe.value)
              : "n/a"
          }
        />
      </div>

      {active.flags && active.flags.length > 0 ? (
        <ul className="flex flex-col gap-1.5 border-t border-mk-line pt-3">
          {active.flags.map((flag) => (
            <li key={flag} className="text-xs leading-relaxed text-mk-muted">
              {flag}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
