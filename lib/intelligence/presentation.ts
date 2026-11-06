import type {
  DataProvenance,
  InsiderTransaction,
  InsiderTransactionClass,
  IntelBackfillStatus,
  IntelCoverage,
  IntelExperimentStatus,
  IntelFreshness,
  IntelJob,
  IntelJobStatus,
  IntelValidationStatus,
  ResearchSignal,
  ResearchSignalCategory,
} from "@/lib/api/contracts";
import type { StatusTone } from "@/lib/status";
import { formatDuration } from "@/lib/format";

/**
 * Presentation rules for the research terminal.
 *
 * Everything here is pure so it can be tested without a browser or an engine.
 * The rules encode the claims the backend is willing to make: a score is a
 * ranking, a 13F holding is a quarterly snapshot, and a missing value is never
 * a zero.
 */

/* --- signal categories ---------------------------------------------------- */

const CATEGORY_LABELS: Record<ResearchSignalCategory, string> = {
  INSIDER_PURCHASE_CLUSTER: "Insider purchase cluster",
  INSIDER_PURCHASE_VALUE: "Insider purchase value",
  INSIDER_ACTIVITY_CHANGE: "Insider activity change",
  INSIDER_SELLING_CLUSTER: "Insider selling cluster",
  INSTITUTIONAL_POSITION_CHANGE: "Institutional position change",
  MARKET_TREND: "Market trend",
  VOLUME_ANOMALY: "Volume anomaly",
};

export const SIGNAL_CATEGORIES = Object.keys(
  CATEGORY_LABELS,
) as ResearchSignalCategory[];

export function signalCategoryLabel(category: string): string {
  return CATEGORY_LABELS[category as ResearchSignalCategory] ?? category;
}

/** Insider categories are about people; market categories are about prices. */
export function signalCategoryFamily(
  category: string,
): "insider" | "institutional" | "market" {
  if (category.startsWith("INSIDER_")) return "insider";
  if (category.startsWith("INSTITUTIONAL_")) return "institutional";
  return "market";
}

/* --- insider transaction classes ------------------------------------------ */

const CLASS_LABELS: Record<InsiderTransactionClass, string> = {
  open_market_purchase: "Open-market purchase",
  open_market_sale: "Open-market sale",
  award_grant: "Award or grant",
  tax_withholding: "Tax withholding",
  gift: "Gift",
  derivative_exercise: "Derivative exercise",
  disposition_to_issuer: "Disposition to issuer",
  other: "Other",
};

export function insiderClassLabel(classification: string): string {
  return (
    CLASS_LABELS[classification as InsiderTransactionClass] ?? classification
  );
}

/**
 * Only an open-market purchase or sale is a decision to trade in the market.
 * Everything else moves shares for another reason and must not be coloured as
 * buying or selling.
 */
export function isOpenMarketClass(classification: string): boolean {
  return (
    classification === "open_market_purchase" ||
    classification === "open_market_sale"
  );
}

export function insiderClassTone(classification: string): StatusTone {
  if (classification === "open_market_purchase") return "profit";
  if (classification === "open_market_sale") return "loss";
  return "muted";
}

/** The direction a transaction implies, or `null` when it implies none. */
export function insiderDirection(
  classification: string,
): "buy" | "sell" | null {
  if (classification === "open_market_purchase") return "buy";
  if (classification === "open_market_sale") return "sell";
  return null;
}

/* --- freshness ------------------------------------------------------------ */

const FRESHNESS: Record<IntelFreshness, { label: string; tone: StatusTone }> = {
  fresh: { label: "Fresh", tone: "profit" },
  stale: { label: "Stale", tone: "primary" },
  never: { label: "Never collected", tone: "muted" },
  failing: { label: "Failing", tone: "loss" },
};

export function freshnessStatus(freshness: string): {
  label: string;
  tone: StatusTone;
} {
  return FRESHNESS[freshness as IntelFreshness] ?? { label: freshness, tone: "muted" };
}

