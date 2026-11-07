import type { Metadata } from "next";

import { Pagination } from "@/components/member/pagination";
import { SignalRow } from "@/components/member/signal-row";
import { EmptyState, PageHeader, Panel, ProvenanceNote } from "@/components/member/ui";
import type { ResearchSignalCategory } from "@/lib/api/contracts";
import { SIGNAL_LABEL } from "@/lib/member/labels";
import { memberResearch } from "@/lib/member/research";
import { requireMember } from "@/lib/member/session";
import { SYMBOL_PATTERN } from "@/lib/member/validation";

export const metadata: Metadata = { title: "Signals" };

const CATEGORIES = (Object.keys(SIGNAL_LABEL) as ResearchSignalCategory[]).map((value) => ({
  value,
  label: SIGNAL_LABEL[value],
}));

type SearchParams = { symbol?: string; category?: string; page?: string };

export default async function SignalsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireMember("/app/signals");

  const params = await searchParams;
  const rawSymbol = params.symbol?.trim().toUpperCase();
  const symbol = rawSymbol && SYMBOL_PATTERN.test(rawSymbol) ? rawSymbol : undefined;
  const category = CATEGORIES.some((entry) => entry.value === params.category)
    ? (params.category as ResearchSignalCategory)
    : undefined;
  const page = Math.max(1, Number(params.page ?? "1") || 1);

  const feed = await memberResearch.signals({ symbol, category, page, limit: 25 });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Research"
        title="Signals"
        description="Measured activity published by the research engine. A score is a bounded ranking, not a probability or a recommendation."
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

        <div>
          <label htmlFor="category" className="mb-1.5 block font-marketing-mono text-[11px] uppercase tracking-[0.14em] text-mk-muted">
            Category
          </label>
          <select
            id="category"
            name="category"
            defaultValue={category ?? ""}
            className="w-56 rounded-lg border border-mk-line bg-mk-surface px-3 py-2 text-sm text-mk-fg focus:border-mk-accent/60 focus:outline-none focus:ring-2 focus:ring-mk-accent/20"
          >
            <option value="">All categories</option>
            {CATEGORIES.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          className="rounded-lg bg-mk-accent px-3 py-2 text-sm font-semibold text-mk-accent-ink transition-opacity hover:opacity-90"
        >
          Apply
        </button>
      </form>

      <Panel title={`${feed.data.total.toLocaleString()} signals`} bodyClassName="p-0">
        {feed.data.items.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No signals match this filter"
              description="Signals appear once the engine has enough filings to measure activity against a baseline. An empty result means nothing has been published for this filter."
            />
          </div>
        ) : (
          <>
            <ul>
              {feed.data.items.map((signal) => (
                <SignalRow key={signal.id} signal={signal} />
              ))}
            </ul>
            <Pagination
              page={page}
              hasMore={feed.data.hasMore}
              basePath="/app/signals"
              params={{ symbol, category }}
            />
          </>
        )}
      </Panel>

      <ProvenanceNote provenance={feed.provenance} generatedAt={feed.generatedAt} warnings={feed.warnings} />
    </div>
  );
}
