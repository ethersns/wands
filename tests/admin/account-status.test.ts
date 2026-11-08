// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => {
  const state = {
    rows: [] as unknown[],
    fail: false,
    calls: [] as { sql: string; values: unknown[] }[],
  };

  const run = async (sql: string, values: unknown[] = []) => {
    state.calls.push({ sql, values });
    if (state.fail) throw new Error("connection refused");
    return state.rows;
  };

  return { state, run };
});

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: () => true,
  query: (sql: string, values?: unknown[]) => db.run(sql, values),
  withTransaction: (fn: (tx: typeof db.run) => Promise<unknown>) => fn(db.run),
}));

import {
  ACTIVE_STATUS,
  countSuspendedAccounts,
  getAccountStatus,
  isAccountSuspended,
} from "@/lib/admin/account-status";

beforeEach(() => {
  db.state.rows = [];
  db.state.fail = false;
  db.state.calls.length = 0;
});

describe("getAccountStatus", () => {
  it("treats an account with no row as active", async () => {
    db.state.rows = [];
    expect(await getAccountStatus("usr_1")).toEqual(ACTIVE_STATUS);
  });

  it("returns the suspension record when one exists", async () => {
    db.state.rows = [
      {
        status: "suspended",
        reason: "chargeback",
        suspended_at: "2026-11-01T00:00:00Z",
        suspended_by: "operator",
        reactivated_at: null,
        reactivated_by: null,
        updated_at: "2026-11-01T00:00:00Z",
      },
    ];

    const record = await getAccountStatus("usr_1");
    expect(record.status).toBe("suspended");
    expect(record.reason).toBe("chargeback");
    expect(record.suspended_by).toBe("operator");
  });

  it("maps an unrecognised status to active rather than inventing a third state", async () => {
    db.state.rows = [{ status: "banished", reason: null, suspended_at: null, suspended_by: null, reactivated_at: null, reactivated_by: null, updated_at: null }];
    expect((await getAccountStatus("usr_1")).status).toBe("active");
  });

  it("does not lock every member out when the table cannot be read", async () => {
    // A read failure is a policy-gate failure, not an authentication failure.
    // Treating it as "suspended" would deny the whole customer base because one
    // query failed.
    db.state.fail = true;
    expect(await getAccountStatus("usr_1")).toEqual(ACTIVE_STATUS);
  });

  it("does not query for an empty id", async () => {
    await getAccountStatus("");
    expect(db.state.calls).toHaveLength(0);
  });
});

describe("isAccountSuspended", () => {
  it("is false for a null or undefined id", async () => {
    expect(await isAccountSuspended(null)).toBe(false);
    expect(await isAccountSuspended(undefined)).toBe(false);
    expect(db.state.calls).toHaveLength(0);
  });

  it("is true only for a suspended row", async () => {
    db.state.rows = [{ status: "suspended", reason: null, suspended_at: null, suspended_by: null, reactivated_at: null, reactivated_by: null, updated_at: null }];
    expect(await isAccountSuspended("usr_1")).toBe(true);
  });
});

describe("countSuspendedAccounts", () => {
  it("returns the count", async () => {
    db.state.rows = [{ total: 3 }];
    expect(await countSuspendedAccounts()).toBe(3);
  });

  it("returns zero when the query fails", async () => {
    db.state.fail = true;
    expect(await countSuspendedAccounts()).toBe(0);
  });
});
