import { cn } from "@/lib/utils";
import { formatDateTime, formatRelative } from "@/lib/format";
import { provenanceLabel } from "@/lib/intelligence/presentation";
import type { DataProvenance } from "@/lib/api/contracts";

/**
 * Where a payload came from and when it was produced. Kept as a single line so
 * it can sit in a table footer or a card header without competing with data.
 */
export function ProvenanceLabel({
  provenance,
  source,
  generatedAt,
  className,
}: {
  provenance: DataProvenance;
  source: string;
  generatedAt: string;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "flex flex-wrap items-center gap-x-1.5 font-mono text-[10px] text-muted-foreground",
        className,
      )}
    >
      <span
        className={cn(
          "inline-block size-1.5 rounded-full",
          provenance === "live"
            ? "bg-profit"
            : provenance === "demo"
              ? "bg-primary"
              : "bg-muted-foreground/50",
        )}
        aria-hidden
      />
      <span>{provenanceLabel(provenance)}</span>
      <span aria-hidden>·</span>
      <span>{source}</span>
      <span aria-hidden>·</span>
      <time dateTime={generatedAt} title={formatDateTime(generatedAt)}>
        {formatRelative(generatedAt)}
      </time>
    </p>
  );
}

/**
 * The two timestamps that must never be conflated. `eventTime` is when the
 * activity happened; `publicAvailableAt` is when it became knowable, and only
 * the second may be used to date a backtest.
 */
export function TimestampPair({
  eventTime,
  publicAvailableAt,
  eventLabel = "Event",
  publishedLabel = "Public",
  className,
}: {
  eventTime: string | null;
  publicAvailableAt: string;
  eventLabel?: string;
  publishedLabel?: string;
  className?: string;
}) {
  return (
    <dl className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <dt className="text-[10px] tracking-[0.04em] text-muted-foreground uppercase">
          {eventLabel}
        </dt>
        <dd className="font-mono text-[11px] tabular text-foreground">
          {eventTime ? formatDateTime(eventTime) : "—"}
        </dd>
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <dt className="text-[10px] tracking-[0.04em] text-muted-foreground uppercase">
          {publishedLabel}
        </dt>
        <dd className="font-mono text-[11px] tabular text-foreground">
          {formatDateTime(publicAvailableAt)}
        </dd>
      </div>
    </dl>
  );
}
