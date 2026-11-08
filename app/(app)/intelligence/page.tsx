import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Building2,
  Database,
  FileText,
  Landmark,
  Radar,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { ProvenanceBadge } from "@/components/shared/provenance-badge";
import { SectionCard } from "@/components/shared/section-card";
import { EmptyState } from "@/components/shared/empty-state";
import { CoverageWarning } from "@/components/intelligence/coverage-warning";
import { FreshnessIndicator } from "@/components/intelligence/freshness-indicator";
import { MetricTile } from "@/components/intelligence/metric-tile";
import { Pagination } from "@/components/intelligence/pagination";
import { SignalExplorer } from "@/components/intelligence/signal-explorer";
import { SourceFreshnessTable } from "@/components/intelligence/source-freshness";
import { SymbolSearch } from "@/components/intelligence/symbol-search";
import { UnavailablePanel } from "@/components/intelligence/unavailable-panel";
import { ProvenanceLabel } from "@/components/intelligence/provenance-label";
import { FilingSourceLink } from "@/components/intelligence/filing-link";
import { requireOperator } from "@/lib/admin/guard";
import {
  getInsiderFeed,
  getInstitutions,
  getIntelStatus,
  getSignals,
} from "@/lib/api/endpoints";
import {
  formatCompact,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatNumber,
} from "@/lib/format";
import {
  freshnessCaveat,
  signalDistribution,
} from "@/lib/intelligence/presentation";

export const metadata: Metadata = {
  title: "Intelligence Overview",
};

const PAGE_LIMIT = 25;

