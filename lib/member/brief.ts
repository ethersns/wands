import "server-only";

import { buildMarketBrief, type MarketBrief } from "./brief-model";
import { memberResearch } from "./research";
import { listTrackedSymbols } from "./watchlists";

/**
 * The read layer for the Founder Market Brief.
 *
 * Six bounded reads, issued in parallel, none of them per symbol. The brief
 * costs the same six requests whether the watchlist holds one ticker or fifty,
 * and it reuses the customer-safe reads in `lib/member/research.ts` rather than
 * adding an engine endpoint or a table.
 *
 * The watchlist is the signed-in member's own, read from the application
 * database, so the brief is scoped to that member and never to another account.
 */

const CATALYST_WINDOW_DAYS = 30;
const INSIDER_LIMIT = 12;
const INSTITUTION_LIMIT = 8;
const SIGNAL_LIMIT = 12;

export async function getMarketBrief(userId: string): Promise<MarketBrief> {
  const [watchlist, dashboard, coverage, catalysts, insiders, institutions, signals] =
    await Promise.all([
      listTrackedSymbols(userId),
      memberResearch.dashboard(),
      memberResearch.coverage(),
      memberResearch.catalysts({ windowDays: CATALYST_WINDOW_DAYS }),
      memberResearch.insiders({ limit: INSIDER_LIMIT }),
      memberResearch.institutions(1, INSTITUTION_LIMIT),
      memberResearch.signals({ limit: SIGNAL_LIMIT }),
    ]);

  return buildMarketBrief({
    asOf: dashboard.data.asOf,
    watchlist,
    dashboard: dashboard.data,
    coverage: coverage.data,
    catalysts: catalysts.data,
    insiders: insiders.data,
    institutions: institutions.data,
    signals: signals.data,
    unreachable:
      dashboard.unreachable ||
      coverage.unreachable ||
      catalysts.unreachable ||
      insiders.unreachable ||
      institutions.unreachable ||
      signals.unreachable,
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
  type BriefInvestigation,
  type BriefLimitation,
  type BriefMarketContext,
  type BriefReason,
  type MarketBrief,
  type MarketBriefInputs,
} from "./brief-model";
