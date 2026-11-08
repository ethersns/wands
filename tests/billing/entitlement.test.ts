// @vitest-environment node

import { describe, expect, it } from "vitest";

import { decideEntitlement } from "@/lib/billing/entitlement";

/**
 * The billing policy, tested directly.
 *
 * `decideEntitlement` is the single place that answers "may this account read
 * research", so these cases are the product's access rules rather than an
 * implementation detail. Every surface — the workspace layout, the research
 * APIs, the billing page — reads this same answer.
 */

const NOW = new Date("2026-11-08T12:00:00.000Z");
const FUTURE = "2026-12-08T12:00:00.000Z";
const PAST = "2026-10-08T12:00:00.000Z";

function decide(
  overrides: Partial<Parameters<typeof decideEntitlement>[0]> = {},
) {
  return decideEntitlement({
    suspended: false,
    comped: false,
    source: "stripe",
    status: "active",
    currentPeriodEnd: FUTURE,
    now: NOW,
    ...overrides,
  });
}

describe("decideEntitlement", () => {
  it("allows an active subscription", () => {
    expect(decide()).toEqual({ allowed: true, reason: "active_subscription" });
  });

  it("allows a trialing subscription", () => {
    expect(decide({ status: "trialing" })).toEqual({
      allowed: true,
      reason: "active_subscription",
    });
  });

  it("keeps access after cancellation until the paid period ends", () => {
    expect(decide({ status: "canceled", currentPeriodEnd: FUTURE })).toEqual({
      allowed: true,
      reason: "cancelled_but_paid",
    });
  });

  it("removes access once a cancelled period has ended", () => {
    expect(decide({ status: "canceled", currentPeriodEnd: PAST })).toEqual({
      allowed: false,
      reason: "expired",
    });
  });

  it("removes access when a cancelled subscription has no period end", () => {
    expect(decide({ status: "canceled", currentPeriodEnd: null })).toEqual({
      allowed: false,
      reason: "expired",
    });
  });

  it("removes access when the last payment failed", () => {
    expect(decide({ status: "past_due" })).toEqual({
      allowed: false,
      reason: "payment_failed",
    });
    expect(decide({ status: "unpaid" })).toEqual({
      allowed: false,
      reason: "payment_failed",
    });
    expect(decide({ status: "incomplete" })).toEqual({
      allowed: false,
      reason: "payment_failed",
    });
  });

  it("does not treat a plan name as a payment", () => {
    // The row says "active" and the plan says "founding", but nothing was ever
    // paid for. This is the case that used to hand out free access.
    expect(
      decide({ source: "none", status: "active", currentPeriodEnd: FUTURE }),
    ).toEqual({ allowed: false, reason: "no_subscription" });
  });

  it("allows an explicit owner grant", () => {
    expect(decide({ comped: true, source: "none", status: "none" })).toEqual({
      allowed: true,
      reason: "comp",
    });
  });

  it("denies a suspended account even when it has paid", () => {
    expect(decide({ suspended: true })).toEqual({
      allowed: false,
      reason: "suspended",
    });
  });

  it("denies a suspended account even when it is comped", () => {
    expect(decide({ suspended: true, comped: true })).toEqual({
      allowed: false,
      reason: "suspended",
    });
  });

  it("denies an unrecognised status", () => {
    expect(decide({ status: "paused" })).toEqual({
      allowed: false,
      reason: "expired",
    });
  });
});
