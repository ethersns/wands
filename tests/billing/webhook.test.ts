// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Webhook handling.
 *
 * The webhook is the only place a payment becomes an entitlement, so these
 * tests are about the properties that make that safe: an unsigned body is
 * rejected, a replayed delivery is acknowledged without repeating its effects,
 * a delayed payment is not treated as a paid one, and a failure leaves the
 * event unprocessed so Stripe's retry is handled rather than skipped.
 */

const db = vi.hoisted(() => {
  const state = {
    calls: [] as { sql: string; values: unknown[] }[],
    handlers: [] as { match: RegExp; rows: unknown[] }[],
    failOn: null as RegExp | null,
  };

  const run = async (sql: string, values: unknown[] = []) => {
    state.calls.push({ sql, values });
    if (state.failOn && state.failOn.test(sql)) {
      throw new Error("simulated database failure");
    }
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

const stripe = vi.hoisted(() => ({
  event: null as unknown,
  signatureError: null as Error | null,
  retrieved: [] as string[],
  subscription: null as unknown,
}));

vi.mock("stripe", () => {
  class FakeStripe {
    webhooks = {
      constructEvent: () => {
        if (stripe.signatureError) throw stripe.signatureError;
        return stripe.event;
      },
    };

    subscriptions = {
      retrieve: async (id: string) => {
        stripe.retrieved.push(id);
        return stripe.subscription;
      },
    };
  }

  return { default: FakeStripe };
});

const dispatch = vi.hoisted(() => ({ calls: [] as string[] }));

vi.mock("@/lib/billing/activation-dispatch", () => ({
  dispatchActivation: async (intentId: string) => {
    dispatch.calls.push(intentId);
    return { sent: true };
  },
}));

function on(match: RegExp, rows: unknown[]) {
  db.state.handlers.unshift({ match, rows });
}

function callsMatching(pattern: RegExp) {
  return db.state.calls.filter((call) => pattern.test(call.sql));
}

function request(signature: string | null = "t=1,v1=abc") {
  const headers = new Headers({ "content-type": "application/json" });
  if (signature) headers.set("stripe-signature", signature);

  return new Request("http://localhost/api/billing/webhook", {
    method: "POST",
    headers,
    body: JSON.stringify({ id: "evt_1" }),
  });
}

function subscriptionObject(overrides: Record<string, unknown> = {}) {
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
  };
}

async function loadRoute() {
  vi.resetModules();
  return await import("@/app/api/billing/webhook/route");
}

beforeEach(() => {
  db.state.calls.length = 0;
  db.state.handlers.length = 0;
  db.state.failOn = null;
  dispatch.calls.length = 0;
  stripe.retrieved.length = 0;
  stripe.event = null;
  stripe.signatureError = null;
  stripe.subscription = subscriptionObject();

  process.env.STRIPE_SECRET_KEY = "sk_test_123";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";

  on(/insert into billing_event/, [{ processed_at: null }]);
  on(/from subscription\s+where stripe_customer_id/, [
    {
      stripe_subscription_id: "sub_1",
      stripe_customer_id: "cus_1",
      price_id: "price_founding",
      plan: "founding",
      status: "active",
      current_period_end: new Date("2026-12-08T10:00:00.000Z"),
      cancel_at_period_end: false,
    },
  ]);
});

afterEach(() => {
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
});

describe("POST /api/billing/webhook", () => {
  it("rejects a delivery with no signature", async () => {
    const { POST } = await loadRoute();
    const response = await POST(request(null));

    expect(response.status).toBe(400);
    expect(db.state.calls).toHaveLength(0);
  });

  it("rejects a body whose signature does not verify", async () => {
    stripe.signatureError = new Error(
      "No signatures found matching the expected signature",
    );
    const { POST } = await loadRoute();
    const response = await POST(request());

    expect(response.status).toBe(400);
    expect(db.state.calls).toHaveLength(0);
  });

  it("acknowledges a replayed delivery without repeating its effects", async () => {
    on(/insert into billing_event/, [{ processed_at: new Date() }]);
    stripe.event = {
      id: "evt_dup",
      type: "checkout.session.completed",
      created: 1762600000,
      data: {
        object: { payment_status: "paid", metadata: { intent_id: "intent_1" } },
      },
    };

    const { POST } = await loadRoute();
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, duplicate: true });
    expect(callsMatching(/update member_signup_intent/)).toHaveLength(0);
    expect(dispatch.calls).toHaveLength(0);
  });

  it("records a paid checkout and dispatches activation", async () => {
    stripe.event = {
      id: "evt_paid",
      type: "checkout.session.completed",
      created: 1762600000,
      data: {
        object: {
          id: "cs_1",
          payment_status: "paid",
          customer: "cus_1",
          subscription: "sub_1",
          customer_details: { email: "Member@Example.com" },
          metadata: { intent_id: "intent_1" },
          client_reference_id: "intent_1",
        },
      },
    };

    const { POST } = await loadRoute();
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(callsMatching(/insert into billing_customer/)).toHaveLength(1);
    expect(callsMatching(/update member_signup_intent/)).toHaveLength(1);
    expect(stripe.retrieved).toEqual(["sub_1"]);
    expect(dispatch.calls).toEqual(["intent_1"]);
    expect(callsMatching(/update billing_event set processed_at/)).toHaveLength(1);
  });

  it("does not activate a checkout whose payment has not settled", async () => {
    stripe.event = {
      id: "evt_pending",
      type: "checkout.session.completed",
      created: 1762600000,
      data: {
        object: {
          id: "cs_2",
          payment_status: "unpaid",
          customer: "cus_1",
          subscription: "sub_1",
          metadata: { intent_id: "intent_1" },
        },
      },
    };

    const { POST } = await loadRoute();
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(dispatch.calls).toHaveLength(0);
    expect(stripe.retrieved).toHaveLength(0);
  });

  it("marks a signup failed when a delayed payment fails", async () => {
    stripe.event = {
      id: "evt_failed",
      type: "checkout.session.async_payment_failed",
      created: 1762600000,
      data: { object: { metadata: { intent_id: "intent_1" } } },
    };

    const { POST } = await loadRoute();
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(callsMatching(/set status = 'failed'/)).toHaveLength(1);
    expect(dispatch.calls).toHaveLength(0);
  });

  it("mirrors a subscription update and guards against stale events", async () => {
    stripe.event = {
      id: "evt_sub",
      type: "customer.subscription.updated",
      created: 1762600000,
      data: { object: subscriptionObject({ status: "past_due" }) },
    };

    const { POST } = await loadRoute();
    const response = await POST(request());

    expect(response.status).toBe(200);

    const upserts = callsMatching(/insert into subscription/);
    expect(upserts).toHaveLength(1);
    // The ordering guard is the whole reason an out-of-order delivery is safe.
    expect(upserts[0].sql).toContain("subscription.last_event_at is null");
    expect(upserts[0].sql).toContain("<= excluded.last_event_at");
    expect(callsMatching(/update member_membership/)).toHaveLength(1);
  });

  it("re-reads the subscription when an invoice payment fails", async () => {
    stripe.subscription = subscriptionObject({ status: "past_due" });
    stripe.event = {
      id: "evt_invoice",
      type: "invoice.payment_failed",
      created: 1762600000,
      data: { object: { customer: "cus_1", subscription: "sub_1" } },
    };

    const { POST } = await loadRoute();
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(stripe.retrieved).toEqual(["sub_1"]);
    expect(callsMatching(/insert into subscription/)).toHaveLength(1);
  });

  it("ignores an invoice that has no subscription", async () => {
    stripe.event = {
      id: "evt_oneoff",
      type: "invoice.paid",
      created: 1762600000,
      data: { object: { customer: "cus_1" } },
    };

    const { POST } = await loadRoute();
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(stripe.retrieved).toHaveLength(0);
  });

  it("leaves the event unprocessed when handling fails, so Stripe retries", async () => {
    db.state.failOn = /update member_membership/;
    stripe.event = {
      id: "evt_boom",
      type: "customer.subscription.updated",
      created: 1762600000,
      data: { object: subscriptionObject() },
    };

    const { POST } = await loadRoute();
    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(callsMatching(/update billing_event set processed_at/)).toHaveLength(0);
  });
});
