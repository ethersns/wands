import "server-only";

import {
  getPerformanceEvidence,
  getPerformanceOverview,
  getPerformanceSignals,
  getPerformanceStrategies,
} from "@/lib/api/performance";

/**
 * The only Performance Lab surface a page may reach.
 *
 * Every entry point is a read. Recording a signal, running an evaluation and
 * sealing evidence are operator actions performed by the scheduler or the CLI,
 * so a page cannot mutate the evidence store by importing this module.
 */
export const memberPerformance = {
  overview: getPerformanceOverview,
  signals: getPerformanceSignals,
  strategies: getPerformanceStrategies,
  evidence: getPerformanceEvidence,
} as const;

export type MemberPerformance = typeof memberPerformance;
