// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Operator-issued activation links.
 *
 * The activation token is stored only as a hash, so the operator cannot read
 * back the link a customer already holds. These tests pin the consequences of
 * that: issuing must replace the live link rather than add a second one, an
 * account that is already activated must not be re-linked, and a deployment
 * with no email provider must still hand the operator a usable link instead of
 * silently doing nothing.
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

const mail = vi.hoisted(() => ({
  configured: false,
  delivered: true,
  sent: [] as { to: string; subject: string }[],
}));

vi.mock("@/lib/email/send", () => ({
  get emailDeliveryConfigured() {
    return mail.configured;
  },
  activationEmail: (url: string, planName: string) => ({
    subject: `Activate your ${planName}`,
    html: `<a href="${url}">Activate</a>`,
    text: url,
  }),
  sendTransactionalEmail: async (args: { to: string; subject: string }) => {
    mail.sent.push({ to: args.to, subject: args.subject });
    return { delivered: mail.delivered };
  },
}));

vi.mock("@/lib/marketing/site", () => ({
  siteUrl: "https://wands.test",
  siteName: "Wands",
}));

import {
  emailActivationLink,
  issueActivationLink,
  listPendingActivations,
  revokeActivationLinks,
} from "@/lib/admin/activation-links";

const INTENT_ID = "3f1c2b4a-5d6e-4f70-8a91-b2c3d4e5f607";
const ACTOR = "operator";

function on(match: RegExp, rows: unknown[]) {
  db.state.handlers.unshift({ match, rows });
}

function callsMatching(pattern: RegExp) {
  return db.state.calls.filter((call) => pattern.test(call.sql));
}

function intentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: INTENT_ID,
    email_normalized: "member@example.com",
    plan: "founding",
    status: "paid",
    ...overrides,
  };
}

beforeEach(() => {
  db.state.calls.length = 0;
  db.state.handlers.length = 0;
  mail.configured = false;
  mail.delivered = true;
  mail.sent.length = 0;

  on(/from member_signup_intent\s+where id = \$1::uuid/, [intentRow()]);
  on(/update member_activation_token\s+set used_at = now\(\)\s+where intent_id/, [
    { id: "tok_old" },
  ]);
  on(/insert into member_activation_token/, [{ id: "tok_new" }]);
  on(/insert into admin_audit_log/, []);
});

describe("listPendingActivations", () => {
  it("asks only for paid intents and maps the live link state", async () => {
    on(/from member_signup_intent i/, [
      {
        intent_id: INTENT_ID,
        email: "member@example.com",
        plan: "founding",
        paid_at: new Date("2026-02-01T10:00:00Z"),
        created_at: new Date("2026-02-01T09:00:00Z"),
        live_expires_at: new Date("2026-02-02T10:00:00Z"),
        last_issued_at: new Date("2026-02-01T10:00:00Z"),
      },
    ]);

    const rows = await listPendingActivations();

    expect(rows).toHaveLength(1);
    expect(rows[0].intentId).toBe(INTENT_ID);
    expect(rows[0].liveLinkExpiresAt).toBe("2026-02-02T10:00:00.000Z");

    const [query] = callsMatching(/from member_signup_intent i/);
    expect(query.sql).toContain("where i.status = 'paid'");
  });

  it("reports no live link when the customer holds nothing usable", async () => {
    on(/from member_signup_intent i/, [
      {
        intent_id: INTENT_ID,
        email: "member@example.com",
        plan: "founding",
        paid_at: null,
        created_at: new Date("2026-02-01T09:00:00Z"),
        live_expires_at: null,
        last_issued_at: null,
      },
    ]);

    const rows = await listPendingActivations();

    expect(rows[0].liveLinkExpiresAt).toBeNull();
    expect(rows[0].lastLinkIssuedAt).toBeNull();
  });
});

describe("issueActivationLink", () => {
  it("replaces the live link and returns the new one once", async () => {
    const result = await issueActivationLink({ intentId: INTENT_ID, actor: ACTOR });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.url).toMatch(/^https:\/\/wands\.test\/activate\?token=/);
    expect(result.expiresAt).toBeTruthy();

    const revoke = callsMatching(/update member_activation_token\s+set used_at/);
    const insert = callsMatching(/insert into member_activation_token/);
    expect(revoke).toHaveLength(1);
    expect(insert).toHaveLength(1);

    // The old link must stop working before the new one exists, so a customer
    // is never holding two working links at once.
    expect(db.state.calls.indexOf(revoke[0])).toBeLessThan(
      db.state.calls.indexOf(insert[0]),
    );

    const audit = callsMatching(/insert into admin_audit_log/);
    expect(audit).toHaveLength(1);
    expect(audit[0].values).toContain("activation.link_issued");
  });

  it("refuses an account that is already activated", async () => {
    on(/from member_signup_intent\s+where id = \$1::uuid/, [
      intentRow({ status: "activated" }),
    ]);

    const result = await issueActivationLink({ intentId: INTENT_ID, actor: ACTOR });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("already activated");
    expect(callsMatching(/insert into member_activation_token/)).toHaveLength(0);
  });

  it("refuses a signup whose payment never settled", async () => {
    on(/from member_signup_intent\s+where id = \$1::uuid/, [intentRow({ status: "pending" })]);

    const result = await issueActivationLink({ intentId: INTENT_ID, actor: ACTOR });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("Only a paid signup");
    expect(callsMatching(/insert into member_activation_token/)).toHaveLength(0);
  });

  it("rejects a malformed reference without touching the database", async () => {
    const result = await issueActivationLink({ intentId: "not-a-uuid", actor: ACTOR });

    expect(result.ok).toBe(false);
    expect(db.state.calls).toHaveLength(0);
  });
});

describe("emailActivationLink", () => {
  it("still hands the operator a link when no provider is configured", async () => {
    mail.configured = false;

    const result = await emailActivationLink({ intentId: INTENT_ID, actor: ACTOR });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("not configured");
    expect(result.url).toMatch(/^https:\/\/wands\.test\/activate\?token=/);
    expect(mail.sent).toHaveLength(0);
  });

  it("sends the link to the address the payment was made with", async () => {
    mail.configured = true;

    const result = await emailActivationLink({ intentId: INTENT_ID, actor: ACTOR });

    expect(result.ok).toBe(true);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toBe("member@example.com");
    expect(mail.sent[0].subject).toContain("Founding");
  });

  it("returns the link when the provider refuses the message", async () => {
    mail.configured = true;
    mail.delivered = false;

    const result = await emailActivationLink({ intentId: INTENT_ID, actor: ACTOR });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.url).toMatch(/^https:\/\/wands\.test\/activate\?token=/);
  });
});

describe("revokeActivationLinks", () => {
  it("revokes the live link", async () => {
    const result = await revokeActivationLinks({ intentId: INTENT_ID, actor: ACTOR });

    expect(result.ok).toBe(true);
    expect(result.message).toContain("revoked");
    expect(callsMatching(/insert into admin_audit_log/)[0].values).toContain(
      "activation.link_revoked",
    );
  });

  it("says so when there was nothing to revoke", async () => {
    on(/update member_activation_token\s+set used_at = now\(\)\s+where intent_id/, []);

    const result = await revokeActivationLinks({ intentId: INTENT_ID, actor: ACTOR });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("no live activation link");
  });
});
