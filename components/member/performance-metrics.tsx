import { Badge } from "@/components/member/ui";
import type { PerfMetric } from "@/lib/api/performance";
import { cn } from "@/lib/utils";

export function formatPercent(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const percent = value * 100;
  return `${percent >= 0 ? "+" : ""}${percent.toFixed(digits)}%`;
}

export function formatRatio(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString("en-US");
}

function statusText(status: PerfMetric["status"]): string {
  if (status === "not_implemented") return "Not implemented";
  if (status === "insufficient_data") return "Not yet calculated";
  return "—";
}

function toneOf(status: PerfMetric["status"]): "neutral" | "accent" | "warn" | "emerald" {
  if (status === "ok") return "emerald";
  if (status === "low_sample") return "warn";
  if (status === "not_implemented") return "neutral";
  return "neutral";
}

function statusLabel(status: PerfMetric["status"]): string {
  if (status === "ok") return "Measured";
  if (status === "low_sample") return "Low sample";
  if (status === "not_implemented") return "Not implemented";
  return "Insufficient data";
}

export function MetricTile({
  label,
  metric,
  kind = "percent",
  hint,
}: {
  label: string;
  metric: PerfMetric | undefined;
  kind?: "percent" | "ratio" | "count" | "days";
  hint?: string;
}) {
  if (!metric) {
    return (
      <div className="rounded-xl border border-mk-line bg-mk-surface/60 px-4 py-3.5">
        <p className="font-marketing-mono text-[10px] uppercase tracking-[0.16em] text-mk-dim">
          {label}
        </p>
        <p className="mt-1.5 font-display text-lg font-medium text-mk-dim">Not yet calculated</p>
      </div>
    );
  }

  const measured = metric.value !== null;
  const display = measured
    ? kind === "count" || kind === "days"
      ? formatCount(metric.value)
      : kind === "ratio"
        ? formatRatio(metric.value)
        : formatPercent(metric.value)
    : statusText(metric.status);

  return (
    <div className="rounded-xl border border-mk-line bg-mk-surface/60 px-4 py-3.5">
      <div className="flex items-start justify-between gap-2">
        <p className="font-marketing-mono text-[10px] uppercase tracking-[0.16em] text-mk-dim">
          {label}
        </p>
        <Badge tone={toneOf(metric.status)}>{statusLabel(metric.status)}</Badge>
      </div>
      <p
        className={cn(
          "mt-1.5 font-display text-2xl font-semibold tabular-nums tracking-[-0.02em]",
          measured ? "text-mk-fg" : "text-base font-medium text-mk-dim",
        )}
      >
        {display}
      </p>
      {hint ? <p className="mt-0.5 text-xs text-mk-muted">{hint}</p> : null}
      {metric.note ? (
        <p className="mt-1.5 text-[11px] leading-relaxed text-mk-dim text-pretty">{metric.note}</p>
      ) : null}
    </div>
  );
}

export function GroupTable({
  title,
  rows,
  labelHeading,
}: {
  title: string;
  rows: {
    label: string;
    sample: number;
    winRate: number | null;
    meanNetReturn: number | null;
    compoundedReturn: number | null;
    meanBenchmarkReturn: number | null;
    profitFactor: number | null;
  }[];
  labelHeading: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-mk-line px-4 py-6">
        <p className="text-sm text-mk-muted">
          No evaluated signal has been grouped here yet. Nothing is estimated to fill the table.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] border-collapse text-left">
        <caption className="sr-only">{title}</caption>
        <thead>
          <tr className="border-b border-mk-line">
            {[labelHeading, "Obs", "Win rate", "Mean net", "Compounded", "Benchmark", "PF"].map(
              (heading) => (
                <th
                  key={heading}
                  scope="col"
                  className="py-2 pr-3 font-marketing-mono text-[10px] font-normal uppercase tracking-[0.14em] text-mk-dim last:pr-0"
                >
                  {heading}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-b border-mk-line/60 last:border-0">
              <th scope="row" className="py-2.5 pr-3 text-sm font-medium text-mk-fg">
                {row.label}
              </th>
              <td className="py-2.5 pr-3 font-marketing-mono text-[12px] tabular-nums text-mk-muted">
                {formatCount(row.sample)}
              </td>
              <td className="py-2.5 pr-3 font-marketing-mono text-[12px] tabular-nums text-mk-fg">
                {row.winRate === null ? "—" : `${(row.winRate * 100).toFixed(0)}%`}
              </td>
              <td
                className={cn(
                  "py-2.5 pr-3 font-marketing-mono text-[12px] tabular-nums",
                  row.meanNetReturn === null
                    ? "text-mk-dim"
                    : row.meanNetReturn >= 0
                      ? "text-mk-emerald"
                      : "text-mk-warn",
                )}
              >
                {formatPercent(row.meanNetReturn)}
              </td>
              <td className="py-2.5 pr-3 font-marketing-mono text-[12px] tabular-nums text-mk-fg">
                {formatPercent(row.compoundedReturn)}
              </td>
              <td className="py-2.5 pr-3 font-marketing-mono text-[12px] tabular-nums text-mk-silver">
                {formatPercent(row.meanBenchmarkReturn)}
              </td>
              <td className="py-2.5 font-marketing-mono text-[12px] tabular-nums text-mk-muted">
                {formatRatio(row.profitFactor)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