/** A feed that is not fresh must say so rather than looking populated. */
export function freshnessCaveat(freshness: string): string | null {
  switch (freshness) {
    case "fresh":
      return null;
    case "stale":
      return "Collection has not completed recently. Figures below are the last stored values, not the current state of the world.";
    case "never":
      return "No collection run has completed. An empty feed here means nothing has been collected, not that nothing happened.";
    case "failing":
      return "The most recent collection attempts failed. Stored data is older than the schedule implies.";
    default:
      return null;
  }
}

/* --- data quality --------------------------------------------------------- */

export function dataQualityTone(quality: string): StatusTone {
  switch (quality) {
    case "reported":
      return "profit";
    case "derived":
      return "primary";
    case "incomplete":
      return "primary";
    case "unavailable":
      return "muted";
    default:
      return "muted";
  }
}

export function dataQualityLabel(quality: string): string {
  switch (quality) {
    case "reported":
      return "Reported";
    case "derived":
      return "Derived";
    case "incomplete":
      return "Incomplete";
    case "unavailable":
      return "Unavailable";
    default:
      return quality;
  }
}

/* --- research score ------------------------------------------------------- */

/**
 * A bounded 0-100 research ranking. It is not a probability and must never be
 * rendered as one, so the label travels with the number everywhere.
 */
export function scoreTone(score: number | null): StatusTone {
  if (score === null) return "muted";
  if (score >= 70) return "profit";
  if (score >= 40) return "primary";
  return "muted";
}

export function formatScore(score: number | null): string {
  if (score === null) return "—";
  return score.toFixed(0);
}

export function scoreBand(score: number | null): string {
  if (score === null) return "No score";
  if (score >= 70) return "High";
  if (score >= 40) return "Moderate";
  return "Low";
}

/* --- provenance ----------------------------------------------------------- */

export function provenanceLabel(provenance: DataProvenance): string {
  switch (provenance) {
    case "live":
      return "Engine";
    case "demo":
      return "Demo fixture";
    case "unavailable":
      return "Unavailable";
  }
}

/* --- jobs ----------------------------------------------------------------- */

const JOB_STATUS: Record<IntelJobStatus, { label: string; tone: StatusTone }> = {
  idle: { label: "Idle", tone: "muted" },
  running: { label: "Running", tone: "profit" },
  failed: { label: "Failed", tone: "loss" },
  paused: { label: "Paused", tone: "primary" },
  interrupted: { label: "Interrupted", tone: "loss" },
};

export function jobStatus(job: Pick<IntelJob, "status" | "paused">): {
  label: string;
  tone: StatusTone;
} {
  if (job.paused) return { label: "Paused", tone: "primary" };
  return JOB_STATUS[job.status] ?? { label: job.status, tone: "muted" };
}

/** A job that has failed repeatedly is a warning even while it is idle. */
export function jobHealth(job: IntelJob): {
  label: string;
  tone: StatusTone;
} {
  if (job.consecutiveFailures >= 3) {
    return { label: `${job.consecutiveFailures} consecutive failures`, tone: "loss" };
  }
  if (job.consecutiveFailures > 0) {
    return { label: `${job.consecutiveFailures} consecutive failures`, tone: "primary" };
  }
  if (!job.enabled) return { label: "Disabled", tone: "muted" };
  return { label: "Healthy", tone: "profit" };
}

/**
 * When a job is next expected to run. A scheduled time in the past means the
 * scheduler is not keeping up, which is worth saying rather than rendering as
 * "268d ago" next to the word "next".
 */
export function nextRunLabel(
  iso: string | null,
  now: number = Date.now(),
): { label: string; overdue: boolean } {
  if (!iso) return { label: "not scheduled", overdue: false };
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return { label: "not scheduled", overdue: false };

  const deltaSeconds = Math.round((at - now) / 1000);
  if (deltaSeconds < 0) {
    return {
      label: `overdue by ${formatDuration(Math.abs(deltaSeconds))}`,
      overdue: true,
    };
  }
  return { label: `in ${formatDuration(deltaSeconds)}`, overdue: false };
}

/* --- backfill ------------------------------------------------------------- */

const BACKFILL_STATUS: Record<
  IntelBackfillStatus,
  { label: string; tone: StatusTone }
