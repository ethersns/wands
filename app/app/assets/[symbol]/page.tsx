import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AddToWatchlist } from "@/components/member/add-to-watchlist";
import { InsiderRow } from "@/components/member/insider-row";
import { SaveButton } from "@/components/member/save-button";
import { SignalRow } from "@/components/member/signal-row";
import {
  Badge,
  EmptyState,
  PageHeader,
  Panel,
  ProvenanceNote,
  StatTile,
  formatDate,
  formatShares,
  formatUsd,
  toNumber,
} from "@/components/member/ui";
import type { ResearchCoverageStatus } from "@/lib/api/research-contract";
import { memberResearch } from "@/lib/member/research";
import { isSaved } from "@/lib/member/saved";
import { requireMember } from "@/lib/member/session";
import { SYMBOL_PATTERN } from "@/lib/member/validation";

type PageProps = { params: Promise<{ symbol: string }> };

const COVERAGE_TONE: Record<ResearchCoverageStatus, "neutral" | "accent" | "warn" | "emerald"> = {
  complete: "emerald",
  partial: "accent",
  insufficient: "warn",
  unavailable: "warn",
};

function normalize(raw: string): string | null {
  const symbol = decodeURIComponent(raw).trim().toUpperCase();
  return SYMBOL_PATTERN.test(symbol) ? symbol : null;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { symbol } = await params;
  const normalized = normalize(symbol);
  return { title: normalized ? `${normalized} research` : "Asset research" };
}

