import "server-only";

import { isDatabaseConfigured, query } from "@/lib/db";

import { REPORTING_TIMEZONE, type DateRange } from "./period";
import { fillSeries, type DayPoint } from "./series";

/**
 * Early-access waitlist administration.
 *
 * The existing `public.waitlist_signup` table is the only source. It upserts on
 * `email_normalized`, so a returning visitor updates `updated_at` instead of
 * creating a row — which means `count(*)` is already the unique-signup count and
 * `created_at` is the only honest "signed up on" date. `updated_at` is shown
 * separately and never counted as a new signup.
 */

export const WAITLIST_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const MAX_EXPORT_ROWS = 10_000;

export interface WaitlistFilters {
  search?: string;
  source?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface WaitlistRow {
  id: string;
  email: string;
  role: string | null;
  source: string | null;
  referrer: string | null;
  status: string | null;
  created_at: string;
  updated_at: string;
}

export interface WaitlistPage {
  rows: WaitlistRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

function likeTerm(search: string): string {
  return `%${search.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

function clampPage(page: number | undefined): number {
  if (!page || !Number.isFinite(page) || page < 1) return 1;
  return Math.min(Math.floor(page), 10_000);
}

function clampPageSize(size: number | undefined): number {
  if (!size || !Number.isFinite(size) || size < 1) return WAITLIST_PAGE_SIZE;
  return Math.min(Math.floor(size), MAX_PAGE_SIZE);
}

function buildFilter(filters: WaitlistFilters): { where: string; values: unknown[] } {
  const values: unknown[] = [];
  const clauses: string[] = [];

  const search = filters.search?.trim();
  if (search) {
    values.push(likeTerm(search));
    clauses.push(`email ilike $${values.length}`);
  }

  if (filters.source) {
    values.push(filters.source);
    clauses.push(`source = $${values.length}`);
  }

  if (filters.from) {
    values.push(filters.from, REPORTING_TIMEZONE);
    clauses.push(
      `(created_at at time zone $${values.length})::date >= $${values.length - 1}::date`,
    );
  }

  if (filters.to) {
    values.push(filters.to, REPORTING_TIMEZONE);
    clauses.push(
      `(created_at at time zone $${values.length})::date <= $${values.length - 1}::date`,
    );
  }

  return {
    where: clauses.length ? `where ${clauses.join(" and ")}` : "",
    values,
  };
}

export async function listWaitlist(filters: WaitlistFilters = {}): Promise<WaitlistPage> {
  const page = clampPage(filters.page);
  const pageSize = clampPageSize(filters.pageSize);

  if (!isDatabaseConfigured()) {
    return { rows: [], total: 0, page, pageSize, pageCount: 0 };
  }

  const { where, values } = buildFilter(filters);

  try {
    const [rows, totals] = await Promise.all([
      query<WaitlistRow>(
        `select id::text, email, role, source, referrer, status, created_at, updated_at
         from public.waitlist_signup
         ${where}
         order by created_at desc
         limit $${values.length + 1} offset $${values.length + 2}`,
        [...values, pageSize, (page - 1) * pageSize],
      ),
      query<{ total: number }>(
        `select count(*)::int as total from public.waitlist_signup ${where}`,
        values,
      ),
    ]);

    const total = totals[0]?.total ?? 0;

    return {
      rows,
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    };
  } catch (cause) {
    console.log(
      "[v0] admin waitlist list failed:",
      cause instanceof Error ? cause.message : cause,
    );
    return { rows: [], total: 0, page, pageSize, pageCount: 0 };
  }
}

export interface WaitlistSummary {
  total: number;
  today: number;
  last7: number;
  last30: number;
  firstAt: string | null;
  sources: { source: string; count: number }[];
  roles: { role: string; count: number }[];
  series: DayPoint[];
}

export async function getWaitlistSummary(range: DateRange): Promise<WaitlistSummary> {
  const empty: WaitlistSummary = {
    total: 0,
    today: 0,
    last7: 0,
    last30: 0,
    firstAt: null,
    sources: [],
    roles: [],
    series: fillSeries([], range.from, range.to),
  };

  if (!isDatabaseConfigured()) return empty;

  const tz = REPORTING_TIMEZONE;

  try {
    const [totals, sources, roles, series] = await Promise.all([
      query<{ total: number; today: number; last7: number; last30: number; first_at: string | null }>(
        `with scoped as (
           select (created_at at time zone $1)::date as d, created_at as at
           from public.waitlist_signup
         )
         select
           (select count(*)::int from scoped) as total,
           (select count(*)::int from scoped where d = current_date) as today,
           (select count(*)::int from scoped where d >= current_date - 6) as last7,
           (select count(*)::int from scoped where d >= current_date - 29) as last30,
           (select min(at) from scoped) as first_at`,
        [tz],
      ),
      query<{ source: string; count: number }>(
        `select coalesce(source, 'unknown') as source, count(*)::int as count
         from public.waitlist_signup
         group by 1 order by count desc limit 10`,
      ),
      query<{ role: string; count: number }>(
        `select coalesce(role, 'not stated') as role, count(*)::int as count
         from public.waitlist_signup
         group by 1 order by count desc limit 10`,
      ),
      query<{ day: string; value: number }>(
        `select (created_at at time zone $1)::date::text as day, count(*)::int as value
         from public.waitlist_signup
         where (created_at at time zone $1)::date between $2::date and $3::date
         group by 1 order by 1`,
        [tz, range.from, range.to],
      ),
    ]);

    return {
      total: totals[0]?.total ?? 0,
      today: totals[0]?.today ?? 0,
      last7: totals[0]?.last7 ?? 0,
      last30: totals[0]?.last30 ?? 0,
      firstAt: totals[0]?.first_at ?? null,
      sources,
      roles,
      series: fillSeries(series, range.from, range.to),
    };
  } catch (cause) {
    console.log(
      "[v0] admin waitlist summary failed:",
      cause instanceof Error ? cause.message : cause,
    );
    return empty;
  }
}

export async function listWaitlistSources(): Promise<string[]> {
  if (!isDatabaseConfigured()) return [];

  try {
    const rows = await query<{ source: string }>(
      `select distinct source from public.waitlist_signup where source is not null order by source`,
    );
    return rows.map((row) => row.source);
  } catch {
    return [];
  }
}

/**
 * Neutralises spreadsheet formula injection.
 *
 * A cell beginning with `=`, `+`, `-`, `@`, tab or carriage return is executed
 * as a formula by Excel and Sheets. Prefixing with an apostrophe forces the
 * value to be read as text. Every field is quoted and internal quotes doubled,
 * so a comma or newline in an email cannot shift the columns.
 */
export function csvCell(value: unknown): string {
  // `pg` hands back `timestamptz` as a Date, and `String(date)` produces a
  // locale-dependent string. ISO-8601 is unambiguous and sorts correctly.
  const raw =
    value instanceof Date
      ? value.toISOString()
      : value === null || value === undefined
        ? ""
        : String(value);
  const guarded = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${guarded.replace(/"/g, '""')}"`;
}

export function toCsv(rows: WaitlistRow[]): string {
  const header = [
    "email",
    "role",
    "source",
    "referrer",
    "status",
    "signed_up_at",
    "updated_at",
  ];

  const lines = rows.map((row) =>
    [
      row.email,
      row.role,
      row.source,
      row.referrer,
      row.status,
      row.created_at,
      row.updated_at,
    ]
      .map(csvCell)
      .join(","),
  );

  return [header.map(csvCell).join(","), ...lines].join("\r\n");
}

/** Bounded export. A waitlist export is a support task, not a data dump. */
export async function exportWaitlist(filters: WaitlistFilters = {}): Promise<WaitlistRow[]> {
  if (!isDatabaseConfigured()) return [];

  const { where, values } = buildFilter(filters);

  try {
    return await query<WaitlistRow>(
      `select id::text, email, role, source, referrer, status, created_at, updated_at
       from public.waitlist_signup
       ${where}
       order by created_at desc
       limit $${values.length + 1}`,
      [...values, MAX_EXPORT_ROWS],
    );
  } catch (cause) {
    console.log(
      "[v0] admin waitlist export failed:",
      cause instanceof Error ? cause.message : cause,
    );
    return [];
  }
}
