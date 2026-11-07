/**
 * Wands research API contract — Intelligence Service 1.0.
 *
 * This module is the typed handoff between the Next.js member workspace and the
 * private Python research service. It describes the customer-facing projection
 * of the intelligence data: everything a member is allowed to read, and nothing
 * about how the data is collected.
 *
 * The rules below are part of the contract, not style preferences. The engine
 * must hold to them on every endpoint in `RESEARCH_ENDPOINTS`.
 *
 * 1. Every response is an `Envelope<T>`. `provenance` is `live` only when the
 *    payload was read from stored research data during that request. Research
 *    has no `demo` provenance: a fabricated filing is indistinguishable from a
 *    real one on screen, so an unreachable engine returns `unavailable` with an
 *    empty payload and a stated reason.
 * 2. A missing value is `null` with a reason. It is never `0`, never an empty
 *    string, and never a placeholder. "No purchase reported a price" and "the
 *    purchase was worth nothing" are different claims.
 * 3. Two timestamps are never conflated. `eventTime` is when the activity
 *    happened; `publicAvailableAt` is when it became knowable. Only the second
 *    may date a backtest or a performance claim.
 * 4. A research score is a bounded 0-100 ranking of evidence. It is not a
 *    probability, an expected return, or a recommendation, and it is never
 *    rendered without that label.
 * 5. Every claim carries a source link, or an explicit statement that the
 *    source could not be resolved. A claim with no link is not shown.
 * 6. Collection machinery is not part of this contract. Jobs, leases, backfill
 *    cursors, retry counters, identifier-resolution internals and raw upstream
 *    error strings stay behind the operator surface.
 */

import type {
  Envelope,
  FusionRanking,
  InsiderFeed,
  InsiderSymbolSummary,
  InsiderTransaction,
  InstitutionChanges,
  InstitutionFeed,
  IntelFreshness,
  ResearchSignal,
  SignalFeed,
} from "./contracts";

export const RESEARCH_CONTRACT_VERSION = "1.0.0" as const;

/**
 * A research envelope, plus whether the engine was reachable at all.
 *
 * `provenance: "unavailable"` covers two situations that must never be shown as
 * one: the engine answered and has nothing stored for the subject, and the
 * engine could not be reached. The first is a collection state; the second is an
 * outage. `unreachable` separates them so a page cannot tell a member the engine
 * is down when it actually replied.
 */
export interface ResearchEnvelope<T> extends Envelope<T> {
  unreachable: boolean;
}

/* ------------------------------------------------------------------ */
/* Evidence                                                            */
/* ------------------------------------------------------------------ */

/**
 * What kind of document a claim rests on. `price_series` is included because a
 * performance claim is only as good as the prices behind it, and a member is
 * entitled to know which series was used.
 */
export type ResearchSourceKind =
  | "sec_filing"
  | "sec_filing_index"
  | "issuer_release"
  | "price_series";

export interface ResearchSourceLink {
  id: string;
  kind: ResearchSourceKind;
  /** What a reader sees, e.g. "Form 4 — Acme Corp (2026-03-14)". */
  label: string;
  /** Absolute https URL. The engine never returns a relative path. */
  url: string;
  accessionNumber: string | null;
  formType: string | null;
  /** When the document became public. Not when the event happened. */
  publicAvailableAt: string | null;
  /** The claim this link supports, in the engine's own words. */
  supports: string;
  retrievedAt: string;
}

/* ------------------------------------------------------------------ */
/* Coverage                                                            */
/* ------------------------------------------------------------------ */

/**
 * `insufficient` is distinct from `partial`: partial means some of the requested
 * window is covered, insufficient means what is stored cannot support the claim
 * being made. Both must be shown; neither may be silently rounded up.
 */
export type ResearchCoverageStatus =
  | "complete"
  | "partial"
  | "insufficient"
  | "unavailable";

export interface ResearchCoverageGap {
  key: string;
  label: string;
  detail: string;
}

export interface ResearchCoverageDisclosure {
  status: ResearchCoverageStatus;
  windowStart: string | null;
  windowEnd: string | null;
  symbolsCovered: number;
  symbolsRequested: number;
  gaps: ResearchCoverageGap[];
  caveats: string[];
}

/* ------------------------------------------------------------------ */
/* Payloads                                                            */
/* ------------------------------------------------------------------ */

