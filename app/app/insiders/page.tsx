import type { Metadata } from "next";

import { InsiderRow } from "@/components/member/insider-row";
import { Pagination } from "@/components/member/pagination";
import { EmptyState, PageHeader, Panel, ProvenanceNote } from "@/components/member/ui";
import { memberResearch } from "@/lib/member/research";
import { requireMember } from "@/lib/member/session";
import { SYMBOL_PATTERN } from "@/lib/member/validation";

export const metadata: Metadata = { title: "Insider discovery" };

type SearchParams = { symbol?: string; openMarket?: string; page?: string };

export default async function InsidersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireMember("/app/insiders");

  const params = await searchParams;
  const rawSymbol = params.symbol?.trim().toUpperCase();
  const symbol = rawSymbol && SYMBOL_PATTERN.test(rawSymbol) ? rawSymbol : undefined;
  const openMarketOnly = params.openMarket === "true";
  const page = Math.max(1, Number(params.page ?? "1") || 1);

  const feed = await memberResearch.insiders({ symbol, openMarketOnly, page, limit: 25 });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Research"
        title="Insider discovery"
        description="Form 4 filings as they became public. Transaction dates are when the trade happened; filing dates are when it became known."
      />

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl border border-mk-line bg-mk-surface/60 p-4">
        <div>
          <label htmlFor="symbol" className="mb-1.5 block font-marketing-mono text-[11px] uppercase tracking-[0.14em] text-mk-muted">
            Ticker
          </label>
          <input
            id="symbol"
            name="symbol"
            defaultValue={symbol ?? ""}
            placeholder="All tickers"
            autoComplete="off"
            spellCheck={false}
            className="w-40 rounded-lg border border-mk-line bg-mk-surface px-3 py-2 font-marketing-mono text-sm uppercase text-mk-fg placeholder:normal-case placeholder:text-mk-dim focus:border-mk-accent/60 focus:outline-none focus:ring-2 focus:ring-mk-accent/20"
          />
        </div>

        <div className="flex items-center gap-2 pb-2">
          <input
            id="openMarket"
            name="openMarket"
            type="checkbox"
            value="true"
            defaultChecked={openMarketOnly}
            className="size-4 rounded border-mk-line bg-mk-surface accent-mk-accent"
          />
          <label htmlFor="openMarket" className="text-sm text-mk-muted">
            Open-market only
          </label>
        </div>

        <button
          type="submit"
          className="rounded-lg bg-mk-accent px-3 py-2 text-sm font-semibold text-mk-accent-ink transition-opacity hover:opacity-90"
        >
          Apply
        </button>
      </form>

      <Panel title={`${feed.data.total.toLocaleString()} filings`} bodyClassName="p-0">
        {feed.data.items.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No filings match this filter"
              description="Try clearing the ticker filter or turning off open-market only. An empty result means no matching filing has been published."
            />
          </div>
        ) : (
          <>
            <ul>
              {feed.data.items.map((transaction) => (
                <InsiderRow key={transaction.id} transaction={transaction} />
              ))}
            </ul>
            <Pagination
              page={page}
              hasMore={feed.data.hasMore}
              basePath="/app/insiders"
              params={{ symbol, openMarket: openMarketOnly ? "true" : undefined }}
            />
          </>
        )}
      </Panel>

      <ProvenanceNote provenance={feed.provenance} generatedAt={feed.generatedAt} warnings={feed.warnings} />
    </div>
  );
}
