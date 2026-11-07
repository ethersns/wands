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
  formatUsd,
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

  const [envelope, filings, sources, saved] = await Promise.all([
    memberResearch.asset(symbol),
    memberResearch.insiders({ symbol, limit: 10 }),
    memberResearch.sources({ type: "symbol", id: symbol, symbol }),
    isSaved(session.user.id, "asset", symbol),
  ]);

  const research = envelope.data;
  const insider = research.insider;
  const fusion = research.fusion;
  const coverage = research.coverage;
  const unavailable = envelope.provenance === "unavailable";
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

      {unavailable ? (
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

      {!unavailable && !hasAnyData ? (
        <EmptyState
          title="No research published for this symbol yet"
          description="The engine has not published insider activity or signals for this ticker. Nothing is shown rather than a placeholder, so an empty view always means no data."
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

      <Panel title="Insider filings" bodyClassName="p-0">
        {filings.data.items.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No insider filings"
              description="No Form 4 filings have been published for this symbol."
            />
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
      />
    </div>
  );
}
