import "server-only";

import { cache } from "react";

import { researchConfig, researchFetch } from "./client";
import type {
  FusionRanking,
  InsiderFeed,
  InsiderSymbolSummary,
  InsiderTransaction,
  InstitutionFeed,
  ResearchSignal,
  ResearchSignalCategory,
  SignalFeed,
} from "./contracts";
import type {
  AssetResearch,
  ResearchCoverageDisclosure,
  ResearchDashboard,
  ResearchEnvelope,
  ResearchSourceLink,
  ResearchSourceSubject,
} from "./research-contract";

/**
 * Server-side access to the customer-safe research endpoints.
 *
 * Research has no demo fallback. A fabricated filing or a made-up score would be
 * indistinguishable from a real one on screen, so an unreachable engine degrades
 * to an empty payload marked `unavailable` with the engine's own reason. The
 * caller must render that state rather than a zero.
 */

/** The engine could not be reached, so nothing was read. */
function unavailableEnvelope<T>(data: T, warnings: string[]): ResearchEnvelope<T> {
  return {
    data,
    provenance: "unavailable",
    generatedAt: new Date().toISOString(),
    source: "wands-engine",
    warnings,
    unreachable: true,
  };
}

/** The engine answered, but has nothing stored for this subject. */
function emptyEnvelope<T>(data: T, warnings: string[]): ResearchEnvelope<T> {
  return { ...unavailableEnvelope(data, warnings), unreachable: false };
}

async function loadResearch<T>(
  path: string,
  empty: () => T,
): Promise<ResearchEnvelope<T>> {
  const { configured } = researchConfig();

  if (!configured) {
    return unavailableEnvelope(empty(), [
      "WANDS_ENGINE_URL is not configured. No research data is available.",
    ]);
  }

  const result = await researchFetch<T>(path, {});

  if (result.ok) {
    return { ...result.envelope, unreachable: false };
  }

  return unavailableEnvelope(empty(), [
    `Research data unavailable (${result.error.code}): ${result.error.message}`,
  ]);
}

/* ------------------------------------------------------------------ */
/* Empty payloads                                                      */
/* ------------------------------------------------------------------ */

const emptyCoverage: ResearchCoverageDisclosure = {
  status: "unavailable",
  windowStart: null,
  windowEnd: null,
  symbolsCovered: 0,
  symbolsRequested: 0,
  gaps: [],
  caveats: [],
};

function emptyInsiderSummary(symbol: string): InsiderSymbolSummary {
  return {
    symbol,
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
  };
}

function emptyFusion(symbol: string): FusionRanking {
  return {
    symbol,
    asOf: new Date().toISOString(),
    components: [],
    compositeScore: null,
    coverage: 0,
    explanation: "No research evidence is available for this symbol.",
    dataQuality: "unavailable",
    caveats: [],
  };
}

/**
 * The engine is being extended to serve `sources`, `coverage` and `issuerName`
 * on the asset endpoint. Until it does, a response that omits them must still
 * render, so every field is defaulted here rather than trusted.
 */
function normalizeAsset(
  symbol: string,
  raw: Partial<AssetResearch> | null | undefined,
): AssetResearch {
  const insider = raw?.insider ?? emptyInsiderSummary(symbol);

  return {
    symbol: raw?.symbol ?? symbol,
    issuerName: raw?.issuerName ?? (insider.issuerName || null),
    asOf: raw?.asOf ?? new Date().toISOString(),
    freshness: raw?.freshness ?? "never",
    insider,
    signals: raw?.signals ?? [],
    fusion: raw?.fusion ?? emptyFusion(symbol),
    sources: raw?.sources ?? [],
    coverage: raw?.coverage ?? emptyCoverage,
    caveats: raw?.caveats ?? [],
  };
}

/* ------------------------------------------------------------------ */
/* Fetchers                                                            */
/* ------------------------------------------------------------------ */

export const getResearchDashboard = cache(() =>
  loadResearch<ResearchDashboard>("/v1/intelligence/dashboard", () => ({
    asOf: new Date().toISOString(),
    freshness: "never",
    counts: {
      filings: 0,
      transactions: 0,
      signals: 0,
      institutions: 0,
      holdings: 0,
      symbols: 0,
    },
    latestFilingAt: null,
    latestSignalAt: null,
    topSignals: [],
    recentPurchases: [],
    coverage: emptyCoverage,
    caveats: [],
  })),
);

export const getAssetResearch = cache(
  async (symbol: string): Promise<ResearchEnvelope<AssetResearch>> => {
    const upper = symbol.trim().toUpperCase();
    const envelope = await loadResearch<Partial<AssetResearch>>(
      `/v1/intelligence/symbols/${encodeURIComponent(upper)}/summary`,
      () => ({}),
    );

    return { ...envelope, data: normalizeAsset(upper, envelope.data) };
  },
);

