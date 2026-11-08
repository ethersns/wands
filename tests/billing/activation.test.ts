// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Account activation.
 *
 * The activation token is the only path from "paid" to "usable account", so
 * these tests are about the ways that path must refuse: a replayed link, an
 * expired link, a link whose payment never settled, and — most importantly — a
 * link for an address that already has an account, which must not become a way
 * to take that account over.
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

const auth = vi.hoisted(() => ({
  signUpCalls: [] as Record<string, unknown>[],
  fail: false,
}));

vi.mock("@/lib/auth/member", () => ({
  memberAuth: {
    api: {
      signUpEmail: async ({ body }: { body: Record<string, unknown> }) => {
        auth.signUpCalls.push(body);
        if (auth.fail) {
          return new Response(JSON.stringify({ message: "Email already exists" }), {
            status: 422,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ user: { id: "usr_new" } }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "set-cookie": "wands.session_token=abc; Path=/; HttpOnly",
          },
        });
      },
    },
  },
}));

const session = vi.hoisted(() => ({
  current: null as { user: { id: string; email: string } } | null,
}));

vi.mock("@/lib/member/session", () => ({
  getMemberSession: async () => session.current,
}));

const TOKEN = "activation-token-value";

function on(match: RegExp, rows: unknown[]) {
  db.state.handlers.unshift({ match, rows });
}

function callsMatching(pattern: RegExp) {
  return db.state.calls.filter((call) => pattern.test(call.sql));
}

function tokenRow(overrides: Record<string, unknown> = {}) {
  return {
    token_id: "tok_1",
    expires_at: new Date(Date.now() + 60 * 60 * 1000),
    used_at: null,
    intent_id: "intent_1",
    email_normalized: "member@example.com",
    plan: "founding",
    status: "paid",
    user_id: null,
    stripe_customer_id: "cus_1",
    stripe_subscription_id: "sub_1",
    ...overrides,
  };
}

function post(body: unknown) {
  return new Request("http://localhost/api/billing/activate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function loadRoute() {
  vi.resetModules();
  return await import("@/app/api/billing/activate/route");
}

beforeEach(() => {
  db.state.calls.length = 0;
  db.state.handlers.length = 0;
  auth.signUpCalls.length = 0;
  auth.fail = false;
  session.current = null;

  on(/from member_activation_token t/, [tokenRow()]);
  on(/select id from "user" where lower\(email\)/, []);
  on(/update member_activation_token/, [{ id: "tok_1" }]);
  on(/from subscription\s+where stripe_subscription_id/, []);
  on(/insert into member_membership/, []);
  on(/update member_signup_intent/, []);
  on(/update "user" set "emailVerified"/, []);
});

afterEach(() => {
  session.current = null;
});

describe("POST /api/billing/activate", () => {
  it("rejects a token it has never issued", async () => {
    on(/from member_activation_token t/, []);
    const { POST } = await loadRoute();

    const response = await POST(post({ token: "nope", password: "correct-horse" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "invalid" });
  });

  it("rejects a replayed activation link", async () => {
    on(/from member_activation_token t/, [tokenRow({ used_at: new Date() })]);
    const { POST } = await loadRoute();

    const response = await POST(post({ token: TOKEN, password: "correct-horse" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "used" });
    expect(auth.signUpCalls).toHaveLength(0);
  });

  it("rejects an expired activation link", async () => {
    on(/from member_activation_token t/, [
      tokenRow({ expires_at: new Date(Date.now() - 1000) }),
    ]);
    const { POST } = await loadRoute();

    const response = await POST(post({ token: TOKEN, password: "correct-horse" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "expired" });
  });

  it("refuses to activate a signup whose payment is not confirmed", async () => {
    on(/from member_activation_token t/, [tokenRow({ status: "pending" })]);
    const { POST } = await loadRoute();

    const response = await POST(post({ token: TOKEN, password: "correct-horse" }));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "unpaid" });
    expect(auth.signUpCalls).toHaveLength(0);
  });

  it("requires a password long enough to be worth having", async () => {
    const { POST } = await loadRoute();

    const response = await POST(post({ token: TOKEN, password: "short" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "weak_password" });
    expect(auth.signUpCalls).toHaveLength(0);
  });

  it("creates the account, burns the token and grants the membership", async () => {
    const { POST } = await loadRoute();

    const response = await POST(
      post({ token: TOKEN, password: "correct-horse-battery", name: "Alex" }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.ok).toBe(true);
    expect(["/onboarding", "/signin?activated=1"]).toContain(payload.redirect);

    expect(auth.signUpCalls).toHaveLength(1);
    expect(auth.signUpCalls[0]).toMatchObject({
      email: "member@example.com",
      name: "Alex",
    });

    expect(callsMatching(/update member_activation_token/)).toHaveLength(1);
    expect(callsMatching(/insert into member_membership/)).toHaveLength(1);
    expect(callsMatching(/set status = 'activated'/)).toHaveLength(1);
  });

  it("refuses to attach a membership to an existing account without a session", async () => {
    on(/select id from "user" where lower\(email\)/, [{ id: "usr_existing" }]);
    const { POST } = await loadRoute();

    const response = await POST(post({ token: TOKEN, password: "correct-horse" }));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "sign_in_required" });
    expect(auth.signUpCalls).toHaveLength(0);
    expect(callsMatching(/insert into member_membership/)).toHaveLength(0);
  });

  it("refuses a session belonging to a different address", async () => {
    on(/select id from "user" where lower\(email\)/, [{ id: "usr_existing" }]);
    session.current = { user: { id: "usr_other", email: "someone@else.com" } };

    const { POST } = await loadRoute();
    const response = await POST(post({ token: TOKEN }));

    expect(response.status).toBe(401);
    expect(callsMatching(/insert into member_membership/)).toHaveLength(0);
  });

  it("attaches the membership to an existing account the caller is signed into", async () => {
    on(/select id from "user" where lower\(email\)/, [{ id: "usr_existing" }]);
    session.current = { user: { id: "usr_existing", email: "Member@Example.com" } };

    const { POST } = await loadRoute();
    const response = await POST(post({ token: TOKEN }));

    expect(response.status).toBe(200);
    expect(auth.signUpCalls).toHaveLength(0);

    const inserts = callsMatching(/insert into member_membership/);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].values[0]).toBe("usr_existing");
  });

  it("refuses when the token was consumed by a concurrent request", async () => {
    on(/update member_activation_token/, []);
    const { POST } = await loadRoute();

    const response = await POST(
      post({ token: TOKEN, password: "correct-horse-battery" }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "token_used" });
    expect(callsMatching(/insert into member_membership/)).toHaveLength(0);
  });
});
