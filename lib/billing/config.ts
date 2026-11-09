import "server-only";

import { cache } from "react";

/**
 * Billing configuration.
 *
 * Every value here is read on the server. No price id, amount, plan or
 * entitlement flag is ever accepted from a request body, a query string or a
 * cookie: the browser names a plan, and the server decides what that name is
 * worth.
 */

export const stripeSecretKey = process.env.STRIPE_SECRET_KEY ?? null;
export const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? null;

/**
 * A live key can move real money, so switching billing on is not enough on its
 * own: a live key also needs a second, explicit approval. A test key does not,
 * because a test charge is not a charge.
 */
const liveKey = stripeSecretKey?.startsWith("sk_live_") ?? false;
const liveApproved = process.env.WANDS_BILLING_LIVE_APPROVED === "true";
const switchOn = process.env.WANDS_BILLING_ENABLED === "true";

export const billingEnabled = switchOn && (!liveKey || liveApproved);

export const billingBlockedReason: string | null = billingEnabled
  ? null
  : switchOn && liveKey
    ? "Billing is switched on but the configured Stripe key is a live key. Set WANDS_BILLING_LIVE_APPROVED=true to accept live payments."
    : "Billing is not open yet.";

// ---------------------------------------------------------------------------
// Member plans
// ---------------------------------------------------------------------------

export type MemberPlanId = "founding";

export interface MemberPlan {
  id: MemberPlanId;
  name: string;
  /** The amount the product publishes, in minor units. */
  publishedAmount: number;
  publishedCurrency: string;
  interval: "month";
  /** The environment variable holding the Stripe Price id. */
  priceEnv: string;
}

export const MEMBER_PLANS: Record<MemberPlanId, MemberPlan> = {
  founding: {
    id: "founding",
    name: "Wands Founding Access",
    publishedAmount: 1900,
    publishedCurrency: "usd",
    interval: "month",
    priceEnv: "STRIPE_PRICE_FOUNDING",
  },
};

export const MEMBER_PLAN_IDS = Object.keys(MEMBER_PLANS) as MemberPlanId[];

export function isMemberPlanId(value: unknown): value is MemberPlanId {
  return typeof value === "string" && Object.hasOwn(MEMBER_PLANS, value);
}

/**
 * The Stripe Price id for a member plan.
 *
 * Deliberately separate from the operator console's prices.
 * `STRIPE_PRICE_OPERATOR` and `STRIPE_PRICE_DESK` belong to the internal
 * trading console and must never be sold to an ordinary member, so they are not
 * reachable from this module at all. A missing member price means checkout is
 * closed, not that some other price is used instead.
 */
export function priceIdFor(plan: MemberPlanId): string | null {
  const value = process.env[MEMBER_PLANS[plan].priceEnv];
  return value && value.trim().length > 0 ? value.trim() : null;
}

export function checkoutAvailableFor(plan: MemberPlanId): boolean {
  return billingEnabled && Boolean(stripeSecretKey) && Boolean(priceIdFor(plan));
}

// ---------------------------------------------------------------------------
// Price confirmation
// ---------------------------------------------------------------------------

export interface MembershipPrice {
  plan: MemberPlanId;
  name: string;
  /** True only when Stripe returned a recurring price for this plan. */
  confirmed: boolean;
  amount: number | null;
  currency: string | null;
  interval: string | null;
  intervalCount: number | null;
  priceId: string | null;
  /** True when the confirmed price is exactly the published one. */
  matchesPublished: boolean;
}

/**
 * The real price, read from Stripe.
 *
 * The published "$19/month" is a claim about the product; this is the amount
 * the customer would actually be charged. The UI shows the published figure
 * only when the two agree, and otherwise shows whatever Stripe really holds —
 * silently charging a different amount than the page advertises is the failure
 * this function exists to prevent.
 */
export const getMembershipPrice = cache(
  async (plan: MemberPlanId = "founding"): Promise<MembershipPrice> => {
    const priceId = priceIdFor(plan);
    const base: MembershipPrice = {
      plan,
      name: MEMBER_PLANS[plan].name,
      confirmed: false,
      amount: null,
      currency: null,
      interval: null,
      intervalCount: null,
      priceId,
      matchesPublished: false,
    };

    if (!stripeSecretKey || !priceId) return base;

    try {
      const { default: Stripe } = await import("stripe");
      const stripe = new Stripe(stripeSecretKey);
      const price = await stripe.prices.retrieve(priceId);
      const recurring = price.recurring;

      return {
        ...base,
        confirmed: true,
        amount: price.unit_amount,
        currency: price.currency,
        interval: recurring?.interval ?? null,
        intervalCount: recurring?.interval_count ?? null,
        matchesPublished:
          price.unit_amount === MEMBER_PLANS[plan].publishedAmount &&
          price.currency === MEMBER_PLANS[plan].publishedCurrency &&
          recurring?.interval === MEMBER_PLANS[plan].interval &&
          (recurring?.interval_count ?? 1) === 1,
      };
    } catch (cause) {
      console.log(
        "[wands] membership price lookup failed:",
        cause instanceof Error ? cause.message : cause,
      );
      return base;
    }
  },
);

/** "$19/month", or an honest admission that the amount is not confirmed yet. */
export function formatMembershipPrice(price: MembershipPrice): string {
  if (!price.confirmed || price.amount === null || !price.currency) {
    return "Price confirmed at checkout";
  }

  const amount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: price.currency.toUpperCase(),
    minimumFractionDigits: price.amount % 100 === 0 ? 0 : 2,
  }).format(price.amount / 100);

  const count = price.intervalCount ?? 1;
  const interval = price.interval ?? "month";

  return count > 1 ? `${amount} every ${count} ${interval}s` : `${amount}/${interval}`;
}

export const billingStatus = {
  enabled: billingEnabled,
  switchOn,
  liveKey,
  liveApproved,
  keysPresent: Boolean(stripeSecretKey),
  webhookConfigured: Boolean(stripeWebhookSecret),
  memberPriceMapped: Boolean(priceIdFor("founding")),
};