> = {
  pending: { label: "Pending", tone: "muted" },
  running: { label: "Running", tone: "primary" },
  complete: { label: "Complete", tone: "profit" },
  paused: { label: "Paused", tone: "primary" },
  failed: { label: "Failed", tone: "loss" },
};

export function backfillStatus(status: string): {
  label: string;
  tone: StatusTone;
} {
  return (
    BACKFILL_STATUS[status as IntelBackfillStatus] ?? {
      label: status,
      tone: "muted",
    }
  );
}

/* --- experiments ---------------------------------------------------------- */

const EXPERIMENT_STATUS: Record<
  IntelExperimentStatus,
  { label: string; tone: StatusTone }
> = {
  complete: { label: "Complete", tone: "profit" },
  insufficient_data: { label: "Insufficient data", tone: "primary" },
  no_price_data: { label: "No price data", tone: "loss" },
  failed: { label: "Failed", tone: "loss" },
};

export function experimentStatus(status: string): {
  label: string;
  tone: StatusTone;
} {
  return (
    EXPERIMENT_STATUS[status as IntelExperimentStatus] ?? {
      label: status,
      tone: "muted",
    }
  );
}

const VALIDATION_STATUS: Record<
  IntelValidationStatus,
  { label: string; tone: StatusTone }
> = {
  complete: { label: "Complete", tone: "profit" },
  insufficient_sample: { label: "Insufficient sample", tone: "primary" },
  no_price_data: { label: "No price data", tone: "loss" },
  no_signals: { label: "No signals", tone: "muted" },
};

export function validationStatus(status: string): {
  label: string;
  tone: StatusTone;
} {
  return (
    VALIDATION_STATUS[status as IntelValidationStatus] ?? {
      label: status,
      tone: "muted",
    }
  );
}

/**
 * What kind of claim a result is. A descriptive event study measures what
 * happened after an event; a simulation adds fills and costs. Neither is a
 * realised account result, and the UI states that separately.
 */
export function claimType(experiment: {
  executionAssumptions: Record<string, unknown>;
  costAssumptions: Record<string, unknown>;
  metrics: Record<string, unknown>;
}): { label: string; detail: string } {
  const costBps = numberOrNull(experiment.metrics.costBps);
  const simulated =
    Object.keys(experiment.executionAssumptions).length > 0 ||
    Object.keys(experiment.costAssumptions).length > 0 ||
    (costBps !== null && costBps > 0);

  return simulated
    ? {
        label: "Hypothetical simulation",
        detail:
          "Forward returns with modelled fills and estimated costs. Not a realised account result.",
      }
    : {
        label: "Descriptive event study",
        detail:
          "Observed forward returns after each event. No fills, no costs, no account.",
      };
}

/* --- typed readers for free-form payloads --------------------------------- */

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record) : [];
}

export interface HorizonRow {
  horizonDays: number;
  sampleSize: number;
  mean: number | null;
  median: number | null;
  hitRate: number | null;
  standardDeviation: number | null;
  min: number | null;
  max: number | null;
  intervalLower: number | null;
  intervalUpper: number | null;
  confidence: number | null;
  pValue: number | null;
  significant: boolean | null;
  benchmarkMean: number | null;
  excessMean: number | null;
  excessLower: number | null;
  excessUpper: number | null;
  smallSample: boolean;
}

/**
 * Reads the horizon block of an experiment's metrics. Every statistic is
 * nullable: a horizon with no usable sample reports `null`, never `0`.
 */
export function readHorizons(metrics: Record<string, unknown>): HorizonRow[] {
  return records(metrics.horizons).map((horizon) => {
    const descriptive = record(horizon.descriptive);
    const interval = record(horizon.meanInterval);
    const significance = record(horizon.significance);
    const benchmark = record(horizon.benchmark);
    const excess = record(horizon.excess);
    const excessInterval = record(horizon.excessInterval);

    return {
      horizonDays: numberOrNull(horizon.horizonDays) ?? 0,
      sampleSize: numberOrNull(horizon.sampleSize) ?? 0,
      mean: numberOrNull(descriptive.mean),
      median: numberOrNull(descriptive.median),
      hitRate: numberOrNull(descriptive.hitRate),
      standardDeviation: numberOrNull(descriptive.standardDeviation),
      min: numberOrNull(descriptive.min),
      max: numberOrNull(descriptive.max),
      intervalLower: numberOrNull(interval.lower),
      intervalUpper: numberOrNull(interval.upper),
      confidence: numberOrNull(interval.confidence),
      pValue: numberOrNull(significance.pValue),
      significant:
        typeof significance.significant === "boolean"
          ? significance.significant
          : null,
      benchmarkMean: numberOrNull(benchmark.mean),
      excessMean: numberOrNull(excess.mean),
      excessLower: numberOrNull(excessInterval.lower),
      excessUpper: numberOrNull(excessInterval.upper),
      smallSample: descriptive.smallSample === true,
    };
  });
}

