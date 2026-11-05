import "server-only";

import { cache } from "react";

import { engineConfig, engineFetch } from "./client";
import * as demo from "./demo";
import type {
  ApiResult,
  BacktestResult,
  BotLogEntry,
  CandleSeries,
  Connection,
  EngineStatus,
  Envelope,
  Fill,
  InsiderFeed,
  InsiderSymbolSummary,
  InstitutionChanges,
  InstitutionFeed,
  IntelStatus,
  MarketDataHealth,
  MarketOverview,
  Order,
  PaperAccount,
  PortfolioSummary,
  PortfolioVerification,
  RiskSnapshot,
  SignalFeed,
  Strategy,
  SymbolResearchSummary,
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

/**
 * Paper accounts. An empty list is the honest fallback: there is no such thing
 * as a demonstration paper account, because a simulated balance is already
 * simulated.
 */
export const getPaperAccounts = cache(() =>
  load<PaperAccount[]>("/v1/paper/accounts", () => demo.demoPaperAccounts),
);

export const getMarketHealth = cache(() =>
  load<MarketDataHealth[]>("/v1/markets/health", () => []),
);

/**
 * Cash-versus-ledger verification. This deliberately has no demo fallback: a
 * fabricated "reconciled" result would be worse than an error.
 */
export function getVerification(
  connectionId: string,
): Promise<ApiResult<PortfolioVerification>> {
  return engineFetch<PortfolioVerification>(
    `/v1/accounts/${encodeURIComponent(connectionId)}/verification`,
  );
}

/* ------------------------------------------------------------------ */
/* Intelligence                                                        */
/*                                                                     */
/* Research has no demo fallback. A fabricated insider filing or a      */
/* made-up signal score would be indistinguishable from a real one on   */
/* screen, so an unreachable engine degrades to an empty, explicitly    */
/* unavailable payload instead.                                         */
/* ------------------------------------------------------------------ */

function unavailableEnvelope<T>(data: T, warnings: string[]): Envelope<T> {
  return {
    data,
    provenance: "unavailable",
    generatedAt: new Date().toISOString(),
    source: "wands-engine",
    warnings,
  };
}

async function loadResearch<T>(path: string, empty: () => T): Promise<Envelope<T>> {
  const { configured } = engineConfig();

  if (!configured) {
    return unavailableEnvelope(empty(), [
      "WANDS_ENGINE_URL is not configured. No research data is available.",
    ]);
  }

  const result = await engineFetch<T>(path, {});

  if (result.ok) {
    return result.envelope;
  }

  return unavailableEnvelope(empty(), [
    `Research data unavailable (${result.error.code}): ${result.error.message}`,
  ]);
}

const emptyInsiderFeed: InsiderFeed = {
  items: [],
  total: 0,
  page: 1,
  limit: 50,
  hasMore: false,
};

const emptySignalFeed: SignalFeed = {
  items: [],
  total: 0,
  page: 1,
  limit: 50,
  hasMore: false,
};

const emptyInstitutionFeed: InstitutionFeed = {
  items: [],
  total: 0,
  page: 1,
  limit: 50,
  hasMore: false,
};

export const getIntelStatus = cache(() =>
  loadResearch<IntelStatus>("/v1/intelligence/status", () => ({
    enabled: false,
    freshness: "never",
    sources: [],
    filings: 0,
    transactions: 0,
    signals: 0,
    institutions: 0,
    holdings: 0,
    symbolsCovered: [],
    latestFilingAt: null,
    latestSignalAt: null,
    signalEngineVersion: "",
    caveats: [],
  })),
);

export const getInsiderFeed = cache(
  (options: { symbol?: string; openMarketOnly?: boolean; page?: number; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (options.symbol) params.set("symbol", options.symbol);
    if (options.openMarketOnly) params.set("open_market_only", "true");
    params.set("page", String(options.page ?? 1));
    params.set("limit", String(options.limit ?? 50));
    return loadResearch<InsiderFeed>(
      `/v1/intelligence/insiders?${params.toString()}`,
      () => emptyInsiderFeed,
    );
  },
);

export const getInsiderSummary = cache((symbol: string) =>
  loadResearch<InsiderSymbolSummary>(
    `/v1/intelligence/insiders/${encodeURIComponent(symbol)}`,
    () => ({
      symbol: symbol.toUpperCase(),
      issuerName: "",
      windowDays: 0,
      purchaseCount: 0,
      saleCount: 0,
      distinctPurchasers: 0,
      distinctSellers: 0,
      purchaseValueUsd: null,
      unpricedPurchaseLines: 0,
      latestFilingAt: null,
      latestTransactionDate: null,
      caveats: [],
    }),
  ),
);

export const getSignals = cache(
  (options: { category?: string; symbol?: string; page?: number; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (options.category) params.set("category", options.category);
    if (options.symbol) params.set("symbol", options.symbol);
    params.set("page", String(options.page ?? 1));
    params.set("limit", String(options.limit ?? 50));
    return loadResearch<SignalFeed>(
      `/v1/intelligence/signals?${params.toString()}`,
      () => emptySignalFeed,
    );
  },
);

export const getInstitutions = cache((page = 1, limit = 50) =>
  loadResearch<InstitutionFeed>(
    `/v1/intelligence/institutions?page=${page}&limit=${limit}`,
    () => emptyInstitutionFeed,
  ),
);

export const getInstitutionChanges = cache((cik: string) =>
  loadResearch<InstitutionChanges>(
    `/v1/intelligence/institutions/${encodeURIComponent(cik)}/changes`,
    () => ({
      cik,
      name: "",
      periodOfReport: null,
      priorPeriodOfReport: null,
      changes: [],
      caveats: [],
    }),
  ),
);

export const getSymbolResearch = cache((symbol: string) =>
  loadResearch<SymbolResearchSummary>(
    `/v1/intelligence/symbols/${encodeURIComponent(symbol)}/summary`,
    () => ({
      symbol: symbol.toUpperCase(),
      asOf: new Date().toISOString(),
      insider: {
        symbol: symbol.toUpperCase(),
        issuerName: "",
        windowDays: 0,
        purchaseCount: 0,
        saleCount: 0,
        distinctPurchasers: 0,
        distinctSellers: 0,
        purchaseValueUsd: null,
        unpricedPurchaseLines: 0,
        latestFilingAt: null,
        latestTransactionDate: null,
        caveats: [],
      },
      signals: [],
      fusion: {
        symbol: symbol.toUpperCase(),
        asOf: new Date().toISOString(),
        components: [],
        compositeScore: null,
        coverage: 0,
        explanation: "No research evidence is available for this symbol.",
        dataQuality: "unavailable",
        caveats: [],
      },
      freshness: "never",
      caveats: [],
    }),
  ),
);
