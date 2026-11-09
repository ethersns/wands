// @vitest-environment node

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Membership enforcement.
 *
 * Hiding a navigation link is not access control. These tests cover the server
 * side of the rule: a signed-in account with no eligible subscription is
 * refused by the shared member guard, and every research endpoint goes through
 * that guard rather than trusting the page that linked to it.
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

const session = vi.hoisted(() => ({
  current: null as { user: { id: string; email: string; name: string } } | null,
}));

vi.mock("@/lib/member/session", () => ({
  getMemberSession: async () => session.current,
  requireMember: async () => session.current,
  MEMBER_HOME: "/app",
  SUSPENDED_PATH: "/suspended",
  MEMBERSHIP_PATH: "/app/membership",
}));

import {
  handleMemberRoute,
  MembershipRequiredError,
  requireEntitledMemberApi,
  requireMemberApi,
  SuspendedError,
  UnauthorizedError,
} from "@/lib/member/api";

function on(match: RegExp, rows: unknown[]) {
  db.state.handlers.unshift({ match, rows });
}

function membershipRow(overrides: Record<string, unknown> = {}) {
  return {
    plan: "founding",
    status: "active",
    entitlement_source: "stripe",
    current_period_end: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
    cancel_at_period_end: false,
    stripe_customer_id: "cus_1",
    stripe_subscription_id: "sub_1",
    ...overrides,
  };
}

beforeEach(() => {
  db.state.calls.length = 0;
  db.state.handlers.length = 0;
  session.current = {
    user: { id: "usr_1", email: "member@example.com", name: "Member" },
  };

  on(/from member_account_status/, []);
  on(/from member_membership\s+where user_id/, [membershipRow()]);
});

describe("requireEntitledMemberApi", () => {
  it("allows a member with an active subscription", async () => {
    const actor = await requireEntitledMemberApi();
    expect(actor.userId).toBe("usr_1");
  });

  it("refuses a signed-in member with no subscription", async () => {
    on(/from member_membership\s+where user_id/, [
      membershipRow({ entitlement_source: "none", status: "none" }),
    ]);

    await expect(requireEntitledMemberApi()).rejects.toBeInstanceOf(
      MembershipRequiredError,
    );
  });

  it("refuses a member whose payment failed", async () => {
    on(/from member_membership\s+where user_id/, [membershipRow({ status: "past_due" })]);

    await expect(requireEntitledMemberApi()).rejects.toMatchObject({
      reason: "payment_failed",
    });
  });

  it("refuses a member whose cancelled period has ended", async () => {
    on(/from member_membership\s+where user_id/, [
      membershipRow({
        status: "canceled",
        current_period_end: new Date(Date.now() - 24 * 60 * 60 * 1000),
      }),
    ]);

    await expect(requireEntitledMemberApi()).rejects.toMatchObject({
      reason: "expired",
    });
  });

  it("refuses a suspended member even when they have paid", async () => {
    on(/from member_account_status/, [{ status: "suspended" }]);

    await expect(requireEntitledMemberApi()).rejects.toBeInstanceOf(SuspendedError);
  });

  it("refuses an unauthenticated caller", async () => {
    session.current = null;

    await expect(requireEntitledMemberApi()).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it("still lets an unpaid member reach their own account settings", async () => {
    on(/from member_membership\s+where user_id/, [
      membershipRow({ entitlement_source: "none", status: "none" }),
    ]);

    // Account, preferences and onboarding use the session-only guard on
    // purpose: an unpaid member has to be able to finish setting up.
    const actor = await requireMemberApi();
    expect(actor.userId).toBe("usr_1");
  });
});

describe("handleMemberRoute", () => {
  it("answers 402 with a reason when the membership is missing", async () => {
    on(/from member_membership\s+where user_id/, [
      membershipRow({ entitlement_source: "none", status: "none" }),
    ]);

    const response = await handleMemberRoute(() => requireEntitledMemberApi());

    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({
      code: "membership_required",
      reason: "no_subscription",
    });
  });

  it("answers 401 when there is no session", async () => {
    session.current = null;

    const response = await handleMemberRoute(() => requireEntitledMemberApi());

    expect(response.status).toBe(401);
  });
});

describe("route coverage", () => {
  const RESEARCH_ROUTES = [
    "app/api/member/notifications/route.ts",
    "app/api/member/notifications/[id]/route.ts",
    "app/api/member/saved/route.ts",
    "app/api/member/saved/[id]/route.ts",
    "app/api/member/watchlists/route.ts",
    "app/api/member/watchlists/[id]/route.ts",
    "app/api/member/watchlists/[id]/items/route.ts",
    "app/api/member/watchlist-items/[id]/route.ts",
  ];

  const ACCOUNT_ROUTES = [
    "app/api/member/account/route.ts",
    "app/api/member/preferences/route.ts",
    "app/api/member/onboarding/route.ts",
  ];

  it("gates every research endpoint on the paid entitlement", () => {
    for (const route of RESEARCH_ROUTES) {
      const source = readFileSync(join(process.cwd(), route), "utf8");
      expect(source, route).toContain("requireEntitledMemberApi");
      expect(source, route).not.toContain("requireMemberApi(");
    }
  });

  it("leaves the account endpoints on the session-only guard", () => {
    for (const route of ACCOUNT_ROUTES) {
      const source = readFileSync(join(process.cwd(), route), "utf8");
      expect(source, route).toContain("requireMemberApi");
      expect(source, route).not.toContain("requireEntitledMemberApi");
    }
  });
});
