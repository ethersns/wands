import "server-only";

import { cache } from "react";

import { engineConfig, engineFetch } from "./client";
import type { Envelope, FusionRanking, InsiderSymbolSummary } from "./contracts";
import type {
  AssetResearch,
  ResearchCoverageDisclosure,
  ResearchDashboard,
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

function unavailableEnvelope<T>(data: T, warnings: string[]): Envelope<T> {
  return {
    data,
    provenance: "unavailable",
    generatedAt: new Date().toISOString(),
    source: "wands-engine",
    warnings,
  };
}

async function loadResearch<T>(
  path: string,
  empty: () => T,
): Promise<Envelope<T>> {
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
  async (symbol: string): Promise<Envelope<AssetResearch>> => {
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
