// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  SESSION_TTL_SECONDS,
  checkPassword,
  createSessionToken,
  gateConfigured,
  verifySessionToken,
} from "@/lib/auth/session";

const PASSWORD = "correct horse battery staple";
const SECRET = "test-session-secret";

beforeEach(() => {
  process.env.WANDS_OPERATOR_PASSWORD = PASSWORD;
  process.env.WANDS_SESSION_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.WANDS_OPERATOR_PASSWORD;
  delete process.env.WANDS_SESSION_SECRET;
});

describe("gate configuration", () => {
  it("is unconfigured when the password is missing", () => {
    delete process.env.WANDS_OPERATOR_PASSWORD;
    expect(gateConfigured()).toBe(false);
  });

  it("is unconfigured when the secret is missing", () => {
    delete process.env.WANDS_SESSION_SECRET;
    expect(gateConfigured()).toBe(false);
  });

  it("is configured when both are present", () => {
    expect(gateConfigured()).toBe(true);
  });
});

describe("session tokens", () => {
  it("round-trips a freshly issued token", async () => {
    const token = await createSessionToken();
    expect(token).not.toBeNull();
    expect(await verifySessionToken(token ?? undefined)).toBe(true);
  });

  it("refuses to issue a token without a secret", async () => {
    delete process.env.WANDS_SESSION_SECRET;
    expect(await createSessionToken()).toBeNull();
  });

  it("rejects a missing token", async () => {
    expect(await verifySessionToken(undefined)).toBe(false);
  });

  it("rejects a token past its expiry", async () => {
    const issuedAt = Date.now();
    const token = await createSessionToken(issuedAt);
    const afterExpiry = issuedAt + (SESSION_TTL_SECONDS + 1) * 1000;
    expect(await verifySessionToken(token ?? undefined, afterExpiry)).toBe(false);
  });

  it("rejects a token whose signature was altered", async () => {
    const token = (await createSessionToken()) ?? "";
    const [version, expiry, signature] = token.split(".");
    const flipped = signature.slice(0, -1) + (signature.endsWith("A") ? "B" : "A");
    expect(await verifySessionToken(`${version}.${expiry}.${flipped}`)).toBe(false);
  });

  it("rejects a token whose expiry was extended", async () => {
    const token = (await createSessionToken()) ?? "";
    const [version, expiry, signature] = token.split(".");
    const extended = Number(expiry) + 86_400;
    expect(await verifySessionToken(`${version}.${extended}.${signature}`)).toBe(false);
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await createSessionToken();
    process.env.WANDS_SESSION_SECRET = "a-different-secret";
    expect(await verifySessionToken(token ?? undefined)).toBe(false);
  });

  it("rejects a malformed token", async () => {
    expect(await verifySessionToken("not-a-token")).toBe(false);
  });
});

describe("password check", () => {
  it("accepts the configured password", async () => {
    expect(await checkPassword(PASSWORD)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    expect(await checkPassword("wrong")).toBe(false);
  });

  it("rejects an empty password", async () => {
    expect(await checkPassword("")).toBe(false);
  });

  it("rejects everything when the gate is unconfigured", async () => {
    delete process.env.WANDS_OPERATOR_PASSWORD;
    expect(await checkPassword("")).toBe(false);
  });
});
