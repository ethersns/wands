import type { MarketPulseMarket } from "@/lib/api/opportunity";

export type MarketPulseCategoryId =
  | "all"
  | "highlights"
  | "trending"
  | "popular"
  | "top-movers"
  | "volume-surges"
  | "momentum"
  | "breakout-watch"
  | "reversal-watch"
  | "high-risk"
  | "wildcards"
  | "lower-volatility"
  | "strong-liquidity"
  | "low-spread"
  | "high-potential-movement"
  | "short-term"
  | "swing"
  | "longer-term"
  | "bearish-watch"
  | "social-buzz"
  | "search-trending";

export type MarketPulseSort = "interest" | "turnover" | "day-move" | "range" | "spread";

export const MARKET_PULSE_CATEGORIES: {
  id: MarketPulseCategoryId;
  label: string;
  unavailableReason?: string;
}[] = [
  { id: "all", label: "All Markets" },
  { id: "highlights", label: "Highlights" },
  { id: "trending", label: "Trending" },
  { id: "popular", label: "Popular" },
  { id: "top-movers", label: "Top Movers" },
  {
    id: "volume-surges",
    label: "Volume Surges",
    unavailableReason: "A single 24-hour ticker has no recent-volume baseline to verify a surge.",
  },
  {
    id: "momentum",
    label: "Momentum",
    unavailableReason: "Completed candle history is not part of this bounded market snapshot.",
  },
  {
    id: "breakout-watch",
    label: "Breakout Watch",
    unavailableReason: "A breakout watch needs candle-based distance-to-range measurements. Qualified setups remain separate below.",
  },
  {
    id: "reversal-watch",
    label: "Reversal Watch",
    unavailableReason: "Reversal patterns need completed candle history; no unconfirmed pattern is inferred from a ticker.",
  },
  { id: "high-risk", label: "High Risk / High Movement" },
  { id: "wildcards", label: "Wildcards" },
  { id: "lower-volatility", label: "Lower Volatility" },
  { id: "strong-liquidity", label: "Strong Liquidity" },
  { id: "low-spread", label: "Low Spread" },
  { id: "high-potential-movement", label: "High Potential Movement" },
  {
    id: "short-term",
    label: "Short-Term",
    unavailableReason: "Fresh 5-minute to 1-hour candle observations are not included in this ticker-only snapshot.",
  },
  {
    id: "swing",
    label: "Swing",
    unavailableReason: "Multi-hour to multi-day historical observations are not available across this market snapshot.",
  },
  {
    id: "longer-term",
    label: "Longer-Term",
    unavailableReason: "Reliable longer-history trends are not included in this market snapshot.",
  },
  { id: "bearish-watch", label: "Bearish Watch" },
  {
    id: "social-buzz",
    label: "Hype / Social Buzz",
    unavailableReason: "No verified, attributed social-attention provider is connected; social popularity is not inferred.",
  },
  {
    id: "search-trending",
    label: "Search Trending",
    unavailableReason: "No CoinGecko search-trending feed is requested or fetched.",
  },
];

function numeric(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function metric(market: MarketPulseMarket, key: keyof MarketPulseMarket): number | null {
  return numeric(market[key] as string | null);
}

function sortMetric(
  markets: MarketPulseMarket[],
  value: (market: MarketPulseMarket) => number | null,
  direction: "asc" | "desc" = "desc",
): MarketPulseMarket[] {
  return markets
    .filter((market) => value(market) !== null)
    .sort((a, b) => {
      const delta = (value(a) ?? 0) - (value(b) ?? 0);
      return (direction === "desc" ? -delta : delta) || a.symbol.localeCompare(b.symbol);
    });
}

function quartile(
  markets: MarketPulseMarket[],
  value: (market: MarketPulseMarket) => number | null,
  direction: "asc" | "desc",
): MarketPulseMarket[] {
  const sorted = sortMetric(markets, value, direction);
  return sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 4)));
}

function activityOrder(markets: MarketPulseMarket[]): MarketPulseMarket[] {
  const measurable = markets.filter((market) =>
    metric(market, "turnover24hUsd") !== null && metric(market, "range24hPct") !== null,
  );
  const turnoverRanks = new Map(sortMetric(measurable, (market) => metric(market, "turnover24hUsd"))
    .map((market, index) => [market.symbol, index]));
  const rangeRanks = new Map(sortMetric(measurable, (market) => metric(market, "range24hPct"))
    .map((market, index) => [market.symbol, index]));
  const count = measurable.length;
  return measurable.sort((a, b) => {
    const score = (symbol: string) =>
      (count - (turnoverRanks.get(symbol) ?? count)) / count +
      (count - (rangeRanks.get(symbol) ?? count)) / count;
    return score(b.symbol) - score(a.symbol) || a.symbol.localeCompare(b.symbol);
  });
}

