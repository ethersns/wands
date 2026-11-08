import "server-only";

import { compUserIds } from "@/lib/billing/entitlement";
import { isDatabaseConfigured, query } from "@/lib/db";

/**
 * Billing administration, read-only.
 *
 * The source of truth is the existing `member_membership` row, which the Stripe
 * webhook already maintains, joined to the `subscription` and `billing_customer`
 * tables the webhook writes. Nothing here calls Stripe, and nothing here can
 * grant a plan: a paid tier is only ever the result of a webhook the payment
 * provider signed.
 *
 * Card numbers, expiry dates and CVCs are never stored by this application and
 * are not selected here. A Stripe customer reference is an opaque id, not
 * payment data.
 */

export interface BillingRow {
  user_id: string;
  email: string;
  display_name: string | null;
  plan: string;
  status: string;
  entitlement_source: string;
  cancel_at_period_end: boolean;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_end: string | null;
  updated_at: string;
  account_status: string;
  subscription_status: string | null;
  subscription_plan: string | null;
  subscription_period_end: string | null;
}

/** Recurring revenue for one currency, in minor units. */
export interface MrrLine {
  currency: string;
  amountMinor: number;
  subscriptions: number;
}

export interface BillingSummary {
  total: number;
  /**
   * Members with a real Stripe subscription in a billable state.
   *
   * Deliberately not "plan is not free": a plan can be granted without a
   * subscription, and counting that as revenue would overstate the business.
   */
  paying: number;
  /** Accounts holding an explicit owner grant rather than a subscription. */
  comped: number;
  trialing: number;
  pastDue: number;
  canceled: number;
  /** Accounts with no entitlement at all. */
  free: number;
  /** Checkouts started but not yet paid. */
  pendingPayment: number;
  /** Paid, but the customer has not activated their account yet. */
  pendingActivation: number;
  /**
   * Recurring revenue computed from the mirrored subscription rows.
   *
   * A manually assigned plan is not revenue and is not counted here: only a
   * subscription Stripe is actually billing contributes.
   */
  mrr: MrrLine[];
  byPlan: { plan: string; count: number }[];
  byStatus: { status: string; count: number }[];
  billingEnabled: boolean;
}

export function isBillingEnabled(): boolean {
  return process.env.WANDS_BILLING_ENABLED === "true";
}

const FROM_CLAUSE = `
  from member_membership m
  join "user" u on u.id = m.user_id
  left join member_profile p on p.user_id = u.id
  left join member_account_status a on a.user_id = u.id
  left join subscription s on s.stripe_subscription_id = m.stripe_subscription_id
`;

export async function listBilling(filters: {
  search?: string;
  plan?: string;
  status?: string;
  page?: number;
  pageSize?: number;
} = {}): Promise<{ rows: BillingRow[]; total: number; page: number; pageSize: number; pageCount: number }> {
  const page = Math.max(1, Math.floor(filters.page ?? 1) || 1);
  const pageSize = Math.min(Math.max(1, Math.floor(filters.pageSize ?? 25) || 25), 100);

  if (!isDatabaseConfigured()) {
    return { rows: [], total: 0, page, pageSize, pageCount: 0 };
  }

  const values: unknown[] = [];
  const clauses: string[] = [];

  const search = filters.search?.trim();
  if (search) {
    values.push(`%${search.replace(/[\\%_]/g, (match) => `\\${match}`)}%`);
    clauses.push(
      `(u.email ilike $${values.length} or coalesce(p.display_name, '') ilike $${values.length})`,
    );
  }

  if (filters.plan) {
    values.push(filters.plan);
    clauses.push(`m.plan = $${values.length}`);
  }

  if (filters.status) {
    values.push(filters.status);
    clauses.push(`m.status = $${values.length}`);
  }

  const where = clauses.length ? `where ${clauses.join(" and ")}` : "";

  try {
    const [rows, totals] = await Promise.all([
      query<BillingRow>(
        `select
           u.id::text as user_id,
           u.email,
           p.display_name,
           m.plan,
           m.status,
           m.entitlement_source,
           m.cancel_at_period_end,
           m.stripe_customer_id,
           m.stripe_subscription_id,
           m.current_period_end,
           m.updated_at,
           coalesce(a.status, 'active') as account_status,
           s.status as subscription_status,
           s.plan as subscription_plan,
           s.current_period_end as subscription_period_end
         ${FROM_CLAUSE}
         ${where}
         order by m.updated_at desc
         limit $${values.length + 1} offset $${values.length + 2}`,
        [...values, pageSize, (page - 1) * pageSize],
      ),
      query<{ total: number }>(
        `select count(*)::int as total ${FROM_CLAUSE} ${where}`,
        values,
      ),
    ]);

    const total = totals[0]?.total ?? 0;

    return {
      rows,
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    };
  } catch (cause) {
    console.log(
      "[v0] admin billing list failed:",
      cause instanceof Error ? cause.message : cause,
    );
    return { rows: [], total: 0, page, pageSize, pageCount: 0 };
  }
}

