// @vitest-environment node

import type Stripe from "stripe";
import { describe, expect, it } from "vitest";

import { idOf, mapSubscription } from "@/lib/billing/subscription-sync";

/**
 * Mapping a Stripe subscription onto the local mirror.
 *
 * The period end moved from the subscription onto its items in recent API
 * versions, so both shapes have to be read. Getting this wrong would leave a
 * cancelled member with no end date, which the entitlement decision reads as
 * "expired" — the safe direction, but the wrong one for a customer who has
 * paid through the end of the month.
 */

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub_1",
    customer: "cus_1",
    status: "active",
    cancel_at_period_end: false,
    metadata: { plan: "founding" },
    items: {
      data: [
        {
          current_period_end: 1765000000,
          price: {
            id: "price_founding",
            unit_amount: 1900,
            currency: "usd",
            recurring: { interval: "month" },
          },
        },
      ],
    },
    ...overrides,
  } as unknown as Stripe.Subscription;
}

describe("idOf", () => {
  it("reads an id from a string, an expanded object, or nothing", () => {
    expect(idOf("cus_1")).toBe("cus_1");
    expect(idOf({ id: "cus_2" })).toBe("cus_2");
    expect(idOf(null)).toBeNull();
    expect(idOf(undefined)).toBeNull();
  });
});

describe("mapSubscription", () => {
  it("maps the subscription, its price and its period end", () => {
    const state = mapSubscription(subscription(), 1762600000);

    expect(state).toEqual({
      id: "sub_1",
      customerId: "cus_1",
      priceId: "price_founding",
      plan: "founding",
      status: "active",
      currentPeriodEnd: new Date(1765000000 * 1000).toISOString(),
      cancelAtPeriodEnd: false,
      unitAmount: 1900,
      currency: "usd",
      interval: "month",
      eventCreated: 1762600000,
    });
  });

  it("falls back to the legacy top-level period end", () => {
    const state = mapSubscription(
      subscription({
        items: { data: [{ price: { id: "price_founding" } }] },
        current_period_end: 1765000000,
      }),
      1762600000,
    );

    expect(state?.currentPeriodEnd).toBe(
      new Date(1765000000 * 1000).toISOString(),
    );
  });

  it("records a cancellation that runs to the end of the period", () => {
    const state = mapSubscription(
      subscription({ status: "canceled", cancel_at_period_end: true }),
      1762600000,
    );

    expect(state?.status).toBe("canceled");
    expect(state?.cancelAtPeriodEnd).toBe(true);
    expect(state?.currentPeriodEnd).not.toBeNull();
  });

  it("refuses to map a subscription with no customer", () => {
    expect(mapSubscription(subscription({ customer: null }), 1762600000)).toBeNull();
  });
});
