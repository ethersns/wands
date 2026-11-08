// @vitest-environment node

import { describe, expect, it } from "vitest";

import { DEFAULT_RETURN_TO, safeReturnTo } from "@/lib/admin/action-state";

/**
 * The return path arrives in a form field, so it is attacker-controlled. These
 * tests pin the boundary: a control-centre path is honoured, anything that
 * could leave the site falls back to the member directory.
 */
describe("safeReturnTo", () => {
  it("keeps a control-centre path", () => {
    expect(safeReturnTo("/dashboard/members")).toBe("/dashboard/members");
    expect(safeReturnTo("/dashboard/members/suspended")).toBe("/dashboard/members/suspended");
    expect(safeReturnTo("/dashboard/members/abc123")).toBe("/dashboard/members/abc123");
    expect(safeReturnTo("/dashboard")).toBe("/dashboard");
  });

  it("trims surrounding whitespace", () => {
    expect(safeReturnTo("  /dashboard/members  ")).toBe("/dashboard/members");
  });

  it("falls back when the value is missing or not a string", () => {
    expect(safeReturnTo(null)).toBe(DEFAULT_RETURN_TO);
    expect(safeReturnTo(undefined)).toBe(DEFAULT_RETURN_TO);
    expect(safeReturnTo("")).toBe(DEFAULT_RETURN_TO);
    expect(safeReturnTo("   ")).toBe(DEFAULT_RETURN_TO);
  });

  it("refuses anything that could leave the site", () => {
    expect(safeReturnTo("https://evil.example/dashboard")).toBe(DEFAULT_RETURN_TO);
    expect(safeReturnTo("//evil.example/dashboard")).toBe(DEFAULT_RETURN_TO);
    expect(safeReturnTo("/\\evil.example")).toBe(DEFAULT_RETURN_TO);
    expect(safeReturnTo("/dashboard/../../etc/passwd")).toBe(DEFAULT_RETURN_TO);
    expect(safeReturnTo("/dashboard/members?x=1")).toBe(DEFAULT_RETURN_TO);
    expect(safeReturnTo("/dashboard/members#frag")).toBe(DEFAULT_RETURN_TO);
    expect(safeReturnTo("/app")).toBe(DEFAULT_RETURN_TO);
    expect(safeReturnTo("javascript:alert(1)")).toBe(DEFAULT_RETURN_TO);
  });
});
