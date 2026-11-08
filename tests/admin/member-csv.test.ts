// @vitest-environment node

import { describe, expect, it } from "vitest";

import { toMemberCsv, type MemberRow } from "@/lib/admin/members";

function row(overrides: Partial<MemberRow> = {}): MemberRow {
  return {
    id: "usr_1",
    email: "member@example.com",
    name: "Member One",
    display_name: "M1",
    email_verified: true,
    created_at: "2026-11-01T10:00:00Z",
    plan: "early_access",
    status: "active",
    onboarding_completed: true,
    watchlist_count: 2,
    saved_count: 5,
    last_login_at: "2026-11-07T09:00:00Z",
    account_status: "active",
    suspended_at: null,
    ...overrides,
  };
}

describe("toMemberCsv", () => {
  it("writes the documented columns in order", () => {
    const header = toMemberCsv([]).split("\r\n")[0];
    const columns = header.split('","').map((cell) => cell.replace(/"/g, ""));

    expect(columns).toEqual([
      "account_id",
      "email",
      "name",
      "display_name",
      "registered_at",
      "email_verified",
      "plan",
      "membership_status",
      "account_status",
      "suspended_at",
      "onboarding_completed",
      "watchlists",
      "saved_items",
      "last_sign_in",
    ]);
  });

  it("never emits a credential column", () => {
    const header = toMemberCsv([row()]).split("\r\n")[0].toLowerCase();

    expect(header).not.toContain("password");
    expect(header).not.toContain("token");
    expect(header).not.toContain("secret");
    expect(header).not.toContain("hash");
  });

  it("renders booleans as yes/no rather than true/false", () => {
    const line = toMemberCsv([row({ email_verified: false, onboarding_completed: false })])
      .split("\r\n")[1];

    expect(line).toContain('"no"');
    expect(line).not.toContain('"false"');
  });

  it("carries the account status and suspension date", () => {
    const line = toMemberCsv([
      row({ account_status: "suspended", suspended_at: "2026-11-05T12:00:00Z" }),
    ]).split("\r\n")[1];

    expect(line).toContain('"suspended"');
    expect(line).toContain('"2026-11-05T12:00:00Z"');
  });

  it("neutralises a formula in a display name", () => {
    const csv = toMemberCsv([row({ display_name: "=HYPERLINK(\"http://evil\")" })]);
    expect(csv).toContain(`"'=HYPERLINK`);
  });

  it("keeps a comma inside a field from shifting columns", () => {
    const line = toMemberCsv([row({ name: "One, Member" })]).split("\r\n")[1];
    expect(line).toContain('"One, Member"');
    expect(line.split('","')).toHaveLength(14);
  });

  it("produces a header-only file for an empty result", () => {
    expect(toMemberCsv([]).split("\r\n")).toHaveLength(1);
  });
});
