import "server-only";

import { isAccountSuspended } from "@/lib/admin/account-status";
import { isDatabaseConfigured, query } from "@/lib/db";

/**
 * Membership entitlement: the authoritative answer to "may this account read
 * research".
 *
 * Authentication answers who is signed in. This answers what they have paid
 * for, and it is the only place that answer is produced. The workspace layout
 * and every research API call it through, so a subscription cannot be enforced
 * on one surface and forgotten on another.
 *
 * Two independent conditions must both hold: a valid session (checked by the
 * caller) and an eligible entitlement (checked here). A suspended account is
 * denied regardless of what it has paid.
 */

export type EntitlementReason =
  | "active_subscription"
  | "cancelled_but_paid"
  | "comp"
  | "no_subscription"
  | "payment_failed"
  | "expired"
  | "suspended"
  | "unavailable";

export type EntitlementSource = "none" | "stripe" | "comp";

export interface Entitlement {
  allowed: boolean;
  reason: EntitlementReason;
  plan: string;
  status: string;
  source: EntitlementSource;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

export const NO_ENTITLEMENT: Entitlement = {
  allowed: false,
  reason: "no_subscription",
  plan: "none",
  status: "none",
  source: "none",
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
};

export interface EntitlementInput {
  suspended: boolean;
  comped: boolean;
  source: string | null;
  status: string | null;
  currentPeriodEnd: string | null;
  now?: Date;
}

/**
 * The decision, split from the database read so it can be tested directly.
 *
 * The billing policy it encodes, in the order it is applied:
 *
 *   * a suspended account has no access, whatever it has paid;
 *   * an explicit owner grant has access;
 *   * a subscription that is not backed by Stripe has no access — a plan name
 *     on its own is not a payment;
 *   * `active` and `trialing` have access;
 *   * `canceled` keeps access until the end of the period already paid for,
 *     which is the published cancellation policy, and loses it afterwards;
 *   * a failed or incomplete payment has no access.
 */
export function decideEntitlement(input: EntitlementInput): {
  allowed: boolean;
  reason: EntitlementReason;
} {
  if (input.suspended) return { allowed: false, reason: "suspended" };
  if (input.comped) return { allowed: true, reason: "comp" };

  if (input.source !== "stripe") {
    return { allowed: false, reason: "no_subscription" };
  }

  const status = (input.status ?? "").toLowerCase();

  if (status === "active" || status === "trialing") {
    return { allowed: true, reason: "active_subscription" };
  }

  if (status === "canceled") {
    const end = input.currentPeriodEnd ? new Date(input.currentPeriodEnd) : null;
    const now = input.now ?? new Date();

    if (end && !Number.isNaN(end.getTime()) && end.getTime() > now.getTime()) {
      return { allowed: true, reason: "cancelled_but_paid" };
    }

    return { allowed: false, reason: "expired" };
  }

  if (status === "past_due" || status === "unpaid" || status === "incomplete") {
    return { allowed: false, reason: "payment_failed" };
  }

  return { allowed: false, reason: "expired" };
}

// ---------------------------------------------------------------------------
// Owner-granted entitlement
// ---------------------------------------------------------------------------

const COMP_ENV = "WANDS_COMP_USER_IDS";

/**
 * Accounts the owner has explicitly comped.
 *
 * This is the deliberate exception the billing policy allows, and it is
 * deliberately awkward: an allowlist in the server environment, read on the
 * server, never derived from a plan name, a session field or a request body. It
 * fails closed — an absent or blank variable grants nothing — so a previously
 * comped member does not keep permanent free access by accident.
 */
export function compUserIds(): ReadonlySet<string> {
  const raw = process.env[COMP_ENV];
  if (!raw) return new Set();

  return new Set(
    raw
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  );
}

export function isCompedUserId(userId: string | null | undefined): boolean {
  if (!userId) return false;
  return compUserIds().has(userId);
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

interface MembershipRow {
  plan: string;
  status: string;
  entitlement_source: string;
  current_period_end: Date | null;
  cancel_at_period_end: boolean;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
}

export async function getEntitlement(userId: string): Promise<Entitlement> {
  if (!isDatabaseConfigured() || !userId) {
    return { ...NO_ENTITLEMENT, reason: "unavailable" };
  }

  const [suspended, rows] = await Promise.all([
    isAccountSuspended(userId),
    query<MembershipRow>(
      `select plan, status, entitlement_source, current_period_end,
              cancel_at_period_end, stripe_customer_id, stripe_subscription_id
       from member_membership
       where user_id = $1`,
      [userId],
    ),
  ]);

  const row = rows[0];
  const comped = isCompedUserId(userId);
  const currentPeriodEnd = row?.current_period_end
    ? row.current_period_end.toISOString()
    : null;

  const decision = decideEntitlement({
    suspended,
    comped,
    source: row?.entitlement_source ?? "none",
    status: row?.status ?? null,
    currentPeriodEnd,
  });

  return {
    allowed: decision.allowed,
    reason: decision.reason,
    plan: row?.plan ?? "none",
    status: row?.status ?? "none",
    source: comped ? "comp" : ((row?.entitlement_source as EntitlementSource) ?? "none"),
    currentPeriodEnd,
    cancelAtPeriodEnd: row?.cancel_at_period_end ?? false,
    stripeCustomerId: row?.stripe_customer_id ?? null,
    stripeSubscriptionId: row?.stripe_subscription_id ?? null,
  };
}

export async function isEntitled(userId: string): Promise<boolean> {
  const entitlement = await getEntitlement(userId);
  return entitlement.allowed;
}

/** The sentence a blocked member sees. Kept here so every surface agrees. */
export function entitlementMessage(reason: EntitlementReason): string {
  switch (reason) {
    case "suspended":
      return "This account is suspended. Contact support if you believe this is a mistake.";
    case "payment_failed":
      return "Your last payment did not go through. Update your payment method to restore research access.";
    case "expired":
      return "Your membership has ended. Reactivate it to restore research access.";
    case "unavailable":
      return "Membership status could not be checked. Try again in a moment.";
    default:
      return "Your research is saved. Activate your membership to continue.";
  }
}
