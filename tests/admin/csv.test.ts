// @vitest-environment node

import { describe, expect, it } from "vitest";

import { csvCell, toCsv, type WaitlistRow } from "@/lib/admin/waitlist";

function row(overrides: Partial<WaitlistRow> = {}): WaitlistRow {
  return {
    id: "1",
    email: "member@example.com",
    role: "trader",
    source: "landing",
    referrer: "https://wands.trade/",
    status: "new",
    created_at: "2026-11-01T10:00:00Z",
    updated_at: "2026-11-01T10:00:00Z",
    member_id: null,
    ...overrides,
  };
}

describe("csvCell", () => {
  it("quotes every value", () => {
    expect(csvCell("plain")).toBe('"plain"');
  });

  it("neutralises formula-leading characters", () => {
    expect(csvCell("=1+1")).toBe(`"'=1+1"`);
    expect(csvCell("+44 7700 900000")).toBe(`"'+44 7700 900000"`);
    expect(csvCell("-2")).toBe(`"'-2"`);
    expect(csvCell("@SUM(A1)")).toBe(`"'@SUM(A1)"`);
    expect(csvCell("\tcmd")).toBe(`"'\tcmd"`);
    expect(csvCell("\rcmd")).toBe(`"'\rcmd"`);
  });

  it("does not mangle a value that merely contains a formula character", () => {
    expect(csvCell("a=b")).toBe('"a=b"');
    expect(csvCell("name@example.com")).toBe('"name@example.com"');
  });

  it("doubles internal quotes", () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it("renders null and undefined as empty", () => {
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
  });

  it("renders a Date as ISO-8601, not a locale string", () => {
    expect(csvCell(new Date("2026-11-08T03:31:23Z"))).toBe('"2026-11-08T03:31:23.000Z"');
  });
});

describe("toCsv", () => {
  it("writes a header and one line per row", () => {
    const csv = toCsv([row(), row({ id: "2", email: "second@example.com" })]);
    const lines = csv.split("\r\n");

    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('"email"');
    expect(lines[0]).toContain('"signed_up_at"');
    expect(lines[1]).toContain('"member@example.com"');
    expect(lines[2]).toContain('"second@example.com"');
  });

  it("keeps a comma inside a field from shifting columns", () => {
    const csv = toCsv([row({ email: "a,b@example.com" })]);
    const dataLine = csv.split("\r\n")[1];
    expect(dataLine).toContain('"a,b@example.com"');
    // Eight columns, so seven separators outside the quoted fields.
    expect(dataLine.split('","')).toHaveLength(8);
  });

  it("records whether the address also belongs to a registered account", () => {
    const csv = toCsv([row({ member_id: "usr_123" }), row({ id: "2", member_id: null })]);
    const lines = csv.split("\r\n");

    expect(lines[0]).toContain('"registered_member"');
    expect(lines[1].endsWith('"yes"')).toBe(true);
    expect(lines[2].endsWith('"no"')).toBe(true);
  });

  it("neutralises a formula in an email field", () => {
    const csv = toCsv([row({ email: "=HYPERLINK(\"http://evil\")" })]);
    expect(csv).toContain(`"'=HYPERLINK`);
  });

  it("produces a header-only file for an empty result", () => {
    const csv = toCsv([]);
    expect(csv.split("\r\n")).toHaveLength(1);
  });
});
