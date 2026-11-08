import { NextResponse } from "next/server";

import { pruneOldPageViews, recordPageView } from "@/lib/analytics/track";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";
import { clientKey, rateLimit } from "@/lib/marketing/rate-limit";
import { pruneOldLoginEvents } from "@/lib/member/login-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public page-view beacon.
 *
 * This endpoint is deliberately unauthenticated — it measures anonymous
 * marketing traffic — so it is written to be useless to an attacker:
 *
 *   * it accepts only a path and a referrer, and normalises both;
 *   * it refuses every private surface, so it cannot be used to probe whether
 *     `/dashboard` or `/app` exists;
 *   * it is rate limited per connection;
 *   * it always answers 204, so it never reveals whether a row was written.
 *
 * Analytics must never break a page, so every failure path is silent.
 */

const NO_CONTENT = new NextResponse(null, { status: 204 });

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return (
    forwarded?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function POST(request: Request) {
  const limit = rateLimit(clientKey(request, "track"), 60, 60_000);
  if (!limit.allowed) return NO_CONTENT;

  let payload: { path?: unknown; referrer?: unknown } = {};

  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NO_CONTENT;
  }

  const path = typeof payload.path === "string" ? payload.path : null;
  if (!path) return NO_CONTENT;

  const referrer = typeof payload.referrer === "string" ? payload.referrer : null;

  // UTM parameters travel on the page URL, not the referrer, so they are read
  // from the beacon's own query string.
  const url = new URL(request.url);

  const operatorToken = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);

  const isOperator = await verifySessionToken(operatorToken);

  await recordPageView({
    path,
    referrer,
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent") ?? "",
    selfHost: request.headers.get("host")?.split(":")[0] ?? null,
    utm: {
      source: url.searchParams.get("utm_source"),
      medium: url.searchParams.get("utm_medium"),
      campaign: url.searchParams.get("utm_campaign"),
    },
    isOperator,
  });

  // Roughly one sweep per hour per instance, without a scheduler. Both tables
  // are pruned on the same horizon so retention is one policy, not two.
  if (Math.random() < 0.002) {
    void pruneOldPageViews();
    void pruneOldLoginEvents();
  }

  return NO_CONTENT;
}
