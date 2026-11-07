import {
  Building2,
  ExternalLink,
  FileText,
  LineChart,
  ListTree,
} from "lucide-react";

import type {
  ResearchSourceKind,
  ResearchSourceLink,
} from "@/lib/api/research-contract";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const KIND: Record<
  ResearchSourceKind,
  { icon: typeof FileText; label: string }
> = {
  sec_filing: { icon: FileText, label: "SEC filing" },
  sec_filing_index: { icon: ListTree, label: "SEC index" },
  issuer_release: { icon: Building2, label: "Issuer release" },
  price_series: { icon: LineChart, label: "Price series" },
};

/**
 * The evidence chain for a research claim.
 *
 * A claim with no link is not shown, so the empty state says the engine returned
 * no source rather than implying the claim was checked and held up.
 */
export function ResearchSourceLinks({
  sources,
  className,
  emptyLabel = "The engine returned no source link for this claim, so it is not shown as verified.",
}: {
  sources: ResearchSourceLink[];
  className?: string;
  emptyLabel?: string;
}) {
  if (sources.length === 0) {
    return (
      <p
        className={cn(
          "rounded-lg border border-dashed border-border px-3 py-2.5 text-[11px] leading-relaxed text-pretty text-muted-foreground",
          className,
        )}
      >
        {emptyLabel}
      </p>
    );
  }

  return (
    <ul className={cn("flex flex-col divide-y divide-border", className)}>
      {sources.map((source) => {
        const kind = KIND[source.kind] ?? KIND.sec_filing;
        const Icon = kind.icon;

        return (
          <li key={source.id} className="flex items-start gap-2.5 py-2.5 first:pt-0 last:pb-0">
            <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded border border-border bg-muted text-muted-foreground">
              <Icon className="size-3" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-start gap-1 text-[11px] font-medium text-primary underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <span className="text-pretty">{source.label}</span>
                <ExternalLink className="mt-0.5 size-2.5 shrink-0" aria-hidden />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
              <p className="mt-0.5 text-[10px] leading-relaxed text-pretty text-muted-foreground">
                {source.supports}
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-x-1.5 font-mono text-[10px] text-muted-foreground/80">
                <span>{kind.label}</span>
                {source.formType ? (
                  <>
                    <span aria-hidden>·</span>
                    <span>{source.formType}</span>
                  </>
                ) : null}
                {source.accessionNumber ? (
                  <>
                    <span aria-hidden>·</span>
                    <span>{source.accessionNumber}</span>
                  </>
                ) : null}
                {source.publicAvailableAt ? (
                  <>
                    <span aria-hidden>·</span>
                    <span>public {formatDate(source.publicAvailableAt)}</span>
                  </>
                ) : null}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