function interestOrder(markets: MarketPulseMarket[]): MarketPulseMarket[] {
  const metrics = [
    { value: (market: MarketPulseMarket) => metric(market, "turnover24hUsd"), weight: 0.4, direction: "desc" as const },
    { value: (market: MarketPulseMarket) => {
      const move = metric(market, "dayChangePct");
      return move === null ? null : Math.abs(move);
    }, weight: 0.3, direction: "desc" as const },
    { value: (market: MarketPulseMarket) => metric(market, "range24hPct"), weight: 0.2, direction: "desc" as const },
    { value: (market: MarketPulseMarket) => metric(market, "spreadPct"), weight: 0.1, direction: "asc" as const },
  ];
  const ranks = metrics.map(({ value, direction }) => {
    const ordered = sortMetric(markets, value, direction);
    return new Map(ordered.map((market, index) => [market.symbol, index]));
  });

  return [...markets].sort((a, b) => {
    const score = (symbol: string) => {
      let total = 0;
      let availableWeight = 0;
      metrics.forEach((item, index) => {
        const rank = ranks[index].get(symbol);
        if (rank === undefined || ranks[index].size === 0) return;
        total += item.weight * (ranks[index].size - rank) / ranks[index].size;
        availableWeight += item.weight;
      });
      return availableWeight === 0 ? -1 : total / availableWeight;
    };
    return score(b.symbol) - score(a.symbol) || a.symbol.localeCompare(b.symbol);
  });
}

function sortIncludingUnavailable(
  markets: MarketPulseMarket[],
  value: (market: MarketPulseMarket) => number | null,
  direction: "asc" | "desc" = "desc",
): MarketPulseMarket[] {
  const measured = sortMetric(markets, value, direction);
  const measuredSymbols = new Set(measured.map((market) => market.symbol));
  const unavailable = markets
    .filter((market) => !measuredSymbols.has(market.symbol))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
  return [...measured, ...unavailable];
}

export function getMarketsForCategory(
  markets: MarketPulseMarket[],
  category: MarketPulseCategoryId,
  minimumTurnoverUsd: string,
  maxSpreadPct: string,
): MarketPulseMarket[] {
  const known = markets.filter((market) => market.tickerAvailable);
  const turnoverFloor = Number(minimumTurnoverUsd);
  const spreadCeiling = Number(maxSpreadPct);
  const dayMove = (market: MarketPulseMarket) => metric(market, "dayChangePct");
  const range = (market: MarketPulseMarket) => metric(market, "range24hPct");
  const turnover = (market: MarketPulseMarket) => metric(market, "turnover24hUsd");
  const spread = (market: MarketPulseMarket) => metric(market, "spreadPct");

  switch (category) {
    case "all":
      return interestOrder(known);
    case "highlights":
      return interestOrder(known).slice(0, Math.max(1, Math.ceil(known.length / 4)));
    case "trending": {
      const activity = activityOrder(known);
      return activity.slice(0, Math.max(1, Math.ceil(activity.length / 4)));
    }
    case "popular":
      return quartile(known, turnover, "desc");
    case "top-movers":
      return quartile(known, (market) => {
        const move = dayMove(market);
        return move === null ? null : Math.abs(move);
      }, "desc");
    case "high-risk":
    case "high-potential-movement":
      return quartile(known, range, "desc");
    case "wildcards":
      return sortMetric(known.filter((market) => {
        const value = turnover(market);
        return value !== null && value < turnoverFloor;
      }), turnover);
    case "lower-volatility":
      return quartile(known, range, "asc");
    case "strong-liquidity":
      return sortMetric(known.filter((market) => {
        const value = turnover(market);
        const quotedSpread = spread(market);
        return value !== null && value >= turnoverFloor && quotedSpread !== null && quotedSpread <= spreadCeiling;
      }), turnover);
    case "low-spread":
      return quartile(known, spread, "asc");
    case "bearish-watch":
      return sortMetric(known.filter((market) => (dayMove(market) ?? 0) < 0), dayMove, "asc");
    default:
      return [];
  }
}

export function sortMarketPulseMarkets(
  markets: MarketPulseMarket[],
  sort: MarketPulseSort,
): MarketPulseMarket[] {
  if (sort === "interest") return interestOrder(markets);
  if (sort === "turnover") return sortIncludingUnavailable(markets, (market) => metric(market, "turnover24hUsd"));
  if (sort === "day-move") return sortIncludingUnavailable(markets, (market) => {
    const move = metric(market, "dayChangePct");
    return move === null ? null : Math.abs(move);
  });
  if (sort === "range") return sortIncludingUnavailable(markets, (market) => metric(market, "range24hPct"));
  return sortIncludingUnavailable(markets, (market) => metric(market, "spreadPct"), "asc");
}