export interface SplitRow {
  label: string;
  sampleSize: number;
  mean: number | null;
  hitRate: number | null;
  excessMean: number | null;
}

export function readSplits(metrics: Record<string, unknown>): SplitRow[] {
  return records(metrics.splits).map((split) => {
    const descriptive = record(split.descriptive);
    const excess = record(split.excess);
    return {
      label: String(split.label ?? split.name ?? split.kind ?? "Split"),
      sampleSize: numberOrNull(split.sampleSize) ?? 0,
      mean: numberOrNull(descriptive.mean),
      hitRate: numberOrNull(descriptive.hitRate),
      excessMean: numberOrNull(excess.mean),
    };
  });
}

/** True when an experiment carries at least one measurable horizon. */
export function hasMeasuredHorizons(metrics: Record<string, unknown>): boolean {
  return readHorizons(metrics).some(
    (row) => row.sampleSize > 0 && row.mean !== null,
  );
}

/* --- coverage ------------------------------------------------------------- */

export interface IdentifierCoverage {
  mappings: number;
  distinctCusips: number;
  verifiedCusips: number;
  unresolvedCusips: number;
  fusionEligible: number;
  resolvedPct: number | null;
  byStatus: { status: string; count: number }[];
  sources: string[];
}

export function readIdentifierCoverage(
  identifiers: Record<string, unknown>,
): IdentifierCoverage {
  const distinct = numberOrNull(identifiers.distinctCusips) ?? 0;
  const verified = numberOrNull(identifiers.verifiedCusips) ?? 0;
  const byStatus = record(identifiers.byStatus);

  return {
    mappings: numberOrNull(identifiers.mappings) ?? 0,
    distinctCusips: distinct,
    verifiedCusips: verified,
    unresolvedCusips: numberOrNull(identifiers.unresolvedCusips) ?? 0,
    fusionEligible: numberOrNull(identifiers.fusionEligible) ?? 0,
    resolvedPct: distinct > 0 ? (verified / distinct) * 100 : null,
    byStatus: Object.entries(byStatus)
      .map(([status, count]) => ({ status, count: numberOrNull(count) ?? 0 }))
      .sort((a, b) => b.count - a.count),
    sources: Array.isArray(identifiers.sources)
      ? identifiers.sources.filter((s): s is string => typeof s === "string")
      : [],
  };
}

export interface PriceCoverage {
  symbolsWithSignals: number;
  symbolsWithDailyBars: number;
  missing: string[];
  note: string;
  coveredPct: number | null;
}

export function readPriceCoverage(
  priceCoverage: Record<string, unknown>,
): PriceCoverage {
  const withSignals = numberOrNull(priceCoverage.symbolsWithSignals) ?? 0;
  const withBars = numberOrNull(priceCoverage.symbolsWithDailyBars) ?? 0;

  return {
    symbolsWithSignals: withSignals,
    symbolsWithDailyBars: withBars,
    missing: Array.isArray(priceCoverage.missing)
      ? priceCoverage.missing.filter((s): s is string => typeof s === "string")
      : [],
    note: typeof priceCoverage.note === "string" ? priceCoverage.note : "",
    coveredPct: withSignals > 0 ? (withBars / withSignals) * 100 : null,
  };
}

export interface CoverageGap {
  label: string;
  detail: string;
  severity: "blocking" | "warning" | "info";
}

/**
 * The gaps that decide whether a hypothesis can be evaluated at all. Ordered
 * worst first so the blocking problem is the one that is read.
 */
