import { NextResponse, type NextRequest } from "next/server";

import {
  SESSION_COOKIE,
  gateConfigured,
  verifySessionToken,
} from "@/lib/auth/session";

/**
 * Gate for the engine proxy.
 *
 * `/api/wands/*` forwards to the Python engine with a server-side admin token,
 * so an unauthenticated request to it is an unauthenticated admin request to
 * the engine. Nothing reaches the engine without a valid operator session.
 *
 * When the gate is unconfigured the route fails closed in production rather
 * than silently becoming public. Development and preview stay open so the app
 * is usable without a password.
 */
export async function middleware(request: NextRequest) {
  if (!gateConfigured()) {
    if (process.env.NODE_ENV === "production") {
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
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (await verifySessionToken(token)) {
    return NextResponse.next();
  }

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

export const config = {
  matcher: ["/api/wands/:path*"],
};
