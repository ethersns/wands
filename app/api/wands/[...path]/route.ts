import { NextResponse, type NextRequest } from "next/server";

import { engineConfig } from "@/lib/api/client";

/**
 * Backend-for-frontend proxy.
 *
 * The browser never holds engine credentials and never talks to an exchange.
 * Mutating calls are forwarded to the private Python service; when that service
 * is not configured the route returns an explicit 503 so the UI can show a real
 * failure instead of a fabricated success.
 */

const ALLOWED_PREFIXES = [
  "bots",
  "risk",
  "orders",
  "connections",
  "settings",
  "backtests",
  "engine",
];

const TIMEOUT_MS = 8_000;

function notConfigured() {
  return NextResponse.json(
    {
      error: {
        code: "not_configured",
        message:
          "The trading engine is not connected. Set WANDS_ENGINE_URL and WANDS_ENGINE_TOKEN on the server to enable this action.",
      },
    },
    { status: 503 },
  );
}

async function proxy(request: NextRequest, path: string[]) {
  const { baseUrl, token, configured } = engineConfig();

  if (!configured || !baseUrl) {
    return notConfigured();
  }

  if (!ALLOWED_PREFIXES.includes(path[0] ?? "")) {
    return NextResponse.json(
      { error: { code: "bad_request", message: "Unknown engine route." } },
      { status: 404 },
    );
  }

  const target = new URL(`/v1/${path.join("/")}`, baseUrl);
  target.search = request.nextUrl.search;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const body =
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : await request.text();

    const upstream = await fetch(target, {
      method: request.method,
      cache: "no-store",
      signal: controller.signal,
      headers: {
        accept: "application/json",
        ...(body ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body || undefined,
    });

    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: {
        "content-type":
          upstream.headers.get("content-type") ?? "application/json",
      },
    });
  } catch (cause) {
    const aborted = cause instanceof Error && cause.name === "AbortError";
    return NextResponse.json(
      {
        error: {
          code: aborted ? "timeout" : "unreachable",
          message: aborted
            ? "The trading engine did not respond in time."
            : "Could not reach the trading engine.",
        },
      },
      { status: 504 },
    );
  } finally {
    clearTimeout(timer);
  }
}

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  return proxy(request, path);
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  return proxy(request, path);
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  return proxy(request, path);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  return proxy(request, path);
}
