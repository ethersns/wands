// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  categorizeReferrer,
  normalizePath,
  visitorDigest,
} from "@/lib/analytics/track";

describe("normalizePath", () => {
  it("keeps public marketing paths", () => {
    expect(normalizePath("/")).toBe("/");
    expect(normalizePath("/pricing")).toBe("/pricing");
    expect(normalizePath("/features")).toBe("/features");
    expect(normalizePath("/about")).toBe("/about");
  });

  it("collapses a trailing slash so one page is one row", () => {
    expect(normalizePath("/pricing/")).toBe("/pricing");
    expect(normalizePath("/pricing///")).toBe("/pricing");
  });

  it("drops the query string", () => {
    expect(normalizePath("/pricing?utm_source=x")).toBe("/pricing");
  });

  it("refuses every private surface", () => {
    for (const path of [
      "/dashboard",
      "/dashboard/members",
      "/dashboard/waitlist",
      "/app",
      "/app/quant-lab",
      "/app/opportunity",
      "/login",
      "/signin",
      "/onboarding",
      "/portfolio",
      "/markets",
      "/bots",
      "/orders",
      "/intelligence",
      "/strategy-lab",
      "/research",
      "/risk",
      "/connections",
      "/settings",
      "/account",
      "/billing",
      "/api/track",
      "/api/admin/waitlist/export",
      "/_next/static/chunk.js",
    ]) {
      expect(normalizePath(path), path).toBeNull();
    }
  });

  it("is case-insensitive about private prefixes", () => {
    expect(normalizePath("/Dashboard/Members")).toBeNull();
    expect(normalizePath("/APP")).toBeNull();
  });

  it("rejects junk", () => {
    expect(normalizePath(null)).toBeNull();
    expect(normalizePath(undefined)).toBeNull();
    expect(normalizePath("")).toBeNull();
  });

  it("caps an absurdly long path", () => {
    const long = `/${"a".repeat(500)}`;
    expect(normalizePath(long)?.length).toBe(200);
  });
});

describe("categorizeReferrer", () => {
  it("treats a missing referrer as direct", () => {
    expect(categorizeReferrer(null, "wands.trade")).toEqual({
      host: null,
      category: "direct",
    });
    expect(categorizeReferrer("not a url", "wands.trade").category).toBe("direct");
  });

  it("recognises internal navigation", () => {
    expect(categorizeReferrer("https://wands.trade/pricing", "wands.trade").category).toBe(
      "internal",
    );
    expect(categorizeReferrer("https://www.wands.trade/", "wands.trade").category).toBe(
      "internal",
    );
  });

  it("recognises search engines", () => {
    expect(categorizeReferrer("https://www.google.com/search?q=wands", "wands.trade").category).toBe(
      "search",
    );
    expect(categorizeReferrer("https://duckduckgo.com/", "wands.trade").category).toBe("search");
  });

  it("recognises social networks", () => {
    expect(categorizeReferrer("https://x.com/someone", "wands.trade").category).toBe("social");
    expect(categorizeReferrer("https://www.linkedin.com/feed", "wands.trade").category).toBe(
      "social",
    );
  });

  it("falls back to referral", () => {
    expect(categorizeReferrer("https://example.com/post", "wands.trade").category).toBe(
      "referral",
    );
  });

  it("does not treat a lookalike host as internal", () => {
    expect(categorizeReferrer("https://notwands.trade/", "wands.trade").category).toBe(
      "referral",
    );
  });
});

describe("visitorDigest", () => {
  const secret = "test-secret";

  it("is stable within a day", async () => {
    const a = await visitorDigest("1.2.3.4", "agent", "2026-11-08", secret);
    const b = await visitorDigest("1.2.3.4", "agent", "2026-11-08", secret);
    expect(a).toBe(b);
  });

  it("rotates across days, so a visitor cannot be followed", async () => {
    const today = await visitorDigest("1.2.3.4", "agent", "2026-11-08", secret);
    const tomorrow = await visitorDigest("1.2.3.4", "agent", "2026-11-09", secret);
    expect(today).not.toBe(tomorrow);
  });

  it("separates different visitors on the same day", async () => {
    const a = await visitorDigest("1.2.3.4", "agent", "2026-11-08", secret);
    const b = await visitorDigest("5.6.7.8", "agent", "2026-11-08", secret);
    expect(a).not.toBe(b);
  });

  it("changes with the secret", async () => {
    const a = await visitorDigest("1.2.3.4", "agent", "2026-11-08", secret);
    const b = await visitorDigest("1.2.3.4", "agent", "2026-11-08", "other-secret");
    expect(a).not.toBe(b);
  });

  it("is a truncated digest, not an address", async () => {
    const digest = await visitorDigest("1.2.3.4", "agent", "2026-11-08", secret);
    expect(digest).toHaveLength(32);
    expect(digest).toMatch(/^[0-9a-f]+$/);
    expect(digest).not.toContain("1.2.3.4");
  });
});
