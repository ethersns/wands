import type { MarketType } from "./validation";

/**
 * Shapes shared by the journal, the page and the client components.
 *
 * Kept out of `journal.ts` so a client component can name a trade without
 * importing the module that opens a database connection.
 */

export interface MoneyTrade {
  id: string;
  symbol: string;
  marketType: MarketType;
  candidateId: string | null;
  strategyKey: string | null;
  strategyVersion: number | null;
  planReferencePrice: string | null;
  planTargetPrice: string | null;
  planStopPrice: string | null;
  planReason: string | null;
  status: "open" | "closed";
  entryPrice: string;
  entryQuantity: string;
  entryFee: string;
  reportedAt: string;
  exitPrice: string | null;
  exitFee: string | null;
  closedAt: string | null;
  note: string | null;
}

/** The engine's verified quote for one symbol, as the page received it. */
export interface QuoteView {
  price: string;
  asOf: string;
  ageSeconds: number | null;
  stale: boolean;
  provider: string;
  quality: string;
}

export interface OpenPositionView {
  trade: MoneyTrade;
  quote: QuoteView | null;
  /** Why there is no quote. Never a substitute for one. */
  quoteError: string | null;
  costBasis: string;
  unrealizedGross: string | null;
  unrealizedNet: string | null;
  returnPct: string;
  positive: boolean;
}

export interface ClosedTradeView {
  trade: MoneyTrade;
  costBasis: string;
  proceeds: string;
  grossPnl: string;
  netPnl: string;
  returnPct: string;
  positive: boolean;
}
