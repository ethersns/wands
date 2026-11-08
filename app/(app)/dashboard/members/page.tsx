import type { Metadata } from "next";
import Link from "next/link";
import { Search, Users } from "lucide-react";

import { AdminPagination } from "@/components/admin/pagination";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireOperator } from "@/lib/admin/guard";
import {
  listMembers,
  listPlans,
  listStatuses,
  type MemberFilters,
} from "@/lib/admin/members";
import { formatDate, formatRelative } from "@/lib/format";

export const metadata: Metadata = {
  title: "Members",
};

export const dynamic = "force-dynamic";

interface SearchParams {
  search?: string;
  plan?: string;
  status?: string;
  verified?: string;
  from?: string;
  to?: string;
  page?: string;
}

const inputClass =
  "h-8 rounded-md border border-border bg-surface px-2 text-[12px] text-foreground placeholder:text-muted-foreground/70";
const labelClass = "text-[10px] font-medium tracking-[0.05em] text-muted-foreground uppercase";

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireOperator("/dashboard/members");

  const params = await searchParams;
  const page = Number(params.page ?? "1");

  const filters: MemberFilters = {
    search: params.search?.trim() || undefined,
    plan: params.plan || undefined,
    status: params.status || undefined,
    verified:
      params.verified === "yes" || params.verified === "no" ? params.verified : undefined,
    from: params.from || undefined,
    to: params.to || undefined,
    page: Number.isFinite(page) ? page : 1,
  };

  const [result, plans, statuses] = await Promise.all([
    listMembers(filters),
    listPlans(),
    listStatuses(),
  ]);

  const filtered = Boolean(
    filters.search || filters.plan || filters.status || filters.verified || filters.from || filters.to,
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Members"
        description="Every Better Auth account, with the membership and engagement records already stored against it. Read-only."
      />

      <SectionCard
        title="Search and filter"
        description="Filters are applied server-side and every result set is paginated."
        bodyClassName="px-4 pb-4 sm:px-5"
      >
        <form method="get" className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-[180px] flex-1 flex-col gap-1">
            <label htmlFor="member-search" className={labelClass}>
              Email or name
            </label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <input
                id="member-search"
                type="search"
                name="search"
                defaultValue={params.search ?? ""}
                placeholder="name@example.com"
                className={`${inputClass} w-full pl-7`}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="member-plan" className={labelClass}>
              Plan
            </label>
            <select
              id="member-plan"
              name="plan"
              defaultValue={params.plan ?? ""}
              className={`${inputClass} min-w-[120px]`}
            >
              <option value="">Any plan</option>
              {plans.map((plan) => (
                <option key={plan} value={plan}>
                  {plan}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="member-status" className={labelClass}>
              Status
            </label>
            <select
              id="member-status"
              name="status"
              defaultValue={params.status ?? ""}
              className={`${inputClass} min-w-[120px]`}
            >
              <option value="">Any status</option>
              {statuses.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="member-verified" className={labelClass}>
              Email verified
            </label>
            <select
              id="member-verified"
              name="verified"
              defaultValue={params.verified ?? ""}
              className={`${inputClass} min-w-[100px]`}
            >
              <option value="">Any</option>
              <option value="yes">Verified</option>
              <option value="no">Unverified</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="member-from" className={labelClass}>
              Registered from
            </label>
            <input
              id="member-from"
              type="date"
              name="from"
              defaultValue={params.from ?? ""}
              className={`${inputClass} font-mono`}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="member-to" className={labelClass}>
              to
            </label>
            <input
              id="member-to"
              type="date"
              name="to"
              defaultValue={params.to ?? ""}
              className={`${inputClass} font-mono`}
            />
          </div>

          <button
            type="submit"
            className="h-8 rounded-md border border-primary/40 bg-primary/10 px-3 text-[12px] font-medium text-primary transition-colors hover:bg-primary/15"
          >
            Apply
          </button>

          {filtered ? (
            <Link
              href="/dashboard/members"
              className="h-8 rounded-md border border-border px-3 text-[12px] leading-8 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              Clear
            </Link>
          ) : null}
        </form>
      </SectionCard>

      <SectionCard
        title={`${result.total} member${result.total === 1 ? "" : "s"}`}
        description="Select a member to see their support and engagement detail."
        bodyClassName="px-0 pb-0 sm:px-0"
        footer={
          <AdminPagination
            page={result.page}
            pageCount={result.pageCount}
            total={result.total}
            pageSize={result.pageSize}
            basePath="/dashboard/members"
            params={{
              search: filters.search,
              plan: filters.plan,
              status: filters.status,
              verified: filters.verified,
              from: filters.from,
              to: filters.to,
            }}
          />
        }
      >
        {result.rows.length === 0 ? (
          <div className="px-4 pb-4 sm:px-5">
            <EmptyState
              icon={Users}
              title={filtered ? "No members match these filters" : "No members yet"}
              description={
                filtered
                  ? "Try widening the date range or clearing the search."
                  : "Member accounts will appear here as soon as someone registers."
              }
            />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Registered</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Verified</TableHead>
                <TableHead>Onboarding</TableHead>
                <TableHead className="text-right">Watchlists</TableHead>
                <TableHead className="text-right">Saved</TableHead>
                <TableHead>Last sign-in</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.rows.map((member) => (
                <TableRow key={member.id}>
                  <TableCell>
                    <Link
                      href={`/dashboard/members/${member.id}`}
                      className="flex flex-col gap-0.5 hover:underline"
                    >
                      <span className="text-[12px] font-medium text-foreground">
                        {member.display_name || member.name || member.email}
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {member.email}
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-[11px] text-muted-foreground">
                    {formatDate(member.created_at)}
                  </TableCell>
                  <TableCell className="text-[11px] text-foreground">
                    {member.plan ?? "—"}
                  </TableCell>
                  <TableCell className="text-[11px] text-muted-foreground">
                    {member.status ?? "—"}
                  </TableCell>
                  <TableCell>
                    <span
                      className={
                        member.email_verified
                          ? "text-[11px] text-profit"
                          : "text-[11px] text-muted-foreground"
                      }
                    >
                      {member.email_verified ? "Verified" : "Unverified"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span
                      className={
                        member.onboarding_completed
                          ? "text-[11px] text-profit"
                          : "text-[11px] text-muted-foreground"
                      }
                    >
                      {member.onboarding_completed ? "Complete" : "Incomplete"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono text-[11px] tabular text-foreground">
                    {member.watchlist_count}
                  </TableCell>
                  <TableCell className="text-right font-mono text-[11px] tabular text-foreground">
                    {member.saved_count}
                  </TableCell>
                  <TableCell className="text-[11px] text-muted-foreground">
                    {member.last_login_at ? formatRelative(member.last_login_at) : "Not tracked"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>
    </div>
  );
}
