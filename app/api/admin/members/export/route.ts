import { NextResponse } from "next/server";

import { authorizeOperatorRequest } from "@/lib/admin/guard";
import { recordMemberExport } from "@/lib/admin/member-actions";
import { exportMembers, toMemberCsv, type MemberFilters } from "@/lib/admin/members";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Member CSV export.
 *
 * The same constraints as the waitlist export, for the same reasons: the
 * operator session is re-validated here rather than trusted from middleware,
 * the result set is capped, every cell is quoted with formula-leading
 * characters neutralised, and the export is written to the audit log so a bulk
 * read of personal data is always attributable.
 *
 * Password hashes, session tokens and reset tokens are not selected by the
 * query, so they cannot appear in the file.
 */
export async function GET(request: Request) {
  const auth = await authorizeOperatorRequest();

  if (!auth.ok) {
    return NextResponse.json(
      { error: { code: auth.denial.code, message: auth.denial.message } },
      { status: auth.denial.status },
    );
  }

  const url = new URL(request.url);
  const accountStatus = url.searchParams.get("accountStatus");

  const filters: MemberFilters = {
    search: url.searchParams.get("search")?.trim() || undefined,
    plan: url.searchParams.get("plan") || undefined,
    status: url.searchParams.get("status") || undefined,
    verified:
      url.searchParams.get("verified") === "yes" || url.searchParams.get("verified") === "no"
        ? (url.searchParams.get("verified") as "yes" | "no")
        : undefined,
    accountStatus:
      accountStatus === "active" || accountStatus === "suspended" ? accountStatus : undefined,
    from: url.searchParams.get("from") || undefined,
    to: url.searchParams.get("to") || undefined,
  };

  const rows = await exportMembers(filters);
  const csv = toMemberCsv(rows);

  await recordMemberExport({
    actor: auth.identity.actor,
    rows: rows.length,
    filters: {
      search: filters.search ? "present" : null,
      plan: filters.plan ?? null,
      status: filters.status ?? null,
      verified: filters.verified ?? null,
      accountStatus: filters.accountStatus ?? null,
      from: filters.from ?? null,
      to: filters.to ?? null,
    },
  });

  const stamp = new Date().toISOString().slice(0, 10);

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="wands-members-${stamp}.csv"`,
      "cache-control": "no-store, max-age=0",
      "x-content-type-options": "nosniff",
    },
  });
}
