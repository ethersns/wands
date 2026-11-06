/**
 * Which audience a path belongs to.
 *
 * The deployment serves three of them, and they must not be confused:
 *
 * - `public`   — the marketing site, sign-in, and provider webhooks. No session.
 * - `customer` — billing and account pages owned by the commercial site. A
 *                customer session, never an operator one.
 * - `operator` — the trading console and every route that reaches the engine.
 *
 * Unknown paths are public on purpose. The commercial site adds pages without
 * editing this file, and a new public page must never be blocked by a gate that
 * has not heard of it. The trade-off is that a new *private* page is public
 * until it is listed below, so the operator list is the thing to keep current.
 */

export type RouteTier = "public" | "customer" | "operator";

/**
 * Every path that reaches the engine, plus the console that drives it.
 *
 * `/api/research` and `/api/markets/*` are here for the same reason
 * `/api/wands/*` is: they call the engine with the server-side admin token, so
 * an unauthenticated request to them is an unauthenticated admin request. They
 * were reachable without a session before this list existed.
 */
export const OPERATOR_PREFIXES = [
  "/api/wands",
  "/api/research",
  "/api/markets",
  "/dashboard",
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
] as const;

/**
 * Billing and account surfaces. Empty until the commercial site adds them;
 * listing a path here keeps it off the operator gate once it exists.
 */
export const CUSTOMER_PREFIXES: readonly string[] = [];

function matches(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function routeTier(pathname: string): RouteTier {
  if (matches(pathname, OPERATOR_PREFIXES)) return "operator";
  if (matches(pathname, CUSTOMER_PREFIXES)) return "customer";
  return "public";
}

/** True for the routes that answer with JSON rather than a page. */
export function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}
