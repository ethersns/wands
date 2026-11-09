import "server-only";

import type Stripe from "stripe";

import { isDatabaseConfigured, query } from "@/lib/db";

import { stripeSecretKey } from "./config";

/**
 * The Stripe mirror.
 *
 * Stripe is the system of record for a payment. This module keeps a local copy
 * of the parts Wands needs to answer "may this account read research" without
 * calling Stripe on every request, and it is written only from a verified
 * webhook — never from a browser.
 *
 * Two properties matter more than anything else here:
 *
 *   * **Idempotence.** Stripe retries deliveries and can deliver the same event
 *     more than once. Every write is an upsert keyed on the Stripe id, so a
 *     replay changes nothing.
 *   * **Ordering.** Stripe does not guarantee delivery order. Each subscription
 *     row carries `last_event_at`, and an update whose event is older than the
 *     state already stored is discarded rather than allowed to roll the
 *     subscription backwards.
 */

export interface SubscriptionState {
  id: string;
  customerId: string;
  priceId: string | null;
  plan: string | null;
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  unitAmount: number | null;
  currency: string | null;
  interval: string | null;
  /** Unix seconds from the Stripe event, used to reject stale updates. */
  eventCreated: number;
}

export function idOf(
  value: string | { id: string } | null | undefined,
): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof value.id === "string") {
    return value.id;
  }
  return null;
}

function toIso(seconds: number | null | undefined): string | null {
  if (!seconds || !Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000).toISOString();
}

/**
 * Maps a Stripe subscription onto the local shape.
 *
 * `current_period_end` moved from the subscription onto its items in recent
 * API versions, so both are read and the item wins.
 */
export function mapSubscription(
  subscription: Stripe.Subscription,
  eventCreated: number,
): SubscriptionState | null {
  const customerId = idOf(subscription.customer);
  if (!customerId) return null;

  const item = subscription.items?.data?.[0];
  const legacy = subscription as unknown as { current_period_end?: number | null };
  const periodEnd = item?.current_period_end ?? legacy.current_period_end ?? null;
  const price = item?.price;

  return {
    id: subscription.id,
    customerId,
    priceId: price?.id ?? null,
    plan: subscription.metadata?.plan ?? null,
    status: subscription.status,
    currentPeriodEnd: toIso(periodEnd),
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    unitAmount: price?.unit_amount ?? null,
    currency: price?.currency ?? null,
    interval: price?.recurring?.interval ?? null,
    eventCreated,
  };
}

export async function upsertBillingCustomer(
  email: string,
  customerId: string,
): Promise<void> {
  if (!isDatabaseConfigured()) return;

  await query(
    `insert into billing_customer (email_normalized, stripe_customer_id)
     values ($1, $2)
     on conflict (email_normalized) do update
       set stripe_customer_id = excluded.stripe_customer_id,
           updated_at = now()`,
    [email.trim().toLowerCase(), customerId],
  );
}

export async function upsertSubscription(state: SubscriptionState): Promise<void> {
  if (!isDatabaseConfigured()) return;

  await query(
    `insert into subscription
       (stripe_subscription_id, stripe_customer_id, price_id, plan, status,
        current_period_end, cancel_at_period_end, unit_amount, currency,
        interval, last_event_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, to_timestamp($11))
     on conflict (stripe_subscription_id) do update set
       stripe_customer_id = excluded.stripe_customer_id,
       price_id = coalesce(excluded.price_id, subscription.price_id),
       plan = coalesce(excluded.plan, subscription.plan),
       status = excluded.status,
       current_period_end = coalesce(excluded.current_period_end, subscription.current_period_end),
       cancel_at_period_end = excluded.cancel_at_period_end,
       unit_amount = coalesce(excluded.unit_amount, subscription.unit_amount),
       currency = coalesce(excluded.currency, subscription.currency),
       interval = coalesce(excluded.interval, subscription.interval),
       last_event_at = excluded.last_event_at,
       updated_at = now()
     where subscription.last_event_at is null
        or subscription.last_event_at <= excluded.last_event_at`,
    [
      state.id,
      state.customerId,
      state.priceId,
      state.plan,
      state.status,
      state.currentPeriodEnd,
      state.cancelAtPeriodEnd,
      state.unitAmount,
      state.currency,
      state.interval,
      state.eventCreated,
    ],
  );
}

interface SubscriptionRow {
  stripe_subscription_id: string;
  stripe_customer_id: string;
  price_id: string | null;
  plan: string | null;
  status: string;
  current_period_end: Date | null;
  cancel_at_period_end: boolean;
}

