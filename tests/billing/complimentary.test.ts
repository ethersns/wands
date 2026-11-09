// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Complimentary membership.
 *
 * An owner grant is the one way to hold access without a subscription. These
 * tests pin the properties that make it safe: it resolves to the full founding
 * plan, it never expires, it is keyed on the user id rather than the email, it
 * fails closed when unconfigured, and it does not survive a suspension or
 * confer operator rights.
 */

const db = vi.hoisted(() => {
  const state = {
    calls: [] as { sql: string; values: unknown[] }[],
    handlers: [] as { match: RegExp; rows: unknown[] }[],
  };

  const run = async (sql: string, values: unknown[] = []) => {
    state.calls.push({ sql, values });
    for (const handler of state.handlers) {
      if (handler.match.test(sql)) return handler.rows;
    }
    return [];
  };

  return { state, run };
});

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: () => true,
  query: (sql: string, values?: unknown[]) => db.run(sql, values),
  withTransaction: (fn: (tx: typeof db.run) => Promise<unknown>) => fn(db.run),
}));

vi.mock("@/lib/member/session", () => ({
  getMemberSession: async () => null,
  requireMember: async () => null,
  MEMBER_HOME: "/app",
  SUSPENDED_PATH: "/suspended",
  MEMBERSHIP_PATH: "/app/membership",
}));

import { isFounderUserId } from "@/lib/auth/founder";
import { compUserIds, isCompedUserId } from "@/lib/billing/entitlement";
import { getMembership } from "@/lib/member/membership";

const COMPED = "tXCzXo1MchRokx5YnUXnz6NlkiSEMxfx";
const OTHER = "usr_other";

function on(match: RegExp, rows: unknown[]) {
  db.state.handlers.unshift({ match, rows });
}

function membershipRow(overrides: Record<string, unknown> = {}) {
  return {
    plan: "early_access",
    status: "active",
    entitlement_source: "none",
    current_period_end: null,
    cancel_at_period_end: false,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    ...overrides,
  };
}

beforeEach(() => {
  db.state.calls.length = 0;
  db.state.handlers.length = 0;
  process.env.WANDS_COMP_USER_IDS = COMPED;

  on(/from member_account_status/, []);
  on(/from member_membership\s+where user_id/, [membershipRow()]);
});

afterEach(() => {
  delete process.env.WANDS_COMP_USER_IDS;
  delete process.env.WANDS_FOUNDER_USER_IDS;
});

describe("complimentary membership", () => {
  it("grants the full founding plan to a comped account", async () => {
    const membership = await getMembership(COMPED);

    expect(membership.entitled).toBe(true);
    expect(membership.plan).toBe("founding");
    expect(membership.label).toBe("Wands Founding Access");
    expect(membership.complimentary).toBe(true);
    expect(membership.reason).toBe("comp");
    expect(membership.source).toBe("comp");
  });

  it("carries the maximum limits of the highest plan", async () => {
    const membership = await getMembership(COMPED);

    expect(membership.limits).toEqual({
      watchlists: 50,
      savedItems: 5000,
      alertRules: 25,
      insiderWindowDays: 1095,
      institutionalChanges: true,
    });
  });

  it("never expires and needs no billing account", async () => {
    const membership = await getMembership(COMPED);

    expect(membership.currentPeriodEnd).toBeNull();
    expect(membership.cancelAtPeriodEnd).toBe(false);
    expect(membership.stripeCustomerId).toBeNull();
  });

  it("grants access even when the stored plan is a legacy name", async () => {
    on(/from member_membership\s+where user_id/, [
      membershipRow({ plan: "free", status: "none" }),
    ]);

    const membership = await getMembership(COMPED);

    expect(membership.entitled).toBe(true);
    expect(membership.plan).toBe("founding");
  });

  it("still denies a non-comped account with no subscription", async () => {
    const membership = await getMembership(OTHER);

    expect(membership.entitled).toBe(false);
    expect(membership.plan).toBe("none");
    expect(membership.complimentary).toBe(false);
    expect(membership.limits.watchlists).toBe(0);
    expect(membership.limits.institutionalChanges).toBe(false);
  });

  it("denies a suspended comped account", async () => {
    on(/from member_account_status/, [{ status: "suspended" }]);

    const membership = await getMembership(COMPED);

    expect(membership.entitled).toBe(false);
    expect(membership.reason).toBe("suspended");
  });

  it("does not confer operator privileges", () => {
    expect(isFounderUserId(COMPED)).toBe(false);
  });

  it("fails closed when the allowlist is absent", () => {
    delete process.env.WANDS_COMP_USER_IDS;

    expect(compUserIds().size).toBe(0);
    expect(isCompedUserId(COMPED)).toBe(false);
  });

  it("matches the exact user id, never the email address", () => {
    expect(isCompedUserId(COMPED)).toBe(true);
    expect(isCompedUserId("cleverlywin@gmail.com")).toBe(false);
    expect(isCompedUserId(null)).toBe(false);
  });
});
