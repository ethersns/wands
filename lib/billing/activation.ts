import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { isDatabaseConfigured, query } from "@/lib/db";

import type { SignupIntent, SignupIntentStatus } from "./signup-intent";

/**
 * Account activation after a verified payment.
 *
 * The activation token is the only path from "paid" to "usable account". It is
 * generated on the server, sent to the address the payment was made with, and
 * stored only as a SHA-256 hash — a leaked database row cannot be turned into a
 * working link, exactly as with a password. It is single-use and time-limited.
 */

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export function hashActivationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface IssuedToken {
  token: string;
  expiresAt: Date;
}

export async function issueActivationToken(
  intentId: string,
): Promise<IssuedToken | null> {
  if (!isDatabaseConfigured()) return null;

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  const rows = await query<{ id: string }>(
    `insert into member_activation_token (intent_id, token_hash, expires_at)
     values ($1::uuid, $2, $3)
     returning id::text as id`,
    [intentId, hashActivationToken(token), expiresAt.toISOString()],
  );

  return rows[0] ? { token, expiresAt } : null;
}

/**
 * True when this intent already has a live, unused token.
 *
 * Stripe retries deliveries, and a retry must not send a second activation
 * email or invalidate the link the customer already has.
 */
export async function hasLiveActivationToken(intentId: string): Promise<boolean> {
  if (!isDatabaseConfigured()) return false;

  const rows = await query<{ id: string }>(
    `select id::text as id from member_activation_token
     where intent_id = $1::uuid and used_at is null and expires_at > now()
     limit 1`,
    [intentId],
  );

  return rows.length > 0;
}

export interface ActivationLookup {
  tokenId: string;
  expiresAt: string;
  usedAt: string | null;
  intent: {
    id: string;
    email: string;
    plan: string;
    status: SignupIntentStatus;
    userId: string | null;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
  };
}

interface LookupRow {
  token_id: string;
  expires_at: Date;
  used_at: Date | null;
  intent_id: string;
  email_normalized: string;
  plan: string;
  status: string;
  user_id: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
}

/** Reads a token without consuming it, so a page can render before acting. */
export async function peekActivationToken(
  token: string,
): Promise<ActivationLookup | null> {
  if (!isDatabaseConfigured() || !token) return null;

  const rows = await query<LookupRow>(
    `select t.id::text as token_id, t.expires_at, t.used_at,
            i.id::text as intent_id, i.email_normalized, i.plan, i.status,
            i.user_id, i.stripe_customer_id, i.stripe_subscription_id
     from member_activation_token t
     join member_signup_intent i on i.id = t.intent_id
     where t.token_hash = $1`,
    [hashActivationToken(token)],
  );

  const row = rows[0];
  if (!row) return null;

  return {
    tokenId: row.token_id,
    expiresAt: row.expires_at.toISOString(),
    usedAt: row.used_at ? row.used_at.toISOString() : null,
    intent: {
      id: row.intent_id,
      email: row.email_normalized,
      plan: row.plan,
      status: row.status as SignupIntentStatus,
      userId: row.user_id,
      stripeCustomerId: row.stripe_customer_id,
      stripeSubscriptionId: row.stripe_subscription_id,
    },
  };
}

export type ActivationTokenState =
  | { ok: true; lookup: ActivationLookup }
  | { ok: false; reason: "invalid" | "used" | "expired" | "unpaid" };

/**
 * Validates a token for display or for use.
 *
 * The three failure modes are kept apart because they need different words: a
 * replayed link, an expired link and a link whose payment never settled are not
 * the same problem for the person holding it.
 */
export async function validateActivationToken(
  token: string,
): Promise<ActivationTokenState> {
  const lookup = await peekActivationToken(token);
  if (!lookup) return { ok: false, reason: "invalid" };
  if (lookup.usedAt) return { ok: false, reason: "used" };

  const expires = new Date(lookup.expiresAt);
  if (Number.isNaN(expires.getTime()) || expires.getTime() <= Date.now()) {
    return { ok: false, reason: "expired" };
  }

  if (lookup.intent.status !== "paid" && lookup.intent.status !== "activated") {
    return { ok: false, reason: "unpaid" };
  }

  return { ok: true, lookup };
}

/**
 * Burns the token.
 *
 * The `used_at is null` predicate is the single-use guarantee: two concurrent
 * requests carrying the same link cannot both succeed, because only one update
 * can match the row.
 */
export async function consumeActivationToken(token: string): Promise<boolean> {
  if (!isDatabaseConfigured()) return false;

  const rows = await query<{ id: string }>(
    `update member_activation_token
     set used_at = now()
     where token_hash = $1 and used_at is null and expires_at > now()
     returning id::text as id`,
    [hashActivationToken(token)],
  );

  return rows.length > 0;
}

export function activationUrl(token: string, baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/activate?token=${encodeURIComponent(token)}`;
}

export type { SignupIntent };
