"use client";

import * as React from "react";
import useSWR from "swr";
import {
  CircleAlert,
  CircleCheck,
  Search,
  Star,
  TriangleAlert,
} from "lucide-react";

import { PriceChart } from "@/components/charts/price-chart";
import { Sparkline } from "@/components/charts/sparkline";
import { SectionCard } from "@/components/shared/section-card";
import { StatusChip } from "@/components/shared/status-chip";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  CandleSeries,
  Envelope,
  MarketOverview,
  MarketType,
  Quote,
} from "@/lib/api/contracts";
import {
  formatCompact,
  formatPercent,
  formatPrice,
  formatRelative,
  toneClass,
  toneOf,
} from "@/lib/format";
import { dataQuality } from "@/lib/status";
import { cn } from "@/lib/utils";

const INTERVALS: CandleSeries["interval"][] = ["15m", "1h", "4h", "1d"];

async function fetchCandles(url: string): Promise<Envelope<CandleSeries>> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Failed to load candles");
  return response.json();
}

function QuoteRow({
  quote,
  active,
  watched,
  onSelect,
}: {
  quote: Quote;
  active: boolean;
  watched: boolean;
  onSelect: () => void;
}) {
  const tone = toneOf(quote.change24hPct);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors",
        active ? "bg-secondary" : "hover:bg-accent/60",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[12px] font-medium text-foreground">
            {quote.symbol}
          </span>
          {watched ? (
            <Star className="size-2.5 fill-primary text-primary" aria-label="On watchlist" />
          ) : null}
          {quote.stale ? (
            <TriangleAlert className="size-2.5 text-muted-foreground" aria-label="Stale quote" />
          ) : null}
          {quote.quality && quote.quality !== "live" ? (
            <span className="font-mono text-[9px] tracking-[0.06em] text-muted-foreground uppercase">
              {quote.quality}
            </span>
          ) : null}
        </div>
        <p className="truncate text-[10px] text-muted-foreground">{quote.name}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="font-mono text-[12px] tabular text-foreground">
          {formatPrice(quote.price)}
        </p>
        <p className={cn("font-mono text-[10px] tabular", toneClass(tone))}>
          {formatPercent(quote.change24hPct, { signed: true })}
        </p>
      </div>
    </button>
  );
}

function DetailStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] tracking-[0.06em] text-muted-foreground uppercase">
        {label}
      </span>
      <span className={cn("font-mono text-[12px] tabular text-foreground", tone)}>
        {value}
      </span>
    </div>
  );
}

