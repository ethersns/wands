import "server-only";

import type { ApiError, ApiResult, Envelope } from "./contracts";

const DEFAULT_TIMEOUT_MS = 4_000;

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
 * workspace. When it is absent the research path falls back to the operator
 * token so the workspace still works, but `scoped` reports false: the member
 * surface is then running on a credential that can also reach operator
 * functions, which is a deployment gap rather than a code one.
 */
export function researchConfig(): ResearchConfig {
  const baseUrl = process.env.WANDS_ENGINE_URL?.trim() || null;
  const scopedToken = process.env.WANDS_RESEARCH_TOKEN?.trim() || null;
  const engineToken = process.env.WANDS_ENGINE_TOKEN?.trim() || null;

  return {
    baseUrl,
    token: scopedToken ?? engineToken,
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
  const { timeoutMs = DEFAULT_TIMEOUT_MS, headers, config, ...rest } = init;
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
  return engineFetch<T>(path, { ...init, config: researchConfig() });
}