export default async function IntelligenceOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ symbol?: string; category?: string; page?: string }>;
}) {
  await requireOperator("/intelligence");

  const params = await searchParams;
  const symbol = (params.symbol ?? "").trim().toUpperCase();
  const category = params.category ?? "";
  const page = Math.max(1, Number(params.page ?? "1") || 1);

  const [status, signals, insiders, institutions] = await Promise.all([
    getIntelStatus(),
    getSignals({
      symbol: symbol || undefined,
      category: category || undefined,
      page,
      limit: PAGE_LIMIT,
    }),
    getInsiderFeed({ openMarketOnly: true, limit: 6 }),
    getInstitutions(1, 5),
  ]);

  const s = status.data;
  const distribution = signalDistribution(signals.data.items);
  const caveat = freshnessCaveat(s.freshness);

  // The engine is asked for open-market purchases only. The filter is repeated
  // here so the card's label stays true even if the engine returns more.
  const purchases = insiders.data.items.filter(
    (tx) => tx.classification === "open_market_purchase",
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow={
          <>
            <ProvenanceBadge provenance={status.provenance} />
            <span className="inline-flex items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] tracking-[0.08em] text-muted-foreground uppercase">
              <Sparkles className="size-2.5" aria-hidden />
              Research only
            </span>
            <FreshnessIndicator
              freshness={s.freshness}
              lastSuccessAt={s.latestFilingAt}
            />
          </>
        }
        title="Intelligence"
        description="SEC insider filings, institutional disclosures and the signals computed from them. Every figure is traceable to a filing, and a research score is a ranking of evidence — never a probability of profit."
        actions={
          <Link
            href="/intelligence/coverage"
            className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <Database className="size-3" aria-hidden />
            Data coverage
            <ArrowRight className="size-3" aria-hidden />
          </Link>
        }
      />

      <UnavailablePanel
        envelope={status}
        title="Intelligence collection is not reporting"
      />

      {caveat ? (
        <CoverageWarning
          severity={s.freshness === "failing" ? "blocking" : "warning"}
          title={`Feed is ${s.freshness}`}
        >
          {caveat}
        </CoverageWarning>
      ) : null}

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <MetricTile
          label="Filings"
          value={formatCompact(s.filings)}
          hint="SEC documents stored"
          icon={FileText}
          tone="primary"
        />
        <MetricTile
          label="Transactions"
          value={formatCompact(s.transactions)}
          hint="Reported lines parsed"
          icon={UserRound}
          tone="primary"
        />
        <MetricTile
          label="Signals"
          value={formatCompact(s.signals)}
          hint="Thresholds met"
          icon={Radar}
          tone="profit"
        />
        <MetricTile
          label="Institutions"
          value={formatCompact(s.institutions)}
          hint="13F filers stored"
          icon={Landmark}
          tone="primary"
        />
        <MetricTile
          label="Holdings"
          value={formatCompact(s.holdings)}
          hint="Quarterly positions"
          icon={Building2}
          tone="muted"
        />
        <MetricTile
          label="Symbols"
          value={formatCompact(s.symbolsCovered.length)}
          hint="With stored research"
          icon={Database}
          tone="muted"
        />
      </div>

      <SectionCard
        title="Research signals"
        description="Ranked by the engine's research score. Expand a row to read the measurement, the confidence notes and the timestamps behind it."
        bodyClassName="p-0"
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <ProvenanceLabel
              provenance={signals.provenance}
              source={signals.source}
              generatedAt={signals.generatedAt}
            />
            <span className="font-mono text-[10px] text-muted-foreground">
              engine {s.signalEngineVersion || "—"}
            </span>
          </div>
        }
      >
        <SignalExplorer
          signals={signals.data.items}
          serverFilters={{ symbol, category }}
          basePath="/intelligence"
          total={signals.data.total}
          page={signals.data.page}
          limit={signals.data.limit}
        />
        <Pagination
          basePath="/intelligence"
          params={{ symbol, category }}
          page={signals.data.page}
          limit={signals.data.limit}
          total={signals.data.total}
          hasMore={signals.data.hasMore}
        />
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="Signal category distribution"
          description={`Across the ${signals.data.items.length} signals loaded on this page — the engine exposes no aggregate endpoint, so this is not a global distribution.`}
        >
          {distribution.length === 0 ? (
            <EmptyState
              icon={Radar}
              title="No signals to distribute"
              description="Nothing is stored for the current filters, so there is no category mix to show."
            />
          ) : (
            <ul className="flex flex-col gap-2.5">
              {distribution.map((item) => (
                <li key={item.category} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[11px] text-foreground">{item.label}</span>
                    <span className="font-mono text-[10px] tabular text-muted-foreground">
                      {item.count}
                      <span className="ml-1 text-muted-foreground/60">
                        {item.share.toFixed(0)}%
                      </span>
                    </span>
                  </div>
                  <div className="h-1 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${Math.max(2, item.share)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Source freshness"
          description="Derived from completed ingestion runs, so a collector that has stopped shows as stale rather than looking populated."
        >
          <SourceFreshnessTable sources={s.sources} />
        </SectionCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="Insider purchase activity"
          description="Open-market purchases only. Awards, gifts, exercises and tax withholding are excluded here and shown in full on the Insider Radar."
          action={
            <Link
              href="/intelligence/insiders"
              className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
            >
              Insider Radar
              <ArrowRight className="size-3" aria-hidden />
            </Link>
          }
          bodyClassName="p-0"
        >
          {purchases.length === 0 ? (
            <div className="px-4 pb-4 sm:px-5">
              <EmptyState
                icon={UserRound}
                title="No open-market purchases stored"
                description="Nothing is stored for this window. That is not the same as no insider buying occurring — it means the collector has not stored a matching filing."
              />
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {purchases.map((tx) => (
                <li
                  key={tx.id}
                  className="flex items-start justify-between gap-3 px-4 py-2.5 sm:px-5"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5">
                      <span className="font-mono text-[12px] font-medium text-foreground">
                        {tx.symbol}
                      </span>
                      <span className="truncate text-[11px] text-muted-foreground">
                        {tx.reportingPersonName}
                      </span>
                    </p>
                    <p className="mt-0.5 flex items-baseline gap-1 text-[10px] text-muted-foreground">
                      <span className="truncate">{tx.role || "Role not reported"}</span>
                      <span className="shrink-0">
                        · public {formatDate(tx.acceptedAt)}
                      </span>
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-0.5">
                    <span className="font-mono text-[11px] tabular text-profit">
                      {tx.value === null
                        ? "no price"
                        : formatCurrency(tx.value, "USD", { compact: true })}
                    </span>
                    <FilingSourceLink href={tx.sourceUrl} compact />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Institutional disclosures"
          description="Quarterly 13F snapshots. A reported holding is a position at quarter end, not a current position and not a real-time purchase."
          action={
            <Link
              href="/intelligence/institutions"
              className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
            >
              Institutional Radar
              <ArrowRight className="size-3" aria-hidden />
            </Link>
          }
          bodyClassName="p-0"
        >
          {institutions.data.items.length === 0 ? (
            <div className="px-4 pb-4 sm:px-5">
              <EmptyState
                icon={Landmark}
                title="No 13F filings stored"
                description="Institutional data is empty because nothing has been collected, not because no institution filed."
              />
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {institutions.data.items.map((institution) => (
                <li
                  key={institution.cik}
                  className="flex items-start justify-between gap-3 px-4 py-2.5 sm:px-5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[11px] font-medium text-foreground">
                      {institution.name}
                    </p>
                    <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                      CIK {institution.cik} ·{" "}
                      {institution.latestPeriod
                        ? `period ${formatDate(institution.latestPeriod)}`
                        : "no period"}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-0.5">
                    <span className="font-mono text-[11px] tabular text-foreground">
                      {institution.reportedValueUsd === null
                        ? "—"
                        : formatCurrency(institution.reportedValueUsd, "USD", {
                            compact: true,
                          })}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {formatNumber(institution.positionCount, { digits: 0 })} positions
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <SectionCard
          title="Research coverage"
          description="Symbols with at least one stored signal or transaction."
          action={<SymbolSearch />}
        >
          {s.symbolsCovered.length === 0 ? (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              No symbol has stored research yet. Coverage appears here once a filing
              has been ingested and a signal computed.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {s.symbolsCovered.slice(0, 60).map((ticker) => (
                <Link
                  key={ticker}
                  href={`/intelligence/symbols/${encodeURIComponent(ticker)}`}
                  className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {ticker}
                </Link>
              ))}
              {s.symbolsCovered.length > 60 ? (
                <span className="px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  +{s.symbolsCovered.length - 60} more
                </span>
              ) : null}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Ingestion status"
          description="What the collectors last reported."
        >
          <dl className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-[11px] text-muted-foreground">Collection enabled</dt>
              <dd className="font-mono text-[11px] text-foreground">
                {s.enabled ? "yes" : "no"}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-[11px] text-muted-foreground">Latest filing</dt>
              <dd className="font-mono text-[11px] text-foreground">
                {s.latestFilingAt ? formatDateTime(s.latestFilingAt) : "never"}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-[11px] text-muted-foreground">Latest signal</dt>
              <dd className="font-mono text-[11px] text-foreground">
                {s.latestSignalAt ? formatDateTime(s.latestSignalAt) : "never"}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-[11px] text-muted-foreground">Collectors</dt>
              <dd className="font-mono text-[11px] text-foreground">
                {s.sources.length}
              </dd>
            </div>
          </dl>
          <Link
            href="/intelligence/operations"
            className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
          >
            Collection operations
            <ArrowRight className="size-3" aria-hidden />
          </Link>
        </SectionCard>
      </div>

      {s.caveats.length > 0 ? (
        <SectionCard
          title="Engine caveats"
          description="Reported by the engine with this payload, unedited."
        >
          <ul className="flex flex-col gap-1.5">
            {s.caveats.map((item) => (
              <li key={item}>
                <CoverageWarning severity="info" title={item} />
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      <div className="flex items-start gap-2 rounded-lg border border-border bg-surface/60 px-3 py-2.5">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          The research terminal is separate from order execution. Nothing on this page
          can place an order, reach a broker, change a risk limit or enable live
          trading, and no signal is ever routed to a bot automatically.
        </p>
      </div>
    </div>
  );
}