export function coverageGaps(coverage: IntelCoverage): CoverageGap[] {
  const gaps: CoverageGap[] = [];
  const identifiers = readIdentifierCoverage(coverage.identifiers);
  const prices = readPriceCoverage(coverage.priceCoverage);

  if (coverage.filings === 0) {
    gaps.push({
      label: "No filings collected",
      detail:
        "Nothing has been ingested, so no signal can be computed. Run a bounded backfill or wait for the collector.",
      severity: "blocking",
    });
  }

  if (coverage.signals === 0 && coverage.filings > 0) {
    gaps.push({
      label: "No signals produced",
      detail:
        "Filings are stored but no configured threshold has been met. An empty signal feed is expected for most symbols.",
      severity: "warning",
    });
  }

  if (identifiers.distinctCusips > 0 && identifiers.unresolvedCusips > 0) {
    gaps.push({
      label: `${identifiers.unresolvedCusips} unresolved CUSIP${identifiers.unresolvedCusips === 1 ? "" : "s"}`,
      detail:
        "13F holdings keyed by an unresolved CUSIP cannot be attributed to a symbol, so they are omitted from fusion rankings rather than approximated.",
      severity: "warning",
    });
  }

  if (prices.symbolsWithSignals > 0 && prices.missing.length > 0) {
    gaps.push({
      label: `${prices.missing.length} symbol${prices.missing.length === 1 ? "" : "s"} without daily bars`,
      detail:
        "A symbol without daily bars cannot be validated. Its signals count toward the sample but produce no return.",
      severity: "warning",
    });
  }

  const malformed = coverage.backfill.reduce(
    (total, stream) => total + stream.filingsMalformed,
    0,
  );
  if (malformed > 0) {
    gaps.push({
      label: `${malformed} malformed filing${malformed === 1 ? "" : "s"}`,
      detail:
        "These documents were fetched but could not be parsed, so their transactions are absent from every count on this page.",
      severity: "warning",
    });
  }

  const unavailable = coverage.backfill.reduce(
    (total, stream) => total + stream.filingsUnavailable,
    0,
  );
  if (unavailable > 0) {
    gaps.push({
      label: `${unavailable} filing${unavailable === 1 ? "" : "s"} could not be fetched`,
      detail:
        "The SEC index listed these documents but the request failed. They are missing from the sample, not known to be empty.",
      severity: "info",
    });
  }

  return gaps;
}

/** A plain-language verdict on whether the stored data supports research. */
export function researchReadiness(coverage: IntelCoverage): {
  verdict: string;
  detail: string;
  tone: StatusTone;
} {
  const gaps = coverageGaps(coverage);
  const blocking = gaps.filter((gap) => gap.severity === "blocking");

  if (blocking.length > 0) {
    return {
      verdict: "Not enough data to evaluate a hypothesis",
      detail: blocking[0].detail,
      tone: "loss",
    };
  }

  const warnings = gaps.filter((gap) => gap.severity === "warning");
  if (warnings.length > 0) {
    return {
      verdict: "Usable with stated limitations",
      detail: `${warnings.length} coverage gap${warnings.length === 1 ? "" : "s"} limit what a result can claim. Read them before trusting a statistic.`,
      tone: "primary",
    };
  }

  return {
    verdict: "Coverage is complete for the stored universe",
    detail:
      "No blocking gap was detected. This says the data is present, not that a signal is profitable.",
    tone: "profit",
  };
}

/* --- derived views over a loaded page ------------------------------------- */

export interface CategoryCount {
  category: ResearchSignalCategory;
  label: string;
  count: number;
  share: number;
}

/**
 * Category distribution across the signals actually loaded. The API has no
 * aggregate endpoint, so this is a page-level count and the UI labels it as
 * such rather than implying a global distribution.
 */
