import "server-only";

import { engineFetch } from "./client";
import type { ApiResult } from "./contracts";

/**
 * Server-side access to the Opportunity Desk.
 *
 * Money and quantity fields arrive as strings because the engine keeps them as
 * decimals. Parsing them into floats here would quietly round a price, so they
 * are formatted at the point of display instead.
 */

export interface OpportunitySizing {
  quantity: string | null;
  notional: string | null;
  riskAtStop: string | null;
  bindingConstraint: string;
  rejectedReason: string | null;
  feasible: boolean;
}

export interface OpportunityCandidate {
  id: string;
  symbol: string;
  marketType: string;
  strategyKey: string;
  strategyVersion: number;
  observedAt: string;
  referencePrice: string;
  invalidationPrice: string;
  targetPrice: string;
  rangeHigh: string;
  volumeRatio: number;
  breakoutMargin: number;
  whyQualified: string;
  entryCondition: string;
  invalidationCondition: string;
  exitCondition: string;
  maxHoldingHours: number;
  sizing: OpportunitySizing;
  costs: { feeBps: number; slippageBps: number };
  dataQuality: { fresh: boolean; ageSeconds: number | null; warnings: string[] };
  rankReason: string;
  createdAt: string;
}

export interface OpportunityScan {
  generatedAt: string;
  interval: string;
  candidates: OpportunityCandidate[];
  skipped: { symbol: string; reason: string }[];
  notes: string[];
}

export interface OpportunityBudget {
  startingCapital: string;
  plannedRiskBudget: string;
  effectiveRiskCeiling: string;
  exposureCeiling: string;
  perTradeRiskPct: string;
  maxExposurePct: string;
  maxHoldingHours: number;
  disclosure: string;
  note: string;
}

export interface OpportunityDecision {
  id: string;
  candidateId: string;
  decision: string;
  note: string | null;
  decidedAt: string;
}

export interface OpportunityPaperTest {
  id: string;
  candidateId: string;
  symbol: string;
  marketType: string;
  strategyKey: string;
  strategyVersion: number;
  referencePrice: string;
  invalidationPrice: string;
  targetPrice: string;
  quantity: string;
  openedAt: string;
  deadline: string;
  status: string;
  exitReason: string;
  entryPrice: string | null;
  exitPrice: string | null;
  exitAt: string | null;
  holdingSeconds: number | null;
  grossReturn: string | null;
  fees: string | null;
  slippage: string | null;
  netReturn: string | null;
  drawdown: number | null;
  notes: string[];
}

export type OpportunityDecisionKind = "candidate_watched" | "candidate_rejected";

/**
 * A scan reads candles for every watchlist symbol, so it is given a longer
 * budget than a single read. It is also the only call here that writes: the
 * engine stores each candidate it qualifies, which is why the page never runs
 * it on render and why it is a POST. A GET that writes can be replayed by a
 * prefetch, a crawler or a link preview, so the method now matches the effect.
 */
export function getOpportunityScan(): Promise<ApiResult<OpportunityScan>> {
  return engineFetch<OpportunityScan>("/v1/opportunity/scan", {
    method: "POST",
    timeoutMs: 20_000,
  });
}

export function getOpportunityBudget(): Promise<ApiResult<OpportunityBudget>> {
  return engineFetch<OpportunityBudget>("/v1/opportunity/budget");
}

export function getOpportunityCandidates(
  limit = 50,
): Promise<ApiResult<{ candidates: OpportunityCandidate[] }>> {
  return engineFetch<{ candidates: OpportunityCandidate[] }>(
    `/v1/opportunity/candidates?limit=${limit}`,
  );
}

export function getOpportunityDecisions(
  limit = 200,
): Promise<ApiResult<{ decisions: OpportunityDecision[] }>> {
  return engineFetch<{ decisions: OpportunityDecision[] }>(
    `/v1/opportunity/decisions?limit=${limit}`,
  );
}

export function getOpportunityTests(
  limit = 50,
): Promise<ApiResult<{ tests: OpportunityPaperTest[] }>> {
  return engineFetch<{ tests: OpportunityPaperTest[] }>(
    `/v1/opportunity/tests?limit=${limit}`,
  );
}

export function recordOpportunityDecision(
  candidateId: string,
  decision: OpportunityDecisionKind,
  note: string,
): Promise<ApiResult<OpportunityDecision>> {
  return engineFetch<OpportunityDecision>(
    `/v1/opportunity/candidates/${encodeURIComponent(candidateId)}/decision`,
    {
      method: "POST",
      body: JSON.stringify({ decision, note: note.trim() || null }),
    },
  );
}

export function recordOpportunityTest(
  candidateId: string,
  quantity?: string,
): Promise<ApiResult<OpportunityPaperTest>> {
  return engineFetch<OpportunityPaperTest>(
    `/v1/opportunity/candidates/${encodeURIComponent(candidateId)}/tests`,
    {
      method: "POST",
      body: JSON.stringify(quantity ? { quantity } : {}),
    },
  );
}

export function evaluateOpportunityTest(
  testId: string,
): Promise<ApiResult<OpportunityPaperTest>> {
  return engineFetch<OpportunityPaperTest>(
    `/v1/opportunity/tests/${encodeURIComponent(testId)}/evaluate`,
    { method: "POST", timeoutMs: 20_000 },
  );
}
