"use client";

import * as React from "react";
import useSWR from "swr";
import { RefreshCw, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionCard } from "@/components/shared/section-card";
import type { MarketPulseMarket } from "@/lib/api/opportunity";
import {
  getMarketsForCategory,
  MARKET_PULSE_CATEGORIES,
  sortMarketPulseMarkets,
  type MarketPulseCategoryId,
  type MarketPulseSort,
} from "@/lib/opportunity/market-pulse";
import { readMarketPulseAction } from "@/lib/opportunity/scan-actions";

const DISPLAY_LIMIT = 50;
const COMPARE_LIMIT = 4;

function number(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function usd(value: string | null): string {
  const parsed = number(value);
  if (parsed === null) return "Unavailable";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(parsed);
}

function percent(value: string | null): string {
  const parsed = number(value);
  if (parsed === null) return "Unavailable";
  return `${parsed > 0 ? "+" : ""}${parsed.toFixed(2)}%`;
}

function price(value: string | null): string {
  const parsed = number(value);
  if (parsed === null) return "Unavailable";
  return new Intl.NumberFormat("en-US", { maximumSignificantDigits: 10 }).format(parsed);
}

function movementClass(value: string | null): string {
  const parsed = number(value);
  if (parsed === null || parsed === 0) return "text-muted-foreground";
  return parsed > 0 ? "text-profit" : "text-loss";
}

function localTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString("en-US");
}

