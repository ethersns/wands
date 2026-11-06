// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { OPERATOR_PREFIXES, routeTier } from "@/lib/auth/routes";

// next/font resolves at build time; the metadata is what is under test.
vi.mock("next/font/google", () => {
  const font = () => ({ variable: "--font-mock", className: "font-mock" });
  return {
    Geist: font,
    Geist_Mono: font,
    IBM_Plex_Mono: font,
    IBM_Plex_Sans: font,
    Instrument_Sans: font,
  };
});

// The console layout pulls in the shell and the engine client. Only its
// metadata is under test here.
vi.mock("@/components/shell/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/lib/api/endpoints", () => ({
  getEngineStatus: async () => ({ data: null, error: null }),
  getMarkets: async () => ({ data: null, error: null }),
}));

function paths(entries: { url: string }[]): string[] {
  return entries.map((entry) => new URL(entry.url).pathname);
}

describe("robots", () => {
  const policy = robots();
  const rules = Array.isArray(policy.rules) ? policy.rules : [policy.rules];
  const disallow = rules.flatMap((rule) => {
    const value = rule.disallow;
    return Array.isArray(value) ? value : value ? [value] : [];
  });

  it("allows the public site to be crawled", () => {
    for (const rule of rules) {
      const allow = rule.allow;
      expect(Array.isArray(allow) ? allow : [allow]).toContain("/");
    }
  });

  it("keeps every console route out of the index", () => {
    for (const prefix of OPERATOR_PREFIXES) {
      expect(disallow, `robots is missing ${prefix}`).toContain(prefix);
    }
  });

  it("keeps the sign-in form and the API out of the index", () => {
    expect(disallow).toContain("/login");
    expect(disallow).toContain("/api/");
  });

  it("advertises the sitemap", () => {
    expect(policy.sitemap).toMatch(/\/sitemap\.xml$/);
  });
});

describe("sitemap", () => {
  const entries = paths(sitemap());

  it("lists the marketing homepage and the commercial pages", () => {
    for (const path of [
      "/",
      "/features",
      "/pricing",
      "/about",
      "/contact",
      "/security",
      "/privacy",
      "/terms",
      "/risk-disclosure",
    ]) {
      expect(entries, `sitemap is missing ${path}`).toContain(path);
    }
  });

  it("lists every feature detail page", () => {
    expect(entries).toContain("/features/insider-radar");
    expect(entries).toContain("/features/institutional-radar");
    expect(entries).toContain("/features/strategy-lab");
  });

  it("never lists a route the gate protects", () => {
    for (const path of entries) {
      expect(routeTier(path), path).toBe("public");
    }
    expect(entries, "login must not be listed").not.toContain("/login");
  });
});

describe("per-surface metadata", () => {
  it("lets the public marketing site be indexed", async () => {
    const { metadata } = await import("@/app/layout");
    expect(metadata.robots).toMatchObject({ index: true, follow: true });
    expect(metadata.alternates?.canonical).toBe("/");
  });

  it("keeps the console out of the index", async () => {
    const { metadata } = await import("@/app/(app)/layout");
    expect(metadata.robots).toMatchObject({ index: false, follow: false });
  });

  it("keeps the sign-in form out of the index", async () => {
    const { metadata } = await import("@/app/login/layout");
    expect(metadata.robots).toMatchObject({ index: false, follow: false });
  });
});
