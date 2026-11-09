import { AddToWatchlist } from "@/components/member/add-to-watchlist";
import { Badge, PageHeader, Panel } from "@/components/member/ui";

/**
 * A crypto pair has no SEC evidence, so it gets its own view.
 *
 * The alternative — running the equity research lookup and rendering whatever
 * comes back — would report an empty insider panel for `BTC/USD`, which reads
 * as "no insider bought this" rather than "insider filings do not describe
 * this instrument". The gap is stated instead of filled.
 */
export function CryptoAssetView({ symbol }: { symbol: string }) {
  const [base, quote] = symbol.split("/");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Crypto asset"
        title={symbol}
        description={`${base} priced in ${quote}.`}
        actions={<AddToWatchlist symbol={symbol} marketType="crypto" />}
      />

      <Panel title="Research coverage" action={<Badge tone="warn">Not covered</Badge>}>
        <p className="text-sm leading-relaxed text-mk-fg text-pretty">
          The research engine covers SEC equity filings: Form 4 insider transactions, 13F
          institutional holdings and CUSIP identifier resolution. None of those describe a crypto
          pair, so there is no insider, institutional or signal evidence to report for {symbol}.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-mk-muted text-pretty">
          Nothing is rendered in their place. An empty panel on this page means the evidence does
          not exist for this market, not that it was collected and found empty.
        </p>
      </Panel>

      <Panel title="Market data" action={<Badge tone="warn">Unavailable</Badge>}>
        <p className="text-sm leading-relaxed text-mk-fg text-pretty">
          No price series is published for {symbol} on this surface, so no price, return or
          performance figure is shown.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-mk-muted text-pretty">
          The engine can serve crypto candles, but the member research contract does not expose
          them yet. Until it does, this page reports the gap rather than a placeholder.
        </p>
      </Panel>
    </div>
  );
}