export const getResearchSources = cache(
  (subject: { type: ResearchSourceSubject; id: string; symbol?: string }) => {
    const params = new URLSearchParams({
      subject_type: subject.type,
      subject_id: subject.id,
    });
    if (subject.symbol) params.set("symbol", subject.symbol);

    return loadResearch<ResearchSourceLink[]>(
      `/v1/intelligence/sources?${params.toString()}`,
      () => [],
    );
  },
);

export const getPublicCoverage = cache(() =>
  loadResearch<ResearchCoverageDisclosure>(
    "/v1/intelligence/coverage/public",
    () => emptyCoverage,
  ),
);

/**
 * One signal by its stable identifier.
 *
 * The engine answers `404` for an identifier it has no record of, which is a
 * different claim from "the engine is unreachable". Both resolve to a `null`
 * payload so the page renders no figures, but the warning says which one
 * happened, because a member reopening a saved signal needs to know whether the
 * record is gone or the engine is down.
 */
export const getSignal = cache(
  async (id: string): Promise<ResearchEnvelope<ResearchSignal | null>> => {
    const { configured } = researchConfig();

    if (!configured) {
      return unavailableEnvelope<ResearchSignal | null>(null, [
        "WANDS_ENGINE_URL is not configured. No research data is available.",
      ]);
    }

    const result = await researchFetch<ResearchSignal>(
      `/v1/intelligence/signals/${encodeURIComponent(id)}`,
      {},
    );

    if (result.ok) {
      return { ...result.envelope, unreachable: false };
    }

    if (result.error.status === 404) {
      return emptyEnvelope<ResearchSignal | null>(null, [
        "The engine has no stored signal with this identifier.",
      ]);
    }

    if (result.error.status === 422) {
      return emptyEnvelope<ResearchSignal | null>(null, [
        "This is not a signal identifier, so the engine has no record to return.",
      ]);
    }

    return unavailableEnvelope<ResearchSignal | null>(null, [
      `Research data unavailable (${result.error.code}): ${result.error.message}`,
    ]);
  },
);

/* ------------------------------------------------------------------ */
/* Feeds                                                               */
/* ------------------------------------------------------------------ */

const emptyInsiderFeed: InsiderFeed = { items: [], total: 0, page: 1, limit: 50, hasMore: false };
const emptySignalFeed: SignalFeed = { items: [], total: 0, page: 1, limit: 50, hasMore: false };
const emptyInstitutionFeed: InstitutionFeed = { items: [], total: 0, page: 1, limit: 50, hasMore: false };

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

export const getSignalFeed = cache(
  (options: { category?: ResearchSignalCategory; symbol?: string; page?: number; limit?: number } = {}) => {
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

export const getInstitutionFeed = cache((page = 1, limit = 50) =>
  loadResearch<InstitutionFeed>(
    `/v1/intelligence/institutions?page=${page}&limit=${limit}`,
    () => emptyInstitutionFeed,
  ),
);

/**
 * One insider transaction by its stable identifier.
 *
 * The engine reads the row directly, so a filing stays reachable after it has
 * aged out of the published feed. There is no feed scan behind this: scanning a
 * page of the feed could not open an older filing, and it made "not in the
 * published window" look like "not stored".
 *
 * The three outcomes stay distinct, because a member reopening a saved record
 * needs to know which one happened:
 * - `404` — the engine has no filing with this identifier.
 * - `422` — the identifier is not a filing id at all.
 * - anything else — the engine could not be reached or refused the credential.
 */
export const getInsiderTransaction = cache(
  async (id: string): Promise<ResearchEnvelope<InsiderTransaction | null>> => {
    const { configured } = researchConfig();

    if (!configured) {
      return unavailableEnvelope<InsiderTransaction | null>(null, [
        "WANDS_ENGINE_URL is not configured. No research data is available.",
      ]);
    }

    const result = await researchFetch<InsiderTransaction>(
      `/v1/intelligence/insiders/transactions/${encodeURIComponent(id)}`,
      {},
    );

    if (result.ok) {
      return { ...result.envelope, unreachable: false };
    }

    if (result.error.status === 404) {
      return emptyEnvelope<InsiderTransaction | null>(null, [
        "The engine has no stored filing with this identifier.",
      ]);
    }

    if (result.error.status === 422) {
      return emptyEnvelope<InsiderTransaction | null>(null, [
        "This is not a filing identifier, so the engine has no record to return.",
      ]);
    }

    return unavailableEnvelope<InsiderTransaction | null>(null, [
      `Research data unavailable (${result.error.code}): ${result.error.message}`,
    ]);
  },
);
