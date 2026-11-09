import {
  computeClosedPnl,
  computeOpenPnl,
  formatDecimal,
  formatPercent,
  parseDecimal,
} from "./calc";
import type { ClosedTradeView, MoneyTrade, OpenPositionView, QuoteView } from "./types";

/**
 * Turns a stored trade plus a quote into the numbers the page renders.
 *
 * The arithmetic happens here, on the server, so the client never has to decide
 * what a position is worth. When a quote is missing the unrealised figures are
 * `null` rather than zero: a position with no current price has an unknown
 * P&L, and showing `0.00` would read as "flat" when the truth is "unknown".
 */

function scaled(value: string | null): bigint | null {
  if (value === null) return null;
  return parseDecimal(value);
}

export function buildOpenPositionView(
  trade: MoneyTrade,
  quote: QuoteView | null,
  quoteError: string | null,
): OpenPositionView {
  const entryPrice = scaled(trade.entryPrice);
  const quantity = scaled(trade.entryQuantity);
  const entryFee = scaled(trade.entryFee) ?? 0n;

  if (entryPrice === null || quantity === null) {
    return {
      trade,
      quote,
      quoteError,
      costBasis: "—",
      unrealizedGross: null,
      unrealizedNet: null,
      returnPct: "—",
      positive: false,
    };
  }

  const costBasis = computeOpenPnl({
    entryPrice,
    quantity,
    entryFee,
    currentPrice: entryPrice,
  }).costBasis;

  const currentPrice = quote ? parseDecimal(quote.price) : null;

  if (currentPrice === null) {
    return {
      trade,
      quote,
      quoteError,
      costBasis: formatDecimal(costBasis, 2),
      unrealizedGross: null,
      unrealizedNet: null,
      returnPct: "—",
      positive: false,
    };
  }

  const pnl = computeOpenPnl({ entryPrice, quantity, entryFee, currentPrice });

  return {
    trade,
    quote,
    quoteError,
    costBasis: formatDecimal(costBasis, 2),
    unrealizedGross: formatDecimal(pnl.unrealizedGross, 2),
    unrealizedNet: formatDecimal(pnl.unrealizedNet, 2),
    returnPct: formatPercent(pnl.returnFraction),
    positive: pnl.unrealizedNet >= 0n,
  };
}

export function buildClosedTradeView(trade: MoneyTrade): ClosedTradeView {
  const entryPrice = scaled(trade.entryPrice);
  const quantity = scaled(trade.entryQuantity);
  const entryFee = scaled(trade.entryFee) ?? 0n;
  const exitPrice = scaled(trade.exitPrice);
  const exitFee = scaled(trade.exitFee) ?? 0n;

  if (entryPrice === null || quantity === null || exitPrice === null) {
    return {
      trade,
      costBasis: "—",
      proceeds: "—",
      grossPnl: "—",
      netPnl: "—",
      returnPct: "—",
      positive: false,
    };
  }

  const pnl = computeClosedPnl({ entryPrice, quantity, entryFee, exitPrice, exitFee });

  return {
    trade,
    costBasis: formatDecimal(pnl.costBasis, 2),
    proceeds: formatDecimal(pnl.proceeds, 2),
    grossPnl: formatDecimal(pnl.grossPnl, 2),
    netPnl: formatDecimal(pnl.netPnl, 2),
    returnPct: formatPercent(pnl.returnFraction),
    positive: pnl.netPnl >= 0n,
  };
}

export interface MoneySummary {
  openCount: number;
  /** How many open positions actually had a quote to price them with. */
  openPricedCount: number;
  openCostBasis: string;
  /** Sum over priced positions only. Never includes an unpriced one as zero. */
  openUnrealizedNet: string;
  closedCount: number;
  realizedNet: string;
  wins: number;
  losses: number;
  positive: boolean;
}

/**
 * Totals across the journal.
 *
 * An open position with no quote is excluded from the unrealised total rather
 * than counted as flat, and `openPricedCount` lets the page say so. A total that
 * quietly treated an unknown as zero would understate the risk on screen.
 */
export function buildSummary(
  openTrades: MoneyTrade[],
  closedTrades: MoneyTrade[],
  currentPrices: Map<string, bigint>,
): MoneySummary {
  let openCostBasis = 0n;
  let openUnrealizedNet = 0n;
  let openPricedCount = 0;

  for (const trade of openTrades) {
    const entryPrice = scaled(trade.entryPrice);
    const quantity = scaled(trade.entryQuantity);
    const entryFee = scaled(trade.entryFee) ?? 0n;
    if (entryPrice === null || quantity === null) continue;

    const currentPrice = currentPrices.get(trade.symbol) ?? null;
    const pnl = computeOpenPnl({
      entryPrice,
      quantity,
      entryFee,
      currentPrice: currentPrice ?? entryPrice,
    });

    openCostBasis += pnl.costBasis;
    if (currentPrice !== null) {
      openUnrealizedNet += pnl.unrealizedNet;
      openPricedCount += 1;
    }
  }

  let realizedNet = 0n;
  let wins = 0;
  let losses = 0;

  for (const trade of closedTrades) {
    const entryPrice = scaled(trade.entryPrice);
    const quantity = scaled(trade.entryQuantity);
    const exitPrice = scaled(trade.exitPrice);
    if (entryPrice === null || quantity === null || exitPrice === null) continue;

    const pnl = computeClosedPnl({
      entryPrice,
      quantity,
      entryFee: scaled(trade.entryFee) ?? 0n,
      exitPrice,
      exitFee: scaled(trade.exitFee) ?? 0n,
    });

    realizedNet += pnl.netPnl;
    if (pnl.netPnl > 0n) wins += 1;
    else if (pnl.netPnl < 0n) losses += 1;
  }

  return {
    openCount: openTrades.length,
    openPricedCount,
    openCostBasis: formatDecimal(openCostBasis, 2),
    openUnrealizedNet: formatDecimal(openUnrealizedNet, 2),
    closedCount: closedTrades.length,
    realizedNet: formatDecimal(realizedNet, 2),
    wins,
    losses,
    positive: realizedNet >= 0n,
  };
}

/**
 * The engine reports a quote price as a JSON number. Converting it to a decimal
 * string at a fixed scale keeps the P&L arithmetic in `bigint` instead of
 * letting a float reach the money path.
 */
export function quoteView(quote: {
  price: number;
  asOf: string;
  ageSeconds: number | null;
  stale: boolean;
  provider: string;
  quality: string;
}): QuoteView {
  return {
    price: quote.price.toFixed(10),
    asOf: quote.asOf,
    ageSeconds: quote.ageSeconds,
    stale: quote.stale,
    provider: quote.provider,
    quality: quote.quality,
  };
}
