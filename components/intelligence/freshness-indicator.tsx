import { cn } from "@/lib/utils";
import { formatDuration, formatRelative } from "@/lib/format";
import { freshnessStatus } from "@/lib/intelligence/presentation";
import { toneDot, toneText } from "@/lib/status";

/**
 * How current a collector is. A feed that has stopped must not look populated,
 * so the age is always shown next to the state.
 */
export function FreshnessIndicator({
  freshness,
  ageSeconds,
  lastSuccessAt,
  className,
  showAge = true,
}: {
  freshness: string;
  ageSeconds?: number | null;
  lastSuccessAt?: string | null;
  className?: string;
  showAge?: boolean;
}) {
  const status = freshnessStatus(freshness);

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span
        className={cn("size-1.5 shrink-0 rounded-full", toneDot[status.tone])}
        aria-hidden
      />
      <span className={cn("text-[11px] font-medium", toneText[status.tone])}>
        {status.label}
      </span>
      {showAge ? (
        <span className="font-mono text-[10px] text-muted-foreground">
          {ageSeconds !== null && ageSeconds !== undefined
            ? formatDuration(ageSeconds)
            : lastSuccessAt
              ? formatRelative(lastSuccessAt)
              : "no run"}
        </span>
      ) : null}
    </span>
  );
}
