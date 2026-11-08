// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clientIpFromHeaders,
  hashEmail,
  userAgentFromHeaders,
} from "@/lib/member/request-context";

function headers(init: Record<string, string>): Headers {
  return new Headers(init);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("clientIpFromHeaders", () => {
  it("reads the address the hosting edge wrote", () => {
    expect(clientIpFromHeaders(headers({ "x-vercel-forwarded-for": "203.0.113.7" }))).toBe(
      "203.0.113.7",
    );
    expect(clientIpFromHeaders(headers({ "x-real-ip": "198.51.100.4" }))).toBe("198.51.100.4");
    expect(clientIpFromHeaders(headers({ "cf-connecting-ip": "192.0.2.9" }))).toBe("192.0.2.9");
  });

  it("ignores a client-supplied x-forwarded-for by default", () => {
    // The whole point: any caller can send this header, so it is not evidence.
    expect(clientIpFromHeaders(headers({ "x-forwarded-for": "1.2.3.4" }))).toBeNull();
  });

  it("honours x-forwarded-for only when the deployment opts in", () => {
    vi.stubEnv("WANDS_TRUST_PROXY_HEADERS", "true");
    expect(clientIpFromHeaders(headers({ "x-forwarded-for": "1.2.3.4" }))).toBe("1.2.3.4");
  });

  it("prefers the edge header over a spoofed forwarded header", () => {
    vi.stubEnv("WANDS_TRUST_PROXY_HEADERS", "true");
    const value = clientIpFromHeaders(
      headers({ "x-vercel-forwarded-for": "203.0.113.7", "x-forwarded-for": "1.2.3.4" }),
    );
    expect(value).toBe("203.0.113.7");
  });

  it("takes the leftmost entry of a forwarded list", () => {
    expect(
      clientIpFromHeaders(headers({ "x-vercel-forwarded-for": "203.0.113.7, 10.0.0.1" })),
    ).toBe("203.0.113.7");
  });

  it("unwraps an IPv4-mapped IPv6 address so one client is not two", () => {
    expect(clientIpFromHeaders(headers({ "x-real-ip": "::ffff:203.0.113.7" }))).toBe(
      "203.0.113.7",
    );
  });

  it("strips a port suffix", () => {
    expect(clientIpFromHeaders(headers({ "x-real-ip": "203.0.113.7:51234" }))).toBe(
      "203.0.113.7",
    );
    expect(clientIpFromHeaders(headers({ "x-real-ip": "[2001:db8::1]:443" }))).toBe(
      "2001:db8::1",
    );
  });

  it("rejects a value that is not an address", () => {
    expect(clientIpFromHeaders(headers({ "x-real-ip": "not-an-ip" }))).toBeNull();
    expect(clientIpFromHeaders(headers({ "x-real-ip": "999.1.1.1" }))).toBeNull();
    expect(clientIpFromHeaders(headers({ "x-real-ip": "" }))).toBeNull();
  });

  it("returns null when no trusted header is present", () => {
    expect(clientIpFromHeaders(headers({}))).toBeNull();
  });
});

describe("userAgentFromHeaders", () => {
  it("truncates a long user agent", () => {
    const value = userAgentFromHeaders(headers({ "user-agent": "a".repeat(1000) }));
    expect(value).toHaveLength(256);
  });

  it("returns null for an absent user agent", () => {
    expect(userAgentFromHeaders(headers({}))).toBeNull();
  });
});

describe("hashEmail", () => {
  it("is stable for the same address regardless of case or padding", () => {
    vi.stubEnv("WANDS_SESSION_SECRET", "test-secret");
    expect(hashEmail("  Member@Example.com ")).toBe(hashEmail("member@example.com"));
  });

  it("never contains the address it hashes", () => {
    vi.stubEnv("WANDS_SESSION_SECRET", "test-secret");
    const digest = hashEmail("member@example.com");
    expect(digest).not.toBeNull();
    expect(digest).not.toContain("member");
    expect(digest).not.toContain("example");
  });

  it("changes when the deployment secret changes, so it is not portable", () => {
    vi.stubEnv("WANDS_SESSION_SECRET", "secret-one");
    const first = hashEmail("member@example.com");

    vi.stubEnv("WANDS_SESSION_SECRET", "secret-two");
    const second = hashEmail("member@example.com");

    expect(first).not.toBe(second);
  });

  it("returns null without a secret rather than an unsalted digest", () => {
    vi.stubEnv("WANDS_SESSION_SECRET", "");
    vi.stubEnv("BETTER_AUTH_SECRET", "");
    expect(hashEmail("member@example.com")).toBeNull();
  });

  it("returns null for a blank address", () => {
    vi.stubEnv("WANDS_SESSION_SECRET", "test-secret");
    expect(hashEmail("   ")).toBeNull();
  });
});
