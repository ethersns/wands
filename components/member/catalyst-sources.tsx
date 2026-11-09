import { Badge } from "@/components/member/ui";
import type { CatalystSource, CatalystSourceStatus } from "@/lib/api/research-contract";

const TONE: Record<CatalystSourceStatus, "neutral" | "accent" | "warn" | "emerald"> = {
  ok: "emerald",
  unavailable: "warn",
  failed: "warn",
};

const LABEL: Record<CatalystSourceStatus, string> = {
  ok: "read",
  unavailable: "not configured",
  failed: "failed",
};

/**
 * What each scheduled-event source could say.
 *
 * A source that could not be read is listed with its reason rather than omitted,
 * so an empty calendar is never mistaken for a quiet one.
 */
export function CatalystSources({ sources }: { sources: CatalystSource[] }) {
  if (sources.length === 0) {
    return (
      <p className="text-sm leading-relaxed text-mk-muted text-pretty">
        No scheduled-event source was queried. The engine did not report a source
        status, which usually means it could not be reached.
      </p>
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-mk-line">
      {sources.map((source) => (
        <li key={source.source} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-mk-fg">{source.label}</span>
            <Badge tone={TONE[source.status]}>{LABEL[source.status]}</Badge>
            <span className="font-marketing-mono text-[10px] uppercase tracking-[0.1em] text-mk-dim">
              {source.eventCount} event{source.eventCount === 1 ? "" : "s"}
            </span>
          </div>

          <p className="text-xs leading-relaxed text-mk-muted text-pretty">{source.detail}</p>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {source.sourceUrl ? (
              <a
                href={source.sourceUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="text-[11px] text-mk-muted underline-offset-4 hover:text-mk-fg hover:underline"
              >
                Source page
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : null}
            {source.fetchedAt ? (
              <span className="text-[11px] text-mk-dim">
                read {source.fetchedAt.slice(0, 16).replace("T", " ")} UTC
              </span>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
