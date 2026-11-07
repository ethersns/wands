/**
 * Which audience a path belongs to.
 *
 * The deployment serves three of them, and they must not be confused:
 *
 * - `public`   — the marketing site, sign-in, and the endpoints the marketing
 *                forms post to. No session.
 * - `customer` — billing and account pages for paying subscribers. A customer
 *                session, never an operator one. A Stripe subscription grants
 *                entitlement to these routes and nothing else.
 * - `operator` — the trading console and every route that reaches the engine.
 *
 * A fourth outcome, `denied`, exists for API routes nobody classified. Pages
 * default to public so the commercial site can add them without editing this
 * file; APIs do not, because an unclassified API route is far more likely to be
 * a forgotten private endpoint than a new public one.
 */

export type RouteTier = "public" | "customer" | "operator" | "denied";

/**
 * Every path that reaches the engine, plus the console that drives it.
 *
 * `/api/research` and `/api/markets/*` are here for the same reason
 * `/api/wands/*` is: they call the engine with the server-side admin token, so
 * an unauthenticated request to them is an unauthenticated admin request.
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
 * Subscriber surfaces. A Stripe subscription is what will authorise these, and
 * it must never authorise anything in `OPERATOR_PREFIXES`.
 */
export const CUSTOMER_PREFIXES = [
  "/app",
  "/onboarding",
  "/account",
  "/billing",
  "/api/member",
  "/api/account",
  "/api/billing/portal",
] as const;

/**
 * Customer pages that require a member session. Middleware only performs an
 * optimistic cookie check on these; the layout re-validates the session against
 * the database, which is the authoritative gate.
 */
export const MEMBER_PAGE_PREFIXES = ["/app", "/onboarding"] as const;

/**
 * Better Auth's session cookie, prefixed by the `cookiePrefix` in
 * `lib/auth/member.ts`. Kept here because middleware runs on the edge and
 * cannot import the auth instance.
 *
 * Better Auth prepends `__Secure-` whenever the cookie is marked secure, which
 * it is in development (for the cross-site preview iframe) and on HTTPS in
 * production. Both names have to be recognised or the optimistic check misses a
 * valid session and bounces the visitor between `/app` and `/signin`.
 */
export const MEMBER_SESSION_COOKIES = ["wands.session_token", "__Secure-wands.session_token"] as const;

export function hasMemberSessionCookie(cookies: { has(name: string): boolean }): boolean {
  return MEMBER_SESSION_COOKIES.some((name) => cookies.has(name));
}

/**
 * The only API routes reachable without a session. Each is listed deliberately:
 * the marketing forms, the sign-in endpoint, and the two billing endpoints that
 * anonymous visitors legitimately call. The webhook is public because Stripe
 * cannot hold a session — it authenticates with a signature instead.
 */
export const PUBLIC_API_PREFIXES = [
  "/api/auth",
  "/api/session",
  "/api/waitlist",
  "/api/contact",
  "/api/billing/checkout",
  "/api/billing/webhook",
] as const;

function matches(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** True for the routes that answer with JSON rather than a page. */
export function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

export function isMemberPage(pathname: string): boolean {
  return matches(pathname, MEMBER_PAGE_PREFIXES);
}

export function routeTier(pathname: string): RouteTier {
  if (matches(pathname, OPERATOR_PREFIXES)) return "operator";
  if (matches(pathname, CUSTOMER_PREFIXES)) return "customer";
  if (matches(pathname, PUBLIC_API_PREFIXES)) return "public";

  // An API route that no list claims is not public by default. A new page is
  // public until someone says otherwise; a new endpoint has to be declared.
  if (isApiPath(pathname)) return "denied";

  return "public";
}
