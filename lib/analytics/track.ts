import "server-only";

import { isDatabaseConfigured, query } from "@/lib/db";
import { REPORTING_TIMEZONE, todayInReportingZone } from "@/lib/admin/period";

/**
 * First-party, privacy-conscious page-view recording.
 *
 * Design constraints, in order of importance:
 *
 * 1. No raw IP address is ever stored. The address is mixed into a digest and
 *    then discarded.
 * 2. No persistent identifier. The digest is keyed with a salt that is derived
 *    from the calendar day, so the same person produces a different digest
 *    tomorrow. That makes "unique visitors today" answerable and cross-day
 *    tracking impossible by construction, not by policy.
 * 3. No cookies, no fingerprinting, no third-party script.
 * 4. Only public marketing pages are recorded. Signed-in surfaces are excluded
 *    at the source, so member behaviour never enters the traffic table.
 *
 * The result is aggregate measurement that answers "how many people read the
 * pricing page" without building a profile of anyone who did.
 */

/** Private surfaces that must never be recorded as web traffic. */
const PRIVATE_PREFIXES = [
  "/api",
  "/_next",
  "/dashboard",
  "/app",
  "/login",
  "/signin",
  "/signup",
  "/onboarding",
  "/portfolio",
  "/markets",
  "/bots",
  "/orders",
  "/intelligence",
  "/strategy-lab",
  "/research",
  "/risk",
  "/connections",
  "/settings",
  "/account",
  "/billing",
] as const;

const SEARCH_HOSTS = [
  "google.",
  "bing.com",
  "duckduckgo.com",
  "search.yahoo",
  "ecosia.org",
  "brave.com",
  "yandex.",
];

const SOCIAL_HOSTS = [
  "twitter.com",
  "x.com",
  "t.co",
  "linkedin.com",
  "lnkd.in",
  "facebook.com",
  "instagram.com",
  "reddit.com",
  "news.ycombinator.com",
  "threads.net",
  "bsky.app",
  "youtube.com",
];

export type ReferrerCategory = "direct" | "internal" | "search" | "social" | "referral";

/** Normalises a pathname, or returns `null` when it must not be recorded. */
export function normalizePath(rawPath: string | null | undefined): string | null {
  if (!rawPath) return null;

  let pathname: string;
  try {
    pathname = new URL(rawPath, "https://wands.trade").pathname;
  } catch {
    return null;
  }

  if (!pathname.startsWith("/")) return null;

  const lowered = pathname.toLowerCase();

  if (PRIVATE_PREFIXES.some((prefix) => lowered === prefix || lowered.startsWith(`${prefix}/`))) {
    return null;
  }

  // Collapse a trailing slash so `/pricing` and `/pricing/` are one page.
  const trimmed = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;

  return trimmed.slice(0, 200) || "/";
}

export function categorizeReferrer(
  referrer: string | null | undefined,
  selfHost: string | null,
): { host: string | null; category: ReferrerCategory } {
  if (!referrer) return { host: null, category: "direct" };

  let host: string;
  try {
    host = new URL(referrer).hostname.toLowerCase();
  } catch {
    return { host: null, category: "direct" };
  }

  if (!host) return { host: null, category: "direct" };

  if (selfHost && (host === selfHost || host.endsWith(`.${selfHost}`))) {
    return { host, category: "internal" };
  }

  if (SEARCH_HOSTS.some((needle) => host.includes(needle))) {
    return { host, category: "search" };
  }

  if (SOCIAL_HOSTS.some((needle) => host === needle || host.endsWith(`.${needle}`))) {
    return { host, category: "social" };
  }

  return { host, category: "referral" };
}

function clean(value: string | null | undefined, max = 120): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Daily-rotating visitor digest.
 *
 * The salt is `HMAC(secret, day)`, so yesterday's digests cannot be recomputed
 * from today's salt even by someone holding the secret and the IP address. The
 * digest is truncated to 32 hex characters — enough to avoid collisions in a
 * day's traffic, short enough to be obviously not an identifier.
 */
export async function visitorDigest(
  ip: string,
  userAgent: string,
  day: string,
  secret: string,
): Promise<string> {
  const salt = await hmacHex(secret, `page-view-salt:${day}`);
  const digest = await hmacHex(salt, `${ip}|${userAgent}`);
  return digest.slice(0, 32);
}

export interface TrackInput {
  path: string;
  referrer: string | null;
  ip: string;
  userAgent: string;
  selfHost: string | null;
  utm: { source: string | null; medium: string | null; campaign: string | null };
  isOperator: boolean;
}

export interface TrackResult {
  recorded: boolean;
  reason?: "not_trackable" | "no_secret" | "db_unavailable" | "failed";
}

/**
 * The key for the daily visitor salt.
 *
 * `WANDS_SESSION_SECRET` is the operator gate's secret and is the natural
 * choice, but a deployment can run without the operator gate configured. The
 * Better Auth secret is always present wherever members can sign in, so it is
 * the fallback. Either way the value is only ever used through
 * `HMAC(secret, "page-view-salt:<day>")`, so the two purposes never share a key.
 */
function analyticsSecret(): string | null {
  const candidates = [process.env.WANDS_SESSION_SECRET, process.env.BETTER_AUTH_SECRET];
  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (value) return value;
  }
  return null;
}

export async function recordPageView(input: TrackInput): Promise<TrackResult> {
  const path = normalizePath(input.path);
  if (!path) return { recorded: false, reason: "not_trackable" };

  if (!isDatabaseConfigured()) return { recorded: false, reason: "db_unavailable" };

  const secret = analyticsSecret();
  if (!secret) return { recorded: false, reason: "no_secret" };

  const day = todayInReportingZone();
  const { host, category } = categorizeReferrer(input.referrer, input.selfHost);

  try {
    const digest = await visitorDigest(input.ip, input.userAgent, day, secret);

    await query(
      `insert into site_page_view
         (day, path, referrer_host, referrer_category, utm_source, utm_medium, utm_campaign, visitor_hash, is_operator)
       values ($1::date, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        day,
        path,
        host,
        category,
        clean(input.utm.source),
        clean(input.utm.medium),
        clean(input.utm.campaign),
        digest,
        input.isOperator,
      ],
    );

    return { recorded: true };
  } catch (cause) {
    console.log(
      "[wands] page view record failed:",
      cause instanceof Error ? cause.message : cause,
    );
    return { recorded: false, reason: "failed" };
  }
}

/**
 * Retention. Traffic rows are aggregate and cheap, but they are still personal
 * data in aggregate, so they are pruned on a fixed horizon rather than kept
 * forever. Called opportunistically from the beacon; failures are ignored.
 */
export const TRAFFIC_RETENTION_DAYS = 400;

export async function pruneOldPageViews(): Promise<void> {
  if (!isDatabaseConfigured()) return;

  try {
    await query(
      `delete from site_page_view where day < (current_date - $1::int)`,
      [TRAFFIC_RETENTION_DAYS],
    );
  } catch {
    // Retention is best-effort; a missed sweep is not worth failing a beacon.
  }
}

export { REPORTING_TIMEZONE };