export async function getBillingSummary(): Promise<BillingSummary> {
  const empty: BillingSummary = {
    total: 0,
    paying: 0,
    comped: 0,
    trialing: 0,
    pastDue: 0,
    canceled: 0,
    free: 0,
    pendingPayment: 0,
    pendingActivation: 0,
    mrr: [],
    byPlan: [],
    byStatus: [],
    billingEnabled: isBillingEnabled(),
  };

  if (!isDatabaseConfigured()) return empty;

  const compIds = [...compUserIds()];

  try {
    const [totals, byPlan, byStatus, mrr, pending, comped] = await Promise.all([
      query<{
        total: number;
        paying: number;
        trialing: number;
        past_due: number;
        canceled: number;
        free: number;
      }>(
        `select
           count(*)::int as total,
           count(*) filter (
             where entitlement_source = 'stripe' and status in ('active', 'trialing')
           )::int as paying,
           count(*) filter (where status = 'trialing')::int as trialing,
           count(*) filter (where status = 'past_due')::int as past_due,
           count(*) filter (where status = 'canceled')::int as canceled,
           count(*) filter (where entitlement_source = 'none')::int as free
         from member_membership`,
      ),
      query<{ plan: string; count: number }>(
        `select plan, count(*)::int as count from member_membership group by 1 order by count desc`,
      ),
      query<{ status: string; count: number }>(
        `select status, count(*)::int as count from member_membership group by 1 order by count desc`,
      ),
      // Annual prices are divided by twelve so the figure is monthly recurring
      // revenue rather than a mix of monthly and annual amounts.
      query<{ currency: string; amount_minor: number; subscriptions: number }>(
        `select coalesce(currency, 'usd') as currency,
                coalesce(sum(
                  case when interval = 'year' then unit_amount / 12 else unit_amount end
                ), 0)::int as amount_minor,
                count(*)::int as subscriptions
         from subscription
         where status in ('active', 'trialing')
         group by 1
         order by 2 desc`,
      ),
      query<{ pending_payment: number; pending_activation: number }>(
        `select
           count(*) filter (where status = 'pending')::int as pending_payment,
           count(*) filter (where status = 'paid')::int as pending_activation
         from member_signup_intent`,
      ),
      compIds.length > 0
        ? query<{ total: number }>(
            `select count(*)::int as total from member_membership
             where user_id = any($1::text[])`,
            [compIds],
          )
        : Promise.resolve([{ total: 0 }]),
    ]);

    return {
      total: totals[0]?.total ?? 0,
      paying: totals[0]?.paying ?? 0,
      comped: comped[0]?.total ?? 0,
      trialing: totals[0]?.trialing ?? 0,
      pastDue: totals[0]?.past_due ?? 0,
      canceled: totals[0]?.canceled ?? 0,
      free: totals[0]?.free ?? 0,
      pendingPayment: pending[0]?.pending_payment ?? 0,
      pendingActivation: pending[0]?.pending_activation ?? 0,
      mrr: mrr.map((row) => ({
        currency: row.currency,
        amountMinor: row.amount_minor,
        subscriptions: row.subscriptions,
      })),
      byPlan,
      byStatus,
      billingEnabled: isBillingEnabled(),
    };
  } catch (cause) {
    console.log(
      "[v0] admin billing summary failed:",
      cause instanceof Error ? cause.message : cause,
    );
    return empty;
  }
}

