import "server-only";

import { cache } from "react";

import { engineConfig, engineFetch } from "./client";
import * as demo from "./demo";
import type {
  BacktestResult,
  BotLogEntry,
  CandleSeries,
  Connection,
  EngineStatus,
  Envelope,
  Fill,
  MarketOverview,
  Order,
  PortfolioSummary,
  RiskSnapshot,
  Strategy,
  TradingBot,
  UserSettings,
} from "./contracts";

/**
 * Server-side data access for the Wands UI.
 *
 * Every function resolves to an `Envelope`, so the caller always knows whether
 * a figure is live or demonstration data. Nothing here throws: a missing or
 * unreachable engine degrades to a labelled demo payload with an explanatory
 * warning rather than an empty screen or a fabricated "live" badge.
 */

function demoEnvelope<T>(data: T, warnings: string[] = []): Envelope<T> {
  return {
    data,
    provenance: "demo",
    generatedAt: new Date().toISOString(),
    source: "demo-fixture",
    warnings,
  };
}

async function load<T>(
  path: string,
  fallback: () => T,
  options: { timeoutMs?: number } = {},
): Promise<Envelope<T>> {
  const { configured } = engineConfig();

  if (!configured) {
    return demoEnvelope(fallback(), [
      "WANDS_ENGINE_URL is not configured. Showing demonstration data.",
    ]);
  }

  const result = await engineFetch<T>(path, options);

  if (result.ok) {
    return result.envelope;
  }

  return demoEnvelope(fallback(), [
    `Trading engine unavailable (${result.error.code}): ${result.error.message} Showing demonstration data.`,
  ]);
}

/* ------------------------------------------------------------------ */

export const getEngineStatus = cache(() =>
  load<EngineStatus>("/v1/engine/status", () => demo.demoEngineStatus),
);

export const getPortfolio = cache(() =>
  load<PortfolioSummary>("/v1/portfolio", () => demo.demoPortfolio),
);

export const getMarkets = cache(() =>
  load<MarketOverview>("/v1/markets/overview", () => demo.demoMarketOverview),
);

export const getCandles = cache((symbol: string, interval: CandleSeries["interval"]) =>
  load<CandleSeries>(
    `/v1/markets/${encodeURIComponent(symbol)}/candles?interval=${interval}`,
    () => demo.demoCandles(symbol, interval),
  ),
);

export const getStrategies = cache(() =>
  load<Strategy[]>("/v1/strategies", () => demo.demoStrategies),
);

export const getBots = cache(() =>
  load<TradingBot[]>("/v1/bots", () => demo.demoBots),
);

export const getBotLogs = cache(() =>
  load<BotLogEntry[]>("/v1/bots/logs", () => demo.demoBotLogs),
);

export const getBacktests = cache(() =>
  load<BacktestResult[]>("/v1/backtests", () => demo.demoBacktests),
);

export const getOrders = cache(() =>
  load<Order[]>("/v1/orders", () => demo.demoOrders),
);

export const getFills = cache(() =>
  load<Fill[]>("/v1/fills", () => demo.demoFills),
);

export const getRisk = cache(() =>
  load<RiskSnapshot>("/v1/risk", () => demo.demoRiskSnapshot),
);

export const getConnections = cache(() =>
  load<Connection[]>("/v1/connections", () => demo.demoConnections),
);

export const getSettings = cache(() =>
  load<UserSettings>("/v1/settings", () => demo.demoUserSettings),
);
