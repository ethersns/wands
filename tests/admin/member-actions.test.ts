// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * These tests exercise the real decision logic in `lib/admin/member-actions.ts`
 * against a recording fake of the database layer. The fake returns canned rows
 * per statement and keeps every call, so the assertions can check not only the
 * outcome but the statements that produced it — which is the only way to prove
 * that a suspension actually deletes sessions, that a deletion does not touch
 * billing records, and that a repeated request writes no second audit row.
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

import {
  deleteMember,
  deleteWaitlistEntry,
  isValidMemberId,
  reactivateMember,
  suspendMember,
} from "@/lib/admin/member-actions";

const USER = { id: "usr_1", email: "member@example.com" };

function handlers(overrides: { match: RegExp; rows: unknown[] }[] = []) {
  const base = [
    { match: /from "user" where id = \$1 for update/, rows: [USER] },
    { match: /select status from member_account_status/, rows: [] },
    { match: /insert into member_account_status/, rows: [] },
    { match: /update member_account_status/, rows: [] },
    { match: /delete from session/, rows: [{ id: "s1" }, { id: "s2" }] },
    { match: /select stripe_customer_id/, rows: [] },
    { match: /select\s+\(select count\(\*\)::int from member_watchlist/, rows: [{ watchlists: 2, saved: 5, notifications: 1, sessions: 1 }] },
    { match: /update member_login_event set user_id = null/, rows: [] },
    { match: /update member_security_event set user_id = null/, rows: [] },
    { match: /delete from "user" where id = \$1/, rows: [] },
    { match: /delete from public\.waitlist_signup/, rows: [] },
    { match: /insert into admin_audit_log/, rows: [] },
    { match: /insert into member_security_event/, rows: [] },
  ];

  // Overrides win, so a test can replace one statement's result without
  // restating the whole script.
  return [...overrides, ...base];
}

function callsMatching(pattern: RegExp) {
  return db.state.calls.filter((call) => pattern.test(call.sql));
}

beforeEach(() => {
  db.state.calls.length = 0;
  db.state.handlers = handlers();
  delete process.env.WANDS_FOUNDER_USER_IDS;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isValidMemberId", () => {
  it("accepts a Better Auth id", () => {
    expect(isValidMemberId("aBc123XyZ_-9")).toBe(true);
  });

  it("rejects an empty, overlong or punctuated id", () => {
    expect(isValidMemberId("")).toBe(false);
    expect(isValidMemberId(null)).toBe(false);
    expect(isValidMemberId("a".repeat(65))).toBe(false);
    expect(isValidMemberId("usr_1' or 1=1")).toBe(false);
    expect(isValidMemberId("usr/1")).toBe(false);
  });
});

describe("suspendMember", () => {
  it("refuses an invalid id without touching the database", async () => {
    const result = await suspendMember({ userId: "bad id!", reason: "x", actor: "operator" });

    expect(result).toMatchObject({ ok: false, code: "invalid_id" });
    expect(db.state.calls).toHaveLength(0);
  });

  it("refuses an account that holds operator access", async () => {
    vi.stubEnv("WANDS_FOUNDER_USER_IDS", "usr_1");

    const result = await suspendMember({ userId: "usr_1", reason: "x", actor: "operator" });

    expect(result).toMatchObject({ ok: false, code: "operator_account" });
    expect(db.state.calls).toHaveLength(0);
  });

  it("reports a missing account rather than creating a status row", async () => {
    db.state.handlers = handlers([
      { match: /from "user" where id = \$1 for update/, rows: [] },
    ]);

    const result = await suspendMember({ userId: "usr_1", reason: "x", actor: "operator" });

    expect(result).toMatchObject({ ok: false, code: "not_found" });
    expect(callsMatching(/insert into member_account_status/)).toHaveLength(0);
  });

  it("writes the status, revokes every session and records the action", async () => {
    const result = await suspendMember({
      userId: "usr_1",
      reason: "chargeback",
      actor: "operator",
    });

    expect(result).toMatchObject({ ok: true, changed: true });

    const status = callsMatching(/insert into member_account_status/);
    expect(status).toHaveLength(1);
    expect(status[0].values).toEqual(["usr_1", "chargeback", "operator"]);

    // The suspension is only real if the sessions are gone.
    const revoked = callsMatching(/delete from session/);
    expect(revoked).toHaveLength(1);
    expect(revoked[0].values).toEqual(["usr_1"]);

    const audit = callsMatching(/insert into admin_audit_log/);
    expect(audit).toHaveLength(1);
    expect(audit[0].values[0]).toBe("operator");
    expect(audit[0].values[1]).toBe("member.suspend");
    expect(audit[0].values[2]).toBe("usr_1");
    expect(JSON.parse(String(audit[0].values[3]))).toMatchObject({
      reason: "chargeback",
      sessions_revoked: 2,
    });

    const event = callsMatching(/insert into member_security_event/);
    expect(event).toHaveLength(1);
    expect(event[0].values[1]).toBe("account_suspended");
  });

  it("treats a repeated request as a no-op that still revokes sessions", async () => {
    db.state.handlers = handlers([
      { match: /select status from member_account_status/, rows: [{ status: "suspended" }] },
    ]);

    const result = await suspendMember({ userId: "usr_1", reason: "again", actor: "operator" });

    expect(result).toMatchObject({ ok: true, changed: false });
    // No second audit row for the same state change.
    expect(callsMatching(/insert into admin_audit_log/)).toHaveLength(0);
    expect(callsMatching(/insert into member_security_event/)).toHaveLength(0);
    // But a live session must never survive a suspension.
    expect(callsMatching(/delete from session/)).toHaveLength(1);
  });

  it("truncates an overlong reason instead of failing the action", async () => {
    await suspendMember({ userId: "usr_1", reason: "x".repeat(900), actor: "operator" });

    const status = callsMatching(/insert into member_account_status/);
    expect(String(status[0].values[1])).toHaveLength(500);
  });
});

describe("reactivateMember", () => {
  it("reports an already-active account without writing an audit row", async () => {
    const result = await reactivateMember({ userId: "usr_1", reason: "", actor: "operator" });

    expect(result).toMatchObject({ ok: true, changed: false });
    expect(callsMatching(/update member_account_status/)).toHaveLength(0);
    expect(callsMatching(/insert into admin_audit_log/)).toHaveLength(0);
  });

  it("clears the suspension and records who did it", async () => {
    db.state.handlers = handlers([
      { match: /select status from member_account_status/, rows: [{ status: "suspended" }] },
    ]);

    const result = await reactivateMember({
      userId: "usr_1",
      reason: "appeal upheld",
      actor: "operator",
    });

    expect(result).toMatchObject({ ok: true, changed: true });

    const update = callsMatching(/update member_account_status/);
    expect(update).toHaveLength(1);
    expect(update[0].values).toEqual(["usr_1", "operator"]);

    const audit = callsMatching(/insert into admin_audit_log/);
    expect(audit[0].values[1]).toBe("member.reactivate");

    const event = callsMatching(/insert into member_security_event/);
    expect(event[0].values[1]).toBe("account_reactivated");
  });

  it("refuses an invalid id", async () => {
    const result = await reactivateMember({ userId: "../etc", reason: "", actor: "operator" });
    expect(result).toMatchObject({ ok: false, code: "invalid_id" });
  });
});

describe("deleteMember", () => {
  it("refuses when the confirmation address does not match", async () => {
    const result = await deleteMember({
      userId: "usr_1",
      confirmEmail: "someone-else@example.com",
      actor: "operator",
    });

    expect(result).toMatchObject({ ok: false, code: "confirmation_mismatch" });
    expect(callsMatching(/delete from "user"/)).toHaveLength(0);
  });

  it("matches the confirmation address case-insensitively", async () => {
    const result = await deleteMember({
      userId: "usr_1",
      confirmEmail: "  MEMBER@Example.com ",
      actor: "operator",
    });

    expect(result).toMatchObject({ ok: true, changed: true });
  });

  it("refuses an account that holds operator access", async () => {
    vi.stubEnv("WANDS_FOUNDER_USER_IDS", "usr_1");

    const result = await deleteMember({
      userId: "usr_1",
      confirmEmail: USER.email,
      actor: "operator",
    });

    expect(result).toMatchObject({ ok: false, code: "operator_account" });
    expect(callsMatching(/delete from "user"/)).toHaveLength(0);
  });

  it("refuses while a Stripe subscription is live", async () => {
    db.state.handlers = handlers([
      {
        match: /select stripe_customer_id/,
        rows: [
          {
            stripe_customer_id: "cus_1",
            stripe_subscription_id: "sub_1",
            status: "active",
          },
        ],
      },
    ]);

    const result = await deleteMember({
      userId: "usr_1",
      confirmEmail: USER.email,
      actor: "operator",
    });

    expect(result).toMatchObject({ ok: false, code: "live_subscription" });
    expect(callsMatching(/delete from "user"/)).toHaveLength(0);
  });

  it("allows deletion once the subscription is cancelled", async () => {
    db.state.handlers = handlers([
      {
        match: /select stripe_customer_id/,
        rows: [
          {
            stripe_customer_id: "cus_1",
            stripe_subscription_id: "sub_1",
            status: "canceled",
          },
        ],
      },
    ]);

    const result = await deleteMember({
      userId: "usr_1",
      confirmEmail: USER.email,
      actor: "operator",
    });

    expect(result).toMatchObject({ ok: true, changed: true });
  });

  it("deletes the account, severs the security trail and retains billing references", async () => {
    db.state.handlers = handlers([
      {
        match: /select stripe_customer_id/,
        rows: [
          {
            stripe_customer_id: "cus_1",
            stripe_subscription_id: null,
            status: "active",
          },
        ],
      },
    ]);

    const result = await deleteMember({
      userId: "usr_1",
      confirmEmail: USER.email,
      actor: "operator",
    });

    expect(result).toMatchObject({ ok: true, changed: true });

    // The account row goes; every member-owned table cascades from it.
    const deleted = callsMatching(/delete from "user"/);
    expect(deleted).toHaveLength(1);
    expect(deleted[0].values).toEqual(["usr_1"]);

    // The security trail survives, but the link to the person does not.
    expect(callsMatching(/update member_login_event set user_id = null/)).toHaveLength(1);
    expect(callsMatching(/update member_security_event set user_id = null/)).toHaveLength(1);

    // Billing records are never deleted by this action.
    expect(callsMatching(/delete from billing_customer/)).toHaveLength(0);
    expect(callsMatching(/delete from subscription/)).toHaveLength(0);

    const audit = callsMatching(/insert into admin_audit_log/);
    expect(audit).toHaveLength(1);
    expect(audit[0].values[1]).toBe("member.delete");
    expect(JSON.parse(String(audit[0].values[3]))).toMatchObject({
      watchlists: 2,
      saved: 5,
      notifications: 1,
      sessions: 1,
      stripe_customer_id: "cus_1",
      billing_records_retained: true,
    });
  });

  it("reports a missing account rather than deleting nothing silently", async () => {
    db.state.handlers = handlers([
      { match: /from "user" where id = \$1 for update/, rows: [] },
    ]);

    const result = await deleteMember({
      userId: "usr_1",
      confirmEmail: USER.email,
      actor: "operator",
    });

    expect(result).toMatchObject({ ok: false, code: "not_found" });
  });
});

describe("deleteWaitlistEntry", () => {
  it("rejects a value that is not a uuid", async () => {
    const result = await deleteWaitlistEntry({ id: "1", actor: "operator" });

    expect(result).toMatchObject({ ok: false, code: "invalid_id" });
    expect(db.state.calls).toHaveLength(0);
  });

  it("reports a missing entry", async () => {
    const result = await deleteWaitlistEntry({
      id: "3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b",
      actor: "operator",
    });

    expect(result).toMatchObject({ ok: false, code: "not_found" });
  });

  it("removes only the waitlist row and audits the deletion", async () => {
    db.state.handlers = handlers([
      {
        match: /delete from public\.waitlist_signup/,
        rows: [{ email: "contact@example.com" }],
      },
    ]);

    const result = await deleteWaitlistEntry({
      id: "3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b",
      actor: "operator",
    });

    expect(result).toMatchObject({ ok: true, changed: true });

    // A waitlist contact and a member account are separate records.
    expect(callsMatching(/delete from "user"/)).toHaveLength(0);

    const audit = callsMatching(/insert into admin_audit_log/);
    expect(audit[0].values[1]).toBe("waitlist.delete");
    // The address itself is not copied into the audit log.
    expect(JSON.parse(String(audit[0].values[3]))).toEqual({
      email_domain: "example.com",
    });
  });
});
