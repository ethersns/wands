import type {
  InsiderFeed,
  InsiderTransaction,
  InsiderTransactionClass,
  Institution,
  InstitutionFeed,
  IntelFreshness,
  ResearchSignal,
  SignalFeed,
} from "@/lib/api/contracts";
import type {
  Catalyst,
  CatalystFeed,
  CatalystSource,
  ResearchCoverageDisclosure,
  ResearchCoverageStatus,
  ResearchDashboard,
} from "@/lib/api/research-contract";

import { filingHref, signalHref } from "./links";
import type { TrackedSymbol } from "./watchlists";

/**
 * The Founder Market Brief, as a pure function of research the engine already
 * serves.
 *
 * Nothing here collects, scores or infers: every item is a record that exists in
 * an existing feed, re-ordered by the rules in `BRIEF_RULES` so the founder can
 * see why it was surfaced. There is no second scoring engine and no confidence
 * percentage the engine did not itself produce.
 *
 * This module holds no I/O so the selection rules can be tested against
 * deterministic fixtures. `lib/member/brief.ts` is the read layer.
 */

const DAY_MS = 86_400_000;

/** How far back a disclosure still counts as newly published. */
const DISCLOSURE_WINDOW_DAYS = 14;
const SIGNAL_WINDOW_DAYS = 14;
/** How far ahead a symbol-tagged event is still worth opening. */
const SYMBOL_CATALYST_WINDOW_DAYS = 30;
/** A market-wide event touches every holding, so its window is tighter. */
const MARKET_CATALYST_WINDOW_DAYS = 7;

const MAX_INVESTIGATIONS = 8;

export type BriefReason =
  | "time_unknown"
  | "watched_disclosure"
  | "watched_catalyst"
  | "market_catalyst"
  | "watched_signal"
  | "source_stale";

/**
 * The rules, stated in the product rather than only in this file. A founder who
 * cannot see why an item was surfaced cannot judge whether to trust it.
 */
export const BRIEF_RULES: ReadonlyArray<{ reason: BriefReason; label: string; rule: string }> = [
  {
    reason: "time_unknown",
    label: "Assessment time unknown",
    rule: "The brief could not establish when it was assessed, so no time-window rule was applied and nothing is called recent or upcoming.",
  },
  {
    reason: "watched_disclosure",
    label: "New disclosure",
    rule: `A watched symbol has an open-market insider filing published in the last ${DISCLOSURE_WINDOW_DAYS} days.`,
  },
  {
    reason: "watched_catalyst",
    label: "Event approaching",
    rule: `A watched symbol is tagged to a scheduled event within ${SYMBOL_CATALYST_WINDOW_DAYS} days.`,
  },
  {
    reason: "market_catalyst",
    label: "Market-wide event",
    rule: `A market-wide scheduled event falls within ${MARKET_CATALYST_WINDOW_DAYS} days.`,
  },
  {
    reason: "watched_signal",
    label: "Signal changed",
    rule: `A watched symbol has a research signal that became public in the last ${SIGNAL_WINDOW_DAYS} days.`,
  },
  {
    reason: "source_stale",
    label: "Source stale",
    rule: "A research source is stale, failing or never collected, or published coverage is insufficient.",
  },
];

const REASON_ORDER: Record<BriefReason, number> = {
  time_unknown: 0,
  watched_disclosure: 1,
  watched_catalyst: 2,
  market_catalyst: 3,
  watched_signal: 4,
  source_stale: 5,
};

const CLASSIFICATION_LABEL: Record<InsiderTransactionClass, string> = {
  open_market_purchase: "Open-market purchase",
  open_market_sale: "Open-market sale",
  award_grant: "Award or grant",
  tax_withholding: "Tax withholding",
  gift: "Gift",
  derivative_exercise: "Derivative exercise",
  disposition_to_issuer: "Disposition to issuer",
  other: "Other",
};

export interface BriefInvestigation {
  id: string;
  reason: BriefReason;
  symbol: string | null;
  title: string;
  detail: string;
  href: string;
  sourceName: string | null;
  sourceUrl: string | null;
  /** When the underlying record became public. Never a computed "now". */
  observedAt: string | null;
  dataQuality: string;
}

export interface BriefLimitation {
  key: string;
  label: string;
  detail: string;
  severity: "gap" | "caveat";
}

