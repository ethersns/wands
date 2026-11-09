import "server-only";

import { buildMarketBrief, type BriefSourceKey, type MarketBrief } from "./brief-model";
import { memberResearch } from "./research";
import { listWatchlists, trackedSymbolsFrom } from "./watchlists";

/**
 * The read layer for the Founder Market Brief.
 *
 * Six bounded engine reads plus one database read, issued in parallel, none of
 * them per symbol. The brief costs the same seven reads whether the watchlist
 * holds one ticker or fifty, and it reuses the customer-safe reads in
 * `lib/member/research.ts` rather than adding an engine endpoint or a table.
 *
 * The watchlist is the signed-in member's own, read from the application
 * database, so the brief is scoped to that member and never to another account.
 * That single read supplies both the tracked symbols and the watchlist count,
 * so the page does not read the member's watchlists a second time.
 */

const CATALYST_WINDOW_DAYS = 30;
const INSTITUTION_LIMIT = 8;
/**
 * The engine caps these feeds at 200 rows per page and offers no multi-symbol
 * filter, so one request is the most complete bounded read available. Asking
 * for the maximum keeps a watched symbol from falling outside the retrieved
 * page as often as possible; `insiderCoverage` and `signalCoverage` report the
 * remainder rather than implying the page was the whole feed.
 */
const INSIDER_LIMIT = 200;
const SIGNAL_LIMIT = 200;

export async function getMarketBrief(userId: string): Promise<MarketBrief> {
  const [watchlists, dashboard, coverage, catalysts, insiders, institutions, signals] =
    await Promise.all([
      listWatchlists(userId),
      memberResearch.dashboard(),
      memberResearch.coverage(),
      memberResearch.catalysts({ windowDays: CATALYST_WINDOW_DAYS }),
      memberResearch.insiders({ limit: INSIDER_LIMIT }),
      memberResearch.institutions(1, INSTITUTION_LIMIT),
      memberResearch.signals({ limit: SIGNAL_LIMIT }),
    ]);

  const unreachableSources: BriefSourceKey[] = [];
  if (dashboard.unreachable) unreachableSources.push("dashboard");
  if (coverage.unreachable) unreachableSources.push("coverage");
  if (catalysts.unreachable) unreachableSources.push("catalysts");
  if (insiders.unreachable) unreachableSources.push("insiders");
  if (institutions.unreachable) unreachableSources.push("institutions");
  if (signals.unreachable) unreachableSources.push("signals");

  // An unreachable dashboard still returns a payload, stamped with the current
  // clock. Passing that through would let an outage masquerade as a valid
  // assessment time, so the brief is told there is no timestamp at all.
  const asOf = dashboard.unreachable ? "" : dashboard.data.asOf;

  return buildMarketBrief({
    asOf,
    watchlist: trackedSymbolsFrom(watchlists),
    watchlistCount: watchlists.length,
    dashboard: dashboard.data,
    coverage: coverage.data,
    catalysts: catalysts.data,
    insiders: insiders.data,
    institutions: institutions.data,
    signals: signals.data,
    unreachableSources,
    warnings: [
      ...dashboard.warnings,
      ...coverage.warnings,
      ...catalysts.warnings,
      ...insiders.warnings,
      ...institutions.warnings,
      ...signals.warnings,
    ],
  });
}

export {
  BRIEF_RULES,
  buildMarketBrief,
  type BriefAvailability,
  type BriefFeedCoverage,
  type BriefInvestigation,
  type BriefLimitation,
  type BriefMarketContext,
  type BriefReason,
  type BriefSourceKey,
  type BriefSourceState,
  type BriefSourceStatus,
  type BriefTimeBasis,
  type MarketBrief,
  type MarketBriefInputs,
} from "./brief-model";
