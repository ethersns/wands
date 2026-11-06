import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { toneText, type StatusTone } from "@/lib/status";

/**
 * A single count with its provenance. The hint line is not decoration: it says
 * what the number counts, because "signals: 0" means something different from
 * "filings: 0".
 */
export function MetricTile({
  label,
  value,
  hint,
  icon: Icon,
  tone = "muted",
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: LucideIcon;
  tone?: StatusTone;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-lg border border-border bg-card px-3 py-2.5",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
          {label}
        </span>
        {Icon ? (
          <Icon className={cn("size-3 shrink-0", toneText[tone])} aria-hidden />
        ) : null}
      </div>
      <span className="font-mono text-[19px] leading-none tabular tracking-[-0.02em] text-foreground">
        {value}
      </span>
      {hint ? (
        <span className="text-[10px] leading-relaxed text-muted-foreground">{hint}</span>
      ) : null}
    </div>
  );
}
