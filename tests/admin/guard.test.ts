// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cookieStore, redirectMock } = vi.hoisted(() => ({
  cookieStore: { get: vi.fn() },
  redirectMock: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("next/headers", () => ({ cookies: async () => cookieStore }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

import {
  authorizeOperatorRequest,
  checkOperator,
  requireOperator,
} from "@/lib/admin/guard";
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

beforeEach(() => {
  configureGate();
  cookieStore.get.mockReset();
  redirectMock.mockClear();
});

afterEach(() => {
  unconfigureGate();
  vi.unstubAllEnvs();
});

describe("checkOperator", () => {
  it("rejects a request with no session", async () => {
    cookieStore.get.mockReturnValue(undefined);
    const result = await checkOperator();
    expect(result).toEqual({ ok: false, reason: "unauthenticated" });
  });

  it("accepts a valid operator session", async () => {
    const token = await createSessionToken();
    cookieStore.get.mockReturnValue({ value: token });

    const result = await checkOperator();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.identity.actor).toBe(USERNAME);
  });

  it("rejects a forged session cookie", async () => {
    cookieStore.get.mockReturnValue({ value: "v1.9999999999.forged" });
    expect(await checkOperator()).toEqual({ ok: false, reason: "unauthenticated" });
  });

  it("rejects a session signed with a rotated secret", async () => {
    const token = await createSessionToken();
    process.env.WANDS_SESSION_SECRET = "rotated-secret";
    cookieStore.get.mockReturnValue({ value: token });

    expect(await checkOperator()).toEqual({ ok: false, reason: "unauthenticated" });
  });

  it("rejects an expired session", async () => {
    const token = await createSessionToken(Date.now() - 9 * 60 * 60 * 1000);
    cookieStore.get.mockReturnValue({ value: token });

    expect(await checkOperator()).toEqual({ ok: false, reason: "unauthenticated" });
  });

  it("does not accept a member session as an operator session", async () => {
    // A signed-in customer carries `wands.session_token`, not the operator
    // cookie. The guard only ever reads the operator cookie, so a member
    // session cannot satisfy it.
    cookieStore.get.mockImplementation((name: string) =>
      name === SESSION_COOKIE ? undefined : { value: "member-session-token" },
    );

    expect(await checkOperator()).toEqual({ ok: false, reason: "unauthenticated" });
  });

  it("fails closed in production when the gate is unconfigured", async () => {
    unconfigureGate();
    vi.stubEnv("NODE_ENV", "production");
    cookieStore.get.mockReturnValue(undefined);

    expect(await checkOperator()).toEqual({ ok: false, reason: "unconfigured" });
  });

  it("stays open in development when the gate is unconfigured", async () => {
    unconfigureGate();
    vi.stubEnv("NODE_ENV", "development");
    cookieStore.get.mockReturnValue(undefined);

    const result = await checkOperator();
    expect(result.ok).toBe(true);
  });
});

describe("requireOperator", () => {
  it("redirects an unauthenticated visitor to the operator sign-in", async () => {
    cookieStore.get.mockReturnValue(undefined);

    await expect(requireOperator("/dashboard/members")).rejects.toThrow(
      "REDIRECT:/login?next=%2Fdashboard%2Fmembers",
    );
  });

  it("returns the identity for a valid session", async () => {
    const token = await createSessionToken();
    cookieStore.get.mockReturnValue({ value: token });

    await expect(requireOperator("/dashboard")).resolves.toEqual({ actor: USERNAME });
  });
});

describe("authorizeOperatorRequest", () => {
  it("answers 401 for an unauthenticated API call", async () => {
    cookieStore.get.mockReturnValue(undefined);

    const result = await authorizeOperatorRequest();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.denial.status).toBe(401);
      expect(result.denial.code).toBe("unauthorized");
    }
  });

  it("answers 503 when the gate is unconfigured in production", async () => {
    unconfigureGate();
    vi.stubEnv("NODE_ENV", "production");
    cookieStore.get.mockReturnValue(undefined);

    const result = await authorizeOperatorRequest();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.denial.status).toBe(503);
      expect(result.denial.code).toBe("operator_gate_unconfigured");
    }
  });

  it("allows a valid operator session", async () => {
    const token = await createSessionToken();
    cookieStore.get.mockReturnValue({ value: token });

    const result = await authorizeOperatorRequest();
    expect(result.ok).toBe(true);
  });

  it("never leaks the configured password in a denial", async () => {
    cookieStore.get.mockReturnValue(undefined);

    const result = await authorizeOperatorRequest();
    expect(JSON.stringify(result)).not.toContain(PASSWORD);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });
});
