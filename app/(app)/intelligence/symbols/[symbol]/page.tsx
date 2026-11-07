import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  FileText,
  Landmark,
  Radar,
  ShieldCheck,
  UserRound,
} from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { ProvenanceBadge } from "@/components/shared/provenance-badge";
import { SectionCard } from "@/components/shared/section-card";
import { EmptyState } from "@/components/shared/empty-state";
import { CoverageDisclosure } from "@/components/intelligence/coverage-disclosure";
import { DataQualityBadge } from "@/components/intelligence/data-quality-badge";
import { FreshnessIndicator } from "@/components/intelligence/freshness-indicator";
import { MetricTile } from "@/components/intelligence/metric-tile";
import { ProvenanceLabel, TimestampPair } from "@/components/intelligence/provenance-label";
import { ResearchSourceLinks } from "@/components/intelligence/research-source-links";
import { ResearchScore } from "@/components/intelligence/score-indicator";
import { SignalBadge } from "@/components/intelligence/signal-badge";
import { SymbolSearch } from "@/components/intelligence/symbol-search";
import { UnavailablePanel } from "@/components/intelligence/unavailable-panel";
import { getAssetResearch } from "@/lib/api/research";
import {
  formatCompact,
  formatCurrency,
  formatDate,
  formatNumber,
} from "@/lib/format";

const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9.-]{0,11}$/;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ symbol: string }>;
}): Promise<Metadata> {
  const { symbol } = await params;
  const upper = decodeURIComponent(symbol).trim().toUpperCase();
  return {
    title: `${upper} research`,
    description: `Insider filings, institutional disclosures and computed signals for ${upper}, with the source document behind every claim.`,
  };
}

