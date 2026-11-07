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
 * A strategy is judged on its excess over holding the same instrument, not on
 * its raw return: a rule that made 50% while the stock made 160% lost. The
 * holdings study has no single headline, so it reports the event count and says
 * what kind of event it is.
 */
export function headline(experiment: QuantExperiment): {
  label: string;
  value: string;
  hint: string;
} {
  const result = experiment.metrics;

  if (result?.study === "strategy_baseline" && result.summary) {
    return {
      label: "Mean excess vs hold",
      value: formatPercent(result.summary.meanExcessReturn),
      hint: `${formatCount(result.summary.tradeCount)} trades, ${formatPercent(
        result.summary.meanStrategyReturn,
      )} vs ${formatPercent(result.summary.meanBenchmarkReturn)} held`,
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
