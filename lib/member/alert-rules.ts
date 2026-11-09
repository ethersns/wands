import type { InsiderTransaction, ResearchSignal } from "@/lib/api/contracts";
import { SIGNAL_LABEL, TRANSACTION_CLASS_LABEL } from "./labels";

/**
 * The pure half of the alerting system: what a rule means, and whether an event
 * satisfies it.
 *
 * Nothing here touches the database or the engine, so the matching rules can be
 * tested directly. `lib/member/alerts.ts` owns the storage and the sweep.
 *
 * Two contract rules from `lib/api/research-contract.ts` shape the matching:
 *
 * 1. A missing value is `null` with a reason, never `0`. A filing that reported
 *    no price therefore cannot satisfy a dollar threshold — it is skipped with
 *    a stated reason rather than treated as a zero-dollar transaction.
 * 2. A research score is a bounded 0-100 ranking of evidence, not a
 *    probability. Every alert that quotes one says so.
 */

export const ALERT_RULE_KINDS = ["insider_purchase", "insider_sale", "signal"] as const;
export type AlertRuleKind = (typeof ALERT_RULE_KINDS)[number];

export const ALERT_RULE_KIND_LABEL: Record<AlertRuleKind, string> = {
  insider_purchase: "Insider purchase",
  insider_sale: "Insider sale",
  signal: "Research signal",
};

export type AlertRule = {
  id: string;
  kind: AlertRuleKind;
  /** null means every symbol the member tracks. */
  symbol: string | null;
  minValue: number | null;
  minScore: number | null;
  enabled: boolean;
  createdAt: string;
};

export type AlertCandidate = {
  /** The engine's id for the underlying event. Unique per rule. */
  eventKey: string;
  title: string;
  body: string;
  href: string;
};

export type RuleOutcome = {
  ruleId: string;
  matched: number;
  /** Why nothing matched, when nothing did. */
  reason: string | null;
};

export type CollectedMatches = {
  candidates: Array<{ ruleId: string; candidate: AlertCandidate }>;
  outcomes: RuleOutcome[];
};

export type AlertFeed = {
  transactions: InsiderTransaction[];
  signals: ResearchSignal[];
};

const TRANSACTION_CLASS_FOR_KIND = {
  insider_purchase: "open_market_purchase",
  insider_sale: "open_market_sale",
} as const satisfies Record<"insider_purchase" | "insider_sale", string>;

