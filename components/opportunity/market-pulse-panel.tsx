"use client";

import * as React from "react";
import Link from "next/link";
import useSWR from "swr";
import { ChevronDown, RefreshCw, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionCard } from "@/components/shared/section-card";
import { AddToWatchlist } from "@/components/member/add-to-watchlist";
import type { MarketPulseMarket } from "@/lib/api/opportunity";
import {
  getMarketsForCategory,
  MARKET_PULSE_CATEGORIES,
  sortMarketPulseMarkets,
  type MarketPulseCategoryId,
  type MarketPulseSort,
} from "@/lib/opportunity/market-pulse";
import { readMarketPulseAction } from "@/lib/opportunity/scan-actions";
import { assetHref } from "@/lib/member/links";

const DISPLAY_LIMIT = 50;
const COMPARE_LIMIT = 4;

const CATEGORY_GROUPS: { label: string; ids: MarketPulseCategoryId[] }[] = [
  { label: "Market", ids: ["all", "highlights", "trending", "popular", "top-movers", "strong-liquidity", "low-spread"] },
  { label: "Speculative", ids: ["high-risk", "wildcards", "lower-volatility", "bearish-watch"] },
];
const ADVANCED_CATEGORY_IDS: MarketPulseCategoryId[] = [
  "volume-surges", "momentum", "breakout-watch", "reversal-watch", "short-term",
  "swing", "longer-term", "social-buzz", "search-trending",
];

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
  highRange,
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
  highRange: boolean;
  onExpand: () => void;
  onCompare: (checked: boolean) => void;
}) {
  const turnover = number(market.turnover24hUsd);
  const spread = number(market.spreadPct);
  const belowFloor = turnover !== null && turnover < Number(minimumTurnoverUsd);
  const dayMove = number(market.dayChangePct);
  const riskNotes = [
    turnover === null ? "24h USD turnover is unavailable." : belowFloor ? `24h USD turnover is below the $${Number(minimumTurnoverUsd).toLocaleString("en-US")} scanner floor; research only.` : null,
    spread === null ? "Quoted spread is unavailable, so execution cost cannot be assessed." : spread > Number(maxSpreadPct) ? `Quoted spread is wider than the ${maxSpreadPct}% scanner limit.` : null,
    dayMove !== null && dayMove < 0 ? `Price is ${percent(market.dayChangePct)} from Kraken's UTC day open; this is a measured move, not a forecast.` : null,
    highRange ? "This market's 24h high-low range is in the highest quartile of this snapshot; relative range is not a forecast." : null,
    !market.tickerAvailable ? "Kraken did not return a ticker for this market; measurements are unavailable." : null,
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
          {turnover === null || spread === null || belowFloor || (spread !== null && spread > Number(maxSpreadPct)) || !market.tickerAvailable || (dayMove !== null && dayMove < 0) || highRange ? (
            <div className="mt-2 flex flex-wrap gap-1.5" aria-label={`${market.symbol} measured risk indicators`}>
              {!market.tickerAvailable ? <Badge variant="muted" className="border-warning/30 bg-warning/10 text-warning">Ticker unavailable</Badge> : null}
              {turnover === null ? <Badge variant="muted" className="border-warning/30 bg-warning/10 text-warning">Turnover unavailable</Badge> : belowFloor ? <Badge variant="muted" className="border-warning/30 bg-warning/10 text-warning">Thin liquidity</Badge> : null}
              {spread === null ? <Badge variant="muted" className="border-warning/30 bg-warning/10 text-warning">Spread unavailable</Badge> : spread > Number(maxSpreadPct) ? <Badge variant="muted" className="border-warning/30 bg-warning/10 text-warning">Wide spread</Badge> : null}
              {dayMove !== null && dayMove < 0 ? <Badge variant="muted" className="border-loss/30 bg-loss/10 text-loss">Downward move</Badge> : null}
              {highRange ? <Badge variant="muted" className="border-warning/30 bg-warning/10 text-warning">High range</Badge> : null}
            </div>
          ) : null}
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
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
                <p className="text-sm text-muted-foreground">Research and watchlist actions do not place an order.</p>
                <div className="flex flex-wrap items-center gap-3">
                  <Link
                    href={assetHref(market.symbol)}
                    className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Open asset research
                  </Link>
                  <AddToWatchlist
                    symbol={market.symbol}
                    marketType={market.symbol.includes("/") ? "crypto" : "stocks"}
                  />
                </div>
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

export function MarketPulsePanel() {
  const [category, setCategory] = React.useState<MarketPulseCategoryId>("highlights");
  const [sortOverride, setSortOverride] = React.useState<MarketPulseSort | null>(null);
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
    if (sortOverride) return sortMarketPulseMarkets(filtered, sortOverride);
    return query ? sortMarketPulseMarkets(filtered, "interest") : filtered;
  }, [data, category, search, sortOverride]);

  const categoryCounts = React.useMemo(() => {
    if (!data) return new Map<MarketPulseCategoryId, number>();
    return new Map(MARKET_PULSE_CATEGORIES.map((item) => [
      item.id,
      getMarketsForCategory(data.markets, item.id, data.minimumTurnoverUsd, data.maxSpreadPct).length,
    ]));
  }, [data]);

  const visibleMarkets = rows.slice(0, visibleLimit);
  const highRangeSymbols = new Set(data
    ? getMarketsForCategory(data.markets, "high-risk", data.minimumTurnoverUsd, data.maxSpreadPct)
        .map((market) => market.symbol)
    : []);
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
    setSortOverride(null);
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
        <div className="flex flex-wrap items-center justify-end gap-3">
          {data ? (
            <span className="text-sm text-muted-foreground" aria-live="polite">
              Snapshot {localTime(data.asOf)} · Kraken {data.timestampSource === "provider" ? "timestamp" : "receipt time"}
            </span>
          ) : null}
          <Button size="sm" variant="outline" onClick={() => void mutate()} disabled={isLoading || isValidating} aria-label="Refresh Kraken market snapshot">
            <RefreshCw data-icon="inline-start" aria-hidden className={isValidating ? "animate-spin" : undefined} />
            Refresh
          </Button>
        </div>
      )}
    >
      {error ? (
        <p role="alert" className="text-sm text-loss">Market snapshot unavailable: {error.message}. No substitute or social-popularity data is shown.</p>
      ) : isLoading ? (
        <p role="status" className="text-sm text-muted-foreground">Loading the Kraken USD market snapshot…</p>
      ) : data ? (
        <div className="flex flex-col gap-5">
          <label className="flex w-full flex-col gap-1 text-sm text-muted-foreground sm:max-w-lg" htmlFor="market-pulse-search">
            Search supported USD markets
            <span className="relative">
              <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="market-pulse-search" value={search} onChange={(event) => { setSearch(event.target.value); setVisibleLimit(DISPLAY_LIMIT); }} placeholder="Search BTC/USD, SOL/USD…" className="pl-9" />
            </span>
          </label>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1 rounded-md border border-border bg-muted/30 p-3"><span className="text-sm text-muted-foreground">Active Kraken USD markets</span><strong className="font-mono text-lg text-foreground">{data.activeMarkets.toLocaleString("en-US")}</strong></div>
            <div className="flex flex-col gap-1 rounded-md border border-border bg-muted/30 p-3"><span className="text-sm text-muted-foreground">Verified 24h USD turnover</span><strong className="font-mono text-lg text-foreground">{usd(reportedTurnover === null ? null : String(reportedTurnover))}</strong><span className="text-sm text-muted-foreground">{turnoverCoverage} / {data.markets.length} markets · missing values excluded</span></div>
            <div className="flex flex-col gap-1 rounded-md border border-border bg-muted/30 p-3"><span className="text-sm text-muted-foreground">Market breadth · UTC open</span><strong className="font-mono text-lg"><span className="text-profit">{advances} up</span><span className="text-muted-foreground"> / </span><span className="text-loss">{declines} down</span></strong><span className="text-sm text-muted-foreground">{advances + declines} measured moves</span></div>
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <label className="flex flex-col gap-1 text-sm text-muted-foreground" htmlFor="market-pulse-sort">
                Rank by
                <select id="market-pulse-sort" value={sortOverride ?? "category"} onChange={(event) => setSortOverride(event.target.value === "category" ? null : event.target.value as MarketPulseSort)} className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <option value="category">Category default</option>
                  <option value="interest">Highlights heuristic</option>
                  <option value="turnover">24h USD turnover</option>
                  <option value="day-move">Move from UTC open</option>
                  <option value="range">24h high-low range</option>
                  <option value="spread">Quoted spread</option>
                </select>
              </label>
            </div>

            <div className="flex flex-col gap-3">
              {CATEGORY_GROUPS.map((group) => (
                <section key={group.label} className="flex flex-col gap-2">
                  <h3 className="font-mono text-sm font-medium uppercase tracking-wide text-muted-foreground">{group.label}</h3>
                  <div className="flex flex-wrap gap-2" role="group" aria-label={`${group.label} discovery categories`}>
                    {group.ids.map((id) => {
                      const item = MARKET_PULSE_CATEGORIES.find((candidate) => candidate.id === id);
                      if (!item) return null;
                      return (
                        <Button
                          key={item.id}
                          type="button"
                          size="sm"
                          variant={category === item.id ? "default" : "outline"}
                          aria-pressed={category === item.id}
                          aria-label={`${item.label}, ${categoryCounts.get(item.id) ?? 0} markets`}
                          onClick={() => selectCategory(item.id)}
                        >
                          {item.label}
                          <span className="font-mono text-sm opacity-80">{categoryCounts.get(item.id) ?? 0}</span>
                        </Button>
                      );
                    })}
                  </div>
                </section>
              ))}
              <details className="rounded-md border border-border bg-muted/20 px-3 py-2" open={ADVANCED_CATEGORY_IDS.includes(category)}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span>Other indicators / Not yet available ({ADVANCED_CATEGORY_IDS.length})</span>
                  <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </summary>
                <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Not yet available indicators">
                  {ADVANCED_CATEGORY_IDS.map((id) => {
                    const item = MARKET_PULSE_CATEGORIES.find((candidate) => candidate.id === id);
                    if (!item) return null;
                    return (
                      <Button
                        key={item.id}
                        type="button"
                        size="sm"
                        variant={category === item.id ? "default" : "outline"}
                        aria-pressed={category === item.id}
                        aria-label={`${item.label}, not yet available`}
                        onClick={() => selectCategory(item.id)}
                      >
                        {item.label}
                        <Badge variant="muted">Unavailable</Badge>
                      </Button>
                    );
                  })}
                </div>
              </details>
            </div>
          </div>

          <div className="rounded-md border border-border bg-muted/20 p-3 text-sm leading-relaxed text-muted-foreground">
            {search.trim() ? (
              <p><strong className="font-medium text-foreground">Full-catalog search — </strong>search spans all supported markets in this snapshot, independent of category.</p>
            ) : selectedCategory.unavailableReason ? (
              <p><strong className="font-medium text-foreground">Not yet available — </strong>{selectedCategory.unavailableReason} No substitute data is inferred.</p>
            ) : category === "highlights" ? (
              <p><strong className="font-medium text-foreground">Highlights — </strong>combines turnover, move from UTC open, 24h range and quoted spread. It is a market-interest ranking, not a trading signal.</p>
            ) : category === "trending" ? (
              <p><strong className="font-medium text-foreground">High Activity — </strong>combines rolling 24h USD turnover rank and 24h range rank; it is not a social trend or historical volume surge.</p>
            ) : category === "wildcards" || category === "high-risk" ? (
              <p><strong className="font-medium text-foreground">Movement warning — </strong>24h range is a movement proxy, not a forecast. Wildcards fall below the scanner&apos;s turnover floor and are not qualified setups.</p>
            ) : category === "lower-volatility" ? (
              <p><strong className="font-medium text-foreground">Relative range only — </strong>lowest measured ranges in this snapshot do not mean low risk or risk-free.</p>
            ) : category === "strong-liquidity" ? (
              <p>Requires at least {usd(data.minimumTurnoverUsd)} in verified 24h USD turnover and quoted spread within {data.maxSpreadPct}%. This does not qualify a strategy setup.</p>
            ) : category === "low-spread" ? (
              <p>Lowest quartile of available current bid-ask spreads; a quote comparison is not a guaranteed execution price.</p>
            ) : category === "bearish-watch" ? (
              <p>Markets below Kraken&apos;s UTC day open, ranked by measured decline. This is not a short-selling recommendation.</p>
            ) : category === "top-movers" ? (
              <p>Ranked by absolute move from Kraken&apos;s UTC day open, not a rolling 24-hour open.</p>
            ) : category === "popular" ? (
              <p>Highest verified rolling-24h USD turnover, calculated from Kraken volume and 24h VWAP; not social popularity.</p>
            ) : (
              <p>Measured from the Kraken public market snapshot; missing values remain unavailable, not zero.</p>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
            <span>{rows.length.toLocaleString("en-US")} markets match</span>
            <span>{compared.length} / {COMPARE_LIMIT} selected to compare</span>
          </div>

          {rows.length > 0 ? (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[760px] border-collapse text-left">
                <caption className="sr-only">Kraken USD spot market measurements for {selectedCategory.label}</caption>
                <thead className="bg-muted/50 text-sm text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">Market / USD price</th>
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
                      highRange={highRangeSymbols.has(market.symbol)}
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

          <details className="rounded-md border border-border px-3 py-2">
            <summary className="cursor-pointer text-sm font-medium text-foreground">Data source and measurement notes</summary>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Source: {data.source}. Snapshot timestamp: {localTime(data.asOf)} ({data.timestampSource === "provider" ? "Kraken HTTP response Date header" : "local receipt time; Kraken supplied no response timestamp"}). Missing turnover or quote metrics stay unavailable. Social/search attention, candle-derived momentum, volume surges and strategy qualification are not inferred by this snapshot.
            </p>
          </details>
        </div>
      ) : null}
    </SectionCard>
  );
}
