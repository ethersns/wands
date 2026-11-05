import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import { cn } from "@/lib/utils";
import { toneOf, type Tone } from "@/lib/format";

const toneText: Record<Tone, string> = {
  profit: "text-profit",
  loss: "text-loss",
  neutral: "text-muted-foreground",
};

export function Stat({
  label,
  value,
  delta,
  deltaLabel,
  footnote,
  tone,
  className,
  emphasis = false,
}: {
  label: string;
  value: ReactNode;
  delta?: number | null;
  deltaLabel?: string;
  footnote?: ReactNode;
  tone?: Tone;
  className?: string;
  emphasis?: boolean;
}) {
  const resolvedTone = tone ?? toneOf(delta);
  const DeltaIcon =
    delta === null || delta === undefined || delta === 0
      ? Minus
      : delta > 0
        ? ArrowUpRight
        : ArrowDownRight;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
        {label}
      </span>
      <span
        className={cn(
          "font-mono tabular leading-none tracking-[-0.02em] text-foreground",
          emphasis ? "text-[26px] sm:text-[30px]" : "text-[19px] sm:text-[21px]",
        )}
      >
        {value}
      </span>
      {delta !== undefined || footnote ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {delta !== undefined ? (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 font-mono text-[11px] tabular",
                toneText[resolvedTone],
              )}
            >
              <DeltaIcon className="size-3" aria-hidden />
              {delta === null || delta === undefined
                ? "—"
                : `${delta > 0 ? "+" : delta < 0 ? "−" : ""}${Math.abs(delta).toFixed(2)}%`}
            </span>
          ) : null}
          {deltaLabel ? (
            <span className="text-[11px] text-muted-foreground">{deltaLabel}</span>
          ) : null}
          {footnote ? (
            <span className="text-[11px] text-muted-foreground">{footnote}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