export default async function AssetResearchPage({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol: raw } = await params;
  const symbol = decodeURIComponent(raw).trim().toUpperCase();

  if (!SYMBOL_PATTERN.test(symbol)) notFound();

  const research = await getAssetResearch(symbol);
  const r = research.data;
  const insider = r.insider;
  const fusion = r.fusion;

  const insiderLines = insider.purchaseCount + insider.saleCount;
  const hasEvidence = r.signals.length > 0 || insiderLines > 0;

  // An unreachable engine must not render as a row of zeros: "0 purchases"
  // reads as "no insider bought", which is a claim we cannot make.
  const known = research.provenance !== "unavailable";
  const count = (value: number) => (known ? formatCompact(value) : "—");
  const when = (iso: string | null) =>
    known ? (iso ? formatDate(iso) : "never") : "—";

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow={
          <>
            <ProvenanceBadge provenance={research.provenance} />
            <span className="inline-flex items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] tracking-[0.08em] text-muted-foreground uppercase">
              <Radar className="size-2.5" aria-hidden />
              Research only
            </span>
            <FreshnessIndicator
              freshness={r.freshness}
              lastSuccessAt={insider.latestFilingAt}
            />
          </>
        }
        title={r.issuerName ? `${symbol} · ${r.issuerName}` : symbol}
        description="Insider activity reported to the SEC, the signals computed from it, and the filing behind each claim. A research score ranks evidence — it is not a probability of profit, and nothing here is a recommendation."
        actions={
          <>
            <Link
              href="/intelligence/symbols"
              className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <ArrowLeft className="size-3" aria-hidden />
              All assets
            </Link>
            <SymbolSearch defaultValue={symbol} />
          </>
        }
      />

      <UnavailablePanel
        envelope={research}
        title={`No research data is available for ${symbol}`}
      />

      <CoverageDisclosure coverage={r.coverage} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <SectionCard
          title="Composite research ranking"
          description="A weighted blend of the components below, on a bounded 0-100 scale. Coverage says how much of the weight was actually present."
          footer={
            <ProvenanceLabel
              provenance={research.provenance}
              source={research.source}
              generatedAt={research.generatedAt}
            />
          }
        >
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <ResearchScore score={fusion.compositeScore} showLabel />
              <span className="font-mono text-[10px] text-muted-foreground">
                coverage {formatNumber(fusion.coverage * 100, { digits: 0 })}%
                <span aria-hidden> · </span>
                {fusion.components.length} components
              </span>
            </div>

            <p className="text-[11px] leading-relaxed text-pretty text-muted-foreground">
              {fusion.explanation}
            </p>

            {fusion.components.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-2.5 text-[11px] leading-relaxed text-pretty text-muted-foreground">
                No component is available, so there is no composite score. A
                missing score is not a score of zero.
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {fusion.components.map((component) => (
                  <li
                    key={`${component.name}-${component.publicAvailableAt}`}
                    className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] font-medium text-foreground">
                          {component.name}
                        </span>
                        <SignalBadge category={component.category} />
                      </p>
                      <p className="mt-0.5 text-[10px] leading-relaxed text-pretty text-muted-foreground">
                        {component.explanation}
                      </p>
                      <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/80">
                        {formatNumber(component.measurement, { digits: 2 })}{" "}
                        {component.unit}
                        <span aria-hidden> · </span>
                        public {formatDate(component.publicAvailableAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <ResearchScore score={component.score} />
                      <DataQualityBadge quality={component.dataQuality} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </SectionCard>

        <SectionCard
          title="Insider activity"
          description={
            known
              ? `Reported over the last ${insider.windowDays} days. Only open-market purchases and sales are decisions to trade; awards, gifts and withholding are excluded.`
              : "The engine did not report insider activity for this symbol, so no counts are shown."
          }
        >
          <div className="grid grid-cols-2 gap-2.5">
            <MetricTile
              label="Purchases"
              value={count(insider.purchaseCount)}
              hint="Open-market buys"
              icon={UserRound}
              tone="profit"
            />
            <MetricTile
              label="Sales"
              value={count(insider.saleCount)}
              hint="Open-market sells"
              icon={UserRound}
              tone="loss"
            />
            <MetricTile
              label="Buyers"
              value={count(insider.distinctPurchasers)}
              hint="Distinct people"
              icon={UserRound}
              tone="muted"
            />
            <MetricTile
              label="Sellers"
              value={count(insider.distinctSellers)}
              hint="Distinct people"
              icon={UserRound}
              tone="muted"
            />
          </div>

          <dl className="mt-3 flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-[11px] text-muted-foreground">
                Reported purchase value
              </dt>
              <dd className="font-mono text-[11px] tabular text-foreground">
                {!known
                  ? "—"
                  : insider.purchaseValueUsd === null
                    ? "no price reported"
                    : formatCurrency(insider.purchaseValueUsd, "USD", {
                        compact: true,
                      })}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-[11px] text-muted-foreground">
                Unpriced purchase lines
              </dt>
              <dd className="font-mono text-[11px] tabular text-foreground">
                {known
                  ? formatNumber(insider.unpricedPurchaseLines, { digits: 0 })
                  : "—"}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-[11px] text-muted-foreground">Latest filing</dt>
              <dd className="font-mono text-[11px] text-foreground">
                {when(insider.latestFilingAt)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-[11px] text-muted-foreground">
                Latest transaction
              </dt>
              <dd className="font-mono text-[11px] text-foreground">
                {when(insider.latestTransactionDate)}
              </dd>
            </div>
          </dl>

          {insider.caveats.length > 0 ? (
            <ul className="mt-3 flex flex-col gap-1 border-t border-border pt-2.5">
              {insider.caveats.map((caveat) => (
                <li
                  key={caveat}
                  className="text-[10px] leading-relaxed text-pretty text-muted-foreground"
                >
                  {caveat}
                </li>
              ))}
            </ul>
          ) : null}
        </SectionCard>
      </div>

      <SectionCard
        title="Signals"
        description="Each signal states the measurement it was computed from, when the underlying activity happened, and when it became public. Only the second timestamp may date a backtest."
        bodyClassName="p-0"
      >
        {r.signals.length === 0 ? (
          <div className="px-4 pb-4 sm:px-5">
            <EmptyState
              icon={Radar}
              title={
                known
                  ? `No signal is stored for ${symbol}`
                  : `Signals for ${symbol} are unavailable`
              }
              description={
                known
                  ? "Either no threshold was met or nothing has been collected for this symbol. That is not the same as no insider activity occurring."
                  : "The engine did not answer, so no signal is shown. An empty list here is not evidence that no signal exists."
              }
            />
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {r.signals.map((signal) => (
              <li key={signal.id} className="flex flex-col gap-1.5 px-4 py-3 sm:px-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <SignalBadge category={signal.category} />
                    <DataQualityBadge quality={signal.dataQuality} />
                  </div>
                  <ResearchScore score={signal.score} showLabel />
                </div>

                <p className="text-[11px] leading-relaxed text-pretty text-foreground">
                  {signal.explanation}
                </p>

                <p className="font-mono text-[10px] text-muted-foreground">
                  {formatNumber(signal.rawMeasurement, { digits: 2 })}{" "}
                  {signal.rawUnit}
                  <span aria-hidden> · </span>
                  {signal.sourceEventIds.length} source
                  {signal.sourceEventIds.length === 1 ? "" : "s"}
                </p>

                <TimestampPair
                  eventTime={signal.eventTime}
                  publicAvailableAt={signal.publicAvailableAt}
                />

                {signal.confidenceNotes ? (
                  <p className="text-[10px] leading-relaxed text-pretty text-muted-foreground">
                    {signal.confidenceNotes}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        title="Sources"
        description="The documents behind the claims above. A claim with no resolvable source is not presented as verified."
      >
        <ResearchSourceLinks
          sources={r.sources}
          emptyLabel={
            known
              ? "The engine returned no source link for this claim, so it is not shown as verified."
              : "The engine did not answer, so no source link is available. This is not a statement that the claim is unsourced."
          }
        />
      </SectionCard>

      {r.caveats.length > 0 ? (
        <SectionCard
          title="Engine caveats"
          description="Reported by the engine with this payload, unedited."
        >
          <ul className="flex flex-col gap-1.5">
            {r.caveats.map((caveat) => (
              <li
                key={caveat}
                className="text-[11px] leading-relaxed text-pretty text-muted-foreground"
              >
                {caveat}
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      {!hasEvidence && research.provenance === "live" ? (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
          <FileText
            className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <p className="text-[10px] leading-relaxed text-pretty text-muted-foreground">
            The engine answered for {symbol} but holds no insider line or signal
            for it. Nothing is shown rather than a placeholder figure, because a
            zero here would read as &ldquo;no insider bought&rdquo; when it only
            means &ldquo;nothing is stored&rdquo;.
          </p>
        </div>
      ) : null}

      <div className="flex items-start gap-2 rounded-lg border border-border bg-surface/60 px-3 py-2.5">
        <ShieldCheck
          className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
          aria-hidden
        />
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Asset research is informational. Nothing on this page can place an
          order, reach a broker, change a risk limit or enable live trading, and
          no signal is ever routed to a bot automatically. Reported holdings are
          positions at a stated date, not current positions.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
        <Link
          href={`/intelligence/insiders?symbol=${encodeURIComponent(symbol)}`}
          className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
        >
          <UserRound className="size-3" aria-hidden />
          Insider Radar
        </Link>
        <Link
          href="/intelligence/institutions"
          className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
        >
          <Landmark className="size-3" aria-hidden />
          Institutional Radar
        </Link>
        <Link
          href="/intelligence/coverage"
          className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
        >
          <Building2 className="size-3" aria-hidden />
          Data coverage
        </Link>
      </div>
    </div>
  );
}
