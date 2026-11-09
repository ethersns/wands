import "server-only";

import {
  getAssetResearch,
  getCatalystFeed,
  getExperiment,
  getExperiments,
  getInsiderFeed,
  getInsiderTransaction,
  getInstitutionChanges,
  getInstitutionFeed,
  getPriceSeries,
  getPublicCoverage,
  getResearchDashboard,
  getResearchSources,
  getSignal,
  getSignalFeed,
} from "@/lib/api/research";

/**
 * The only research surface member code may reach.
 *
 * Every entry point here is a customer-safe read from `lib/api/research.ts`,
 * which is the single implementation of the `AssetResearch` contract. There is
 * no second definition of the research shapes and no demo fallback: an
 * unreachable engine returns an `unavailable` envelope with an empty payload,
 * and the page renders that state instead of a zero.
 *
 * Trading, portfolio, risk, bot, connection, settings, backfill and job-control
 * endpoints are intentionally absent, so a member page cannot import its way
 * into an operator function even by mistake.
 */
export const memberResearch = {
  dashboard: getResearchDashboard,
  asset: getAssetResearch,
  prices: getPriceSeries,
  insiders: getInsiderFeed,
  insiderTransaction: getInsiderTransaction,
  signals: getSignalFeed,
  signal: getSignal,
  institutions: getInstitutionFeed,
  institutionChanges: getInstitutionChanges,
  sources: getResearchSources,
  coverage: getPublicCoverage,
  experiments: getExperiments,
  experiment: getExperiment,
  catalysts: getCatalystFeed,
} as const;

export type MemberResearch = typeof memberResearch;