export async function getSubscription(
  subscriptionId: string,
): Promise<SubscriptionRow | null> {
  if (!isDatabaseConfigured()) return null;

  const rows = await query<SubscriptionRow>(
    `select stripe_subscription_id, stripe_customer_id, price_id, plan, status,
            current_period_end, cancel_at_period_end
     from subscription
     where stripe_subscription_id = $1`,
    [subscriptionId],
  );

  return rows[0] ?? null;
}

/**
 * Pushes the mirrored subscription state onto the member's entitlement row.
 *
 * Only an account that has already been activated is touched: before that
 * there is no user to update, and the state is picked up from the subscription
 * row when activation happens.
 */
export async function syncMembershipFromCustomer(
  customerId: string,
): Promise<void> {
  if (!isDatabaseConfigured()) return;

  const rows = await query<SubscriptionRow>(
    `select stripe_subscription_id, stripe_customer_id, price_id, plan, status,
            current_period_end, cancel_at_period_end
     from subscription
     where stripe_customer_id = $1
     order by last_event_at desc nulls last
     limit 1`,
    [customerId],
  );

  const subscription = rows[0];
  if (!subscription) return;

  await query(
    `update member_membership
     set plan = coalesce($2, plan),
         status = $3,
         current_period_end = $4,
         cancel_at_period_end = $5,
         price_id = coalesce($6, price_id),
         stripe_subscription_id = coalesce(stripe_subscription_id, $7),
         entitlement_source = 'stripe',
         updated_at = now()
     where stripe_customer_id = $1`,
    [
      customerId,
      subscription.plan,
      subscription.status,
      subscription.current_period_end
        ? subscription.current_period_end.toISOString()
        : null,
      subscription.cancel_at_period_end,
      subscription.price_id,
      subscription.stripe_subscription_id,
    ],
  );
}

/**
 * Grants the entitlement that a verified payment bought.
 *
 * Called once, at activation, after the token has proved the person controls
 * the address the payment was made with. The subscription row is the source of
 * the plan, status and period end, so the entitlement can never be wider than
 * what Stripe actually recorded.
 */
export async function activateMembershipForUser(input: {
  userId: string;
  customerId: string | null;
  subscriptionId: string | null;
  plan: string;
}): Promise<void> {
  if (!isDatabaseConfigured()) return;

  const subscription = input.subscriptionId
    ? await getSubscription(input.subscriptionId)
    : null;

  const status = subscription?.status ?? "active";
  const periodEnd = subscription?.current_period_end
    ? subscription.current_period_end.toISOString()
    : null;

  await query(
    `insert into member_membership
       (user_id, plan, status, entitlement_source, stripe_customer_id,
        stripe_subscription_id, price_id, current_period_end,
        cancel_at_period_end, activated_at, updated_at)
     values ($1, $2, $3, 'stripe', $4, $5, $6, $7, $8, now(), now())
     on conflict (user_id) do update set
       plan = excluded.plan,
       status = excluded.status,
       entitlement_source = 'stripe',
       stripe_customer_id = coalesce(excluded.stripe_customer_id, member_membership.stripe_customer_id),
       stripe_subscription_id = coalesce(excluded.stripe_subscription_id, member_membership.stripe_subscription_id),
       price_id = coalesce(excluded.price_id, member_membership.price_id),
       current_period_end = coalesce(excluded.current_period_end, member_membership.current_period_end),
       cancel_at_period_end = excluded.cancel_at_period_end,
       activated_at = coalesce(member_membership.activated_at, now()),
       updated_at = now()`,
    [
      input.userId,
      subscription?.plan ?? input.plan,
      status,
      input.customerId,
      input.subscriptionId,
      subscription?.price_id ?? null,
      periodEnd,
      subscription?.cancel_at_period_end ?? false,
    ],
  );
}

/**
 * Reads a subscription straight from Stripe and mirrors it.
 *
 * Used by the events that carry a subscription id but not the subscription's
 * state — `checkout.session.completed` and the invoice events. The state is
 * fetched live, so it is stamped with the current time rather than the event's
 * timestamp: the data is as fresh as the call, and an older event payload
 * delivered afterwards must not be allowed to overwrite it.
 *
 * A failure here throws so the webhook answers 500 and Stripe retries, rather
 * than recording a payment whose entitlement was never written.
 */
export async function syncSubscriptionFromStripe(
  subscriptionId: string,
): Promise<void> {
  if (!stripeSecretKey) return;

  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe(stripeSecretKey);
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const state = mapSubscription(subscription, Math.floor(Date.now() / 1000));

  if (!state) return;

  await upsertSubscription(state);
  await syncMembershipFromCustomer(state.customerId);
}