export function signalDistribution(signals: ResearchSignal[]): CategoryCount[] {
  const counts = new Map<ResearchSignalCategory, number>();
  for (const signal of signals) {
    counts.set(signal.category, (counts.get(signal.category) ?? 0) + 1);
  }
  const total = signals.length;

  return [...counts.entries()]
    .map(([category, count]) => ({
      category,
      label: signalCategoryLabel(category),
      count,
      share: total > 0 ? (count / total) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count);
}

export function distinctReportingPersons(
  transactions: InsiderTransaction[],
): number {
  return new Set(transactions.map((t) => t.reportingPersonCik)).size;
}

export function distinctIssuers(transactions: InsiderTransaction[]): number {
  return new Set(transactions.map((t) => t.symbol)).size;
}

/** Transactions whose reported value is absent. Never counted as zero. */
export function unpricedTransactions(
  transactions: InsiderTransaction[],
): InsiderTransaction[] {
  return transactions.filter((t) => t.value === null);
}

export function totalReportedValue(
  transactions: InsiderTransaction[],
): number | null {
  const priced = transactions.filter(
    (t): t is InsiderTransaction & { value: number } => t.value !== null,
  );
  if (priced.length === 0) return null;
  return priced.reduce((total, t) => total + t.value, 0);
}

/* --- filtering ------------------------------------------------------------ */

export interface SignalFilters {
  symbol: string;
  category: string;
  minScore: number;
  dataQuality: string;
  availability: "any" | "24h" | "7d" | "30d";
}

export const EMPTY_SIGNAL_FILTERS: SignalFilters = {
  symbol: "",
  category: "",
  minScore: 0,
  dataQuality: "",
  availability: "any",
};

const AVAILABILITY_WINDOW_MS: Record<
  Exclude<SignalFilters["availability"], "any">,
  number
> = {
  "24h": 86_400_000,
  "7d": 604_800_000,
  "30d": 2_592_000_000,
};

/**
 * Refines the signals already on the page. Server-side filters (`symbol`,
 * `category`) are applied by the engine; this only narrows what was returned,
 * and the UI says so.
 */
export function filterSignals(
  signals: ResearchSignal[],
  filters: SignalFilters,
  now: number = Date.now(),
): ResearchSignal[] {
  const symbol = filters.symbol.trim().toUpperCase();

  return signals.filter((signal) => {
    if (symbol && signal.symbol.toUpperCase() !== symbol) return false;
    if (filters.category && signal.category !== filters.category) return false;
    if (filters.minScore > 0) {
      if (signal.score === null || signal.score < filters.minScore) return false;
    }
    if (filters.dataQuality && signal.dataQuality !== filters.dataQuality) {
      return false;
    }
    if (filters.availability !== "any") {
      const published = new Date(signal.publicAvailableAt).getTime();
      if (Number.isNaN(published)) return false;
      if (now - published > AVAILABILITY_WINDOW_MS[filters.availability]) {
        return false;
      }
    }
    return true;
  });
}

export function activeFilterCount(filters: SignalFilters): number {
  let count = 0;
  if (filters.symbol.trim()) count += 1;
  if (filters.category) count += 1;
  if (filters.minScore > 0) count += 1;
  if (filters.dataQuality) count += 1;
  if (filters.availability !== "any") count += 1;
  return count;
}

/* --- sorting -------------------------------------------------------------- */

export type SortDirection = "asc" | "desc";

export function sortRows<T>(
  rows: T[],
  value: (row: T) => number | string | null,
  direction: SortDirection,
): T[] {
  const factor = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = value(a);
    const right = value(b);
    // A missing value sorts last in either direction: it is not a small number.
    if (left === null && right === null) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    if (typeof left === "number" && typeof right === "number") {
      return (left - right) * factor;
    }
    return String(left).localeCompare(String(right)) * factor;
  });
}

/* --- timestamps ----------------------------------------------------------- */

/**
 * The two timestamps that must never be conflated: when the activity happened,
 * and when it became knowable. A backtest may only use the second.
 */
export function timestampPair(eventTime: string, publicAvailableAt: string): {
  event: string;
  published: string;
  lagSeconds: number | null;
} {
  const event = new Date(eventTime).getTime();
  const published = new Date(publicAvailableAt).getTime();
  const lag =
    Number.isNaN(event) || Number.isNaN(published)
      ? null
      : Math.max(0, Math.round((published - event) / 1000));

  return { event: eventTime, published: publicAvailableAt, lagSeconds: lag };
}