/** The engine serialises decimals as strings; matching needs a number. */
function asNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function usd(value: number): string {
  if (Math.abs(value) >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

/**
 * A rule with no symbol watches the member's watchlist, not the whole market.
 * The notifications page promises alerts "about the tickers you track", and a
 * rule that quietly widened to every symbol in the feed would break that.
 */
export function ruleWatchesSymbol(rule: AlertRule, symbol: string, trackedSymbols: string[]): boolean {
  if (rule.symbol !== null) return rule.symbol === symbol;
  return trackedSymbols.includes(symbol);
}

function describeTransaction(transaction: InsiderTransaction): string {
  const shares = asNumber(transaction.shares);
  const price = asNumber(transaction.pricePerShare);
  const value = asNumber(transaction.value);

  const shareText = shares === null ? "an unreported number of shares" : `${shares.toLocaleString("en-US")} shares`;
  const priceText = price === null ? "an unreported price" : `${usd(price)} per share`;
  const valueText = value === null ? "no value was reported" : `a reported value of ${usd(value)}`;
  const dateText = transaction.transactionDate ? `on ${transaction.transactionDate}` : "on an unreported date";

  return `${transaction.reportingPersonName} (${transaction.role}) reported ${shareText} at ${priceText} ${dateText}, with ${valueText}. Filed ${transaction.acceptedAt.slice(0, 10)}.`;
}

function describeSignal(signal: ResearchSignal): string {
  const score = asNumber(signal.score);
  const scoreText =
    score === null
      ? "No research score was calculated for this signal."
      : `Research score ${score}/100 — a bounded ranking of evidence, not a probability or a recommendation.`;

  return `${scoreText} ${signal.explanation}`.trim();
}

type EventMatch = { matched: true; candidate: AlertCandidate } | { matched: false; reason: string };

export function matchTransaction(
  rule: AlertRule,
  transaction: InsiderTransaction,
  trackedSymbols: string[],
): EventMatch {
  if (rule.kind === "signal") {
    return { matched: false, reason: "This rule watches research signals, not filings." };
  }

  if (transaction.classification !== TRANSACTION_CLASS_FOR_KIND[rule.kind]) {
    return { matched: false, reason: `No ${ALERT_RULE_KIND_LABEL[rule.kind].toLowerCase()} was filed.` };
  }

  if (!ruleWatchesSymbol(rule, transaction.symbol, trackedSymbols)) {
    return { matched: false, reason: "No filing was for a symbol this rule watches." };
  }

  if (rule.minValue !== null) {
    const value = asNumber(transaction.value);
    if (value === null) {
      // Not a zero-dollar transaction: the filing simply did not report a
      // price, so it cannot be compared against a dollar floor.
      return { matched: false, reason: "A matching filing reported no value, so it could not clear the threshold." };
    }
    if (value < rule.minValue) {
      return { matched: false, reason: `No filing reached the ${usd(rule.minValue)} threshold.` };
    }
  }

  return {
    matched: true,
    candidate: {
      eventKey: `insider:${transaction.id}`,
      title: `${TRANSACTION_CLASS_LABEL[transaction.classification]} — ${transaction.symbol}`,
      body: describeTransaction(transaction),
      href: `/app/insiders/${transaction.id}`,
    },
  };
}

export function matchSignal(rule: AlertRule, signal: ResearchSignal, trackedSymbols: string[]): EventMatch {
  if (rule.kind !== "signal") {
    return { matched: false, reason: "This rule watches filings, not research signals." };
  }

  if (!ruleWatchesSymbol(rule, signal.symbol, trackedSymbols)) {
    return { matched: false, reason: "No signal was for a symbol this rule watches." };
  }

  if (rule.minScore !== null) {
    const score = asNumber(signal.score);
    if (score === null) {
      return { matched: false, reason: "A matching signal carried no score, so it could not clear the threshold." };
    }
    if (score < rule.minScore) {
      return { matched: false, reason: `No signal reached a score of ${rule.minScore}.` };
    }
  }

  return {
    matched: true,
    candidate: {
      eventKey: `signal:${signal.id}`,
      title: `${SIGNAL_LABEL[signal.category]} — ${signal.symbol}`,
      body: describeSignal(signal),
      href: `/app/signals/${signal.id}`,
    },
  };
}

/**
 * Runs every enabled rule over the feed and reports, per rule, how many events
 * it matched or why it matched none.
 *
 * The per-rule reason is the point: a member who runs a sweep and gets nothing
 * needs to know whether the rule is too narrow, the watchlist is empty, or the
 * engine had nothing to read. A silent zero would be indistinguishable from a
 * broken feature.
 */
export function collectMatches(
  rules: AlertRule[],
  feed: AlertFeed,
  trackedSymbols: string[],
): CollectedMatches {
  const candidates: CollectedMatches["candidates"] = [];
  const outcomes: RuleOutcome[] = [];

  for (const rule of rules) {
    let matched = 0;
    let reason: string | null = null;

    const events: Array<EventMatch> =
      rule.kind === "signal"
        ? feed.signals.map((signal) => matchSignal(rule, signal, trackedSymbols))
        : feed.transactions.map((transaction) => matchTransaction(rule, transaction, trackedSymbols));

    for (const event of events) {
      if (event.matched) {
        matched += 1;
        candidates.push({ ruleId: rule.id, candidate: event.candidate });
      } else if (reason === null) {
        reason = event.reason;
      }
    }

    if (matched === 0 && reason === null) {
      reason =
        rule.kind === "signal"
          ? "The engine returned no research signal to check."
          : "The engine returned no filing to check.";
    }

    outcomes.push({ ruleId: rule.id, matched, reason: matched === 0 ? reason : null });
  }

  return { candidates, outcomes };
}

/** A rule with no symbol needs a watchlist to mean anything. */
export function ruleNeedsWatchlist(rule: AlertRule): boolean {
  return rule.symbol === null;
}
