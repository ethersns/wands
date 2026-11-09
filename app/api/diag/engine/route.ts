import { NextResponse } from "next/server";

import { researchConfig, researchFetch } from "@/lib/api/client";

export const dynamic = "force-dynamic";

const PROBE_KEY = "diag-7f3a91c4e2b8";

const PATHS = [
  "/v1/intelligence/dashboard",
  "/v1/intelligence/coverage/public",
  "/v1/intelligence/insiders",
  "/v1/intelligence/institutions",
  "/v1/intelligence/signals",
  "/v1/intelligence/experiments",
];

export async function GET(request: Request) {
  if (request.headers.get("x-diag-key") !== PROBE_KEY) {
    return new NextResponse(null, { status: 404 });
  }

  const config = researchConfig();

  let host: string | null = null;
  let scheme: string | null = null;
  let pathname: string | null = null;
  let urlValid = false;

  if (config.baseUrl) {
    try {
      const parsed = new URL(config.baseUrl);
      host = parsed.host;
      scheme = parsed.protocol;
      pathname = parsed.pathname;
      urlValid = true;
    } catch {
      host = "INVALID_URL";
    }
  }

  let health: { ms: number; status: number | null; error: string | null } = {
    ms: 0,
    status: null,
    error: "no base url",
  };

  if (config.baseUrl) {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(new URL("/healthz", config.baseUrl), {
        cache: "no-store",
        signal: controller.signal,
      });
      health = { ms: Date.now() - started, status: response.status, error: null };
    } catch (cause) {
      health = {
        ms: Date.now() - started,
        status: null,
        error: cause instanceof Error ? `${cause.name}: ${cause.message}`.slice(0, 160) : "unknown",
      };
    } finally {
      clearTimeout(timer);
    }
  }

  const results = [];
  for (const path of PATHS) {
    const started = Date.now();
    const result = await researchFetch(path, { timeoutMs: 15_000 });
    results.push({
      path,
      ms: Date.now() - started,
      ok: result.ok,
      status: result.ok ? 200 : (result.error.status ?? null),
      code: result.ok ? null : result.error.code,
      message: result.ok ? null : result.error.message.slice(0, 140),
    });
  }

  return NextResponse.json({
    engineHost: host,
    scheme,
    pathname,
    urlValid,
    tokenConfigured: config.scoped,
    health,
    results,
  });
}
