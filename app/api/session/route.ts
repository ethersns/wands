import { NextResponse, type NextRequest } from "next/server";

import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  checkPassword,
  createSessionToken,
  gateConfigured,
} from "@/lib/auth/session";

/**
 * Operator sign-in for the BFF.
 *
 * The engine token lives on the server, so the proxy route is only as private
 * as this gate. Signing in sets a signed, HttpOnly cookie; the middleware
 * requires it before forwarding anything to the engine.
 */

const UNCONFIGURED = {
  error: {
    code: "operator_gate_unconfigured",
    message:
      "Set WANDS_OPERATOR_PASSWORD and WANDS_SESSION_SECRET on the server to enable engine actions.",
  },
};

export async function POST(request: NextRequest) {
  if (!gateConfigured()) {
    return NextResponse.json(UNCONFIGURED, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as {
    password?: unknown;
  } | null;
  const password = typeof body?.password === "string" ? body.password : "";

  if (!(await checkPassword(password))) {
    return NextResponse.json(
      {
        error: {
          code: "unauthorized",
          message: "That password is not correct.",
        },
      },
      { status: 401 },
    );
  }

  const token = await createSessionToken();
  if (!token) {
    return NextResponse.json(UNCONFIGURED, { status: 503 });
  }

  const response = NextResponse.json({ data: { signedIn: true } });
  response.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ data: { signedIn: false } });
  response.cookies.set({
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