/**
 * Everything the member workspace shows for one asset. `sources` and `coverage`
 * are required: an asset page that cannot say where its evidence came from, or
 * how much of the window it covers, is not publishable.
 */
export interface AssetResearch {
  symbol: string;
  issuerName: string | null;
  asOf: string;
  freshness: IntelFreshness;
  insider: InsiderSymbolSummary;
  signals: ResearchSignal[];
  fusion: FusionRanking;
  sources: ResearchSourceLink[];
  coverage: ResearchCoverageDisclosure;
  caveats: string[];
}

/**
 * The member dashboard aggregate. Counts are of stored records, not of events
 * that happened: "0 filings" means nothing is stored, which is not the same as
 * no insider having filed.
 */
export interface ResearchDashboard {
  asOf: string;
  freshness: IntelFreshness;
  counts: {
    filings: number;
    transactions: number;
    signals: number;
    institutions: number;
    holdings: number;
    symbols: number;
  };
  latestFilingAt: string | null;
  latestSignalAt: string | null;
  topSignals: ResearchSignal[];
  recentPurchases: InsiderTransaction[];
  coverage: ResearchCoverageDisclosure;
  caveats: string[];
}

/* ------------------------------------------------------------------ */
/* Endpoint map                                                        */
/* ------------------------------------------------------------------ */

/**
 * `status` tells the engine team what work an endpoint needs:
 * - `existing` — already served, shape unchanged.
 * - `extend`   — already served, must gain the listed fields.
 * - `new`      — not served yet.
 *
 * `omit` names fields that exist on the operator projection and must not appear
 * in the customer response.
 */
export const RESEARCH_ENDPOINTS = {
  dashboard: {
    method: "GET",
    path: "/v1/intelligence/dashboard",
    query: [],
    status: "new",
    omit: ["jobs", "backfill", "leaseOwner", "lastError", "consecutiveFailures"],
  },
  asset: {
    method: "GET",
    path: "/v1/intelligence/symbols/{symbol}/summary",
    query: [],
    status: "extend",
    omit: ["jobs", "backfill", "leaseOwner", "lastError"],
  },
  insiders: {
    method: "GET",
    path: "/v1/intelligence/insiders",
    query: ["symbol", "open_market_only", "page", "limit"],
    status: "existing",
    omit: ["rawDocument", "parserWarnings"],
  },
  insiderSummary: {
    method: "GET",
    path: "/v1/intelligence/insiders/{symbol}",
    query: ["window_days"],
    status: "existing",
    omit: [],
  },
  insiderTransaction: {
    method: "GET",
    path: "/v1/intelligence/insiders/transactions/{id}",
    query: [],
    status: "new",
    omit: ["rawDocument", "parserWarnings"],
  },
  institutions: {
    method: "GET",
    path: "/v1/intelligence/institutions",
    query: ["page", "limit"],
    status: "existing",
    omit: [],
  },
  institutionChanges: {
    method: "GET",
    path: "/v1/intelligence/institutions/{cik}/changes",
    query: [],
    status: "existing",
    omit: ["unresolvedCusips"],
  },
  signals: {
    method: "GET",
    path: "/v1/intelligence/signals",
    query: ["category", "symbol", "page", "limit"],
    status: "existing",
    omit: [],
  },
  sources: {
    method: "GET",
    path: "/v1/intelligence/sources",
    query: ["subject_type", "subject_id", "symbol"],
    status: "new",
    omit: ["storageKey", "fetchAttempts", "lastFetchError"],
  },
  coverage: {
    method: "GET",
    path: "/v1/intelligence/coverage/public",
    query: [],
    status: "new",
    omit: ["identifiers", "backfill", "priceCoverage", "jobs"],
  },
} as const;

export type ResearchEndpointName = keyof typeof RESEARCH_ENDPOINTS;

export interface ResearchResponseMap {
  dashboard: ResearchDashboard;
  asset: AssetResearch;
  insiders: InsiderFeed;
  insiderSummary: InsiderSymbolSummary;
  insiderTransaction: InsiderTransaction;
  institutions: InstitutionFeed;
  institutionChanges: InstitutionChanges;
  signals: SignalFeed;
  sources: ResearchSourceLink[];
  coverage: ResearchCoverageDisclosure;
}

export type ResearchResponse<K extends ResearchEndpointName> =
  ResearchResponseMap[K];

/** The subject a source link can be attached to. */
export type ResearchSourceSubject =
  | "symbol"
  | "insider_transaction"
  | "institution"
  | "signal";
