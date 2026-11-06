import type { Metadata } from "next";
import Link from "next/link";
import { Search, Sparkles, UserRound, Users } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { ProvenanceBadge } from "@/components/shared/provenance-badge";
import { SectionCard } from "@/components/shared/section-card";
import { EmptyState } from "@/components/shared/empty-state";
import { CoverageWarning } from "@/components/intelligence/coverage-warning";
import { FreshnessIndicator } from "@/components/intelligence/freshness-indicator";
import { InsiderTable } from "@/components/intelligence/insider-table";
import { MetricTile } from "@/components/intelligence/metric-tile";
import { Pagination } from "@/components/intelligence/pagination";
import { ProvenanceLabel } from "@/components/intelligence/provenance-label";
import { ResearchScore } from "@/components/intelligence/score-indicator";
import { SignalBadge } from "@/components/intelligence/signal-badge";
import { UnavailablePanel } from "@/components/intelligence/unavailable-panel";
import { KeyValueList } from "@/components/intelligence/evidence-panel";
import {
  getInsiderFeed,
  getInsiderSummary,
  getIntelStatus,
  getSignals,
} from "@/lib/api/endpoints";
import { formatCurrency, formatDateTime, formatNumber } from "@/lib/format";
import {
  distinctIssuers,
  distinctReportingPersons,
  freshnessCaveat,
  insiderClassLabel,
  totalReportedValue,
  unpricedTransactions,
} from "@/lib/intelligence/presentation";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Insider Radar",
};

const PAGE_LIMIT = 40;

const CLASS_TABS: { value: string; label: string }[] = [
  { value: "", label: "All activity" },
  { value: "open_market_purchase", label: "Open-market purchases" },
  { value: "open_market_sale", label: "Open-market sales" },
  { value: "award_grant", label: "Awards" },
  { value: "gift", label: "Gifts" },
  { value: "derivative_exercise", label: "Exercises" },
  { value: "tax_withholding", label: "Tax withholding" },
  { value: "disposition_to_issuer", label: "To issuer" },
  { value: "other", label: "Other" },
];

