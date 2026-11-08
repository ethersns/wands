// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The guard is tested on its own in `guard.test.ts`. This file tests the
 * wiring: that every admin export and every member-management action actually
 * calls it before it reads or writes anything.
 *
 * That distinction matters. A correct guard that a route forgets to call is
 * indistinguishable from no guard at all, and the failure is silent — the
 * endpoint simply works for anyone. These tests fail loudly if a future edit
 * drops the call.
 */

const { cookieStore, dbCalls, dbRows } = vi.hoisted(() => ({
  cookieStore: { get: vi.fn() },
  dbCalls: [] as { sql: string; values: unknown[] }[],
  dbRows: [] as { match: RegExp; rows: unknown[] }[],
}));

vi.mock("next/headers", () => ({ cookies: async () => cookieStore }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/db", () => {
  const run = async (sql: string, values: unknown[] = []) => {
    dbCalls.push({ sql, values });
    for (const handler of dbRows) {
      if (handler.match.test(sql)) return handler.rows;
    }
    return [];
  };

  return {
    isDatabaseConfigured: () => true,
    query: run,
    withTransaction: async (fn: (tx: typeof run) => Promise<unknown>) => fn(run),
  };
});

import { GET as exportMembers } from "@/app/api/admin/members/export/route";
import { GET as exportWaitlist } from "@/app/api/admin/waitlist/export/route";
import {
  deleteMemberAction,
  deleteWaitlistEntryAction,
  reactivateMemberAction,
  suspendMemberAction,
} from "@/lib/admin/actions";
import { SESSION_COOKIE, createSessionToken } from "@/lib/auth/session";

const USERNAME = "operator";
const PASSWORD = "correct horse battery staple";
const SECRET = "test-session-secret";

function configureGate() {
  process.env.WANDS_OPERATOR_USERNAME = USERNAME;
  process.env.WANDS_OPERATOR_PASSWORD = PASSWORD;
  process.env.WANDS_SESSION_SECRET = SECRET;
}

function unconfigureGate() {
  delete process.env.WANDS_OPERATOR_USERNAME;
  delete process.env.WANDS_OPERATOR_PASSWORD;
  delete process.env.WANDS_SESSION_SECRET;
}

function formData(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

beforeEach(() => {
  configureGate();
  cookieStore.get.mockReset();
  cookieStore.get.mockReturnValue(undefined);
  dbCalls.length = 0;
  dbRows.length = 0;
});

afterEach(() => {
  unconfigureGate();
  vi.unstubAllEnvs();
});

describe("admin exports require an operator session", () => {
  it("refuses the member export without a session and reads nothing", async () => {
    const response = await exportMembers(
      new Request("https://wands.test/api/admin/members/export"),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: "unauthorized" },
    });
    expect(dbCalls).toHaveLength(0);
  });

  it("refuses the waitlist export without a session and reads nothing", async () => {
    const response = await exportWaitlist(
      new Request("https://wands.test/api/admin/waitlist/export"),
    );

    expect(response.status).toBe(401);
    expect(dbCalls).toHaveLength(0);
  });

  it("fails closed with 503 when the gate is not configured", async () => {
    unconfigureGate();

    const response = await exportMembers(
      new Request("https://wands.test/api/admin/members/export"),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "operator_gate_unconfigured" },
    });
    expect(dbCalls).toHaveLength(0);
  });
});

describe("member-management actions require an operator session", () => {
  const cases = [
    {
      name: "suspend",
      run: () =>
        suspendMemberAction(null, formData({ userId: "usr_1", reason: "chargeback" })),
    },
    {
      name: "reactivate",
      run: () => reactivateMemberAction(null, formData({ userId: "usr_1", reason: "" })),
    },
    {
      name: "delete",
      run: () =>
        deleteMemberAction(
          null,
          formData({ userId: "usr_1", confirmEmail: "member@example.com" }),
        ),
    },
    {
      name: "waitlist delete",
      run: () =>
        deleteWaitlistEntryAction(
          null,
          formData({ id: "3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b" }),
        ),
    },
  ];

  for (const testCase of cases) {
    it(`refuses ${testCase.name} without a session and writes nothing`, async () => {
      const state = await testCase.run();

      expect(state.ok).toBe(false);
      expect(state.message).toContain("operator session");
      expect(dbCalls).toHaveLength(0);
    });
  }

  it("refuses every action when the gate is not configured", async () => {
    unconfigureGate();

    for (const testCase of cases) {
      const state = await testCase.run();
      expect(state.ok).toBe(false);
      expect(state.message).toContain("not configured");
    }

    expect(dbCalls).toHaveLength(0);
  });
});

describe("reactivation reports its outcome where the row cannot", () => {
  async function signIn() {
    const token = await createSessionToken();
    cookieStore.get.mockImplementation((name: string) =>
      name === SESSION_COOKIE ? { value: token } : undefined,
    );
  }

  it("redirects back to the suspended list with the address in the URL", async () => {
    await signIn();
    dbRows.push(
      { match: /from "user" where id = \$1 for update/, rows: [{ id: "usr_1", email: "member@example.com" }] },
      { match: /select status from member_account_status/, rows: [{ status: "suspended" }] },
    );

    // The redirect is thrown by the mocked `next/navigation`, which is how the
    // real one behaves: it aborts the action and hands the URL to the router.
    await expect(
      reactivateMemberAction(
        null,
        formData({ userId: "usr_1", reason: "", returnTo: "/dashboard/members/suspended" }),
      ),
    ).rejects.toThrow(
      "REDIRECT:/dashboard/members/suspended?reactivated=member%40example.com",
    );
  });

  it("ignores a return path that would leave the control centre", async () => {
    await signIn();
    dbRows.push(
      { match: /from "user" where id = \$1 for update/, rows: [{ id: "usr_1", email: "member@example.com" }] },
      { match: /select status from member_account_status/, rows: [{ status: "suspended" }] },
    );

    await expect(
      reactivateMemberAction(
        null,
        formData({ userId: "usr_1", reason: "", returnTo: "https://evil.example/steal" }),
      ),
    ).rejects.toThrow("REDIRECT:/dashboard/members?reactivated=member%40example.com");
  });

  it("returns the refusal in the dialog when the account is already active", async () => {
    await signIn();
    dbRows.push({
      match: /from "user" where id = \$1 for update/,
      rows: [{ id: "usr_1", email: "member@example.com" }],
    });

    const state = await reactivateMemberAction(
      null,
      formData({ userId: "usr_1", reason: "", returnTo: "/dashboard/members/suspended" }),
    );

    expect(state.ok).toBe(true);
    expect(state.message).toContain("already active");
  });
});
