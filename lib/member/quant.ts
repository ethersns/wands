import type { QuantExperiment } from "@/lib/api/research-contract";

export type QuantTone = "neutral" | "accent" | "warn" | "emerald";

/**
 * A missing number is an em dash, never a zero.
 *
 * "No benchmark bar covered this window" and "the strategy returned nothing" are
 * different claims, and a zero would collapse them into one.
 */
export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;
}

export function formatRatio(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toFixed(digits);
}

/** A share of something, with no sign: exposure, win rate, coverage. */
export function formatShare(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

/**
 * A difference between two returns, in percentage points.
 *
 * Subtracting one return from another gives points, not a return: a rule that
 * made +49.4% against a +162.8% hold is 113.4 points behind, not down 113.4%.
 */
export function formatPoints(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)} pp`;
}

/** `meanExcessVsMatched` -> `Mean excess vs matched`. */
export function humanizeKey(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .trim()
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * A p-value at the precision the test can actually support.
 *
 * `0.000` claims the probability is zero, which no finite sample can establish.
 * Below the reporting floor the honest form is a bound, and above it two
 * significant figures is as much as a t test on this many observations earns.
 */
export function formatPValue(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (value < 0) return "—";
  if (value < 0.0001) return "< 0.0001";
  if (value > 1) return "—";
  return value.toPrecision(2);
}

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-US").format(value);
}

export function statusTone(status: string): QuantTone {
  if (status === "complete") return "emerald";
  if (
    status === "insufficient_data" ||
    status === "no_data" ||
    status === "no_price_data"
  ) {
    return "warn";
  }
  return "neutral";
}

export function statusLabel(status: string): string {
  switch (status) {
    case "complete":
      return "Measured";
    case "insufficient_data":
      return "Insufficient data";
    case "no_price_data":
      return "No price data";
    case "no_data":
      return "No data";
    default:
      return status.replace(/_/g, " ");
  }
}

/**
 * The tone for an evaluation status.
 *
 * Only a genuinely held-out result is independent evidence, so it is the only
 * one that reads as a clean pass. A retrospective result is a warning rather
 * than a failure: it is a real measurement whose independence is limited, and
 * the label says which.
 */
export function evaluationTone(status: string | undefined): QuantTone {
  if (status === "held_out") return "emerald";
  if (status === "retrospective_validation") return "warn";
  return "neutral";
}

export function studyLabel(study: string | undefined): string {
  switch (study) {
    case "strategy_baseline":
      return "Strategy baseline";
    case "institutional_holdings_study":
      return "Institutional holdings";
    case "insider_purchase_event_study":
      return "Insider purchases";
    default:
      return "Research study";
  }
}

/**
 * The one number that best describes an experiment, chosen per study.
 *
 * A strategy is judged on its excess over holding the same instrument over the
 * same bars, not on its raw return: a rule that made 50% while the stock made
 * 160% lost. It is also not judged against a benchmark that was invested for
 * the whole period while the rule sat in cash, so the headline uses the
 * exposure-matched comparison. The holdings study has no single headline, so it
 * reports the event count and says what kind of event it is.
 */
export function headline(experiment: QuantExperiment): {
  label: string;
  value: string;
  hint: string;
} {
  const result = experiment.metrics;

  if (result?.study === "strategy_baseline" && result.summary) {
    const summary = result.summary;
    return {
      label: "Excess vs matched hold",
      value: formatPercent(summary.meanExcessVsMatched),
      hint: `${formatCount(summary.tradeCount)} trades, ${formatPercent(
        summary.meanStrategyReturn,
      )} vs ${formatPercent(summary.meanMatchedBenchmarkReturn)} on the same ${formatShare(
        summary.meanExposure,
        0,
      )} of bars`,
    };
  }

  if (result?.study === "institutional_holdings_study") {
    return {
      label: "Position changes",
      value: formatCount(result.sampleSize),
      hint: "13F filings, not real-time purchases",
    };
  }

  if (result?.study === "insider_purchase_event_study") {
    return {
      label: "Qualifying purchases",
      value: formatCount(result.sampleSize),
      hint: "Open-market purchases public in the window",
    };
  }

  return {
    label: "Observations",
    value: formatCount(result?.sampleSize ?? experiment.sampleSize),
    hint: "See the study for coverage",
  };
}

/** The period a study covers, as a single readable range. */
export function periodLabel(experiment: QuantExperiment): string {
  const start = experiment.periodStart?.slice(0, 10);
  const end = experiment.periodEnd?.slice(0, 10);
  if (!start || !end) return "—";
  return `${start} to ${end}`;
}
