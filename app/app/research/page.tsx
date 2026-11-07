import type { Metadata } from "next";
import Link from "next/link";

import { SymbolSearch } from "@/components/member/symbol-search";
import { Badge, EmptyState, PageHeader, Panel, ProvenanceNote, formatDate } from "@/components/member/ui";
import type { ResearchCoverageStatus } from "@/lib/api/research-contract";
import { assetHref } from "@/lib/member/links";
import { memberResearch } from "@/lib/member/research";
import { requireMember } from "@/lib/member/session";
import { listTrackedSymbols, listWatchlists } from "@/lib/member/watchlists";

export const metadata: Metadata = { title: "Research" };

const COVERAGE_TONE: Record<ResearchCoverageStatus, "neutral" | "accent" | "warn" | "emerald"> = {
  complete: "emerald",
  partial: "accent",
  insufficient: "warn",
  unavailable: "warn",
};

export default async function ResearchIndexPage() {
  const session = await requireMember("/app/research");

  const [tracked, watchlists, coverage] = await Promise.all([
    listTrackedSymbols(session.user.id),
    listWatchlists(session.user.id),
    memberResearch.coverage(),
  ]);

  const disclosure = coverage.data;
  const window =
    disclosure.windowStart && disclosure.windowEnd
      ? `${formatDate(disclosure.windowStart)} to ${formatDate(disclosure.windowEnd)}`
      : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Research"
        title="Asset research"
        description="Open any ticker to read its insider activity, signals, evidence and coverage. Every view is the same customer-safe research the rest of the workspace uses."
      />

      <div className="max-w-xl">
        <SymbolSearch placeholder="Open research for a ticker, e.g. AAPL" />
      </div>

      <Panel
        title="Your tracked symbols"
        action={
          <Link
            href="/app/watchlists"
            className="text-xs text-mk-muted underline-offset-4 hover:text-mk-fg hover:underline"
          >
            Manage
          </Link>
        }
      >
        {tracked.length === 0 ? (
          <EmptyState
            title="No symbols tracked yet"
            description="Add a ticker to a watchlist and it will appear here as a direct link into its research page."
            action={
              <Link
                href="/app/watchlists"
                className="inline-flex items-center rounded-lg bg-mk-accent px-3 py-2 text-sm font-semibold text-mk-accent-ink transition-opacity hover:opacity-90"
              >
                Add a ticker
              </Link>
            }
          />
        ) : (
          <ul className="flex flex-wrap gap-2">
            {tracked.map((symbol) => (
              <li key={symbol}>
                <Link
                  href={assetHref(symbol)}
                  className="inline-flex items-center rounded-md border border-mk-line bg-mk-raised px-2.5 py-1.5 font-marketing-mono text-xs text-mk-fg transition-colors hover:border-mk-accent/40 hover:text-mk-accent"
                >
                  {symbol}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {watchlists.length > 0 ? (
          <p className="mt-3 font-marketing-mono text-[11px] text-mk-dim">
            across {watchlists.length} watchlist{watchlists.length === 1 ? "" : "s"}
          </p>
        ) : null}
      </Panel>

      <Panel
        title="Published coverage"
        action={<Badge tone={COVERAGE_TONE[disclosure.status]}>{disclosure.status}</Badge>}
      >
        <p className="text-sm leading-relaxed text-mk-fg text-pretty">
          {disclosure.symbolsCovered} of {disclosure.symbolsRequested} requested symbols covered
          {window ? ` · ${window}` : " · window not reported"}
        </p>
        {disclosure.gaps.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-1.5 border-t border-mk-line pt-3">
            {disclosure.gaps.map((gap) => (
              <li key={gap.key} className="text-xs leading-relaxed text-mk-muted text-pretty">
                <span className="text-mk-fg">{gap.label}</span> — {gap.detail}
              </li>
            ))}
          </ul>
        ) : null}
        {disclosure.caveats.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-1">
            {disclosure.caveats.map((caveat) => (
              <li key={caveat} className="text-xs leading-relaxed text-mk-muted text-pretty">
                {caveat}
              </li>
            ))}
          </ul>
        ) : null}
      </Panel>

      <ProvenanceNote
        provenance={coverage.provenance}
        generatedAt={coverage.generatedAt}
        warnings={coverage.warnings}
        unreachable={coverage.unreachable}
      />
    </div>
  );
}
