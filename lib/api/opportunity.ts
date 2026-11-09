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
  runId: string;
  status: "discovering" | "scanning" | "paused" | "complete";
  generatedAt: string;
  updatedAt: string;
  interval: string;
  cursor: number;
  checked: number;
  pairsChecked: number;
  total: number | null;
  activeUsdPairs: number | null;
  qualified: number;
  candidates: { id: string; symbol: string; observedAt: string }[];
  skipped: { symbol: string; reason: string }[];
  notes: string[];
  lastError: string | null;
  nextBatchAt: string | null;
  busy: boolean;
  liquidity: { minUsdVolume24h: string; maxSpreadPct: string };
  replacedRun?: {
    runId: string;
    status: string;
    checked: number;
    total: number | null;
    qualified: number;
    updatedAt: string | null;
  };
}

export interface ScanRequest {
  runId?: string;
  cursor?: number;
  interval?: string;
  restart?: boolean;
  replaceRunId?: string;
  replaceCursor?: number;
}

export interface MarketPulseMarket {
  symbol: string;
  status: string;
  tickerAvailable: boolean;
  provider: string;
  lastPrice: string | null;
  bid: string | null;
  ask: string | null;
  baseVolume24h: string | null;
  vwap24h: string | null;
  turnover24hUsd: string | null;
  high24h: string | null;
  low24h: string | null;
  dayOpen: string | null;
  dayChangePct: string | null;
  range24hPct: string | null;
  spreadPct: string | null;
  warnings: string[];
}

export interface MarketPulseSnapshot {
  asOf: string;
  timestampSource: "provider" | "receipt";
  source: string;
  activeMarkets: number;
  minimumTurnoverUsd: string;
  maxSpreadPct: string;
  markets: MarketPulseMarket[];
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

/** One request advances at most one provider call. The engine owns the cursor,
 * pacing and durable checkpoint; replays attach without duplicating candidates.
 */
export function getOpportunityScan(input: ScanRequest = {}): Promise<ApiResult<OpportunityScan | null>> {
  const params = new URLSearchParams();
  if (input.runId) params.set("run_id", input.runId);
  if (input.cursor !== undefined) params.set("cursor", String(input.cursor));
  if (input.interval) params.set("interval", input.interval);
  if (input.restart) params.set("restart", "true");
  if (input.replaceRunId) params.set("replace_run_id", input.replaceRunId);
  if (input.replaceCursor !== undefined) params.set("replace_cursor", String(input.replaceCursor));
  return engineFetch<OpportunityScan | null>(`/v1/opportunity/scan?${params}`, {
    method: "POST",
    timeoutMs: 12_000,
  });
}

export function getOpportunityMarketPulse(): Promise<ApiResult<MarketPulseSnapshot>> {
  return engineFetch<MarketPulseSnapshot>("/v1/opportunity/market-pulse");
}

export function getOpportunityScanStatus(): Promise<ApiResult<OpportunityScan | null>> {
  return engineFetch<OpportunityScan | null>("/v1/opportunity/scan/status");
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
