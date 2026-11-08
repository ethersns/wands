import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  SESSION_COOKIE,
  gateConfigured,
  operatorUsername,
  verifySessionToken,
} from "@/lib/auth/session";

/**
 * Authoritative operator gate for the admin control centre.
 *
 * `middleware.ts` already refuses an operator path without a valid session, but
 * middleware is a routing convenience: it can be skipped by a rewrite, a direct
 * server-side render, or a future config change. Every admin page and every
 * admin endpoint therefore re-validates the signed cookie here, against the
 * same secret, before it reads a single row of business data.
 *
 * The development affordance mirrors middleware exactly: an unconfigured gate
 * cannot be signed into, so outside production it stays open rather than
 * locking the founder out of their own console. Production fails closed.
 */

export const ADMIN_HOME = "/dashboard";
export const OPERATOR_SIGN_IN = "/login";

export interface OperatorIdentity {
  /** Label recorded in the audit trail. Never a credential. */
  actor: string;
}

export type OperatorCheck =
  | { ok: true; identity: OperatorIdentity }
  | { ok: false; reason: "unconfigured" | "unauthenticated" };

function devBypassActive(): boolean {
  return !gateConfigured() && process.env.NODE_ENV !== "production";
}

export async function checkOperator(): Promise<OperatorCheck> {
  const configured = gateConfigured();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;

  if (configured && (await verifySessionToken(token))) {
    return { ok: true, identity: { actor: operatorUsername() ?? "operator" } };
  }

  if (devBypassActive()) {
    return { ok: true, identity: { actor: "operator (gate unconfigured)" } };
  }

  return { ok: false, reason: configured ? "unauthenticated" : "unconfigured" };
}

/**
 * Page-level gate. Redirects rather than throwing so an expired session lands
 * on the sign-in form with a return path instead of an error screen.
 */
export async function requireOperator(nextPath: string = ADMIN_HOME): Promise<OperatorIdentity> {
  const check = await checkOperator();

  if (check.ok) return check.identity;

  redirect(`${OPERATOR_SIGN_IN}?next=${encodeURIComponent(nextPath)}`);
}

export interface OperatorDenial {
  status: number;
  code: string;
  message: string;
}

/**
 * Endpoint-level gate. Returns a denial the route handler turns into JSON, so
 * an admin API never answers with a redirect that a `fetch` would follow into
 * an HTML sign-in page.
 */
export async function authorizeOperatorRequest(): Promise<
  { ok: true; identity: OperatorIdentity } | { ok: false; denial: OperatorDenial }
> {
  const check = await checkOperator();

  if (check.ok) return check;

  if (check.reason === "unconfigured") {
    return {
      ok: false,
      denial: {
        status: 503,
        code: "operator_gate_unconfigured",
        message: "The operator gate is not configured on this deployment.",
      },
    };
  }

  return {
    ok: false,
    denial: {
      status: 401,
      code: "unauthorized",
      message: "Sign in as the operator to use this endpoint.",
    },
  };
}
