import type { ReactNode } from "react";

import { DataQualityBadge } from "./data-quality-badge";
import { ResearchScore } from "./score-indicator";
import { TimestampPair } from "./provenance-label";
import type { ResearchSignal } from "@/lib/api/contracts";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

export function KeyValueList({
  items,
  className,
  columns = 1,
}: {
  items: { label: string; value: ReactNode }[];
  className?: string;
  columns?: 1 | 2;
}) {
  return (
    <dl
      className={cn(
        "grid gap-x-4 gap-y-1.5",
        columns === 2 ? "sm:grid-cols-2" : "grid-cols-1",
        className,
      )}
    >
      {items.map((item) => (
        <div
          key={item.label}
          className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-1.5 last:border-0"
        >
          <dt className="text-[10px] tracking-[0.04em] whitespace-nowrap text-muted-foreground uppercase">
            {item.label}
          </dt>
          <dd className="min-w-0 text-right font-mono text-[11px] tabular break-words text-foreground">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function parameterEntries(parameters: Record<string, unknown>) {
  return Object.entries(parameters).map(([key, value]) => ({
    label: key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()),
    value:
      value === null || value === undefined
        ? "—"
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value),
  }));
}

/**
 * The evidence behind one signal: what was measured, how it was scored, and
 * what the engine says limits it. A score without these is a claim the engine
 * does not make.
 */
export function SignalEvidencePanel({
  signal,
  className,
  footer,
}: {
  signal: ResearchSignal;
  className?: string;
  footer?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-border bg-surface/60 p-3",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-foreground">
            {signal.symbol} · {signal.category.replaceAll("_", " ").toLowerCase()}
          </p>
          <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
            engine {signal.engineVersion || "—"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DataQualityBadge quality={signal.dataQuality} />
          <ResearchScore score={signal.score} showLabel />
        </div>
      </div>

      <p className="text-[11px] leading-relaxed text-pretty text-foreground/85">
        {signal.explanation || "The engine supplied no explanation for this signal."}
      </p>

      {signal.confidenceNotes ? (
        <div className="rounded-md border border-warning/25 bg-warning/[0.06] px-2.5 py-2">
          <p className="text-[10px] font-medium tracking-[0.04em] text-warning uppercase">
            Confidence notes
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-pretty text-foreground/85">
            {signal.confidenceNotes}
          </p>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <KeyValueList
          items={[
            {
              label: "Measurement",
              value: `${formatNumber(signal.rawMeasurement, { digits: 4 })} ${signal.rawUnit}`,
            },
            { label: "Source events", value: signal.sourceEventIds.length },
            { label: "Calculated", value: signal.calculatedAt.slice(0, 19).replace("T", " ") },
          ]}
        />
        <TimestampPair
          eventTime={signal.eventTime}
          publicAvailableAt={signal.publicAvailableAt}
          eventLabel="Activity"
          publishedLabel="Public"
        />
      </div>

      {Object.keys(signal.parameters).length > 0 ? (
        <details className="group">
          <summary className="cursor-pointer list-none text-[10px] font-medium tracking-[0.04em] text-muted-foreground uppercase transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            Parameters ({Object.keys(signal.parameters).length})
          </summary>
          <KeyValueList
            className="mt-2"
            columns={2}
            items={parameterEntries(signal.parameters)}
          />
        </details>
      ) : null}

      {footer}
    </div>
  );
}
