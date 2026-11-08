import { NextResponse } from "next/server";

import { recordAdminAction } from "@/lib/admin/audit";
import { authorizeOperatorRequest } from "@/lib/admin/guard";
import { exportWaitlist, toCsv, type WaitlistFilters } from "@/lib/admin/waitlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Waitlist CSV export.
 *
 * This is the only admin endpoint that returns personal data in bulk, so it is
 * the most tightly constrained:
 *
 *   * the operator session is re-validated here, not just in middleware;
 *   * the result set is capped, so a crafted filter cannot stream the table;
 *   * every cell is quoted and formula-leading characters are neutralised, so
 *     the file cannot execute a formula when opened in Excel or Sheets;
 *   * the export is written to the audit log with the filter that produced it,
 *     so a bulk read of personal data is always attributable.
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
  const converted = url.searchParams.get("converted");

  const filters: WaitlistFilters = {
    search: url.searchParams.get("search")?.trim() || undefined,
    source: url.searchParams.get("source") || undefined,
    converted: converted === "yes" || converted === "no" ? converted : undefined,
    from: url.searchParams.get("from") || undefined,
    to: url.searchParams.get("to") || undefined,
  };

  const rows = await exportWaitlist(filters);
  const csv = toCsv(rows);

  await recordAdminAction({
    actor: auth.identity.actor,
    action: "waitlist.export",
    target: "public.waitlist_signup",
    detail: {
      rows: rows.length,
      filters: {
        search: filters.search ? "present" : null,
        source: filters.source ?? null,
        converted: filters.converted ?? null,
        from: filters.from ?? null,
        to: filters.to ?? null,
      },
    },
  });

  const stamp = new Date().toISOString().slice(0, 10);

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="wands-waitlist-${stamp}.csv"`,
      "cache-control": "no-store, max-age=0",
      "x-content-type-options": "nosniff",
    },
  });
}
