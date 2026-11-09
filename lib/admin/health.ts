import "server-only";

import { getEngineStatus, getMarkets } from "@/lib/api/endpoints";
import { isDatabaseConfigured, query } from "@/lib/db";

/**
 * System health for the control centre.
 *
 * A service is only reported healthy when something actually answered. A page
 * that rendered is not evidence that the engine is up, so the engine check reads
 * the engine's own status payload and the database check runs a real query and
 * times it.
 *
 * Error text is truncated and never includes a connection string, a token or a
 * stack trace. This page is operator-only, but an admin screen is still a screen
 * someone can screenshot.
 */

export type HealthState = "ok" | "degraded" | "down" | "unknown";

export interface HealthCheck {
  id: string;
  label: string;
  state: HealthState;
  detail: string;
  /** ISO timestamp of the observation, when the source provides one. */
  observedAt: string | null;
}

export interface BackgroundJob {
  name: string;
  enabled: boolean;
  paused: boolean;
  lastStatus: string | null;
  lastFinishedAt: string | null;
  consecutiveFailures: number;
}

export interface HealthReport {
  checks: HealthCheck[];
  jobs: BackgroundJob[];
  failures: { jobName: string; occurredAt: string; errorType: string; message: string }[];
}

function truncate(value: string, max = 180): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function ageLabel(iso: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "unknown";

  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}

async function checkDatabase(): Promise<HealthCheck> {
  if (!isDatabaseConfigured()) {
    return {
      id: "database",
      label: "Database",
      state: "down",
      detail: "No connection string is configured.",
      observedAt: null,
    };
  }

  const startedAt = Date.now();

  try {
    await query(`select 1 as ok`);
    const latency = Date.now() - startedAt;

    return {
      id: "database",
      label: "Database",
      state: latency > 1_500 ? "degraded" : "ok",
      detail: `Responded in ${latency}ms.`,
      observedAt: new Date().toISOString(),
    };
  } catch (cause) {
    return {
      id: "database",
      label: "Database",
      state: "down",
      detail: truncate(cause instanceof Error ? cause.message : "Query failed."),
      observedAt: new Date().toISOString(),
    };
  }
}

async function checkEngine(): Promise<HealthCheck> {
  try {
    const engine = await getEngineStatus();
    const status = engine.data;

    const state: HealthState =
      status.state === "operational"
        ? "ok"
        : status.state === "degraded" || status.state === "paused"
          ? "degraded"
          : "unknown";

    return {
      id: "engine",
      label: "Wands backend",
      state,
      detail: `State ${status.state} · mode ${status.mode} · heartbeat ${ageLabel(status.lastHeartbeat)}`,
      observedAt: status.lastHeartbeat ?? null,
    };
  } catch (cause) {
    return {
      id: "engine",
      label: "Wands backend",
      state: "down",
      detail: truncate(cause instanceof Error ? cause.message : "Engine unreachable."),
      observedAt: null,
    };
  }
}

async function checkMarketData(): Promise<HealthCheck> {
  try {
    const markets = await getMarkets();
    const quotes = markets.data.quotes ?? [];

    if (quotes.length === 0) {
      return {
        id: "market-data",
        label: "Market data",
        state: "degraded",
        detail: "The provider returned no quotes.",
        observedAt: markets.generatedAt ?? null,
      };
    }

    return {
      id: "market-data",
      label: "Market data",
      state: "ok",
      detail: `${quotes.length} quotes · source ${markets.source}`,
      observedAt: markets.generatedAt ?? null,
    };
  } catch (cause) {
    return {
      id: "market-data",
      label: "Market data",
      state: "down",
      detail: truncate(cause instanceof Error ? cause.message : "Provider unreachable."),
      observedAt: null,
    };
  }
}

async function checkQuoteFreshness(): Promise<HealthCheck> {
  if (!isDatabaseConfigured()) {
    return {
      id: "quote-freshness",
      label: "Quote freshness",
      state: "unknown",
      detail: "Database unavailable.",
      observedAt: null,
    };
  }

  try {
    const rows = await query<{ latest: string | null }>(
      `select max(ingested_at) as latest from market_quotes`,
    );
    const latest = rows[0]?.latest ?? null;

    if (!latest) {
      return {
        id: "quote-freshness",
        label: "Quote freshness",
        state: "degraded",
        detail: "No quotes have been ingested yet.",
        observedAt: null,
      };
    }

    const ageSeconds = (Date.now() - new Date(latest).getTime()) / 1000;
    const state: HealthState = ageSeconds < 300 ? "ok" : ageSeconds < 3_600 ? "degraded" : "down";

    return {
      id: "quote-freshness",
      label: "Quote freshness",
      state,
      detail: `Newest quote ingested ${ageLabel(latest)}.`,
      observedAt: latest,
    };
  } catch (cause) {
    return {
      id: "quote-freshness",
      label: "Quote freshness",
      state: "unknown",
      detail: truncate(cause instanceof Error ? cause.message : "Query failed."),
      observedAt: null,
    };
  }
}

