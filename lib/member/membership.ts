import "server-only";

import { query } from "@/lib/db";

export const MEMBER_PLANS = ["free", "early_access", "desk"] as const;
export type MemberPlan = (typeof MEMBER_PLANS)[number];

export type PlanLimits = {
  watchlists: number;
  savedItems: number;
  insiderWindowDays: number;
  institutionalChanges: boolean;
};

const PLAN_LIMITS: Record<MemberPlan, PlanLimits> = {
  free: { watchlists: 1, savedItems: 25, insiderWindowDays: 30, institutionalChanges: false },
  early_access: { watchlists: 10, savedItems: 500, insiderWindowDays: 365, institutionalChanges: true },
  desk: { watchlists: 50, savedItems: 5000, insiderWindowDays: 1095, institutionalChanges: true },
};

const PLAN_LABELS: Record<MemberPlan, string> = {
  free: "Free",
  early_access: "Early access",
  desk: "Desk",
};

export const PLAN_CATALOG: Array<{ plan: MemberPlan; label: string; blurb: string; limits: PlanLimits }> = [
  {
    plan: "free",
    label: PLAN_LABELS.free,
    blurb: "One watchlist and a 30-day insider window.",
    limits: PLAN_LIMITS.free,
  },
  {
    plan: "early_access",
    label: PLAN_LABELS.early_access,
    blurb: "Full research history, institutional changes and ten watchlists.",
    limits: PLAN_LIMITS.early_access,
  },
  {
    plan: "desk",
    label: PLAN_LABELS.desk,
    blurb: "Three-year insider history and the largest saved-research allowance.",
    limits: PLAN_LIMITS.desk,
  },
];

export type Membership = {
  plan: MemberPlan;
  status: string;
  label: string;
  limits: PlanLimits;
  currentPeriodEnd: string | null;
  billingEnabled: boolean;
};

type MembershipRow = {
  plan: string;
  status: string;
  current_period_end: Date | null;
};

function defaultPlan(): MemberPlan {
  const configured = process.env.WANDS_DEFAULT_PLAN;
  return MEMBER_PLANS.includes(configured as MemberPlan) ? (configured as MemberPlan) : "early_access";
}

export function isBillingEnabled(): boolean {
  return process.env.WANDS_BILLING_ENABLED === "true";
}

export async function getMembership(userId: string): Promise<Membership> {
  const rows = await query<MembershipRow>(
    `select plan, status, current_period_end from member_membership where user_id = $1`,
    [userId],
  );

  const row = rows[0];
  const plan = MEMBER_PLANS.includes(row?.plan as MemberPlan) ? (row!.plan as MemberPlan) : defaultPlan();

  return {
    plan,
    status: row?.status ?? "active",
    label: PLAN_LABELS[plan],
    limits: PLAN_LIMITS[plan],
    currentPeriodEnd: row?.current_period_end ? row.current_period_end.toISOString() : null,
    billingEnabled: isBillingEnabled(),
  };
}

export async function ensureMembership(userId: string): Promise<Membership> {
  await query(
    `insert into member_membership (user_id, plan, status)
     values ($1, $2, 'active')
     on conflict (user_id) do nothing`,
    [userId, defaultPlan()],
  );

  return getMembership(userId);
}
