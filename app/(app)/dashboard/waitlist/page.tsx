import type { Metadata } from "next";
import Link from "next/link";
import { Download, Inbox, Search } from "lucide-react";

import { Kpi } from "@/components/admin/kpi";
import { MemberTabs } from "@/components/admin/member-tabs";
import { AdminPagination } from "@/components/admin/pagination";
import { RangePicker } from "@/components/admin/range-picker";
import { TrendChart } from "@/components/admin/trend-chart";
import { WaitlistRowActions } from "@/components/admin/waitlist-actions";
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
import { resolveRange, timezoneLabel } from "@/lib/admin/period";
import {
  getWaitlistSummary,
  listWaitlist,
  listWaitlistSources,
  type WaitlistFilters,
} from "@/lib/admin/waitlist";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";

export const metadata: Metadata = {
  title: "Waitlist",
};

export const dynamic = "force-dynamic";

interface SearchParams {
  search?: string;
  source?: string;
  converted?: string;
  from?: string;
  to?: string;
  page?: string;
  preset?: string;
}

const inputClass =
  "h-8 rounded-md border border-border bg-surface px-2 text-[12px] text-foreground placeholder:text-muted-foreground/70";
const labelClass = "text-[10px] font-medium tracking-[0.05em] text-muted-foreground uppercase";