/**
 * Whether the brief could establish when it was assessed.
 *
 * `indeterminate` means the dashboard returned no usable timestamp. The brief
 * then refuses to classify anything by time rather than measuring against the
 * current clock, so the same inputs always produce the same brief.
 */
export type BriefTimeBasis = "established" | "indeterminate";

/** What the brief as a whole can claim about the research behind it. */
export type BriefAvailability = "complete" | "partial" | "unavailable";

export type BriefSourceKey =
  | "dashboard"
  | "coverage"
  | "catalysts"
  | "insiders"
  | "institutions"
  | "signals";

/**
 * The four states a source can be in. They are kept apart because they mean
 * different things: an empty healthy feed is a collection state, a stale one is
 * an ageing read, and an unavailable one is an outage.
 */
export type BriefSourceState = "healthy" | "empty" | "stale" | "unavailable";

export interface BriefSourceStatus {
  key: BriefSourceKey;
  label: string;
  state: BriefSourceState;
  detail: string;
}

/**
 * How much of a paged feed one bounded read actually returned.
 *
 * The engine serves these feeds one page at a time and has no multi-symbol
 * filter, so a single request cannot retrieve every stored record. Reporting
 * `retrieved` against `total` is what lets the brief say its watchlist coverage
 * is partial instead of implying it is complete.
 */
export interface BriefFeedCoverage {
  retrieved: number;
  total: number;
  complete: boolean;
}

export interface BriefMarketContext {
  asOf: string | null;
  freshness: IntelFreshness;
  /** `null` when the dashboard could not be read, so no count is invented. */
  counts: ResearchDashboard["counts"] | null;
  latestFilingAt: string | null;
  latestSignalAt: string | null;
  coverageStatus: ResearchCoverageStatus;
  /** What this brief can and cannot say about market conditions. */
  priceDataNote: string;
}

export interface MarketBriefInputs {
  asOf: string;
  /**
   * Every tracked symbol with the market it belongs to. The market travels with
   * the symbol so the equity-only selection rules can exclude crypto pairs
   * without a second symbol registry.
   */
  watchlist: TrackedSymbol[];
  /** How many watchlists the symbols came from, read alongside them. */
  watchlistCount: number;
  dashboard: ResearchDashboard;
  coverage: ResearchCoverageDisclosure;
  catalysts: CatalystFeed;
  insiders: InsiderFeed;
  institutions: InstitutionFeed;
  signals: SignalFeed;
  /** Sources the engine could not be reached for. Never inferred from emptiness. */
  unreachableSources: BriefSourceKey[];
  warnings: string[];
}

export interface MarketBrief {
  /** The validated assessment instant, or `null` when none could be established. */
  asOf: string | null;
  timeBasis: BriefTimeBasis;
  watchlist: string[];
  watchlistCount: number;
  availability: BriefAvailability;
  /** True only when every source is unreachable, not when one of them is. */
  unreachable: boolean;
  sources: BriefSourceStatus[];
  warnings: string[];
  context: BriefMarketContext;
  upcomingCatalysts: Catalyst[];
  recentCatalysts: Catalyst[];
  catalystSources: CatalystSource[];
  catalystWindow: { start: string; end: string };
  insiderDisclosures: InsiderTransaction[];
  institutionalFilings: Institution[];
  signals: ResearchSignal[];
  insiderCoverage: BriefFeedCoverage;
  signalCoverage: BriefFeedCoverage;
  investigations: BriefInvestigation[];
  limitations: BriefLimitation[];
}

/* ------------------------------------------------------------------ */
/* Time                                                                */
/* ------------------------------------------------------------------ */