async function checkResearchFreshness(): Promise<HealthCheck> {
  if (!isDatabaseConfigured()) {
    return {
      id: "research",
      label: "Research data",
      state: "unknown",
      detail: "Database unavailable.",
      observedAt: null,
    };
  }

  try {
    const rows = await query<{ latest: string | null; runs: number }>(
      `select
         (select max(finished_at) from intel_ingest_runs) as latest,
         (select count(*)::int from intel_ingest_runs) as runs`,
    );
    const latest = rows[0]?.latest ?? null;
    const runs = rows[0]?.runs ?? 0;

    if (!latest) {
      return {
        id: "research",
        label: "Research data",
        state: "degraded",
        detail: runs === 0 ? "No ingestion has run yet." : "No completed ingestion run.",
        observedAt: null,
      };
    }

    const ageHours = (Date.now() - new Date(latest).getTime()) / 3_600_000;
    const state: HealthState = ageHours < 24 ? "ok" : ageHours < 72 ? "degraded" : "down";

    return {
      id: "research",
      label: "Research data",
      state,
      detail: `Last completed ingestion ${ageLabel(latest)}.`,
      observedAt: latest,
    };
  } catch (cause) {
    return {
      id: "research",
      label: "Research data",
      state: "unknown",
      detail: truncate(cause instanceof Error ? cause.message : "Query failed."),
      observedAt: null,
    };
  }
}

async function checkAnalytics(): Promise<HealthCheck> {
  if (!isDatabaseConfigured()) {
    return {
      id: "analytics",
      label: "Traffic collection",
      state: "unknown",
      detail: "Database unavailable.",
      observedAt: null,
    };
  }

  try {
    const rows = await query<{ latest: string | null; since: string | null }>(
      `select max(occurred_at) as latest, min(day)::text as since from site_page_view`,
    );
    const latest = rows[0]?.latest ?? null;
    const since = rows[0]?.since ?? null;

    if (!latest) {
      return {
        id: "analytics",
        label: "Traffic collection",
        state: "degraded",
        detail: "No page views recorded yet.",
        observedAt: null,
      };
    }

    return {
      id: "analytics",
      label: "Traffic collection",
      state: "ok",
      detail: `Recording since ${since} · last view ${ageLabel(latest)}.`,
      observedAt: latest,
    };
  } catch (cause) {
    return {
      id: "analytics",
      label: "Traffic collection",
      state: "unknown",
      detail: truncate(cause instanceof Error ? cause.message : "Query failed."),
      observedAt: null,
    };
  }
}

export async function getHealth(): Promise<HealthReport> {
  const [database, engine, marketData, quoteFreshness, research, analytics] =
    await Promise.all([
      checkDatabase(),
      checkEngine(),
      checkMarketData(),
      checkQuoteFreshness(),
      checkResearchFreshness(),
      checkAnalytics(),
    ]);

  let jobs: BackgroundJob[] = [];
  let failures: HealthReport["failures"] = [];

  if (isDatabaseConfigured()) {
    try {
      const rows = await query<{
        name: string;
        enabled: boolean;
        paused: boolean;
        last_status: string | null;
        last_finished_at: string | null;
        consecutive_failures: number;
      }>(
        `select name, enabled, paused, last_status, last_finished_at, consecutive_failures
         from intel_jobs
         order by name asc
         limit 25`,
      );

      jobs = rows.map((row) => ({
        name: row.name,
        enabled: row.enabled,
        paused: row.paused,
        lastStatus: row.last_status,
        lastFinishedAt: row.last_finished_at,
        consecutiveFailures: row.consecutive_failures,
      }));
    } catch {
      jobs = [];
    }

    try {
      const rows = await query<{
        job_name: string;
        occurred_at: string;
        error_type: string;
        message: string;
      }>(
        `select job_name, occurred_at, error_type, message
         from intel_job_failures
         order by occurred_at desc
         limit 5`,
      );

      failures = rows.map((row) => ({
        jobName: row.job_name,
        occurredAt: row.occurred_at,
        errorType: row.error_type,
        message: truncate(row.message ?? "", 160),
      }));
    } catch {
      failures = [];
    }
  }

  return {
    checks: [database, engine, marketData, quoteFreshness, research, analytics],
    jobs,
    failures,
  };
}
