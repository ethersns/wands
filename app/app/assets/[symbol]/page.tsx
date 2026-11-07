import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AddToWatchlist } from "@/components/member/add-to-watchlist";
import { InsiderRow } from "@/components/member/insider-row";
import { SaveButton } from "@/components/member/save-button";
import { SignalRow } from "@/components/member/signal-row";
import { Badge, EmptyState, PageHeader, Panel, ProvenanceNote, StatTile, formatDate, formatUsd } from "@/components/member/ui";
import { memberResearch } from "@/lib/member/research";
import { requireMember } from "@/lib/member/session";
import { SYMBOL_PATTERN } from "@/lib/member/validation";

type PageProps = { params: Promise<{ symbol: string }> };

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

  await requireMember(`/app/assets/${symbol}`);

  const [summary, filings] = await Promise.all([
    memberResearch.symbol(symbol),
    memberResearch.insiderFeed({ symbol, limit: 10 }),
  ]);

  const research = summary.data;
  const insider = research.insider;
  const fusion = research.fusion;
  const hasAnyData = insider.purchaseCount + insider.saleCount > 0 || research.signals.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Asset research"
        title={symbol}
        description={insider.issuerName || "Issuer name is not available from the research engine yet."}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <AddToWatchlist symbol={symbol} />
            <SaveButton
              kind="asset"
              refId={symbol}
              symbol={symbol}
              title={`${symbol} research snapshot`}
              summary={`${insider.purchaseCount} purchases, ${insider.saleCount} sales in the last ${insider.windowDays} days`}
              payload={{ asOf: research.asOf, compositeScore: fusion.compositeScore }}
            />
          </div>
        }
      />

      {!hasAnyData ? (
        <EmptyState
          title="No research published for this symbol yet"
          description="The engine has not published insider activity or signals for this ticker. Nothing is shown rather than a placeholder, so an empty view always means no data."
        />
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Purchases" value={insider.purchaseCount} hint={`${insider.distinctPurchasers} distinct buyers`} />
        <StatTile label="Sales" value={insider.saleCount} hint={`${insider.distinctSellers} distinct sellers`} />
        <StatTile label="Purchase value" value={formatUsd(insider.purchaseValueUsd)} hint={`${insider.unpricedPurchaseLines} unpriced lines`} />
        <StatTile label="Window" value={`${insider.windowDays}d`} hint={`Latest filing ${formatDate(insider.latestFilingAt)}`} />
      </div>

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
          coverage {(fusion.coverage * 100).toFixed(0)}% · as of {formatDate(fusion.asOf)} · quality {fusion.dataQuality}
        </p>

        {fusion.components.length > 0 ? (
          <ul className="mt-4 flex flex-col divide-y divide-mk-line border-t border-mk-line">
            {fusion.components.map((component) => (
              <li key={`${component.name}-${component.category}`} className="flex items-start justify-between gap-3 py-2.5">
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
            <EmptyState title="No signals for this symbol" description="Signals appear once there is enough activity to measure against a baseline." />
          </div>
        ) : (
          <ul>
            {research.signals.map((signal) => (
              <SignalRow key={signal.id} signal={signal} />
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Insider filings" bodyClassName="p-0">
        {filings.data.items.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No insider filings" description="No Form 4 filings have been published for this symbol." />
          </div>
        ) : (
          <ul>
            {filings.data.items.map((transaction) => (
              <InsiderRow key={transaction.id} transaction={transaction} />
            ))}
          </ul>
        )}
      </Panel>

      <ProvenanceNote
        provenance={summary.provenance}
        generatedAt={summary.generatedAt}
        warnings={[...summary.warnings, ...research.caveats, ...insider.caveats].slice(0, 3)}
      />
    </div>
  );
}