function MarketRow({
  market,
  expanded,
  compared,
  compareDisabled,
  asOf,
  minimumTurnoverUsd,
  maxSpreadPct,
  onExpand,
  onCompare,
}: {
  market: MarketPulseMarket;
  expanded: boolean;
  compared: boolean;
  compareDisabled: boolean;
  asOf: string;
  minimumTurnoverUsd: string;
  maxSpreadPct: string;
  onExpand: () => void;
  onCompare: (checked: boolean) => void;
}) {
  const turnover = number(market.turnover24hUsd);
  const spread = number(market.spreadPct);
  const belowFloor = turnover !== null && turnover < Number(minimumTurnoverUsd);
  const riskNotes = [
    belowFloor ? `24h USD turnover is below the $${Number(minimumTurnoverUsd).toLocaleString("en-US")} scanner floor; research only.` : null,
    spread !== null && spread > Number(maxSpreadPct) ? `Quoted spread is wider than the ${maxSpreadPct}% scanner limit.` : null,
    !market.tickerAvailable ? "Kraken did not return a ticker for this market; measurements are unavailable." : null,
    market.spreadPct === null ? "Quoted spread is unavailable, so execution cost cannot be assessed." : null,
    ...market.warnings,
  ].filter((item): item is string => item !== null);

  return (
    <>
      <tr className="border-b border-border align-middle last:border-0">
        <td className="px-3 py-3">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={compared}
              disabled={!compared && compareDisabled}
              onChange={(event) => onCompare(event.target.checked)}
              aria-label={`Add ${market.symbol} to comparison`}
              className="size-4 accent-primary"
            />
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={`market-details-${market.symbol.replaceAll("/", "-")}`}
              onClick={onExpand}
              className="flex min-w-0 flex-col items-start text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="font-mono font-medium text-foreground">{market.symbol}</span>
              <span className="text-sm text-muted-foreground">{price(market.lastPrice)} USD</span>
            </button>
          </div>
        </td>
        <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-sm text-foreground">{usd(market.turnover24hUsd)}</td>
        <td className={`whitespace-nowrap px-3 py-3 text-right font-mono text-sm ${movementClass(market.dayChangePct)}`}>{percent(market.dayChangePct)}</td>
        <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-sm text-foreground">{percent(market.range24hPct)}</td>
        <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-sm text-foreground">{percent(market.spreadPct)}</td>
      </tr>
      {expanded ? (
        <tr id={`market-details-${market.symbol.replaceAll("/", "-")}`} className="border-b border-border bg-muted/30">
          <td colSpan={5} className="px-4 py-4">
            <div className="flex flex-col gap-4">
              <dl className="grid gap-x-5 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div><dt className="text-sm text-muted-foreground">24h base volume</dt><dd className="font-mono text-foreground">{market.baseVolume24h ?? "Unavailable"}</dd></div>
                <div><dt className="text-sm text-muted-foreground">24h VWAP</dt><dd className="font-mono text-foreground">{usd(market.vwap24h)}</dd></div>
                <div><dt className="text-sm text-muted-foreground">24h high / low</dt><dd className="font-mono text-foreground">{price(market.high24h)} / {price(market.low24h)}</dd></div>
                <div><dt className="text-sm text-muted-foreground">Change from Kraken&apos;s UTC day open</dt><dd className={`font-mono ${movementClass(market.dayChangePct)}`}>{percent(market.dayChangePct)}{market.dayOpen ? ` · open ${price(market.dayOpen)}` : ""}</dd></div>
                <div><dt className="text-sm text-muted-foreground">Best bid / ask</dt><dd className="font-mono text-foreground">{price(market.bid)} / {price(market.ask)}</dd></div>
                <div><dt className="text-sm text-muted-foreground">24h range proxy</dt><dd className="font-mono text-foreground">{percent(market.range24hPct)} · high-low relative to midpoint</dd></div>
                <div><dt className="text-sm text-muted-foreground">Snapshot time</dt><dd className="text-foreground">{localTime(asOf)} ({market.provider})</dd></div>
                <div><dt className="text-sm text-muted-foreground">Market status</dt><dd className="text-foreground">{market.status}</dd></div>
              </dl>
              {riskNotes.length > 0 ? (
                <ul className="flex flex-col gap-1" aria-label={`${market.symbol} risk warnings`}>
                  {riskNotes.map((note) => <li key={note} className="flex items-start gap-2 text-sm text-muted-foreground"><span aria-hidden>•</span><span>{note}</span></li>)}
                </ul>
              ) : <p className="text-sm text-muted-foreground">Ticker liquidity and quoted spread meet the scanner&apos;s current market-data filters. This is not a strategy-qualified setup.</p>}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

export function MarketPulsePanel() {
  const [category, setCategory] = React.useState<MarketPulseCategoryId>("highlights");
  const [sort, setSort] = React.useState<MarketPulseSort>("interest");
  const [search, setSearch] = React.useState("");
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [compared, setCompared] = React.useState<string[]>([]);
  const [visibleLimit, setVisibleLimit] = React.useState(DISPLAY_LIMIT);
  const { data, error, isLoading, isValidating, mutate } = useSWR(
    "opportunity-market-pulse",
    readMarketPulseAction,
    { refreshInterval: 60_000, revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const selectedCategory = MARKET_PULSE_CATEGORIES.find((item) => item.id === category)!;
  const rows = React.useMemo(() => {
    if (!data) return [];
    const query = search.trim().toLocaleLowerCase();
    const categoryMarkets = query
      ? data.markets
      : getMarketsForCategory(data.markets, category, data.minimumTurnoverUsd, data.maxSpreadPct);
    const filtered = query
      ? categoryMarkets.filter((market) => market.symbol.toLocaleLowerCase().includes(query))
      : categoryMarkets;
    return sortMarketPulseMarkets(filtered, sort);
  }, [data, category, search, sort]);

  const categoryCounts = React.useMemo(() => {
    if (!data) return new Map<MarketPulseCategoryId, number>();
    return new Map(MARKET_PULSE_CATEGORIES.map((item) => [
      item.id,
      getMarketsForCategory(data.markets, item.id, data.minimumTurnoverUsd, data.maxSpreadPct).length,
    ]));
  }, [data]);

  const visibleMarkets = rows.slice(0, visibleLimit);
  const marketsBySymbol = new Map((data?.markets ?? []).map((market) => [market.symbol, market]));
  const comparison = compared.map((symbol) => marketsBySymbol.get(symbol)).filter((market): market is MarketPulseMarket => Boolean(market));
  const turnoverValues = (data?.markets ?? [])
    .map((market) => number(market.turnover24hUsd))
    .filter((value): value is number => value !== null);
  const turnoverCoverage = turnoverValues.length;
  const reportedTurnover = turnoverValues.length
    ? turnoverValues.reduce((total, value) => total + value, 0)
    : null;
  const advances = data?.markets.filter((market) => {
    const move = number(market.dayChangePct);
    return move !== null && move > 0;
  }).length ?? 0;
  const declines = data?.markets.filter((market) => {
    const move = number(market.dayChangePct);
    return move !== null && move < 0;
  }).length ?? 0;

  function selectCategory(next: MarketPulseCategoryId) {
    setCategory(next);
    setVisibleLimit(DISPLAY_LIMIT);
    setExpanded(null);
  }

  function toggleCompare(symbol: string, checked: boolean) {
    setCompared((current) => {
      if (!checked) return current.filter((item) => item !== symbol);
      if (current.length >= COMPARE_LIMIT) return current;
      return [...current, symbol];
    });
  }

  return (
    <SectionCard
      title="Market Pulse"
      description="Market interest and qualified trading setups are separate. This view ranks verified Kraken USD spot measurements; it does not place trades."
      action={(
        <Button size="sm" variant="outline" onClick={() => void mutate()} disabled={isLoading || isValidating}>
          <RefreshCw data-icon="inline-start" aria-hidden className={isValidating ? "animate-spin" : undefined} />
          Refresh snapshot
        </Button>
      )}
    >
      {error ? (
        <p role="alert" className="text-sm text-loss">Market snapshot unavailable: {error.message}. No substitute or social-popularity data is shown.</p>
      ) : isLoading ? (
        <p role="status" className="text-sm text-muted-foreground">Loading the Kraken USD market snapshot…</p>
      ) : data ? (
        <div className="flex flex-col gap-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="flex flex-col gap-1 rounded-md border border-border bg-muted/30 p-3"><span className="text-sm text-muted-foreground">Active Kraken USD markets</span><strong className="font-mono text-lg text-foreground">{data.activeMarkets.toLocaleString("en-US")}</strong></div>
            <div className="flex flex-col gap-1 rounded-md border border-border bg-muted/30 p-3"><span className="text-sm text-muted-foreground">Reported 24h USD turnover</span><strong className="font-mono text-lg text-foreground">{usd(reportedTurnover === null ? null : String(reportedTurnover))}</strong><span className="text-sm text-muted-foreground">{turnoverCoverage} / {data.markets.length} markets · missing values excluded</span></div>
            <div className="flex flex-col gap-1 rounded-md border border-border bg-muted/30 p-3"><span className="text-sm text-muted-foreground">Markets above / below UTC open</span><strong className="font-mono text-lg text-foreground">{advances} / {declines}</strong></div>
            <div className="flex flex-col gap-1 rounded-md border border-border bg-muted/30 p-3"><span className="text-sm text-muted-foreground">Snapshot freshness</span><strong className="text-sm text-foreground">{localTime(data.asOf)}</strong><span className="text-sm text-muted-foreground">Kraken {data.timestampSource === "provider" ? "response timestamp" : "receipt time"}</span></div>
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <label className="flex w-full flex-col gap-1 text-sm text-muted-foreground sm:max-w-sm" htmlFor="market-pulse-search">
                Search supported USD markets
                <span className="relative">
                  <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input id="market-pulse-search" value={search} onChange={(event) => { setSearch(event.target.value); setVisibleLimit(DISPLAY_LIMIT); }} placeholder="Search BTC/USD, SOL/USD…" className="pl-9" />
                </span>
              </label>
              <label className="flex flex-col gap-1 text-sm text-muted-foreground" htmlFor="market-pulse-sort">
                Sort by
                <select id="market-pulse-sort" value={sort} onChange={(event) => setSort(event.target.value as MarketPulseSort)} className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <option value="interest">Highlights heuristic</option>
                  <option value="turnover">24h USD turnover</option>
                  <option value="day-move">Move from UTC open</option>
                  <option value="range">24h high-low range</option>
                  <option value="spread">Quoted spread</option>
                </select>
              </label>
            </div>

            <div className="flex flex-wrap gap-2" role="group" aria-label="Market discovery categories">
              {MARKET_PULSE_CATEGORIES.map((item) => {
                const unavailable = Boolean(item.unavailableReason);
                return (
                  <Button
                    key={item.id}
                    type="button"
                    size="sm"
                    variant={category === item.id ? "default" : "outline"}
                    aria-pressed={category === item.id}
                    aria-label={unavailable ? `${item.label}, insufficient data` : `${item.label}, ${categoryCounts.get(item.id) ?? 0} markets`}
                    onClick={() => selectCategory(item.id)}
                  >
                    {item.label}
                    {unavailable ? <Badge variant="muted">Unavailable</Badge> : <span className="font-mono text-sm opacity-80">{categoryCounts.get(item.id) ?? 0}</span>}
                  </Button>
                );
              })}
            </div>
          </div>

          <div className="rounded-md border border-border bg-muted/20 p-3 text-sm leading-relaxed text-muted-foreground">
            {search.trim() ? (
              <p><strong className="font-medium text-foreground">Full-catalog search — </strong>search applies across every supported market in this snapshot, independent of the selected category.</p>
            ) : selectedCategory.unavailableReason ? (
              <p><strong className="font-medium text-foreground">Insufficient data — </strong>{selectedCategory.unavailableReason} The current request uses one Kraken AssetPairs catalogue and one public Ticker snapshot; candle-dependent categories stay unavailable rather than being guessed.</p>
            ) : category === "highlights" ? (
              <p><strong className="font-medium text-foreground">Highlights heuristic — </strong>deterministic rank combination of 24h USD turnover, absolute move from Kraken&apos;s UTC day open, 24h high-low range and quoted spread. A ranking is not a probability or a profitability claim.</p>
            ) : category === "trending" ? (
              <p><strong className="font-medium text-foreground">Trending — </strong>top-quartile combination of rolling 24h USD turnover rank and 24h high-low range rank. This is snapshot activity, not a historical volume surge or social-media attention.</p>
            ) : category === "wildcards" || category === "high-risk" || category === "high-potential-movement" ? (
              <p><strong className="font-medium text-foreground">Research warning — </strong>the 24h high-low range is a movement proxy, not a forecast. Wildcards are below the existing scanner&apos;s USD-turnover floor and are not qualified for a trading setup.</p>
            ) : category === "lower-volatility" ? (
              <p><strong className="font-medium text-foreground">Relative range only — </strong>these markets have the lowest measured 24h high-low range proxies in this snapshot. This is not a volatility model and does not mean low risk or risk-free.</p>
            ) : category === "strong-liquidity" ? (
              <p>Requires at least {usd(data.minimumTurnoverUsd)} in verified 24h USD turnover and a quoted spread within {data.maxSpreadPct}%. This market filter alone does not qualify a strategy setup.</p>
            ) : category === "low-spread" ? (
              <p>Lowest quartile of available current bid-ask spreads in this snapshot. Spread is a quote comparison, not a guarantee of execution price.</p>
            ) : category === "bearish-watch" ? (
              <p>Markets below Kraken&apos;s UTC day open, sorted by measured change. This is not an automatic short-selling recommendation.</p>
            ) : category === "top-movers" ? (
              <p>Sorted by the absolute change from Kraken&apos;s UTC day open. Kraken&apos;s ticker open is not labelled as a rolling 24-hour open.</p>
            ) : category === "popular" ? (
              <p>Popular means highest verified rolling-24h USD turnover from Kraken volume multiplied by 24h VWAP; it does not mean social popularity.</p>
            ) : (
              <p>Measured from the current Kraken public market snapshot. Missing values are shown as unavailable, never as zero.</p>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
            <span>{rows.length.toLocaleString("en-US")} markets match · {data.source}</span>
            <span>{compared.length} / {COMPARE_LIMIT} selected to compare</span>
          </div>

          {rows.length > 0 ? (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[760px] border-collapse text-left">
                <caption className="sr-only">Kraken USD spot market measurements for {selectedCategory.label}</caption>
                <thead className="bg-muted/50 text-sm text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">Market</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">24h USD turnover</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Move from UTC open</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">24h range</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Spread</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleMarkets.map((market) => (
                    <MarketRow
                      key={market.symbol}
                      market={market}
                      expanded={expanded === market.symbol}
                      compared={compared.includes(market.symbol)}
                      compareDisabled={compared.length >= COMPARE_LIMIT}
                      asOf={data.asOf}
                      minimumTurnoverUsd={data.minimumTurnoverUsd}
                      maxSpreadPct={data.maxSpreadPct}
                      onExpand={() => setExpanded((current) => current === market.symbol ? null : market.symbol)}
                      onCompare={(checked) => toggleCompare(market.symbol, checked)}
                    />
                  ))}
                </tbody>
              </table>
              {rows.length > visibleMarkets.length ? (
                <div className="border-t border-border p-3 text-center">
                  <Button variant="outline" size="sm" onClick={() => setVisibleLimit((current) => current + DISPLAY_LIMIT)}>
                    Show next {Math.min(DISPLAY_LIMIT, rows.length - visibleMarkets.length)} markets
                  </Button>
                </div>
              ) : null}
            </div>
          ) : (
            <p role="status" className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              {selectedCategory.unavailableReason ? "No verified measurements are available for this category." : search ? `No supported market matches “${search}” in ${selectedCategory.label}.` : `No markets currently meet the ${selectedCategory.label} measurement.`}
            </p>
          )}

          {comparison.length > 0 ? (
            <section aria-labelledby="market-comparison-heading" className="flex flex-col gap-3 rounded-md border border-border p-4">
              <div className="flex items-center justify-between gap-3">
                <div><h3 id="market-comparison-heading" className="text-sm font-medium text-foreground">Compare markets</h3><p className="text-sm text-muted-foreground">Side-by-side measurements only; no setup or trade is implied.</p></div>
                <Button variant="ghost" size="sm" onClick={() => setCompared([])}>Clear</Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {comparison.map((market) => (
                  <article key={market.symbol} className="flex flex-col gap-2 rounded-md bg-muted/30 p-3">
                    <div className="flex items-center justify-between gap-2"><h4 className="font-mono text-sm font-medium text-foreground">{market.symbol}</h4><button type="button" onClick={() => toggleCompare(market.symbol, false)} aria-label={`Remove ${market.symbol} from comparison`} className="text-sm text-muted-foreground underline underline-offset-4">Remove</button></div>
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm"><dt className="text-muted-foreground">Turnover</dt><dd className="text-right font-mono text-foreground">{usd(market.turnover24hUsd)}</dd><dt className="text-muted-foreground">UTC move</dt><dd className={`text-right font-mono ${movementClass(market.dayChangePct)}`}>{percent(market.dayChangePct)}</dd><dt className="text-muted-foreground">24h range</dt><dd className="text-right font-mono text-foreground">{percent(market.range24hPct)}</dd><dt className="text-muted-foreground">Spread</dt><dd className="text-right font-mono text-foreground">{percent(market.spreadPct)}</dd></dl>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          <p className="text-sm leading-relaxed text-muted-foreground">
            Source: {data.source}. Snapshot timestamp: {localTime(data.asOf)} ({data.timestampSource === "provider" ? "Kraken HTTP response Date header" : "local receipt time; Kraken supplied no response timestamp"}). Turnover and quote metrics may be unavailable per market. Social/search attention, candle-derived momentum, volume surges and strategy qualification are not inferred by this snapshot.
          </p>
        </div>
      ) : null}
    </SectionCard>
  );
}
