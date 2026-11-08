// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Checkout creation.
 *
 * These tests exercise the real route against a recording fake of the database
 * and a fake Stripe client, so the assertions can check both the response and
 * the session that was actually created — which is the only way to prove that
 * the price comes from server configuration, that a duplicate click reuses the
 * open session instead of creating a second one, and that an address which
 * already pays is refused before anything is written.
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

const stripe = vi.hoisted(() => ({
  created: [] as Record<string, unknown>[],
  openSession: null as { status: string; url: string } | null,
}));

vi.mock("stripe", () => {
  class FakeStripe {
    checkout = {
      sessions: {
        create: async (params: Record<string, unknown>) => {
          stripe.created.push(params);
          return {
            id: `cs_test_${stripe.created.length}`,
            url: `https://checkout.stripe.test/${stripe.created.length}`,
            status: "open",
          };
        },
        retrieve: async () => stripe.openSession,
      },
    };
  }

  return { default: FakeStripe };
});

vi.mock("@/lib/member/session", () => ({
  getMemberSession: async () => null,
}));

const INTENT_ID = "11111111-1111-1111-1111-111111111111";

function intentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: INTENT_ID,
    email_normalized: "member@example.com",
    plan: "founding",
    price_id: "price_founding",
    status: "pending",
    stripe_checkout_session_id: null,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    user_id: null,
    created_at: new Date("2026-11-08T10:00:00.000Z"),
    expires_at: new Date("2026-11-09T10:00:00.000Z"),
    paid_at: null,
    activated_at: null,
    ...overrides,
  };
}

function membershipRow(overrides: Record<string, unknown> = {}) {
  return {
    plan: "founding",
    status: "active",
    entitlement_source: "stripe",
    current_period_end: new Date("2026-12-08T10:00:00.000Z"),
    cancel_at_period_end: false,
    stripe_customer_id: "cus_123",
    stripe_subscription_id: "sub_123",
    ...overrides,
  };
}

function on(match: RegExp, rows: unknown[]) {
  db.state.handlers.unshift({ match, rows });
}

function post(body: unknown) {
  return new Request("http://localhost/api/billing/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID = { email: "member@example.com", plan: "founding", termsAccepted: true };

async function loadRoute() {
  vi.resetModules();
  return await import("@/app/api/billing/checkout/route");
}

beforeEach(() => {
  db.state.calls.length = 0;
  db.state.handlers.length = 0;
  stripe.created.length = 0;
  stripe.openSession = null;

  process.env.WANDS_BILLING_ENABLED = "true";
  process.env.STRIPE_SECRET_KEY = "sk_test_123";
  process.env.STRIPE_PRICE_FOUNDING = "price_founding";
  delete process.env.WANDS_BILLING_LIVE_APPROVED;
});

afterEach(() => {
  delete process.env.WANDS_BILLING_ENABLED;
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_PRICE_FOUNDING;
});

describe("POST /api/billing/checkout", () => {
  it("refuses while billing is switched off", async () => {
    process.env.WANDS_BILLING_ENABLED = "false";
    const { POST } = await loadRoute();

    const response = await POST(post(VALID));

    expect(response.status).toBe(503);
    expect(stripe.created).toHaveLength(0);
  });

  it("refuses a live key that has not been explicitly approved", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_123";
    const { POST } = await loadRoute();

    const response = await POST(post(VALID));

    expect(response.status).toBe(503);
    expect(stripe.created).toHaveLength(0);
  });

  it("rejects an invalid email address", async () => {
    const { POST } = await loadRoute();

    const response = await POST(post({ ...VALID, email: "not-an-email" }));

    expect(response.status).toBe(400);
    expect(stripe.created).toHaveLength(0);
  });

  it("rejects a checkout without terms acceptance", async () => {
    const { POST } = await loadRoute();

    const response = await POST(post({ ...VALID, termsAccepted: false }));

    expect(response.status).toBe(400);
    expect(stripe.created).toHaveLength(0);
  });

  it("rejects a plan that is not in the member allowlist", async () => {
    const { POST } = await loadRoute();

    const response = await POST(post({ ...VALID, plan: "operator" }));

    expect(response.status).toBe(400);
    expect(stripe.created).toHaveLength(0);
  });

  it("refuses when no member price is configured", async () => {
    delete process.env.STRIPE_PRICE_FOUNDING;
    const { POST } = await loadRoute();

    const response = await POST(post(VALID));

    expect(response.status).toBe(400);
    expect(stripe.created).toHaveLength(0);
  });

  it("refuses a second subscription for an address that already pays", async () => {
    on(/select id from "user" where lower\(email\)/, [{ id: "usr_1" }]);
    on(/from member_membership\s+where user_id/, [membershipRow()]);
    on(/from member_account_status/, []);

    const { POST } = await loadRoute();
    const response = await POST(post(VALID));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "already_member" });
    expect(stripe.created).toHaveLength(0);
  });

  it("refuses a second checkout once payment is already confirmed", async () => {
    on(/select id from "user" where lower\(email\)/, []);
    on(/from member_signup_intent\s+where email_normalized/, [
      intentRow({ status: "paid" }),
    ]);

    const { POST } = await loadRoute();
    const response = await POST(post(VALID));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "awaiting_activation" });
    expect(stripe.created).toHaveLength(0);
  });

  it("reuses an open checkout instead of creating a second one", async () => {
    on(/select id from "user" where lower\(email\)/, []);
    on(/from member_signup_intent\s+where email_normalized/, [
      intentRow({ stripe_checkout_session_id: "cs_open" }),
    ]);
    stripe.openSession = {
      status: "open",
      url: "https://checkout.stripe.test/existing",
    };

    const { POST } = await loadRoute();
    const response = await POST(post(VALID));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url: "https://checkout.stripe.test/existing",
    });
    expect(stripe.created).toHaveLength(0);
  });

  it("creates a subscription session priced from server configuration", async () => {
    on(/select id from "user" where lower\(email\)/, []);
    on(/from member_signup_intent\s+where email_normalized/, []);
    on(/insert into member_signup_intent/, [intentRow()]);

    const { POST } = await loadRoute();
    const response = await POST(post({ ...VALID, email: "  Member@Example.com " }));

    expect(response.status).toBe(200);
    expect(stripe.created).toHaveLength(1);

    const session = stripe.created[0];
    expect(session.mode).toBe("subscription");
    expect(session.line_items).toEqual([{ price: "price_founding", quantity: 1 }]);
    expect(session.customer_email).toBe("member@example.com");
    expect(session.client_reference_id).toBe(INTENT_ID);
    expect(session.metadata).toMatchObject({ intent_id: INTENT_ID, plan: "founding" });
    expect(String(session.success_url)).toContain(`/signup/confirmed?intent=${INTENT_ID}`);
  });

  it("never accepts a price from the request body", async () => {
    on(/select id from "user" where lower\(email\)/, []);
    on(/from member_signup_intent\s+where email_normalized/, []);
    on(/insert into member_signup_intent/, [intentRow()]);

    const { POST } = await loadRoute();
    await POST(
      post({
        ...VALID,
        priceId: "price_attacker",
        amount: 1,
        price: "price_attacker",
      }),
    );

    expect(stripe.created[0].line_items).toEqual([
      { price: "price_founding", quantity: 1 },
    ]);
  });
});
