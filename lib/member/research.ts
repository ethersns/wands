import "server-only";

import {
  getInsiderFeed,
  getInsiderSummary,
  getInstitutionChanges,
  getInstitutions,
  getIntelStatus,
  getSignals,
  getSymbolResearch,
} from "@/lib/api/endpoints";

/**
 * The only engine surface customer code may reach.
 *
 * This is an explicit allowlist of published research reads. Trading,
 * portfolio, risk, bot, connection, settings, backfill and job-control
 * endpoints are intentionally absent, so a member page cannot import its way
 * into a private engine function even by mistake.
 */
export const memberResearch = {
  status: getIntelStatus,
  insiderFeed: getInsiderFeed,
  insiderSummary: getInsiderSummary,
  signals: getSignals,
  institutions: getInstitutions,
  institutionChanges: getInstitutionChanges,
  symbol: getSymbolResearch,
} as const;

export type MemberResearch = typeof memberResearch;
