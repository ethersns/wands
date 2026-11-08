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

export function getOpportunityScan(): Promise<ApiResult<OpportunityScan>> {
  return engineFetch<OpportunityScan>("/v1/opportunity/scan");
}

export function getOpportunityBudget(): Promise<ApiResult<OpportunityBudget>> {
  return engineFetch<OpportunityBudget>("/v1/opportunity/budget");
}