export default async function AssetPage({ params }: PageProps) {
  const { symbol: rawSymbol } = await params;
  const symbol = normalize(rawSymbol);

  if (!symbol) notFound();

  const session = await requireMember(`/app/assets/${symbol}`);

  const [envelope, filings, sources, prices, saved] = await Promise.all([
    memberResearch.asset(symbol),
    memberResearch.insiders({ symbol, limit: 10 }),
    memberResearch.sources({ type: "symbol", id: symbol, symbol }),
    memberResearch.prices(symbol, 120),
    isSaved(session.user.id, "asset", symbol),
  ]);

  const research = envelope.data;
  const insider = research.insider;
  const fusion = research.fusion;
  const coverage = research.coverage;
  const institutional = research.institutional;
  const priceSeries = prices.data;
  const recentBars = priceSeries.bars.slice(-15).reverse();
  // "The engine could not be reached" and "the engine answered with nothing
  // stored" are different claims. Only the first is an outage.
  const unreachable = envelope.unreachable;
  const hasAnyData = insider.purchaseCount + insider.saleCount > 0 || research.signals.length > 0;
  const window =
    coverage.windowStart && coverage.windowEnd
      ? `${formatDate(coverage.windowStart)} to ${formatDate(coverage.windowEnd)}`
      : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Asset research"
        title={symbol}
        description={research.issuerName || "Issuer name is not available from the research engine yet."}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <AddToWatchlist symbol={symbol} />
            <SaveButton
              kind="asset"
              refId={symbol}
              symbol={symbol}
              title={`${symbol} research snapshot`}
              summary={`${insider.purchaseCount} purchases, ${insider.saleCount} sales in the last ${insider.windowDays} days`}
              payload={{
                asOf: research.asOf,
                compositeScore: fusion.compositeScore,
                coverageStatus: coverage.status,
              }}
              initialSaved={saved}
            />
          </div>
        }
      />

      {unreachable ? (
        <div className="rounded-xl border border-mk-warn/30 bg-mk-warn/10 px-4 py-3.5">
          <p className="text-sm font-medium text-mk-warn">Research engine unavailable</p>
          <p className="mt-1 text-sm leading-relaxed text-mk-warn text-pretty">
            {envelope.warnings[0] ?? "No research data could be read for this symbol."}
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-mk-muted text-pretty">
            Nothing is shown rather than a placeholder, so an empty view always means no data.
          </p>
        </div>
      ) : null}

      {!unreachable && !hasAnyData ? (
        <EmptyState
          title="No research evidence stored for this symbol"
          description="The engine answered and has no insider activity or signal stored for this ticker. This is a collection state, not a statement that nothing happened."
        />
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Purchases"
          value={insider.purchaseCount}
          hint={`${insider.distinctPurchasers} distinct buyers`}
        />
        <StatTile label="Sales" value={insider.saleCount} hint={`${insider.distinctSellers} distinct sellers`} />
        <StatTile
          label="Purchase value"
          value={formatUsd(insider.purchaseValueUsd)}
          hint={`${insider.unpricedPurchaseLines} unpriced lines`}
        />
        <StatTile
          label="Window"
          value={`${insider.windowDays}d`}
          hint={`Latest filing ${formatDate(insider.latestFilingAt)}`}
        />
      </div>

      <Panel title="Coverage" action={<Badge tone={COVERAGE_TONE[coverage.status]}>{coverage.status}</Badge>}>
        <p className="text-sm leading-relaxed text-mk-fg text-pretty">
          {coverage.symbolsCovered} of {coverage.symbolsRequested} requested symbols covered
          {window ? ` · ${window}` : " · window not reported"}
        </p>
        {coverage.gaps.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-1.5 border-t border-mk-line pt-3">
            {coverage.gaps.map((gap) => (
              <li key={gap.key} className="text-xs leading-relaxed text-mk-muted text-pretty">
                <span className="text-mk-fg">{gap.label}</span> — {gap.detail}
              </li>
            ))}
          </ul>
        ) : null}
        {coverage.caveats.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-1">
            {coverage.caveats.map((caveat) => (
              <li key={caveat} className="text-xs leading-relaxed text-mk-muted text-pretty">
                {caveat}
              </li>
            ))}
          </ul>
        ) : null}
      </Panel>

      <Panel
        title="Identifier resolution"
        action={
          research.identifierMappings.length > 0 ? (
            <Badge tone="emerald">verified</Badge>
          ) : (
            <Badge tone="warn">unresolved</Badge>
          )
        }
      >
        {research.identifierMappings.length === 0 ? (
          <p className="text-sm leading-relaxed text-mk-muted text-pretty">
            No verified CUSIP mapping covers {symbol}, so institutional filings cannot be
            attributed to it. The filings are stored; they are not shown against this asset.
          </p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {research.identifierMappings.map((mapping) => (
              <li key={`${mapping.cusip}-${mapping.effectiveFrom}`}>
                <p className="text-sm text-mk-fg">
                  <span className="font-marketing-mono">{mapping.cusip}</span>
                  <span className="text-mk-muted"> resolves to </span>
                  <span className="font-marketing-mono">{mapping.symbol}</span>
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-mk-muted text-pretty">
                  {mapping.issuerName || "Issuer not reported"} ·{" "}
                  {mapping.securityDescription || "security type not reported"} · source{" "}
                  {mapping.source} · confidence{" "}
                  {toNumber(mapping.confidence)?.toFixed(0) ?? "—"}% · effective{" "}
                  {formatDate(mapping.effectiveFrom)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title="Composite research ranking"
        action={
          fusion.compositeScore === null ? (
            <Badge tone="warn">No score</Badge>
          ) : (
            <Badge tone="accent">{fusion.compositeScore}/100</Badge>
          )
        }
      >
        <p className="text-sm leading-relaxed text-mk-fg text-pretty">{fusion.explanation}</p>
        <p className="mt-2 font-marketing-mono text-[11px] text-mk-dim">
          coverage {(fusion.coverage * 100).toFixed(0)}% · as of {formatDate(fusion.asOf)} · quality{" "}
          {fusion.dataQuality}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-mk-muted text-pretty">
          A research score is a bounded 0-100 ranking of evidence. It is not a probability, an expected return, or a
          recommendation.
        </p>

        {fusion.components.length > 0 ? (
          <ul className="mt-4 flex flex-col divide-y divide-mk-line border-t border-mk-line">
            {fusion.components.map((component) => (
              <li
                key={`${component.name}-${component.category}`}
                className="flex items-start justify-between gap-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-sm text-mk-fg">{component.name}</p>
                  <p className="text-xs leading-relaxed text-mk-muted text-pretty">{component.explanation}</p>
                </div>
                <span className="shrink-0 font-marketing-mono text-xs text-mk-muted">
                  {component.score === null ? "—" : `${component.score}/100`}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        {fusion.caveats.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-1">
            {fusion.caveats.map((caveat) => (
              <li key={caveat} className="text-xs leading-relaxed text-mk-muted">
                {caveat}
              </li>
            ))}
          </ul>
        ) : null}
      </Panel>

      <Panel title="Signals" bodyClassName="p-0">
        {research.signals.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No signals for this symbol"
              description="Signals appear once there is enough activity to measure against a baseline."
            />
          </div>
        ) : (
          <ul>
            {research.signals.map((signal) => (
              <SignalRow key={signal.id} signal={signal} />
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title="Institutional holdings"
        action={
          institutional.holdings.length > 0 ? (
            <Badge tone="accent">{institutional.institutions} institutions</Badge>
          ) : (
            <Badge tone="warn">None attributed</Badge>
          )
        }
        bodyClassName="p-0"
      >
        {institutional.holdings.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No institutional holding attributed"
              description={
                institutional.caveats[0] ??
                "No stored 13F reports a position in this security."
              }
            />
          </div>
        ) : (
          <ul className="divide-y divide-mk-line">
            {institutional.holdings.map((holding) => (
              <li
                key={`${holding.institutionCik}-${holding.periodOfReport}`}
                className="px-4 py-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm text-mk-fg">{holding.institutionName}</p>
                  <span className="font-marketing-mono text-xs tabular-nums text-mk-muted">
                    {formatUsd(toNumber(holding.valueUsd))}
                  </span>
                </div>
                <p className="mt-1 font-marketing-mono text-[11px] text-mk-dim">
                  {formatShares(holding.shares)} shares · period{" "}
                  {formatDate(holding.periodOfReport)} · public{" "}
                  {formatDate(holding.publicAvailableAt)}
                </p>
                {holding.shareChange !== null ? (
                  <p className="mt-1 text-xs leading-relaxed text-mk-muted text-pretty">
                    {toNumber(holding.shareChange)! >= 0 ? "Added" : "Reduced"}{" "}
                    {formatShares(Math.abs(toNumber(holding.shareChange) ?? 0))} shares
                    {holding.shareChangePct !== null
                      ? ` (${toNumber(holding.shareChangePct)! >= 0 ? "+" : ""}${toNumber(holding.shareChangePct)}%)`
                      : ""}{" "}
                    versus {formatDate(holding.priorPeriodOfReport)}
                  </p>
                ) : null}
                {holding.sourceUrl ? (
                  <a
                    href={holding.sourceUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="mt-1 inline-block text-xs text-mk-accent underline-offset-4 hover:underline"
                  >
                    Original 13F filing
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {institutional.holdings.length > 0 && institutional.caveats.length > 0 ? (
          <ul className="flex flex-col gap-1 border-t border-mk-line px-4 py-3">
            {institutional.caveats.map((caveat) => (
              <li key={caveat} className="text-xs leading-relaxed text-mk-muted text-pretty">
                {caveat}
              </li>
            ))}
          </ul>
        ) : null}
      </Panel>

      <Panel
        title="Daily price history"
        action={
          priceSeries.provider ? (
            <Badge tone="neutral">
              {priceSeries.provider}
              {priceSeries.adjustment ? ` · ${priceSeries.adjustment}-adjusted` : " · raw"}
            </Badge>
          ) : (
            <Badge tone="warn">No series</Badge>
          )
        }
        bodyClassName="p-0"
      >
        {recentBars.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No daily bars stored"
              description={
                prices.warnings[0] ??
                "No daily price series has been collected for this symbol, so no performance claim can be measured."
              }
            />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 p-4 lg:grid-cols-4">
              <StatTile
                label="Bars"
                value={priceSeries.coverage?.bars ?? priceSeries.bars.length}
                hint={`${priceSeries.interval} interval`}
              />
              <StatTile
                label="First bar"
                value={formatDate(priceSeries.coverage?.firstBar)}
                hint="Earliest stored session"
              />
              <StatTile
                label="Last bar"
                value={formatDate(priceSeries.coverage?.lastBar)}
                hint="Latest stored session"
              />
              <StatTile
                label="Missing"
                value={priceSeries.coverage?.missingDays ?? 0}
                hint="Expected sessions with no bar"
              />
            </div>
            <table className="w-full border-t border-mk-line text-sm">
              <caption className="sr-only">
                The most recent stored daily bars for {symbol}
              </caption>
              <thead>
                <tr className="border-b border-mk-line">
                  <th scope="col" className="px-4 py-2 text-left font-marketing-mono text-[10px] uppercase tracking-[0.12em] text-mk-dim">
                    Session
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-marketing-mono text-[10px] uppercase tracking-[0.12em] text-mk-dim">
                    Close
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-marketing-mono text-[10px] uppercase tracking-[0.12em] text-mk-dim">
                    Volume
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-mk-line">
                {recentBars.map((bar) => (
                  <tr key={bar.tradingDate}>
                    <td className="px-4 py-2 font-marketing-mono text-xs text-mk-muted">
                      {formatDate(bar.tradingDate)}
                    </td>
                    <td className="px-4 py-2 text-right font-marketing-mono text-xs tabular-nums text-mk-fg">
                      {toNumber(bar.close)?.toFixed(2) ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-right font-marketing-mono text-xs tabular-nums text-mk-muted">
                      {formatShares(bar.volume)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {priceSeries.caveats.length > 0 ? (
              <ul className="flex flex-col gap-1 border-t border-mk-line px-4 py-3">
                {priceSeries.caveats.map((caveat) => (
                  <li key={caveat} className="text-xs leading-relaxed text-mk-muted text-pretty">
                    {caveat}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </Panel>

      <Panel title="Insider filings" bodyClassName="p-0">
        {filings.data.items.length === 0 ? (
          <div className="p-4">
            {filings.unreachable ? (
              <EmptyState
                title="Research engine unreachable"
                description={
                  filings.warnings[0] ??
                  "The filing feed could not be read from the engine, so this is not a statement that no filing exists."
                }
              />
            ) : (
              <EmptyState
                title="No insider filings"
                description="No Form 4 filing is stored for this symbol. This is a collection state, not a statement that no insider filed."
              />
            )}
          </div>
        ) : (
          <ul>
            {filings.data.items.map((transaction) => (
              <InsiderRow key={transaction.id} transaction={transaction} />
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Evidence" bodyClassName="p-0">
        {sources.data.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No source documents resolved"
              description="Every claim is meant to carry a source link. None could be resolved for this symbol, so no claim is shown as sourced."
            />
          </div>
        ) : (
          <ul className="divide-y divide-mk-line">
            {sources.data.map((source) => (
              <li key={source.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-sm text-mk-fg underline-offset-4 hover:text-mk-accent hover:underline"
                  >
                    {source.label}
                  </a>
                  {source.formType ? <Badge>{source.formType}</Badge> : null}
                  <span className="font-marketing-mono text-[10px] uppercase tracking-[0.12em] text-mk-dim">
                    public {formatDate(source.publicAvailableAt)}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-mk-muted text-pretty">{source.supports}</p>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <ProvenanceNote
        provenance={envelope.provenance}
        generatedAt={envelope.generatedAt}
        warnings={[...envelope.warnings, ...research.caveats, ...insider.caveats].slice(0, 3)}
        unreachable={envelope.unreachable}
      />
    </div>
  );
}
