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
  watched_disclosure: 0,
  watched_catalyst: 1,
  market_catalyst: 2,
  watched_signal: 3,
  source_stale: 4,
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

export interface BriefMarketContext {
  asOf: string;
  freshness: IntelFreshness;
  counts: ResearchDashboard["counts"];
  latestFilingAt: string | null;
  latestSignalAt: string | null;
  coverageStatus: ResearchCoverageStatus;
  /** What this brief can and cannot say about market conditions. */
  priceDataNote: string;
}

export interface MarketBriefInputs {
  asOf: string;
  watchlist: string[];
  dashboard: ResearchDashboard;
  coverage: ResearchCoverageDisclosure;
  catalysts: CatalystFeed;
  insiders: InsiderFeed;
  institutions: InstitutionFeed;
  signals: SignalFeed;
  unreachable: boolean;
  warnings: string[];
}

export interface MarketBrief {
  asOf: string;
  watchlist: string[];
  unreachable: boolean;
  warnings: string[];
  context: BriefMarketContext;
  upcomingCatalysts: Catalyst[];
  recentCatalysts: Catalyst[];
  catalystSources: CatalystSource[];
  catalystWindow: { start: string; end: string };
  insiderDisclosures: InsiderTransaction[];
  institutionalFilings: Institution[];
  signals: ResearchSignal[];
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
/* Builder                                                             */
/* ------------------------------------------------------------------ */

export function buildMarketBrief(inputs: MarketBriefInputs): MarketBrief {
  const asOfMs = parseInstant(inputs.asOf) ?? Date.now();
  const asOfDay = new Date(asOfMs).toISOString().slice(0, 10);
  const watched = new Set(inputs.watchlist.map((symbol) => symbol.trim().toUpperCase()));

  const upcomingCatalysts = inputs.catalysts.items
    .filter((catalyst) => isUpcoming(catalyst, asOfDay))
    .sort((a, b) => {
      const left = catalystDay(a) ?? "9999-12-31";
      const right = catalystDay(b) ?? "9999-12-31";
      if (left !== right) return left.localeCompare(right);
      return a.id.localeCompare(b.id);
    });

  const recentCatalysts = inputs.catalysts.items
    .filter((catalyst) => !isUpcoming(catalyst, asOfDay))
    .sort((a, b) => byRecencyDesc(a.publishedAt ?? a.occurredAt, b.publishedAt ?? b.occurredAt));

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

  /* -- limitations ------------------------------------------------- */

  const limitations: BriefLimitation[] = [];
  const limitationKeys = new Set<string>();

  const addLimitation = (limitation: BriefLimitation) => {
    if (limitationKeys.has(limitation.key)) return;
    limitationKeys.add(limitation.key);
    limitations.push(limitation);
  };

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
    asOf: inputs.asOf,
    watchlist: [...watched].sort(),
    unreachable: inputs.unreachable,
    warnings: [...new Set(inputs.warnings)],
    context: {
      asOf: inputs.asOf,
      freshness: inputs.dashboard.freshness,
      counts: inputs.dashboard.counts,
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
    investigations: ordered,
    limitations,
  };
}
