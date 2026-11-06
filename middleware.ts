import { NextResponse, type NextRequest } from "next/server";

import { isApiPath, routeTier } from "@/lib/auth/routes";
import {
  SESSION_COOKIE,
  gateConfigured,
  verifySessionToken,
} from "@/lib/auth/session";

/**
 * Operator gate.
 *
 * The console and every route that reaches the engine require a signed operator
 * session. `/api/wands/*`, `/api/research` and `/api/markets/*` all forward to
 * the engine with a server-side admin token, so an unauthenticated request to
 * any of them is an unauthenticated admin request to the engine.
 *
 * Public and customer paths never consult the gate. A marketing page must not
 * depend on an operator secret being set, and must not start returning 503
 * because the operator password is missing.
 *
 * When the gate is unconfigured the operator tier fails closed in production
 * rather than silently becoming public. Development and preview stay open so
 * the app is usable without a password.
 */

function unconfiguredResponse() {
  return NextResponse.json(
    {
      error: {
        code: "operator_gate_unconfigured",
        message:
          "Set WANDS_OPERATOR_PASSWORD and WANDS_SESSION_SECRET on the server to enable engine actions.",
      },
    },
    { status: 503 },
  );
}

function unauthorizedResponse() {
  return NextResponse.json(
    {
      error: {
        code: "unauthorized",
        message: "Sign in to perform engine actions.",
      },
    },
    { status: 401 },
  );
}

/**
 * An API route that no list in `lib/auth/routes.ts` claims. Answering 404 keeps
 * it from confirming that the endpoint exists, and keeps a forgotten private
 * route from becoming an anonymous one.
 */
function notFoundResponse() {
  return NextResponse.json(
    { error: { code: "not_found", message: "Not found." } },
    { status: 404 },
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const tier = routeTier(pathname);

  if (tier === "denied") {
    return notFoundResponse();
  }

  if (tier !== "operator") {
    return NextResponse.next();
  }

  const configured = gateConfigured();
  const token = request.cookies.get(SESSION_COOKIE)?.value;

  if (configured && (await verifySessionToken(token))) {
    return NextResponse.next();
  }

  // An unconfigured gate cannot be signed into, so outside production it stays
  // open rather than locking the operator out of their own console. Production
  // fails closed.
  if (!configured && process.env.NODE_ENV !== "production") {
    return NextResponse.next();
  }

  // A page sends the operator to the sign-in form; an API call gets a status it
  // can act on. Neither is served without a session.
  if (!isApiPath(pathname)) {
    const signIn = new URL("/login", request.url);
    signIn.searchParams.set("next", pathname);
    return NextResponse.redirect(signIn);
  }

  return configured ? unauthorizedResponse() : unconfiguredResponse();
}

/**
 * Must cover every prefix in `lib/auth/routes.ts`. Next.js requires the matcher
 * to be a static literal, so the two cannot share a value; a test asserts they
 * stay in step.
 *
 * `/api/:path*` is deliberately broad: the middleware is what denies API routes
 * that no list claims, so it has to see all of them, not just the known ones.
 */
export const config = {
  matcher: [
    "/api/:path*",
    "/dashboard/:path*",
    "/portfolio/:path*",
    "/markets/:path*",
    "/bots/:path*",
    "/orders/:path*",
    "/intelligence/:path*",
    "/strategy-lab/:path*",
    "/research/:path*",
    "/risk/:path*",
    "/connections/:path*",
    "/settings/:path*",
  ],
};
