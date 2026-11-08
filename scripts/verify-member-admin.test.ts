// @vitest-environment node

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { isAccountSuspended } from "@/lib/admin/account-status";
import {
  deleteMember,
  reactivateMember,
  suspendMember,
} from "@/lib/admin/member-actions";

/**
 * Live verification of the member-administration operations against the
 * configured database. Creates a throwaway account, runs suspend → reactivate →
 * delete through the real code paths, asserts the effects, then removes every
 * row it created.
 *
 * Run with:
 *   set -a && source /vercel/share/.env.project && set +a
 *   npx vitest run --config vitest.verify.config.ts
 */

const ACTOR = "verification-script";
const stamp = Date.now();
const email = `verify-${stamp}@example.invalid`;
const userId = `verify_${stamp}`;
const sessionId = `verify_session_${stamp}`;
const stripeCustomer = `cus_verify_${stamp}`;
const stripeSubscription = `sub_verify_${stamp}`;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

let auditFloor = 0;
let securityFloor = 0;
let loginEventId = "";
let securityEventId = "";

beforeAll(async () => {
  const before = await pool.query<{ audit: string; security: string }>(
    `select
       (select coalesce(max(id), 0)::text from admin_audit_log) as audit,
       (select coalesce(max(id), 0)::text from member_security_event) as security`,
  );
  auditFloor = Number(before.rows[0].audit);
  securityFloor = Number(before.rows[0].security);

  await pool.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, 'Verification Account', $2, true, now(), now())`,
    [userId, email],
  );
  await pool.query(
    `insert into member_membership
       (user_id, plan, status, stripe_customer_id, stripe_subscription_id,
        current_period_end, updated_at)
     values ($1, 'pro', 'canceled', $2, $3, now() + interval '10 days', now())`,
    [userId, stripeCustomer, stripeSubscription],
  );
  await pool.query(
    `insert into session (id, "expiresAt", token, "createdAt", "updatedAt",
                          "ipAddress", "userAgent", "userId")
     values ($1, now() + interval '1 day', $2, now(), now(),
             '203.0.113.9', 'verification-agent', $3)`,
    [sessionId, `token_${stamp}`, userId],
  );
  const login = await pool.query<{ id: string }>(
    `insert into member_login_event (user_id, occurred_at, day, kind, ip_address, user_agent)
     values ($1, now(), current_date, 'sign_in', '203.0.113.9', 'verification-agent')
     returning id::text as id`,
    [userId],
  );
  loginEventId = login.rows[0].id;

  const event = await pool.query<{ id: string }>(
    `insert into member_security_event
       (day, kind, outcome, user_id, email_hash, ip_address, user_agent, detail)
     values (current_date, 'sign_in_failed', 'failure', $1, 'hash_verify',
             '203.0.113.9', 'verification-agent', '{}'::jsonb)
     returning id::text as id`,
    [userId],
  );
  securityEventId = event.rows[0].id;
});

afterAll(async () => {
  await pool.query(`delete from admin_audit_log where id > $1`, [auditFloor]);
  await pool.query(`delete from member_security_event where id > $1`, [securityFloor]);
  await pool.query(`delete from member_billing_reference where deleted_by = $1`, [ACTOR]);
  await pool.query(`delete from member_login_event where user_agent = 'verification-agent'`);
  await pool.query(`delete from member_account_status where user_id = $1`, [userId]);
  await pool.query(`delete from session where "userId" = $1`, [userId]);
  await pool.query(`delete from "user" where id = $1`, [userId]);
  await pool.end();
});

describe("member administration against the live database", () => {
  it("suspends: writes the status, revokes sessions and blocks the auth layer", async () => {
    const result = await suspendMember({ userId, reason: "verification run", actor: ACTOR });

    expect(result).toMatchObject({ ok: true, changed: true });

    const status = await pool.query<{ status: string; suspended_by: string }>(
      `select status, suspended_by from member_account_status where user_id = $1`,
      [userId],
    );
    expect(status.rows[0]).toMatchObject({ status: "suspended", suspended_by: ACTOR });

    const sessions = await pool.query(`select id from session where "userId" = $1`, [userId]);
    expect(sessions.rowCount).toBe(0);

    expect(await isAccountSuspended(userId)).toBe(true);

    const audit = await pool.query<{ target: string }>(
      `select target from admin_audit_log
       where actor = $1 and action = 'member.suspend' order by id desc limit 1`,
      [ACTOR],
    );
    expect(audit.rows[0]?.target).toBe(userId);
  });

  it("treats a repeated suspension as a no-op that still revokes sessions", async () => {
    const result = await suspendMember({ userId, reason: "again", actor: ACTOR });

    expect(result).toMatchObject({ ok: true, changed: false });

    const count = await pool.query<{ count: string }>(
      `select count(*)::text as count from admin_audit_log
       where actor = $1 and action = 'member.suspend'`,
      [ACTOR],
    );
    expect(count.rows[0].count).toBe("1");
  });

  it("reactivates: clears the suspension and returns the address for the confirmation", async () => {
    const result = await reactivateMember({ userId, reason: "verification run", actor: ACTOR });

    expect(result).toMatchObject({ ok: true, changed: true });
    expect(result.ok && result.detail).toMatchObject({ email });

    const status = await pool.query<{ status: string; reactivated_by: string }>(
      `select status, reactivated_by from member_account_status where user_id = $1`,
      [userId],
    );
    expect(status.rows[0]).toMatchObject({ status: "active", reactivated_by: ACTOR });

    expect(await isAccountSuspended(userId)).toBe(false);
  });

  it("refuses a deletion whose confirmation address does not match", async () => {
    const result = await deleteMember({
      userId,
      confirmEmail: "wrong@example.invalid",
      actor: ACTOR,
    });

    expect(result).toMatchObject({ ok: false, code: "confirmation_mismatch" });

    const still = await pool.query(`select id from "user" where id = $1`, [userId]);
    expect(still.rowCount).toBe(1);
  });

  it("deletes: removes the account, anonymises the trail and retains billing separately", async () => {
    const result = await deleteMember({ userId, confirmEmail: email, actor: ACTOR });

    expect(result).toMatchObject({ ok: true, changed: true });

    const gone = await pool.query(`select id from "user" where id = $1`, [userId]);
    expect(gone.rowCount).toBe(0);

    const membership = await pool.query(
      `select user_id from member_membership where user_id = $1`,
      [userId],
    );
    expect(membership.rowCount).toBe(0);

    // The event rows survive; every identifier of the person does not. They are
    // looked up by id because the identifiers that would have found them are
    // exactly what the deletion removed.
    const logins = await pool.query<{
      user_id: string | null;
      ip_address: string | null;
      user_agent: string | null;
      kind: string;
    }>(
      `select user_id, ip_address, user_agent, kind from member_login_event where id = $1`,
      [loginEventId],
    );
    expect(logins.rows[0]).toEqual({
      user_id: null,
      ip_address: null,
      user_agent: null,
      kind: "sign_in",
    });

    const events = await pool.query<{
      user_id: string | null;
      ip_address: string | null;
      user_agent: string | null;
      email_hash: string | null;
      kind: string;
    }>(
      `select user_id, ip_address, user_agent, email_hash, kind
       from member_security_event where id = $1`,
      [securityEventId],
    );
    expect(events.rows[0]).toEqual({
      user_id: null,
      ip_address: null,
      user_agent: null,
      email_hash: null,
      kind: "sign_in_failed",
    });

    const retained = await pool.query<{
      id: string;
      stripe_customer_id: string;
      stripe_subscription_id: string;
      plan: string;
      deleted_by: string;
    }>(
      `select id::text, stripe_customer_id, stripe_subscription_id, plan, deleted_by
       from member_billing_reference where deleted_by = $1`,
      [ACTOR],
    );
    expect(retained.rowCount).toBe(1);
    expect(retained.rows[0]).toMatchObject({
      stripe_customer_id: stripeCustomer,
      stripe_subscription_id: stripeSubscription,
      plan: "pro",
    });

    const audit = await pool.query<{ target: string | null; detail: Record<string, unknown> }>(
      `select target, detail from admin_audit_log
       where actor = $1 and action = 'member.delete' order by id desc limit 1`,
      [ACTOR],
    );
    const row = audit.rows[0];
    const detail = JSON.stringify(row?.detail ?? {});

    expect(row).toBeDefined();
    expect(row.target).toBeNull();
    expect(detail).not.toContain(email);
    expect(detail).not.toContain(userId);
    expect(detail).not.toContain("cus_verify_");
    expect(detail).not.toContain("sub_verify_");
    expect(row.detail.billing_reference_id).toBe(retained.rows[0].id);
    expect(row.detail.billing_reference_retained).toBe(true);
  });
});