export default async function WaitlistPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireOperator("/dashboard/waitlist");

  const params = await searchParams;
  const range = resolveRange(params);
  const page = Number(params.page ?? "1");

  const filters: WaitlistFilters = {
    search: params.search?.trim() || undefined,
    source: params.source || undefined,
    converted:
      params.converted === "yes" || params.converted === "no" ? params.converted : undefined,
    from: params.from || undefined,
    to: params.to || undefined,
    page: Number.isFinite(page) ? page : 1,
  };

  const [summary, result, sources] = await Promise.all([
    getWaitlistSummary(range),
    listWaitlist(filters),
    listWaitlistSources(),
  ]);

  const exportParams = new URLSearchParams();
  if (filters.search) exportParams.set("search", filters.search);
  if (filters.source) exportParams.set("source", filters.source);
  if (filters.converted) exportParams.set("converted", filters.converted);
  if (filters.from) exportParams.set("from", filters.from);
  if (filters.to) exportParams.set("to", filters.to);
  const exportHref = `/api/admin/waitlist/export${
    exportParams.size > 0 ? `?${exportParams.toString()}` : ""
  }`;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow={
          <span className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground uppercase">
            {range.label} · {timezoneLabel()}
          </span>
        }
        title="Early-access waitlist"
        description="Read directly from public.waitlist_signup. A returning visitor updates their existing row, so the total is already the unique-signup count."
        actions={
          <a
            href={exportHref}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:bg-muted"
          >
            <Download className="size-3" aria-hidden />
            Export CSV
          </a>
        }
      />

      <MemberTabs />

      <RangePicker range={range} basePath="/dashboard/waitlist" />

      <section aria-label="Waitlist totals" className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Kpi
          label="Unique signups"
          value={formatNumber(summary.total)}
          footnote={summary.firstAt ? `since ${formatDate(summary.firstAt)}` : "none yet"}
        />
        <Kpi label="Today" value={formatNumber(summary.today)} footnote={timezoneLabel()} />
        <Kpi label="Last 7 days" value={formatNumber(summary.last7)} />
        <Kpi label="Last 30 days" value={formatNumber(summary.last30)} />
      </section>

      <div className="grid gap-3 lg:grid-cols-3">
        <SectionCard
          title="Signups per day"
          description={`New rows created in ${range.label.toLowerCase()}.`}
          className="lg:col-span-2"
        >
          <TrendChart
            data={summary.series}
            label="Signups"
            emptyLabel="No waitlist signups in this window."
          />
        </SectionCard>

        <SectionCard title="Declared role" description="Self-reported at signup, when provided.">
          {summary.roles.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="No roles recorded"
              description="No signup supplied a role."
            />
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {summary.roles.map((row) => (
                <li key={row.role} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="truncate text-[12px] text-foreground capitalize">{row.role}</span>
                  <span className="font-mono text-[11px] tabular text-muted-foreground">
                    {row.count}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <SectionCard
        title="Search and filter"
        description="Filters apply to the table and to the CSV export."
        bodyClassName="px-4 pb-4 sm:px-5"
      >
        <form method="get" className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-[180px] flex-1 flex-col gap-1">
            <label htmlFor="waitlist-search" className={labelClass}>
              Email
            </label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <input
                id="waitlist-search"
                type="search"
                name="search"
                defaultValue={params.search ?? ""}
                placeholder="name@example.com"
                className={`${inputClass} w-full pl-7`}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="waitlist-source" className={labelClass}>
              Source
            </label>
            <select
              id="waitlist-source"
              name="source"
              defaultValue={params.source ?? ""}
              className={`${inputClass} min-w-[120px]`}
            >
              <option value="">Any source</option>
              {sources.map((source) => (
                <option key={source} value={source}>
                  {source}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="waitlist-converted" className={labelClass}>
              Registered
            </label>
            <select
              id="waitlist-converted"
              name="converted"
              defaultValue={params.converted ?? ""}
              className={`${inputClass} min-w-[120px]`}
            >
              <option value="">Any</option>
              <option value="yes">Has an account</option>
              <option value="no">Waitlist only</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="waitlist-from" className={labelClass}>
              Signed up from
            </label>
            <input
              id="waitlist-from"
              type="date"
              name="from"
              defaultValue={params.from ?? ""}
              className={`${inputClass} font-mono`}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="waitlist-to" className={labelClass}>
              to
            </label>
            <input
              id="waitlist-to"
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

          <Link
            href="/dashboard/waitlist"
            className="h-8 rounded-md border border-border px-3 text-[12px] leading-8 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Clear
          </Link>
        </form>
      </SectionCard>

      <SectionCard
        title={`${result.total} signup${result.total === 1 ? "" : "s"}`}
        description="Newest first. The referrer is the page the visitor signed up from, not a proven marketing source."
        bodyClassName="px-0 pb-0 sm:px-0"
        footer={
          <AdminPagination
            page={result.page}
            pageCount={result.pageCount}
            total={result.total}
            pageSize={result.pageSize}
            basePath="/dashboard/waitlist"
            params={{
              search: filters.search,
              source: filters.source,
              converted: filters.converted,
              from: filters.from,
              to: filters.to,
            }}
          />
        }
      >
        {result.rows.length === 0 ? (
          <div className="px-4 pb-4 sm:px-5">
            <EmptyState
              icon={Inbox}
              title="No signups match"
              description="Adjust the filters, or wait for the next early-access signup."
            />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Referrer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Signed up</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="text-right">Remove</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-[11px] text-foreground">{row.email}</TableCell>
                  <TableCell>
                    {row.member_id ? (
                      <Link
                        href={`/dashboard/members/${row.member_id}`}
                        className="text-[11px] text-primary hover:underline"
                      >
                        Registered
                      </Link>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">Waitlist only</span>
                    )}
                  </TableCell>
                  <TableCell className="text-[11px] text-muted-foreground capitalize">
                    {row.role ?? "—"}
                  </TableCell>
                  <TableCell className="text-[11px] text-muted-foreground">
                    {row.source ?? "—"}
                  </TableCell>
                  <TableCell className="max-w-[220px] truncate text-[11px] text-muted-foreground">
                    {row.referrer ?? "—"}
                  </TableCell>
                  <TableCell className="text-[11px] text-muted-foreground">
                    {row.status ?? "—"}
                  </TableCell>
                  <TableCell className="font-mono text-[11px] whitespace-nowrap text-muted-foreground">
                    {formatDateTime(row.created_at)}
                  </TableCell>
                  <TableCell className="font-mono text-[11px] whitespace-nowrap text-muted-foreground">
                    {formatDateTime(row.updated_at)}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end">
                      <WaitlistRowActions
                        id={row.id}
                        email={row.email}
                        memberId={row.member_id}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>

      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Exports are operator-only, capped at 10,000 rows, and every cell is quoted with
        formula-leading characters neutralised. Each export is written to the admin audit
        log. Removing a waitlist entry deletes only the signup record — a registered account
        with the same address is a separate record and is never touched.
      </p>
    </div>
  );
}
