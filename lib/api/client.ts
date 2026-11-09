import "server-only";

import type { ApiError, ApiResult, Envelope } from "./contracts";

const DEFAULT_TIMEOUT_MS = 12_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 30_000;

/**
 * The engine's research aggregates are not uniformly fast. Measured from the
 * Vercel runtime against a warm engine, `institutions` takes ~5.7s and
 * `dashboard` ~3.8s, so the previous 4s ceiling reported healthy responses as
 * outages. The ceiling is configurable but clamped, so a bad value cannot turn
 * a dead engine into an unbounded wait.
 */
export function engineTimeoutMs(): number {
  const configured = Number(process.env.WANDS_ENGINE_TIMEOUT_MS);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(Math.round(configured), MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);
}

export interface EngineConfig {
  baseUrl: string | null;
  token: string | null;
  configured: boolean;
}

/**
 * The engine endpoint and token are read from server-only environment
 * variables. They are never exposed to the browser and never prefixed with
 * NEXT_PUBLIC_.
 */
export function engineConfig(): EngineConfig {
  const baseUrl = process.env.WANDS_ENGINE_URL?.trim() || null;
  const token = process.env.WANDS_ENGINE_TOKEN?.trim() || null;
  return { baseUrl, token, configured: Boolean(baseUrl) };
}

export interface ResearchConfig extends EngineConfig {
  /**
   * True when the research path holds its own credential rather than borrowing
   * the operator one. A research credential carries `research:read` and a
   * viewer role, so it can read filings and signals but cannot reach backfill,
   * job control, orders, risk or connections even if a member code path asked
   * for them.
   */
  scoped: boolean;
}

/**
 * The credential the member research surface uses.
 *
 * `WANDS_RESEARCH_TOKEN` is a least-privilege credential issued for the member
 * workspace. There is deliberately no fallback to the operator token: a member
 * request that borrowed it would carry the authority to place orders, read
 * credentials and control jobs, and a single missing environment variable would
 * silently widen the member surface to the whole engine. When the credential is
 * absent the research path reports itself unconfigured instead.
 */
export function researchConfig(): ResearchConfig {
  const baseUrl = process.env.WANDS_ENGINE_URL?.trim() || null;
  const scopedToken = process.env.WANDS_RESEARCH_TOKEN?.trim() || null;

  return {
    baseUrl,
    token: scopedToken,
    configured: Boolean(baseUrl),
    scoped: Boolean(scopedToken),
  };
}

function errorOf(code: ApiError["code"], message: string, status?: number): ApiError {
  return { code, message, status };
}

function isEnvelope(value: unknown): value is Envelope<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "data" in value &&
    "provenance" in value
  );
}

/**
 * Calls the private trading engine. Returns a discriminated result rather than
 * throwing, so callers must decide explicitly what to render when the engine is
 * unreachable instead of silently showing zeros.
 */
export async function engineFetch<T>(
  path: string,
  init: RequestInit & { timeoutMs?: number; config?: EngineConfig } = {},
): Promise<ApiResult<T>> {
  const { timeoutMs = engineTimeoutMs(), headers, config, ...rest } = init;
  const { baseUrl, token, configured } = config ?? engineConfig();

  if (!configured || !baseUrl) {
    return {
      ok: false,
      error: errorOf(
        "not_configured",
        "WANDS_ENGINE_URL is not set, so the trading engine cannot be reached.",
      ),
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(new URL(path, baseUrl), {
      ...rest,
      cache: "no-store",
      signal: controller.signal,
      headers: {
        accept: "application/json",
        ...(rest.body ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
    });

    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        error: errorOf(
          "unauthorized",
          "The engine rejected the request. Check WANDS_ENGINE_TOKEN.",
          response.status,
        ),
      };
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return {
        ok: false,
        error: errorOf(
          "server_error",
          detail.slice(0, 300) || `Engine responded with ${response.status}.`,
          response.status,
        ),
      };
    }

    const payload: unknown = await response.json();

    if (!isEnvelope(payload)) {
      return {
        ok: false,
        error: errorOf(
          "server_error",
          "Engine response did not match the Wands envelope contract.",
          response.status,
        ),
      };
    }

    return { ok: true, envelope: payload as Envelope<T> };
  } catch (cause) {
    const aborted = cause instanceof Error && cause.name === "AbortError";
    return {
      ok: false,
      error: errorOf(
        aborted ? "timeout" : "unreachable",
        aborted
          ? `Engine did not respond within ${timeoutMs}ms.`
          : "Could not reach the trading engine.",
      ),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Calls the engine with the member research credential.
 *
 * Every read in `lib/api/research.ts` goes through here rather than
 * `engineFetch`, so the member surface is confined to the credential issued for
 * it. The operator console keeps using `engineFetch` and the operator token.
 */
export function researchFetch<T>(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<ApiResult<T>> {
  const config = researchConfig();

  if (!config.token) {
    return Promise.resolve({
      ok: false,
      error: errorOf(
        "research_unconfigured",
        "WANDS_RESEARCH_TOKEN is not set. The member research surface requires its own research-scoped credential and will not borrow the operator token.",
      ),
    });
  }

  return engineFetch<T>(path, { ...init, config });
}