export default async function InsiderRadarPage({
  searchParams,
}: {
  searchParams: Promise<{ symbol?: string; classification?: string; page?: string }>;
}) {
  const params = await searchParams;
  const symbol = (params.symbol ?? "").trim().toUpperCase();
  const classification = params.classification ?? "";
  const page = Math.max(1, Number(params.page ?? "1") || 1);

  const [status, feed, clusters, summary] = await Promise.all([
    getIntelStatus(),
    getInsiderFeed({
      symbol: symbol || undefined,
      page,
      limit: PAGE_LIMIT,
    }),
    getSignals({ category: "INSIDER_PURCHASE_CLUSTER", limit: 6 }),
    symbol ? getInsiderSummary(symbol) : Promise.resolve(null),
  ]);

  const s = status.data;
  const items = feed.data.items;
  const caveat = freshnessCaveat(s.freshness);

  // The engine filters by classification, but the feed endpoint has no
  // classification parameter on the typed client, so the tab narrows the page.
  const visible = classification
    ? items.filter((tx) => tx.classification === classification)
    : items;

  // The engine is asked for cluster signals only. The filter is repeated here so
  // the section's heading stays true even if the engine returns more.
  const clusterSignals = clusters.data.items.filter(
    (signal) => signal.category === "INSIDER_PURCHASE_CLUSTER",
  );

  const purchases = visible.filter((tx) => tx.classification === "open_market_purchase");
  const sales = visible.filter((tx) => tx.classification === "open_market_sale");
  const unpriced = unpricedTransactions(visible);
  const reportedValue = totalReportedValue(visible);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow={
          <>
            <ProvenanceBadge provenance={feed.provenance} />
            <span className="inline-flex items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] tracking-[0.08em] text-muted-foreground uppercase">
              <Sparkles className="size-2.5" aria-hidden />
              Research only
            </span>
            <FreshnessIndicator freshness={s.freshness} lastSuccessAt={s.latestFilingAt} />
          </>
        }
        title="Insider Radar"
        description="Reported insider transactions from SEC ownership filings. Only an open-market purchase or sale is a decision to trade in the market — awards, gifts, exercises and tax withholding move shares for other reasons and are labelled as such."
      />

      <UnavailablePanel envelope={feed} title="Insider filings are not available" />

      {caveat ? (
        <CoverageWarning
          severity={s.freshness === "failing" ? "blocking" : "warning"}
          title={`Feed is ${s.freshness}`}
        >
          {caveat}
        </CoverageWarning>
      ) : null}

      <form
        action="/intelligence/insiders"
        method="get"
        className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-card px-4 py-3"
      >
        <div className="flex flex-col gap-1">
          <label
            htmlFor="insider-symbol"
            className="text-[10px] font-medium tracking-[0.06em] text-muted-foreground uppercase"
          >
            Issuer ticker
          </label>
          <input
            id="insider-symbol"
            name="symbol"
            defaultValue={symbol}
            placeholder="All issuers"
            autoComplete="off"
            spellCheck={false}
            className="h-7 w-36 rounded-md border border-input bg-surface px-2 font-mono text-[11px] text-foreground uppercase placeholder:font-sans placeholder:normal-case placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          />
        </div>
        {classification ? (
          <input type="hidden" name="classification" value={classification} />
        ) : null}
        <button
          type="submit"
          className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-surface px-2.5 text-[11px] font-medium text-foreground transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <Search className="size-3" aria-hidden />
          Filter
        </button>
        {symbol ? (
          <Link
            href="/intelligence/insiders"
            className="inline-flex h-7 items-center rounded-md px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Clear
          </Link>
        ) : null}
        <p className="ml-auto text-[10px] text-muted-foreground">
          <span className="font-mono text-foreground">{feed.data.total}</span> matching
          records stored
        </p>
      </form>

      <nav aria-label="Transaction classification" className="overflow-x-auto">
        <ul className="flex min-w-max items-center gap-1">
          {CLASS_TABS.map((tab) => {
            const active = classification === tab.value;
            const search = new URLSearchParams();
            if (symbol) search.set("symbol", symbol);
            if (tab.value) search.set("classification", tab.value);
            const query = search.toString();

            return (
              <li key={tab.value || "all"}>
                <Link
                  href={`/intelligence/insiders${query ? `?${query}` : ""}`}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-flex items-center rounded-md border px-2 py-1 text-[11px] transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    active
                      ? "border-border bg-secondary font-medium text-foreground"
                      : "border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                  )}
                >
                  {tab.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        <MetricTile
          label="Purchases (page)"
          value={formatNumber(purchases.length, { digits: 0 })}
          hint="Open-market buys"
          icon={UserRound}
          tone="profit"
        />
        <MetricTile
          label="Sales (page)"
          value={formatNumber(sales.length, { digits: 0 })}
          hint="Open-market sells"
          icon={UserRound}
          tone="loss"
        />
        <MetricTile
          label="Persons (page)"
          value={formatNumber(distinctReportingPersons(visible), { digits: 0 })}
          hint="Distinct reporting CIKs"
          icon={Users}
          tone="primary"
        />
        <MetricTile
          label="Issuers (page)"
          value={formatNumber(distinctIssuers(visible), { digits: 0 })}
          hint="Distinct tickers"
          icon={Users}
          tone="muted"
        />
        <MetricTile
          label="Reported value (page)"
          value={
            reportedValue === null
              ? "—"
              : formatCurrency(reportedValue, "USD", { compact: true })
          }
          hint={
            unpriced.length > 0
              ? `${unpriced.length} line${unpriced.length === 1 ? "" : "s"} with no price`
              : "All lines priced"
          }
          tone={unpriced.length > 0 ? "warning" : "muted"}
        />
      </div>

      {summary ? (
        <SectionCard
          title={`${symbol} — issuer summary`}
          description={`Open-market activity over the engine's ${summary.data.windowDays}-day window.`}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <KeyValueList
              items={[
                { label: "Issuer", value: summary.data.issuerName || "—" },
                { label: "Purchases", value: summary.data.purchaseCount },
                { label: "Sales", value: summary.data.saleCount },
                {
                  label: "Distinct purchasers",
                  value: summary.data.distinctPurchasers,
                },
                {
                  label: "Distinct sellers",
                  value: summary.data.distinctSellers,
                },
              ]}
            />
            <KeyValueList
              items={[
                {
                  label: "Purchase value",
                  value:
                    summary.data.purchaseValueUsd === null
                      ? "no price reported"
                      : formatCurrency(summary.data.purchaseValueUsd, "USD", {
                          compact: true,
                        }),
                },
                {
                  label: "Unpriced lines",
                  value: summary.data.unpricedPurchaseLines,
                },
                {
                  label: "Latest filing",
                  value: formatDateTime(summary.data.latestFilingAt),
                },
                {
                  label: "Latest trade",
                  value: formatDateTime(summary.data.latestTransactionDate),
                },
              ]}
            />
          </div>
          {summary.data.caveats.length > 0 ? (
            <ul className="mt-3 flex flex-col gap-1.5">
              {summary.data.caveats.map((item) => (
                <li key={item}>
                  <CoverageWarning severity="info" title={item} />
                </li>
              ))}
            </ul>
          ) : null}
        </SectionCard>
      ) : null}

      <SectionCard
        title="Transaction feed"
        description="Newest public filings first. Expand a row to read the filing's own description, the accession number and the SEC source."
        bodyClassName="p-0"
        footer={
          <ProvenanceLabel
            provenance={feed.provenance}
            source={feed.source}
            generatedAt={feed.generatedAt}
          />
        }
      >
        <InsiderTable
          transactions={visible}
          emptyTitle={
            classification
              ? `No ${insiderClassLabel(classification).toLowerCase()} records on this page`
              : undefined
          }
          emptyDescription={
            classification
              ? "The engine returned records for this query, but none of them carry this classification on the current page. Move to another page or clear the classification filter."
              : undefined
          }
        />
        <Pagination
          basePath="/intelligence/insiders"
          params={{ symbol, classification }}
          page={feed.data.page}
          limit={feed.data.limit}
          total={feed.data.total}
          hasMore={feed.data.hasMore}
        />
      </SectionCard>

      <SectionCard
        title="Purchase clusters"
        description="Signals the engine raised when several reporting persons bought the same issuer inside one window. A cluster counts reporting persons, which a joint filing can inflate."
        bodyClassName="p-0"
      >
        {clusterSignals.length === 0 ? (
          <div className="px-4 pb-4 sm:px-5">
            <EmptyState
              icon={Users}
              title="No purchase clusters stored"
              description="A cluster is only produced when the configured threshold is met, so an empty list is the normal state for most issuers."
            />
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {clusterSignals.map((signal) => (
              <li
                key={signal.id}
                className="flex flex-wrap items-start justify-between gap-3 px-4 py-2.5 sm:px-5"
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[12px] font-medium text-foreground">
                      {signal.symbol}
                    </span>
                    <SignalBadge category={signal.category} />
                  </p>
                  <p className="mt-0.5 max-w-2xl text-[11px] leading-relaxed text-pretty text-muted-foreground">
                    {signal.explanation}
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/70">
                    public {formatDateTime(signal.publicAvailableAt)}
                  </p>
                </div>
                <ResearchScore score={signal.score} showLabel />
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <div className="flex items-start gap-2 rounded-lg border border-border bg-surface/60 px-3 py-2.5">
        <Sparkles className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          An insider purchase is a reported fact, not a recommendation. The reporting
          person may have bought for reasons unrelated to the issuer&rsquo;s prospects,
          and a filing can be amended after publication.
        </p>
      </div>
    </div>
  );
}
