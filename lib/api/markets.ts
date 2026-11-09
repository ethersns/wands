import "server-only";

import { engineFetch } from "./client";
import type { ApiResult } from "./contracts";

/**
 * Live quotes and provider health, read from the engine.
 *
 * The Money journal needs a current price to estimate an open position's P&L.
 * That price comes from here and nowhere else: it is the engine's own verified
 * quote, carrying the provider that produced it and how old it is. A price this
 * module could not fetch is reported as missing, never defaulted to the entry
 * price, because a position that silently shows zero P&L is worse than one that
 * shows nothing.
 */

export interface MarketQuote {
  symbol: string;
  name: string;
  marketType: string;
  price: number;
  bid: number | null;
  ask: number | null;
  asOf: string;
  ageSeconds: number | null;
  stale: boolean;
  quality: string;
  provider: string;
  strategyEligible: boolean;
}

export interface ProviderHealth {
  provider: string;
  configured: boolean;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  consecutiveFailures: number;
  latencyMs: number | null;
}

/**
 * The engine's quote route takes the pair in its path, and a path segment
 * cannot contain a slash. `BTC/USD` is therefore sent as `BTC-USD`, which the
 * engine normalises back to the pair it stores.
 */
export function getMarketQuote(symbol: string): Promise<ApiResult<MarketQuote>> {
  const path = symbol.replace("/", "-");
  return engineFetch<MarketQuote>(`/v1/markets/${encodeURIComponent(path)}/quote`, {
    timeoutMs: 15_000,
  });
}

export function getMarketHealth(): Promise<ApiResult<ProviderHealth[]>> {
  return engineFetch<ProviderHealth[]>("/v1/markets/health", { timeoutMs: 15_000 });
}
