import type { Metadata } from "next";
import Link from "next/link";

import { MarketBriefView } from "@/components/member/market-brief";
import { SymbolSearch } from "@/components/member/symbol-search";
import { EmptyState, PageHeader, Panel, ProvenanceNote } from "@/components/member/ui";
import { getMarketBrief } from "@/lib/member/brief";
import { assetHref } from "@/lib/member/links";
import { requireMember } from "@/lib/member/session";

export const metadata: Metadata = { title: "Market brief" };

export default async function ResearchIndexPage() {
  const session = await requireMember("/app/research");

  // The brief reads the member's watchlists itself, so the page does not read
  // them a second time. Seven reads total: six engine, one database.
  const brief = await getMarketBrief(session.user.id);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Research"
        title="Market brief"
        description="One read-only briefing assembled from the research Wands already holds: what was disclosed, what is approaching, what the signal engine found, and what is missing. Every item links to the record behind it."
      />

      <div className="max-w-xl">
        <SymbolSearch placeholder="Open research for a ticker, e.g. AAPL" />
      </div>

      <MarketBriefView brief={brief} />

      <ProvenanceNote
        provenance={
          brief.availability === "unavailable"
            ? "unavailable"
            : brief.availability === "partial"
              ? "partial"
              : "live"
        }
        generatedAt={brief.asOf}
        warnings={brief.warnings}
        unreachable={brief.unreachable}
      />

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
        {brief.watchlist.length === 0 ? (
          <EmptyState
            title="No symbols tracked yet"
            description="Add a ticker to a watchlist and the brief will surface its disclosures, approaching events and signals, with a direct link into its research page."
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
            {brief.watchlist.map((symbol) => (
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
        {brief.watchlistCount > 0 ? (
          <p className="mt-3 font-marketing-mono text-[11px] text-mk-dim">
            across {brief.watchlistCount} watchlist{brief.watchlistCount === 1 ? "" : "s"}
          </p>
        ) : null}
      </Panel>
    </div>
  );
}