export function MarketsView({
  overview,
  initialCandles,
}: {
  overview: MarketOverview;
  initialCandles: Envelope<CandleSeries>;
}) {
  const [market, setMarket] = React.useState<MarketType>("crypto");
  const [query, setQuery] = React.useState("");
  const [interval, setInterval] = React.useState<CandleSeries["interval"]>("1h");

  const inMarket = React.useMemo(
    () => overview.quotes.filter((quote) => quote.marketType === market),
    [overview.quotes, market],
  );

  const [selected, setSelected] = React.useState<string>(
    inMarket[0]?.symbol ?? overview.quotes[0]?.symbol ?? "",
  );

  const filtered = React.useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return inMarket;
    return inMarket.filter(
      (quote) =>
        quote.symbol.toLowerCase().includes(term) ||
        quote.name.toLowerCase().includes(term),
    );
  }, [inMarket, query]);

  const quote =
    overview.quotes.find((item) => item.symbol === selected) ?? inMarket[0];

  const candlesKey = quote
    ? `/api/markets/candles?symbol=${encodeURIComponent(quote.symbol)}&interval=${interval}`
    : null;

  const { data, error, isLoading } = useSWR<Envelope<CandleSeries>>(
    candlesKey,
    fetchCandles,
    {
      revalidateOnFocus: false,
      keepPreviousData: true,
      fallbackData:
        quote && quote.symbol === initialCandles.data.symbol && interval === "1h"
          ? initialCandles
          : undefined,
    },
  );

  function changeMarket(next: MarketType) {
    setMarket(next);
    const first = overview.quotes.find((item) => item.marketType === next);
    if (first) setSelected(first.symbol);
    setQuery("");
  }

  const tone = toneOf(quote?.change24hPct);
  const quality = dataQuality(quote?.quality);

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      <div className="flex flex-col gap-3">
        <Tabs value={market} onValueChange={(value) => changeMarket(value as MarketType)}>
          <TabsList className="w-full">
            <TabsTrigger value="crypto" className="flex-1">
              Crypto
            </TabsTrigger>
            <TabsTrigger value="stocks" className="flex-1">
              Stocks
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search symbols"
            aria-label="Search symbols"
            className="h-9 pl-8 text-[13px]"
          />
        </div>

        <div className="max-h-[420px] overflow-y-auto rounded-lg border border-border bg-card p-1 lg:max-h-[560px]">
          {filtered.length === 0 ? (
            <p className="px-2 py-6 text-center text-[12px] text-muted-foreground">
              No instruments match “{query}”.
            </p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {filtered.map((item) => (
                <QuoteRow
                  key={item.symbol}
                  quote={item}
                  active={item.symbol === quote?.symbol}
                  watched={overview.watchlist.includes(item.symbol)}
                  onSelect={() => setSelected(item.symbol)}
                />
              ))}
            </div>
          )}
        </div>

        <p className="flex items-center gap-1.5 px-1 font-mono text-[10px] text-muted-foreground">
          <span
            className={cn(
              "size-1.5 rounded-full",
              overview.feedHealthy ? "bg-profit" : "bg-loss",
            )}
            aria-hidden
          />
          feed {overview.feedHealthy ? "healthy" : "degraded"} ·{" "}
          {formatRelative(overview.feedUpdatedAt)}
        </p>
      </div>

      {quote ? (
        <div className="flex flex-col gap-4">
          <SectionCard
            title={`${quote.symbol} · ${quote.name}`}
            description={`${quote.marketType === "crypto" ? "Crypto" : "Equity"} · session ${quote.session}`}
            action={
              <Tabs
                value={interval}
                onValueChange={(value) => setInterval(value as CandleSeries["interval"])}
              >
                <TabsList className="h-8">
                  {INTERVALS.map((value) => (
                    <TabsTrigger
                      key={value}
                      value={value}
                      className="h-7 px-2 font-mono text-[11px]"
                    >
                      {value}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            }
            bodyClassName="flex flex-col gap-3"
          >
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-[26px] leading-none tabular tracking-[-0.02em] text-foreground">
                  {formatPrice(quote.price)}
                </span>
                <span className={cn("font-mono text-[13px] tabular", toneClass(tone))}>
                  {formatPercent(quote.change24hPct, { signed: true })}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusChip label={quality.label} tone={quality.tone} />
                <StatusChip
                  label={quote.strategyEligible ? "Strategy eligible" : "Not eligible"}
                  tone={quote.strategyEligible ? "profit" : "muted"}
                />
                {quote.stale ? (
                  <StatusChip label="Stale quote" tone="loss" />
                ) : null}
              </div>
            </div>

            {error ? (
              <div className="flex items-center gap-2 rounded-md border border-loss/30 bg-loss/[0.07] px-2.5 py-2">
                <CircleAlert className="size-3.5 text-loss" aria-hidden />
                <p className="text-[11px] text-muted-foreground">
                  Could not load candles for {quote.symbol}.
                </p>
              </div>
            ) : isLoading && !data ? (
              <Skeleton className="h-[320px] w-full" />
            ) : data ? (
              <PriceChart candles={data.data.candles} height={320} />
            ) : null}

            <div className="grid grid-cols-2 gap-3 border-t border-border pt-3 sm:grid-cols-3 lg:grid-cols-4">
              <DetailStat label="Bid" value={formatPrice(quote.bid)} />
              <DetailStat label="Ask" value={formatPrice(quote.ask)} />
              <DetailStat
                label="Spread"
                value={formatPercent(quote.spreadPct, { digits: 3 })}
              />
              <DetailStat
                label="Executable"
                value={
                  quote.executablePrice === null || quote.executablePrice === undefined
                    ? "None"
                    : formatPrice(quote.executablePrice)
                }
                tone={
                  quote.executablePrice === null || quote.executablePrice === undefined
                    ? "text-muted-foreground"
                    : undefined
                }
              />
              <DetailStat label="24h high" value={formatPrice(quote.high24h)} />
              <DetailStat label="24h low" value={formatPrice(quote.low24h)} />
              <DetailStat label="24h volume" value={formatCompact(quote.volume24h)} />
              <DetailStat
                label="Quote age"
                value={quote.ageSeconds === null ? "—" : `${quote.ageSeconds}s`}
              />
            </div>

            <p className="font-mono text-[10px] text-muted-foreground">
              {quote.provider ? `${quote.provider} · ` : ""}
              {quote.timestampSource === "receipt"
                ? "venue publishes no quote timestamp; age is measured from receipt"
                : "venue-stamped timestamp"}
              {quote.asOf ? ` · ${formatRelative(quote.asOf)}` : ""}
            </p>

            {quote.strategyEligible ? (
              <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-2">
                <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-profit" aria-hidden />
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Live, two-sided and within the freshness policy. Orders may be priced
                  against {formatPrice(quote.executablePrice)}.
                </p>
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-md border border-loss/30 bg-loss/[0.07] px-2.5 py-2">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-loss" aria-hidden />
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {quote.stale
                    ? `This quote is ${quote.ageSeconds}s old, beyond the freshness policy.`
                    : quote.quality === "delayed"
                      ? "This is delayed data, not real-time. It cannot price an order."
                      : quote.session === "closed" ||
                          quote.session === "pre" ||
                          quote.session === "post"
                        ? `The ${quote.session} session is not tradeable.`
                        : "This quote has no two-sided bid/ask, so it has no executable price."}{" "}
                  Strategies will not trade this instrument until the feed recovers.
                </p>
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="Watchlist"
            description="Instruments pinned for quick access"
            bodyClassName="px-0 pb-0 sm:px-0"
          >
            <div className="flex flex-col divide-y divide-border">
              {overview.quotes
                .filter((item) => overview.watchlist.includes(item.symbol))
                .map((item) => {
                  const itemTone = toneOf(item.change24hPct);
                  return (
                    <button
                      key={item.symbol}
                      type="button"
                      onClick={() => setSelected(item.symbol)}
                      className="flex items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-accent/40 sm:px-5"
                    >
                      <span className="w-20 shrink-0 font-mono text-[12px] text-foreground">
                        {item.symbol}
                      </span>
                      <span className="hidden min-w-0 flex-1 truncate text-[11px] text-muted-foreground sm:block">
                        {item.name}
                      </span>
                      <Sparkline
                        values={[
                          item.low24h ?? 0,
                          (item.low24h ?? 0) * 1.004,
                          (item.high24h ?? 0) * 0.998,
                          item.price ?? 0,
                        ]}
                        positive={itemTone === "profit"}
                      />
                      <span className="w-20 shrink-0 text-right font-mono text-[12px] tabular text-foreground">
                        {formatPrice(item.price)}
                      </span>
                      <span
                        className={cn(
                          "w-16 shrink-0 text-right font-mono text-[11px] tabular",
                          toneClass(itemTone),
                        )}
                      >
                        {formatPercent(item.change24hPct, { signed: true })}
                      </span>
                    </button>
                  );
                })}
            </div>
          </SectionCard>
        </div>
      ) : null}
    </div>
  );
}
