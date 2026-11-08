import "server-only";

import { billingEnabled } from "@/lib/billing/config";
import {
  getEntitlement,
  type EntitlementReason,
  type EntitlementSource,
} from "@/lib/billing/entitlement";
import { isDatabaseConfigured, query } from "@/lib/db";

/**
 * What a member's account includes.
 *
 * This is a presentation layer over the entitlement decision, not a second
 * source of truth. `getEntitlement` decides whether access is allowed; this
 * module turns that answer into a plan name, a set of limits and the dates the
 * billing page shows.
 *
 * There is no free plan. An account with no eligible subscription resolves to
 * `none`, which carries zero limits — the limits exist so a lapsed member's
 * saved research is preserved and readable in the billing surface, not so it
 * can be used.
 */

export const MEMBER_PLANS = ["none", "founding"] as const;
export type MemberPlan = (typeof MEMBER_PLANS)[number];

export type PlanLimits = {
  watchlists: number;
  savedItems: number;
  insiderWindowDays: number;
  institutionalChanges: boolean;
};

const PLAN_LIMITS: Record<MemberPlan, PlanLimits> = {
  none: { watchlists: 0, savedItems: 0, insiderWindowDays: 0, institutionalChanges: false },
  founding: { watchlists: 50, savedItems: 5000, insiderWindowDays: 1095, institutionalChanges: true },
};

const PLAN_LABELS: Record<MemberPlan, string> = {
  none: "No active membership",
  founding: "Wands Founding Access",
};

export type Membership = {
  plan: MemberPlan;
  status: string;
  label: string;
  limits: PlanLimits;
  currentPeriodEnd: string | null;
  billingEnabled: boolean;
  entitled: boolean;
  reason: EntitlementReason;
  source: EntitlementSource;
  cancelAtPeriodEnd: boolean;
  stripeCustomerId: string | null;
};

export function isBillingEnabled(): boolean {
  return billingEnabled;
}

/**
 * Maps a stored plan onto the current catalogue.
 *
 * Rows written before billing existed carry `free`, `early_access` or `desk`.
 * None of those is a payment, so they resolve to `none` — unless the account
 * holds an entitlement by another route (an owner grant), in which case it is
 * shown as founding access because that is what it now receives.
 */
function resolvePlan(storedPlan: string | null, entitled: boolean): MemberPlan {
  if (storedPlan === "founding") return "founding";
  return entitled ? "founding" : "none";
}

export async function getMembership(userId: string): Promise<Membership> {
  const entitlement = await getEntitlement(userId);
  const plan = resolvePlan(entitlement.plan, entitlement.allowed);

  return {
    plan,
    status: entitlement.status,
    label: PLAN_LABELS[plan],
    limits: PLAN_LIMITS[plan],
    currentPeriodEnd: entitlement.currentPeriodEnd,
    billingEnabled,
    entitled: entitlement.allowed,
    reason: entitlement.reason,
    source: entitlement.source,
    cancelAtPeriodEnd: entitlement.cancelAtPeriodEnd,
    stripeCustomerId: entitlement.stripeCustomerId,
  };
}

/**
 * Creates the membership row for a new account.
 *
 * The row starts with no entitlement. It exists so the account has somewhere to
 * record a subscription later, not so it has something to use now.
 */
export async function ensureMembership(userId: string): Promise<Membership> {
  if (isDatabaseConfigured()) {
    await query(
      `insert into member_membership (user_id, plan, status, entitlement_source)
       values ($1, 'none', 'none', 'none')
       on conflict (user_id) do nothing`,
      [userId],
    );
  }

  return getMembership(userId);
}
