import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Compact KPI tile.
 *
 * `tracked={false}` is the important prop. When a source has no history yet the
 * tile says "Not yet tracked" instead of rendering a zero, because a zero is a
 * measurement and "we have not measured this" is not.
 */
export function Kpi({
  label,
  value,
  delta,
  deltaLabel,
  footnote,
  tracked = true,
  hint,
  className,
}: {
  label: string;
  value: ReactNode;
  delta?: number | null;
  deltaLabel?: string;
  footnote?: ReactNode;
  tracked?: boolean;
  hint?: string;
  className?: string;
}) {
  const DeltaIcon =
    delta === null || delta === undefined || delta === 0
      ? Minus
      : delta > 0
        ? ArrowUpRight
        : ArrowDownRight;

  const deltaTone =
    delta === null || delta === undefined || delta === 0
      ? "text-muted-foreground"
      : delta > 0
        ? "text-profit"
        : "text-loss";

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 rounded-xl border border-border bg-card px-3.5 py-3",
        className,
      )}
    >
      <span className="text-[10px] font-medium tracking-[0.07em] text-muted-foreground uppercase">
        {label}
      </span>

      {tracked ? (
        <span className="font-mono text-[22px] leading-none tracking-[-0.02em] tabular text-foreground">
          {value}
        </span>
      ) : (
        <span className="text-[13px] leading-tight text-muted-foreground">
          Not yet tracked
        </span>
      )}

      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        {tracked && delta !== undefined ? (
          <span className={cn("inline-flex items-center gap-0.5 font-mono text-[11px] tabular", deltaTone)}>
            <DeltaIcon className="size-3" aria-hidden />
            {delta === null
              ? "no baseline"
              : `${delta > 0 ? "+" : delta < 0 ? "−" : ""}${Math.abs(delta).toFixed(1)}%`}
          </span>
        ) : null}
        {tracked && deltaLabel ? (
          <span className="text-[10px] text-muted-foreground">{deltaLabel}</span>
        ) : null}
        {footnote ? (
          <span className="text-[10px] text-muted-foreground">{footnote}</span>
        ) : null}
      </div>

      {hint ? (
        <span className="text-[10px] leading-relaxed text-muted-foreground/80">{hint}</span>
      ) : null}
    </div>
  );
}