export interface SignupIntentRow {
  id: string;
  email: string;
  plan: string;
  status: string;
  created_at: string;
  expires_at: string;
  paid_at: string | null;
  activated_at: string | null;
}

/**
 * Recent signups, including the ones that never became accounts.
 *
 * This is the operator's view of the funnel: a checkout that was started and
 * abandoned, a payment that settled but was never activated, and a payment that
 * failed all look different here, which is the point. No card data is selected
 * because none is stored.
 */
export async function listSignupIntents(limit = 25): Promise<SignupIntentRow[]> {
  if (!isDatabaseConfigured()) return [];

  try {
    return await query<SignupIntentRow>(
      `select id::text, email_normalized as email, plan, status,
              created_at, expires_at, paid_at, activated_at
       from member_signup_intent
       order by created_at desc
       limit $1`,
      [Math.min(Math.max(limit, 1), 100)],
    );
  } catch (cause) {
    console.log(
      "[v0] signup intent read failed:",
      cause instanceof Error ? cause.message : cause,
    );
    return [];
  }
}

export interface BillingEventRow {
  id: string;
  type: string;
  received_at: string;
}

/**
 * Recent webhook deliveries.
 *
 * The payload is deliberately not selected: a Stripe event body can contain a
 * customer's address and payment-method metadata, and the operator needs the
 * event type and the time, not the body.
 */
export async function recentBillingEvents(limit = 15): Promise<BillingEventRow[]> {
  if (!isDatabaseConfigured()) return [];

  try {
    return await query<BillingEventRow>(
      `select id, type, received_at
       from billing_event
       order by received_at desc
       limit $1`,
      [Math.min(Math.max(limit, 1), 100)],
    );
  } catch {
    return [];
  }
}

export interface RetainedBillingReference {
  id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan: string | null;
  membership_status: string | null;
  current_period_end: string | null;
  deleted_at: string;
  deleted_by: string;
}

/**
 * Billing references kept after an account was deleted.
 *
 * These rows are the only surviving link between a charge and the customer it
 * belonged to, so they are read here — in the billing view, behind the operator
 * gate — and nowhere else. They carry no name, address or email: the person is
 * identified by the Stripe customer reference, which is the system of record
 * for the payment.
 */
export async function listRetainedBillingReferences(
  limit = 25,
): Promise<RetainedBillingReference[]> {
  if (!isDatabaseConfigured()) return [];

  try {
    return await query<RetainedBillingReference>(
      `select id::text, stripe_customer_id, stripe_subscription_id, plan,
              membership_status, current_period_end, deleted_at, deleted_by
       from member_billing_reference
       order by deleted_at desc
       limit $1`,
      [Math.min(Math.max(limit, 1), 100)],
    );
  } catch (cause) {
    console.log(
      "[v0] retained billing reference read failed:",
      cause instanceof Error ? cause.message : cause,
    );
    return [];
  }
}

/** Renewals due in the next 30 days, for the billing page's forward look. */
export async function upcomingRenewals(limit = 10): Promise<
  { user_id: string; email: string; plan: string; current_period_end: string }[]
> {
  if (!isDatabaseConfigured()) return [];

  try {
    return await query<{
      user_id: string;
      email: string;
      plan: string;
      current_period_end: string;
    }>(
      `select u.id::text as user_id, u.email, m.plan, m.current_period_end
       from member_membership m
       join "user" u on u.id = m.user_id
       where m.current_period_end is not null
         and m.current_period_end >= now()
         and m.current_period_end <= now() + interval '30 days'
         and m.status in ('active', 'trialing')
       order by m.current_period_end asc
       limit $1`,
      [Math.min(Math.max(limit, 1), 50)],
    );
  } catch {
    return [];
  }
}
