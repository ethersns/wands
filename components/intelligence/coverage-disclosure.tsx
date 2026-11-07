import { CircleCheck, CircleSlash, TriangleAlert } from "lucide-react";

import type {
  ResearchCoverageDisclosure,
  ResearchCoverageStatus,
} from "@/lib/api/research-contract";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const STATUS: Record<
  ResearchCoverageStatus,
  { label: string; icon: typeof CircleCheck; chip: string; detail: string }
> = {
  complete: {
    label: "Complete",
    icon: CircleCheck,
    chip: "border-profit/30 bg-profit/10 text-profit",
    detail: "The stored window covers the full period this view claims.",
  },
  partial: {
    label: "Partial",
    icon: TriangleAlert,
    chip: "border-warning/30 bg-warning/10 text-warning",
    detail: "Some of the period is covered. Absences below are gaps, not events.",
  },
  insufficient: {
    label: "Insufficient",
    icon: TriangleAlert,
    chip: "border-warning/30 bg-warning/10 text-warning",
    detail:
      "What is stored cannot support the claim being made. Treat the figures as indicative only.",
  },
  unavailable: {
    label: "Unavailable",
    icon: CircleSlash,
    chip: "border-border bg-muted text-muted-foreground",
    detail: "The engine did not report coverage for this view.",
  },
};

/**
 * What a research view covers, and what it does not.
 *
 * This is deliberately not collapsible. A member reading a signal needs to know
 * how much of the window is actually stored before the number means anything,
 * and a disclosure nobody opens is not a disclosure.
 */
export function CoverageDisclosure({
  coverage,
  className,
}: {
  coverage: ResearchCoverageDisclosure;
  className?: string;
}) {
  const status = STATUS[coverage.status] ?? STATUS.unavailable;
  const Icon = status.icon;

  return (
    <div
      className={cn(
        "flex flex-col gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-[0.06em] uppercase",
            status.chip,
          )}
        >
          <Icon className="size-2.5" aria-hidden />
          Coverage {status.label}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">
          {coverage.windowStart && coverage.windowEnd
            ? `${formatDate(coverage.windowStart)} → ${formatDate(coverage.windowEnd)}`
            : "no window reported"}
          <span aria-hidden> · </span>
          {coverage.symbolsCovered}/{coverage.symbolsRequested} symbols
        </span>
      </div>

      <p className="text-[11px] leading-relaxed text-pretty text-muted-foreground">
        {status.detail}
      </p>

      {coverage.gaps.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {coverage.gaps.map((gap) => (
            <li
              key={gap.key}
              className="flex flex-col gap-0.5 border-l border-warning/40 pl-2"
            >
              <span className="text-[11px] font-medium text-foreground">
                {gap.label}
              </span>
              <span className="text-[10px] leading-relaxed text-pretty text-muted-foreground">
                {gap.detail}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {coverage.caveats.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {coverage.caveats.map((caveat) => (
            <li
              key={caveat}
              className="text-[10px] leading-relaxed text-pretty text-muted-foreground"
            >
              {caveat}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