function parseInstant(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function dayOf(value: string | null | undefined): string | null {
  const ms = parseInstant(value);
  return ms === null ? null : new Date(ms).toISOString().slice(0, 10);
}

function daysBetween(fromDay: string, toDay: string): number {
  return Math.round(
    (Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / DAY_MS,
  );
}

/**
 * The calendar day a catalyst falls on.
 *
 * A `date_only` catalyst carries a calendar day and no clock time, so it is
 * compared as a day. Reading it as an instant would invent a time the source
 * never published.
 */
function catalystDay(catalyst: Catalyst): string | null {
  if (catalyst.scheduledDate) {
    const day = catalyst.scheduledDate.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
  }
  return dayOf(catalyst.scheduledAt);
}

function isUpcoming(catalyst: Catalyst, asOfDay: string): boolean {
  if (catalyst.status === "cancelled" || catalyst.status === "postponed") return false;
  if (catalyst.status === "published") return false;
  const day = catalystDay(catalyst);
  return day !== null && day >= asOfDay;
}

/* ------------------------------------------------------------------ */
/* Ordering                                                            */
/* ------------------------------------------------------------------ */

function byRecencyDesc(a: string | null, b: string | null): number {
  const left = parseInstant(a);
  const right = parseInstant(b);
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return right - left;
}

function compareInvestigations(a: BriefInvestigation, b: BriefInvestigation): number {
  const reason = REASON_ORDER[a.reason] - REASON_ORDER[b.reason];
  if (reason !== 0) return reason;

  const recency = byRecencyDesc(a.observedAt, b.observedAt);
  if (recency !== 0) return recency;

  const symbol = (a.symbol ?? "\uffff").localeCompare(b.symbol ?? "\uffff");
  if (symbol !== 0) return symbol;

  return a.id.localeCompare(b.id);
}

/* ------------------------------------------------------------------ */
/* Copy                                                                */
/* ------------------------------------------------------------------ */

function insiderDetail(tx: InsiderTransaction): string {
  const shares =
    tx.shares === null
      ? "an unreported number of shares"
      : `${tx.shares.toLocaleString("en-US")} shares`;
  const price =
    tx.pricePerShare === null ? "no price reported" : `$${tx.pricePerShare.toFixed(2)} per share`;
  return `${tx.reportingPersonName} (${tx.role}) reported ${shares} at ${price}.`;
}

function catalystDetail(catalyst: Catalyst): string {
  const scope = catalyst.marketWide
    ? "Market-wide"
    : catalyst.symbols.length > 0
      ? catalyst.symbols.join(", ")
      : "No symbol tagged";
  return `${scope} · ${catalyst.sourceName}`;
}

/* ------------------------------------------------------------------ */
/* Source availability                                                 */
/* ------------------------------------------------------------------ */

const SOURCE_LABELS: Record<BriefSourceKey, string> = {
  dashboard: "Research dashboard",
  coverage: "Published coverage",
  catalysts: "Catalyst Radar",
  insiders: "Insider Radar",
  institutions: "Institutional Radar",
  signals: "Signal engine",
};

function feedCoverage(retrieved: number, total: number, unreachable: boolean): BriefFeedCoverage {
  return { retrieved, total, complete: !unreachable && retrieved >= total };
}

/**
 * One status per source, so a single failed read cannot be reported as a
 * complete brief and an empty healthy feed cannot be reported as an outage.
 */
function buildSourceStatuses(inputs: MarketBriefInputs): BriefSourceStatus[] {
  const down = new Set(inputs.unreachableSources);

  const entry = (
    key: BriefSourceKey,
    state: BriefSourceState,
    detail: string,
  ): BriefSourceStatus => ({
    key,
    label: SOURCE_LABELS[key],
    state: down.has(key) ? "unavailable" : state,
    detail: down.has(key)
      ? "The engine could not be reached, so nothing was read from this source."
      : detail,
  });

  const failedCalendars = inputs.catalysts.sources.filter((source) => source.status !== "ok");
  const catalystCount = inputs.catalysts.items.length;

  return [
    entry(
      "dashboard",
      inputs.dashboard.freshness === "fresh" ? "healthy" : "stale",
      inputs.dashboard.freshness === "fresh"
        ? "Collection completed cleanly. Counts and timestamps are the engine's own."
        : `Collection is ${inputs.dashboard.freshness}. Counts and timestamps may be older than they appear.`,
    ),
    entry(
      "coverage",
      inputs.coverage.status === "complete" ? "healthy" : "stale",
      `${inputs.coverage.symbolsCovered} of ${inputs.coverage.symbolsRequested} requested symbols are covered (${inputs.coverage.status}).`,
    ),
    entry(
      "catalysts",
      failedCalendars.length > 0 ? "stale" : catalystCount === 0 ? "empty" : "healthy",
      failedCalendars.length > 0
        ? `${failedCalendars.length} of ${inputs.catalysts.sources.length} calendar sources could not be read.`
        : `${catalystCount} event${catalystCount === 1 ? "" : "s"} read from ${inputs.catalysts.sources.length} source${inputs.catalysts.sources.length === 1 ? "" : "s"}.`,
    ),
    entry(
      "insiders",
      inputs.insiders.items.length === 0 ? "empty" : "healthy",
      `${inputs.insiders.items.length} of ${inputs.insiders.total} stored filings retrieved.`,
    ),
    entry(
      "institutions",
      inputs.institutions.items.length === 0 ? "empty" : "healthy",
      `${inputs.institutions.items.length} of ${inputs.institutions.total} stored filers retrieved.`,
    ),
    entry(
      "signals",
      inputs.signals.items.length === 0 ? "empty" : "healthy",
      `${inputs.signals.items.length} of ${inputs.signals.total} stored signals retrieved.`,
    ),
  ];
}

function availabilityOf(sources: BriefSourceStatus[]): BriefAvailability {
  const unavailable = sources.filter((source) => source.state === "unavailable").length;
  if (unavailable === sources.length) return "unavailable";
  if (unavailable > 0) return "partial";
  if (sources.some((source) => source.state === "stale")) return "partial";
  return "complete";
}

/**
 * States that a paged feed was read as one bounded page.
 *
 * The engine serves these feeds one page at a time and has no multi-symbol
 * filter, so a single request cannot retrieve every stored record. Without this
 * the brief would imply that a watched symbol with no item in the retrieved
 * page has no activity at all.
 */
function addFeedCoverageLimitation(
  add: (limitation: BriefLimitation) => void,
  key: string,
  label: string,
  noun: string,
  coverage: BriefFeedCoverage,
  watched: Set<string>,
  coveredSymbols: Set<string>,
): void {
  if (coverage.complete) return;
  // An unreachable feed returns an empty payload; the source status already says so.
  if (coverage.total === 0 && coverage.retrieved === 0) return;

  const missing = [...watched].filter((symbol) => !coveredSymbols.has(symbol)).sort();
  const absence =
    missing.length === 0
      ? ""
      : ` ${missing.join(", ")} ${missing.length === 1 ? "has" : "have"} no ${noun} in that page, which is not evidence of no activity.`;

  add({
    key: `coverage:${key}`,
    label,
    detail: `The brief read the most recent ${coverage.retrieved} of ${coverage.total} stored ${noun} in one bounded request.${absence}`,
    severity: "gap",
  });
}

/* ------------------------------------------------------------------ */
/* Builder                                                             */
/* ------------------------------------------------------------------ */

/**
 * Rules 1-4 all measure against the assessment instant, so they are only
 * applied when one was established. Without it the brief cannot tell a filing
 * from last week from one from last year, and guessing would be worse than
 * saying so.
 */
function pushTimeWindowInvestigations(
  push: (item: BriefInvestigation) => void,
  inputs: MarketBriefInputs,
  watched: Set<string>,
  upcomingCatalysts: Catalyst[],
  asOfMs: number,
  asOfDay: string,
): void {
  // 1. A watched symbol has a newly published open-market disclosure.
  for (const tx of inputs.insiders.items) {
    if (!watched.has(tx.symbol) || !tx.isOpenMarket) continue;
    const published = parseInstant(tx.acceptedAt);
    if (published === null || published > asOfMs) continue;
    if (asOfMs - published > DISCLOSURE_WINDOW_DAYS * DAY_MS) continue;

    push({
      id: `disclosure:${tx.id}`,
      reason: "watched_disclosure",
      symbol: tx.symbol,
      title: `${tx.symbol} — ${CLASSIFICATION_LABEL[tx.classification].toLowerCase()} disclosed`,
      detail: insiderDetail(tx),
      href: filingHref(tx.id),
      sourceName: "SEC Form 4",
      sourceUrl: tx.sourceUrl,
      observedAt: tx.acceptedAt,
      dataQuality: tx.dataQuality,
    });
  }

  // 2. A watched symbol is tagged to a scheduled event that is approaching.
  for (const catalyst of upcomingCatalysts) {
    if (catalyst.marketWide) continue;
    const symbol = catalyst.symbols.find((candidate) => watched.has(candidate.toUpperCase()));
    if (!symbol) continue;

    const day = catalystDay(catalyst);
    if (day === null) continue;
    if (daysBetween(asOfDay, day) > SYMBOL_CATALYST_WINDOW_DAYS) continue;

    push({
      id: `catalyst:${catalyst.id}`,
      reason: "watched_catalyst",
      symbol: symbol.toUpperCase(),
      title: catalyst.title,
      detail: catalystDetail(catalyst),
      href: "/app/catalysts",
      sourceName: catalyst.sourceName,
      sourceUrl: catalyst.sourceUrl,
      observedAt: catalyst.scheduledAt ?? catalyst.scheduledDate,
      dataQuality: catalyst.timePrecision,
    });
  }

  // 3. A market-wide scheduled event falls inside the short window.
  for (const catalyst of upcomingCatalysts) {
    if (!catalyst.marketWide) continue;

    const day = catalystDay(catalyst);
    if (day === null) continue;
    if (daysBetween(asOfDay, day) > MARKET_CATALYST_WINDOW_DAYS) continue;

    push({
      id: `catalyst:${catalyst.id}`,
      reason: "market_catalyst",
      symbol: null,
      title: catalyst.title,
      detail: catalystDetail(catalyst),
      href: "/app/catalysts",
      sourceName: catalyst.sourceName,
      sourceUrl: catalyst.sourceUrl,
      observedAt: catalyst.scheduledAt ?? catalyst.scheduledDate,
      dataQuality: catalyst.timePrecision,
    });
  }

  // 4. A watched symbol has a research signal that recently became public.
  for (const signal of inputs.signals.items) {
    if (!watched.has(signal.symbol)) continue;
    const published = parseInstant(signal.publicAvailableAt);
    if (published === null || published > asOfMs) continue;
    if (asOfMs - published > SIGNAL_WINDOW_DAYS * DAY_MS) continue;

    push({
      id: `signal:${signal.id}`,
      reason: "watched_signal",
      symbol: signal.symbol,
      title: `${signal.symbol} — ${signal.category.replaceAll("_", " ").toLowerCase()}`,
      detail: signal.explanation,
      href: signalHref(signal.id),
      sourceName: "Wands signal engine",
      sourceUrl: null,
      observedAt: signal.publicAvailableAt,
      dataQuality: signal.dataQuality,
    });
  }
}

export function buildMarketBrief(inputs: MarketBriefInputs): MarketBrief {
  const asOfMs = parseInstant(inputs.asOf);
  const timeBasis: BriefTimeBasis = asOfMs === null ? "indeterminate" : "established";
  const asOfDay = asOfMs === null ? null : new Date(asOfMs).toISOString().slice(0, 10);
  // The selection rules below are equity-only: insider filings, 13F holdings and
  // research signals are SEC data. A crypto pair is tracked in the same
  // watchlist, but it must not enter that selection as though it were a ticker,
  // so the equity set is derived from the stored market type rather than from
  // the symbol's shape. The full list is still reported for display.
  const allSymbols = inputs.watchlist.map((entry) => entry.symbol);
  const watched = new Set(
    inputs.watchlist
      .filter((entry) => entry.marketType === "stocks")
      .map((entry) => entry.symbol.trim().toUpperCase()),
  );

  const sources = buildSourceStatuses(inputs);
  const availability = availabilityOf(sources);
  const dashboardDown = inputs.unreachableSources.includes("dashboard");

  const upcomingCatalysts =
    asOfDay === null
      ? []
      : inputs.catalysts.items
          .filter((catalyst) => isUpcoming(catalyst, asOfDay))
          .sort((a, b) => {
            const left = catalystDay(a) ?? "9999-12-31";
            const right = catalystDay(b) ?? "9999-12-31";
            if (left !== right) return left.localeCompare(right);
            return a.id.localeCompare(b.id);
          });

  const recentCatalysts =
    asOfDay === null
      ? []
      : inputs.catalysts.items
          .filter((catalyst) => !isUpcoming(catalyst, asOfDay))
          .sort((a, b) =>
            byRecencyDesc(a.publishedAt ?? a.occurredAt, b.publishedAt ?? b.occurredAt),
          );

  const insiderDisclosures = [...inputs.insiders.items].sort((a, b) => {
    const watchedRank = Number(watched.has(b.symbol)) - Number(watched.has(a.symbol));
    if (watchedRank !== 0) return watchedRank;
    return byRecencyDesc(a.acceptedAt, b.acceptedAt);
  });

  const institutionalFilings = [...inputs.institutions.items].sort((a, b) =>
    byRecencyDesc(a.latestPublicAvailableAt, b.latestPublicAvailableAt),
  );

  const signals = [...inputs.signals.items].sort((a, b) => {
    const watchedRank = Number(watched.has(b.symbol)) - Number(watched.has(a.symbol));
    if (watchedRank !== 0) return watchedRank;
    return byRecencyDesc(a.publicAvailableAt, b.publicAvailableAt);
  });

  const investigations: BriefInvestigation[] = [];
  const seen = new Set<string>();

  const push = (item: BriefInvestigation) => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    investigations.push(item);
  };

  // 0. The brief could not establish when it was assessed.
  if (asOfMs === null || asOfDay === null) {
    push({
      id: "time:unknown",
      reason: "time_unknown",
      symbol: null,
      title: "Assessment time could not be established",
      detail:
        "The research dashboard returned no usable assessment timestamp, so no time-window rule was applied. Records below are listed as stored; none is classified as recent or upcoming.",
      href: "/app/research",
      sourceName: "Wands research dashboard",
      sourceUrl: null,
      observedAt: null,
      dataQuality: "indeterminate",
    });
  } else {
    pushTimeWindowInvestigations(push, inputs, watched, upcomingCatalysts, asOfMs, asOfDay);
  }

  // 5. A source the brief depends on is not healthy.
  if (inputs.dashboard.freshness !== "fresh") {
    push({
      id: `stale:overall:${inputs.dashboard.freshness}`,
      reason: "source_stale",
      symbol: null,
      title: `Research collection is ${inputs.dashboard.freshness}`,
      detail:
        inputs.dashboard.freshness === "never"
          ? "No collection run has completed, so an empty brief means nothing was collected, not that nothing happened."
          : "The most recent collection did not complete cleanly. Items below may be older than they appear.",
      href: "/app/research",
      sourceName: "Wands collection status",
      sourceUrl: null,
      observedAt: inputs.dashboard.latestFilingAt,
      dataQuality: inputs.dashboard.freshness,
    });
  }

  for (const source of inputs.catalysts.sources) {
    if (source.status === "ok") continue;
    push({
      id: `stale:catalyst:${source.source}`,
      reason: "source_stale",
      symbol: null,
      title: `${source.label} could not be read`,
      detail: source.detail,
      href: "/app/catalysts",
      sourceName: source.label,
      sourceUrl: source.sourceUrl,
      observedAt: source.fetchedAt,
      dataQuality: source.status,
    });
  }

  if (inputs.coverage.status === "insufficient" || inputs.coverage.status === "unavailable") {
    push({
      id: `stale:coverage:${inputs.coverage.status}`,
      reason: "source_stale",
      symbol: null,
      title: `Published coverage is ${inputs.coverage.status}`,
      detail: `${inputs.coverage.symbolsCovered} of ${inputs.coverage.symbolsRequested} requested symbols are covered. What is stored cannot support a complete reading.`,
      href: "/app/research",
      sourceName: "Wands coverage disclosure",
      sourceUrl: null,
      observedAt: inputs.coverage.windowEnd,
      dataQuality: inputs.coverage.status,
    });
  }

  const ordered = investigations.sort(compareInvestigations).slice(0, MAX_INVESTIGATIONS);

  const insiderCoverage = feedCoverage(
    inputs.insiders.items.length,
    inputs.insiders.total,
    inputs.unreachableSources.includes("insiders"),
  );
  const signalCoverage = feedCoverage(
    inputs.signals.items.length,
    inputs.signals.total,
    inputs.unreachableSources.includes("signals"),
  );

  /* -- limitations ------------------------------------------------- */

  const limitations: BriefLimitation[] = [];
  const limitationKeys = new Set<string>();

  const addLimitation = (limitation: BriefLimitation) => {
    if (limitationKeys.has(limitation.key)) return;
    limitationKeys.add(limitation.key);
    limitations.push(limitation);
  };

  if (timeBasis === "indeterminate") {
    addLimitation({
      key: "time:unknown",
      label: "No assessment time",
      detail:
        "The brief could not establish when it was assessed, so it does not claim that any disclosure, event or signal is recent or upcoming. Nothing here is measured against the current clock.",
      severity: "gap",
    });
  }

  addFeedCoverageLimitation(
    addLimitation,
    "insiders",
    "Insider feed read is partial",
    "filings",
    insiderCoverage,
    watched,
    new Set(inputs.insiders.items.map((tx) => tx.symbol)),
  );
  addFeedCoverageLimitation(
    addLimitation,
    "signals",
    "Signal feed read is partial",
    "signals",
    signalCoverage,
    watched,
    new Set(inputs.signals.items.map((signal) => signal.symbol)),
  );

  for (const gap of inputs.coverage.gaps) {
    addLimitation({
      key: `gap:${gap.key}`,
      label: gap.label,
      detail: gap.detail,
      severity: "gap",
    });
  }

  for (const source of inputs.catalysts.sources) {
    if (source.status === "ok") continue;
    addLimitation({
      key: `source:${source.source}`,
      label: `${source.label} unavailable`,
      detail: source.detail,
      severity: "gap",
    });
  }

  const presentCategories = new Set(inputs.catalysts.items.map((catalyst) => catalyst.category));
  if (!presentCategories.has("earnings")) {
    addLimitation({
      key: "category:earnings",
      label: "No earnings calendar",
      detail:
        "Wands does not ingest scheduled earnings dates, so no earnings event can appear in this brief. This is a coverage gap, not a quiet period.",
      severity: "gap",
    });
  }
  if (!presentCategories.has("economic_release")) {
    addLimitation({
      key: "category:economic_release",
      label: "No macroeconomic release calendar",
      detail:
        "Non-FOMC releases (CPI, employment, GDP) are not ingested. The only scheduled-event source is the Federal Reserve FOMC calendar.",
      severity: "gap",
    });
  }

  addLimitation({
    key: "market:index",
    label: "No market-wide performance data",
    detail:
      "No index, volatility or price-change series is part of the research contract. Wands stores per-symbol daily price history, shown on each asset page with its own coverage disclosure. This brief reports the state of the research pipeline, not market performance.",
    severity: "gap",
  });

  addLimitation({
    key: "institutional:delay",
    label: "13F filings are quarterly and delayed",
    detail:
      "An institutional filing reports a position as of a quarter end and becomes public up to 45 days later. It is a historical snapshot, never live buying or selling.",
    severity: "caveat",
  });

  addLimitation({
    key: "insider:dates",
    label: "Transaction date is not publication date",
    detail:
      "An insider transaction date is when the trade happened. The filing date is when it became public. Only the filing date is used to decide whether a disclosure is new.",
    severity: "caveat",
  });

  for (const caveat of inputs.coverage.caveats) {
    addLimitation({
      key: `coverage:${caveat}`,
      label: "Coverage caveat",
      detail: caveat,
      severity: "caveat",
    });
  }

  for (const caveat of inputs.dashboard.caveats) {
    addLimitation({
      key: `dashboard:${caveat}`,
      label: "Collection caveat",
      detail: caveat,
      severity: "caveat",
    });
  }

  for (const caveat of inputs.catalysts.coverageLimitations) {
    addLimitation({
      key: `catalyst:${caveat}`,
      label: "Catalyst coverage",
      detail: caveat,
      severity: "caveat",
    });
  }

  return {
    asOf: asOfMs === null ? null : inputs.asOf,
    timeBasis,
    watchlist: [...allSymbols].sort(),
    watchlistCount: inputs.watchlistCount,
    availability,
    unreachable: availability === "unavailable",
    sources,
    warnings: [...new Set(inputs.warnings)],
    context: {
      asOf: asOfMs === null ? null : inputs.asOf,
      freshness: inputs.dashboard.freshness,
      counts: dashboardDown ? null : inputs.dashboard.counts,
      latestFilingAt: inputs.dashboard.latestFilingAt,
      latestSignalAt: inputs.dashboard.latestSignalAt,
      coverageStatus: inputs.coverage.status,
      priceDataNote:
        "This brief reports what Wands has collected and when, not how the market performed. No index, volatility or price-change series is available to it.",
    },
    upcomingCatalysts,
    recentCatalysts,
    catalystSources: inputs.catalysts.sources,
    catalystWindow: { start: inputs.catalysts.windowStart, end: inputs.catalysts.windowEnd },
    insiderDisclosures,
    institutionalFilings,
    signals,
    insiderCoverage,
    signalCoverage,
    investigations: ordered,
    limitations,
  };
}
