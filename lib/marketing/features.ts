export type Availability = "available" | "beta" | "planned";

export interface Capability {
  name: string;
  summary: string;
  availability: Availability;
}

export const availabilityLabel: Record<Availability, string> = {
  available: "Available",
  beta: "Beta",
  planned: "Planned",
};

export const capabilities: Capability[] = [
  {
    name: "Insider Radar",
    summary:
      "Form 4 activity parsed, de-noised and ranked by conviction rather than headline size.",
    availability: "available",
  },
  {
    name: "Institutional Radar",
    summary:
      "13F position changes normalised across holders and weighted by portfolio impact.",
    availability: "available",
  },
  {
    name: "Strategy Lab",
    summary:
      "Rule-based backtests with costs, slippage and out-of-sample splits applied by default.",
    availability: "available",
  },
  {
    name: "Portfolio & Risk Centre",
    summary:
      "Exposure, concentration and drawdown limits enforced before an order is accepted.",
    availability: "available",
  },
  {
    name: "AI Research Assistant",
    summary:
      "Ask questions against your own positions, filings and backtest results.",
    availability: "beta",
  },
  {
    name: "Automated Trading Bots",
    summary:
      "Run a validated strategy on a schedule, with a single control that halts everything.",
    availability: "beta",
  },
  {
    name: "Options flow",
    summary:
      "Unusual options activity joined to the underlying filing and holdings record.",
    availability: "planned",
  },
  {
    name: "Multi-broker routing",
    summary:
      "Split a single intent across several accounts with per-account risk limits.",
    availability: "planned",
  },
];

export interface FeatureDetail {
  slug: string;
  name: string;
  eyebrow: string;
  headline: string;
  subhead: string;
  problem: string;
  approach: string[];
  highlights: { title: string; body: string }[];
  footnote: string;
}

export const featureDetails: FeatureDetail[] = [
  {
    slug: "insider-radar",
    name: "Insider Radar",
    eyebrow: "Signal intelligence",
    headline: "Know when the people who run the company are buying.",
    subhead:
      "Ranked insider activity, not a firehose. Wands separates open-market purchases from option exercises and gifts, then scores what is left.",
    problem:
      "Form 4 filings arrive in the hundreds every day. Most of them are compensation mechanics — grants, vesting, tax withholding — that say nothing about conviction. The handful that matter are buried in the same feed.",
    approach: [
      "Every Form 4 is parsed into its individual transaction lines, so a single filing can produce several distinct events.",
      "Non-discretionary transactions — grants, gifts, option exercises, tax withholding — are classified and excluded from conviction scoring.",
      "What remains is scored on cluster activity, insider role, transaction size relative to the insider's history, and filing recency.",
      "Each scored event keeps a link to the source filing, the transaction date and the ingestion timestamp.",
    ],
    highlights: [
      {
        title: "Open-market purchases isolated",
        body: "Discretionary buys are separated from compensation mechanics before anything is ranked.",
      },
      {
        title: "Cluster detection",
        body: "Multiple insiders transacting in the same direction inside one window are surfaced as a single event.",
      },
      {
        title: "Filing-level provenance",
        body: "Every row links back to the accession number, the filing date and the source document.",
      },
    ],
    footnote:
      "Interface shown is illustrative. Records are demonstration data, not live filings.",
  },
  {
    slug: "institutional-radar",
    name: "Institutional Radar",
    eyebrow: "Ownership intelligence",
    headline: "See what the largest holders did last quarter.",
    subhead:
      "13F changes, normalised. Compare position deltas across institutions, weight them by portfolio impact, and surface consensus before it becomes a narrative.",
    problem:
      "A 13F tells you what a fund held at quarter end. It does not tell you whether that position was a rounding error or a third of the book, and comparing two funds by raw share count is close to meaningless.",
    approach: [
      "Holdings are normalised across filers so share counts, splits and reported values are comparable.",
      "Each change is expressed as a share of the filer's reported portfolio, not as an absolute number of shares.",
      "Consensus builds and exits are computed across the tracked institution set for each security.",
      "Filing lag is displayed alongside every figure, because a 13F describes a quarter that has already ended.",
    ],
    highlights: [
      {
        title: "Portfolio-weighted deltas",
        body: "A 2% position increase at a concentrated fund is not the same event as a 2% increase at a mega-cap index.",
      },
      {
        title: "Consensus and divergence",
        body: "See where holders agree, and where one desk is moving against the crowd.",
      },
      {
        title: "Filing lag made explicit",
        body: "Every figure carries the period it describes and the date it was filed.",
      },
    ],
    footnote:
      "Interface shown is illustrative. Records are demonstration data, not live filings.",
  },
  {
    slug: "strategy-lab",
    name: "Strategy Lab",
    eyebrow: "Validation",
    headline: "Test the idea before you fund it.",
    subhead:
      "Backtests with the boring parts included. Define the rules, run them against history, and read the result with costs, slippage and out-of-sample splits already applied.",
    problem:
      "A backtest that ignores fees, slippage and survivorship will happily show you a strategy that cannot survive contact with a real order book. The result looks like an edge and behaves like a rounding error.",
    approach: [
      "Entry, exit and sizing rules are declared explicitly, so a run can be reproduced from its parameters alone.",
      "Commission and slippage assumptions are applied to every simulated fill, and the assumptions are stored with the run.",
      "Data is split into in-sample and out-of-sample windows, with walk-forward runs available for parameter stability.",
      "Every run records its data window, universe and assumptions so two results are never compared on unequal terms.",
    ],
    highlights: [
      {
        title: "Out-of-sample by default",
        body: "Results are reported on held-back data, not just the window the parameters were fitted to.",
      },
      {
        title: "Costs are not optional",
        body: "Fees and slippage are modelled on every fill, and the assumptions are visible next to the result.",
      },
      {
        title: "Reproducible runs",
        body: "Parameters, universe and data window are stored with each result so it can be re-run exactly.",
      },
    ],
    footnote:
      "Interface shown is illustrative. Backtest figures are demonstration data, not a track record.",
  },
];

export function featureBySlug(slug: string): FeatureDetail | undefined {
  return featureDetails.find((feature) => feature.slug === slug);
}
