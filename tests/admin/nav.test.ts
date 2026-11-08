// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  allNavItems,
  isNavItemActive,
  navGroups,
  navItemFor,
} from "@/components/shell/nav-items";

describe("navigation groups", () => {
  it("exposes the four control-centre sections", () => {
    expect(navGroups.map((group) => group.label)).toEqual([
      "Business",
      "Research",
      "Trading operations",
      "Administration",
    ]);
  });

  it("keeps every existing operator route reachable", () => {
    const hrefs = allNavItems.map((item) => item.href);
    for (const href of [
      "/portfolio",
      "/markets",
      "/bots",
      "/orders",
      "/risk",
      "/connections",
      "/intelligence",
      "/strategy-lab",
      "/research",
      "/settings",
    ]) {
      expect(hrefs, href).toContain(href);
    }
  });

  it("links every business section", () => {
    const hrefs = allNavItems.map((item) => item.href);
    for (const href of [
      "/dashboard",
      "/dashboard/members",
      "/dashboard/waitlist",
      "/dashboard/traffic",
      "/dashboard/activity",
      "/dashboard/system",
    ]) {
      expect(hrefs, href).toContain(href);
    }
  });

  it("has no duplicate destinations", () => {
    const hrefs = allNavItems.map((item) => item.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

describe("active state", () => {
  const overview = allNavItems.find((item) => item.href === "/dashboard")!;
  const members = allNavItems.find((item) => item.href === "/dashboard/members")!;

  it("highlights the overview only on its exact path", () => {
    expect(isNavItemActive(overview, "/dashboard")).toBe(true);
    expect(isNavItemActive(overview, "/dashboard/members")).toBe(false);
    expect(isNavItemActive(overview, "/dashboard/waitlist")).toBe(false);
  });

  it("keeps a section highlighted on its detail pages", () => {
    expect(isNavItemActive(members, "/dashboard/members")).toBe(true);
    expect(isNavItemActive(members, "/dashboard/members/abc-123")).toBe(true);
    expect(isNavItemActive(members, "/dashboard/waitlist")).toBe(false);
  });

  it("does not match a sibling that merely shares a prefix", () => {
    const traffic = allNavItems.find((item) => item.href === "/dashboard/traffic")!;
    expect(isNavItemActive(traffic, "/dashboard/traffic-report")).toBe(false);
  });
});

describe("navItemFor", () => {
  it("picks the most specific match", () => {
    expect(navItemFor("/dashboard/members/abc-123")?.href).toBe("/dashboard/members");
    expect(navItemFor("/dashboard")?.href).toBe("/dashboard");
    expect(navItemFor("/dashboard/system")?.href).toBe("/dashboard/system");
  });

  it("returns undefined for an unlisted path", () => {
    expect(navItemFor("/pricing")).toBeUndefined();
  });
});
