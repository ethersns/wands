import "server-only";

import { createHash } from "node:crypto";
import { isIP } from "node:net";

/**
 * Trusted request metadata for the security trail.
 *
 * The rule this module exists to enforce: a value that a client can choose is
 * not evidence. `x-forwarded-for` is a plain request header, so any caller can
 * send `x-forwarded-for: 1.2.3.4` and have it recorded as their address. Only
 * headers the platform's own edge writes are read here, and the generic
 * forwarded header is honoured solely when the deployment explicitly declares
 * that a trusted proxy overwrites it.
 *
 * Nothing here geolocates. An IP address is not a location, and a security log
 * that claims one is worse than a log that admits it does not know.
 */

const MAX_USER_AGENT_LENGTH = 256;

/**
 * Headers written by the hosting edge, in order of trust.
 *
 * Vercel overwrites `x-vercel-forwarded-for` and `x-real-ip` at the edge, so a
 * client cannot forge them. Cloudflare's `cf-connecting-ip` is equivalent when
 * the request arrives through Cloudflare.
 */
const TRUSTED_IP_HEADERS = [
  "x-vercel-forwarded-for",
  "x-real-ip",
  "cf-connecting-ip",
] as const;

/**
 * Normalises one candidate address, or returns null.
 *
 * A forwarded list is comma-separated and the leftmost entry is the one the
 * edge saw, so only that entry is considered. IPv4-mapped IPv6
 * (`::ffff:203.0.113.7`) is unwrapped to its IPv4 form so the same client does
 * not appear as two different addresses. A port suffix is stripped.
 */
function normaliseIp(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const first = raw.split(",")[0]?.trim();
  if (!first) return null;

  // `[2001:db8::1]:443` and `203.0.113.7:51234`
  const withoutPort = first.startsWith("[")
    ? first.slice(1, first.indexOf("]"))
    : first.replace(/:\d+$/, "");

  const candidate = withoutPort.startsWith("::ffff:")
    ? withoutPort.slice("::ffff:".length)
    : withoutPort;

  return isIP(candidate) ? candidate : null;
}

/**
 * The client address, or null when it cannot be established from trusted
 * infrastructure metadata.
 *
 * Null is a legitimate, expected answer — a local development request has no
 * edge in front of it. Callers must render "Not recorded" rather than
 * substituting a placeholder that later reads as fact.
 */
export function clientIpFromHeaders(headers: Headers): string | null {
  for (const name of TRUSTED_IP_HEADERS) {
    const value = normaliseIp(headers.get(name));
    if (value) return value;
  }

  // Opt-in only. Set this when the app sits behind a proxy that is known to
  // overwrite `x-forwarded-for`; without that guarantee the header is
  // attacker-controlled and must not reach a security log.
  if (process.env.WANDS_TRUST_PROXY_HEADERS === "true") {
    return normaliseIp(headers.get("x-forwarded-for"));
  }

  return null;
}

/** A truncated user agent, or null. Long enough to identify a browser family. */
export function userAgentFromHeaders(headers: Headers): string | null {
  const value = headers.get("user-agent")?.trim();
  if (!value) return null;
  return value.slice(0, MAX_USER_AGENT_LENGTH);
}

/**
 * A salted digest of an email address, for correlating repeated failed
 * sign-ins against one address without storing the address.
 *
 * The salt is the deployment's session secret, so the digest is not portable
 * between deployments and cannot be reversed with a precomputed table of
 * common addresses.
 */
export function hashEmail(email: string): string | null {
  const normalised = email.trim().toLowerCase();
  if (!normalised) return null;

  const salt = process.env.WANDS_SESSION_SECRET ?? process.env.BETTER_AUTH_SECRET;
  if (!salt) return null;

  return createHash("sha256").update(`${salt}:${normalised}`).digest("hex").slice(0, 32);
}
