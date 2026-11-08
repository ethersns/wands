import "server-only";

import { isDatabaseConfigured, query } from "@/lib/db";

/**
 * Pending signups.
 *
 * A signup intent is the record of a checkout that has been started but not
 * yet paid for. It is the reconciliation key between the browser, the Stripe
 * session and the webhook, and it is deliberately not a user: it holds no
 * password, cannot be signed into, and grants nothing. The only thing it can
 * become is a paid intent, and the only thing a paid intent can become is an
 * activated account.
 */

export type SignupIntentStatus =
  | "pending"
  | "paid"
  | "activated"
  | "cancelled"
  | "failed"
  | "expired";

export interface SignupIntent {
  id: string;
  email: string;
  plan: string;
  priceId: string;
  status: SignupIntentStatus;
  checkoutSessionId: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  userId: string | null;
  createdAt: string;
  expiresAt: string;
  paidAt: string | null;
  activatedAt: string | null;
}

interface IntentRow {
  id: string;
  email_normalized: string;
  plan: string;
  price_id: string;
  status: string;
  stripe_checkout_session_id: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  user_id: string | null;
  created_at: Date;
  expires_at: Date;
  paid_at: Date | null;
  activated_at: Date | null;
}

const COLUMNS = `id::text as id, email_normalized, plan, price_id, status,
  stripe_checkout_session_id, stripe_customer_id, stripe_subscription_id,
  user_id, created_at, expires_at, paid_at, activated_at`;

function toIntent(row: IntentRow): SignupIntent {
  return {
    id: row.id,
    email: row.email_normalized,
    plan: row.plan,
    priceId: row.price_id,
    status: row.status as SignupIntentStatus,
    checkoutSessionId: row.stripe_checkout_session_id,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    userId: row.user_id,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    paidAt: row.paid_at ? row.paid_at.toISOString() : null,
    activatedAt: row.activated_at ? row.activated_at.toISOString() : null,
  };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function createSignupIntent(input: {
  email: string;
  plan: string;
  priceId: string;
}): Promise<SignupIntent | null> {
  if (!isDatabaseConfigured()) return null;

  const rows = await query<IntentRow>(
    `insert into member_signup_intent
       (email_normalized, plan, price_id, status, terms_accepted_at)
     values ($1, $2, $3, 'pending', now())
     returning ${COLUMNS}`,
    [normalizeEmail(input.email), input.plan, input.priceId],
  );

  return rows[0] ? toIntent(rows[0]) : null;
}

export async function getSignupIntent(id: string): Promise<SignupIntent | null> {
  if (!isDatabaseConfigured()) return null;

  const rows = await query<IntentRow>(
    `select ${COLUMNS} from member_signup_intent where id = $1::uuid`,
    [id],
  );

  return rows[0] ? toIntent(rows[0]) : null;
}

export async function getSignupIntentBySession(
  sessionId: string,
): Promise<SignupIntent | null> {
  if (!isDatabaseConfigured()) return null;

  const rows = await query<IntentRow>(
    `select ${COLUMNS} from member_signup_intent
     where stripe_checkout_session_id = $1`,
    [sessionId],
  );

  return rows[0] ? toIntent(rows[0]) : null;
}

/**
 * The most recent intent for an address.
 *
 * Used to answer "has this person already started or finished a checkout",
 * which is what stops a second subscription being created for the same email.
 */
export async function latestIntentForEmail(
  email: string,
): Promise<SignupIntent | null> {
  if (!isDatabaseConfigured()) return null;

  const rows = await query<IntentRow>(
    `select ${COLUMNS} from member_signup_intent
     where email_normalized = $1
     order by created_at desc
     limit 1`,
    [normalizeEmail(email)],
  );

  return rows[0] ? toIntent(rows[0]) : null;
}

export async function attachCheckoutSession(
  intentId: string,
  sessionId: string,
): Promise<void> {
  await query(
    `update member_signup_intent
     set stripe_checkout_session_id = $2, updated_at = now()
     where id = $1::uuid`,
    [intentId, sessionId],
  );
}

/**
 * Records a verified payment.
 *
 * Idempotent and monotonic: a replayed webhook cannot move an activated intent
 * back to paid, and `coalesce` keeps the first customer and subscription ids
 * rather than letting a later event blank them.
 */
export async function markIntentPaid(input: {
  intentId: string;
  customerId: string | null;
  subscriptionId: string | null;
}): Promise<SignupIntent | null> {
  if (!isDatabaseConfigured()) return null;

  const rows = await query<IntentRow>(
    `update member_signup_intent
     set status = case when status = 'activated' then 'activated' else 'paid' end,
         paid_at = coalesce(paid_at, now()),
         stripe_customer_id = coalesce($2, stripe_customer_id),
         stripe_subscription_id = coalesce($3, stripe_subscription_id),
         updated_at = now()
     where id = $1::uuid
     returning ${COLUMNS}`,
    [input.intentId, input.customerId, input.subscriptionId],
  );

  return rows[0] ? toIntent(rows[0]) : null;
}

/** A payment that Stripe has accepted but not yet settled. */
export async function markIntentAwaitingPayment(input: {
  intentId: string;
  customerId: string | null;
  subscriptionId: string | null;
}): Promise<void> {
  await query(
    `update member_signup_intent
     set stripe_customer_id = coalesce($2, stripe_customer_id),
         stripe_subscription_id = coalesce($3, stripe_subscription_id),
         updated_at = now()
     where id = $1::uuid and status = 'pending'`,
    [input.intentId, input.customerId, input.subscriptionId],
  );
}

/** Only a pending intent can fail; a paid one is never downgraded. */
export async function markIntentFailed(intentId: string): Promise<void> {
  await query(
    `update member_signup_intent
     set status = 'failed', updated_at = now()
     where id = $1::uuid and status = 'pending'`,
    [intentId],
  );
}

export async function markIntentCancelled(intentId: string): Promise<void> {
  await query(
    `update member_signup_intent
     set status = 'cancelled', updated_at = now()
     where id = $1::uuid and status = 'pending'`,
    [intentId],
  );
}

export async function markIntentExpired(intentId: string): Promise<void> {
  await query(
    `update member_signup_intent
     set status = 'expired', updated_at = now()
     where id = $1::uuid and status = 'pending'`,
    [intentId],
  );
}

export async function linkIntentToUser(
  intentId: string,
  userId: string,
): Promise<void> {
  await query(
    `update member_signup_intent
     set user_id = $2, updated_at = now()
     where id = $1::uuid`,
    [intentId, userId],
  );
}

export async function markIntentActivated(intentId: string): Promise<void> {
  await query(
    `update member_signup_intent
     set status = 'activated', activated_at = coalesce(activated_at, now()),
         updated_at = now()
     where id = $1::uuid`,
    [intentId],
  );
}

export function isIntentExpired(intent: SignupIntent, now = new Date()): boolean {
  const expires = new Date(intent.expiresAt);
  return !Number.isNaN(expires.getTime()) && expires.getTime() <= now.getTime();
}
