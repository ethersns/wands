import "server-only";

import { cache } from "react";

import { engineConfig, engineFetch } from "./client";

/**
 * Server-side access to the Performance Lab.
 *
 * These endpoints require the operator credential, not the member research
 * credential: the lab is a private founder surface. There is no demo fallback.
 * An unreachable engine returns an `unavailable` envelope with an empty payload
 * and the engine's own reason, and the page renders that state instead of a
 * zero that would read as a measured result.
 */

export type MetricStatus = "ok" | "low_sample" | "insufficient_data" | "not_implemented";

export interface PerfMetric {
  value: number | null;
  status: MetricStatus;
  sample: number;
  note: string;
}

export interface PerfGroup {
  label: string;
  sample: number;
  winRate: number | null;
  meanNetReturn: number | null;
  compoundedReturn: number | null;
  meanBenchmarkReturn: number | null;
  profitFactor: number | null;
}

export interface PerfOverview {
  generatedAt: string;
  testingStartedAt: string | null;
  benchmarkSymbol: string;
  costBps: number;
  signals: {
    total: number;
    evaluated: number;
    pendingEvaluations: number;
    failedEvaluations: number;
  };
  metrics: Record<string, PerfMetric>;
  equity: {
    dates: string[];
    signal: number[];
    benchmark: number[];
    note: string;
  };
  drawdown: {
    maxDrawdown: number | null;
    peakIndex: number | null;
    troughIndex: number | null;
    note: string;
  };
  monthly: { month: string; sample: number; return: number }[];
  byStrategy: PerfGroup[];
  bySymbol: PerfGroup[];
  byDirection: PerfGroup[];
  byHorizon: PerfGroup[];
  multipleTesting: {
    comparisons: number;
    bonferroniAlpha: number | null;
    survivors: number;
    note: string;
  };
  paperTrading: { status: string; note: string };
  limitations: string[];
}

export interface PerfEvaluation {
  horizon: string;
  status: string;
  netReturn: number | null;
  grossReturn: number | null;
  benchmarkReturn: number | null;
  excessReturn: number | null;
  directionCorrect: boolean | null;
  entryAt: string | null;
  exitAt: string | null;
  detail: string | null;
}

export interface PerfSignal {
  id: string;
  signalKey: string;
  symbol: string;
  direction: string;
  assetClass: string;
  timeframe: string;
  generatedAt: string;
  observedAt: string;
  referencePrice: number | null;
  confidence: number | null;
  dataSource: string;
  dataFreshnessSeconds: number | null;
  strategy: { key: string; name: string; version: number; signalVersion: string };
  integrityVerified: boolean;
  evaluations: PerfEvaluation[];
}

export interface PerfStrategy {
  id: string;
  key: string;
  name: string;
  version: number;
  signalVersion: string;
  parameters: Record<string, unknown>;
  definitionHash: string;
  frozen: boolean;
  signals: number;
  createdAt: string;
}

export interface PerfEvidence {
  runId: string;
  kind: string;
  title: string;
  objective: string;
  createdAt: string;
  finalizedAt: string | null;
  integrityHash: string;
  integrityVerified: boolean;
  limitations: string[];
}

export interface PerfEnvelope<T> {
  data: T;
  provenance: "live" | "demo" | "unavailable";
  generatedAt: string;
  source: string;
  warnings: string[];
  unreachable: boolean;
}

function unavailable<T>(data: T, warnings: string[]): PerfEnvelope<T> {
  return {
    data,
    provenance: "unavailable",
    generatedAt: new Date().toISOString(),
    source: "wands-engine",
    warnings,
    unreachable: true,
  };
}

async function loadPerformance<T>(
  path: string,
  empty: () => T,
): Promise<PerfEnvelope<T>> {
  const { configured } = engineConfig();

  if (!configured) {
    return unavailable(empty(), [
      "WANDS_ENGINE_URL is not configured, so the Performance Lab cannot read the engine.",
    ]);
  }

  const result = await engineFetch<T>(path, { timeoutMs: 8_000 });

  if (result.ok) {
    return { ...result.envelope, unreachable: false };
  }

  return unavailable(empty(), [
    `Performance data unavailable (${result.error.code}): ${result.error.message}`,
  ]);
}

const emptyOverview: PerfOverview = {
  generatedAt: new Date().toISOString(),
  testingStartedAt: null,
  benchmarkSymbol: "SPY",
  costBps: 0,
  signals: { total: 0, evaluated: 0, pendingEvaluations: 0, failedEvaluations: 0 },
  metrics: {},
  equity: { dates: [], signal: [], benchmark: [], note: "" },
  drawdown: { maxDrawdown: null, peakIndex: null, troughIndex: null, note: "" },
  monthly: [],
  byStrategy: [],
  bySymbol: [],
  byDirection: [],
  byHorizon: [],
  multipleTesting: { comparisons: 0, bonferroniAlpha: null, survivors: 0, note: "" },
  paperTrading: { status: "not_implemented", note: "" },
  limitations: [],
};

export const getPerformanceOverview = cache(() =>
  loadPerformance<PerfOverview>("/v1/performance/overview", () => emptyOverview),
);

export const getPerformanceSignals = cache((limit = 100) =>
  loadPerformance<{ items: PerfSignal[]; count: number }>(
    `/v1/performance/signals?limit=${limit}`,
    () => ({ items: [], count: 0 }),
  ),
);

export const getPerformanceStrategies = cache(() =>
  loadPerformance<{ items: PerfStrategy[]; count: number }>(
    "/v1/performance/strategies",
    () => ({ items: [], count: 0 }),
  ),
);

export const getPerformanceEvidence = cache(() =>
  loadPerformance<{ items: PerfEvidence[]; count: number }>(
    "/v1/performance/evidence",
    () => ({ items: [], count: 0 }),
  ),
);
