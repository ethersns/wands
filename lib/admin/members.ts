import "server-only";

import { isDatabaseConfigured, query } from "@/lib/db";

import { REPORTING_TIMEZONE } from "./period";

/**
 * Read-only member administration.
 *
 * The control centre deliberately cannot change a membership, reset a password
 * or enter an account. Those are the operations that turn a reporting tool into
 * a liability, and none of them are needed to run the business. Everything here
 * is a bounded, parameterised read.
 *
 * Password hashes, session tokens and reset tokens live in `account` and
 * `verification`; neither table is joined, so they cannot leak through this
 * module even by accident.
 */

export const MEMBER_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export interface MemberFilters {
  search?: string;
  plan?: string;
  status?: string;
  verified?: "yes" | "no";
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface MemberRow {
  id: string;
  email: string;
  name: string | null;
  display_name: string | null;
  email_verified: boolean;
  created_at: string;
  plan: string | null;
  status: string | null;
  onboarding_completed: boolean | null;
  watchlist_count: number;
  saved_count: number;
  last_login_at: string | null;
}

export interface MemberPage {
  rows: MemberRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

/** Escapes LIKE metacharacters so a search for `a_b` is not a wildcard. */
function likeTerm(search: string): string {
  return `%${search.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

function clampPage(page: number | undefined): number {
  if (!page || !Number.isFinite(page) || page < 1) return 1;
  return Math.min(Math.floor(page), 10_000);
}

function clampPageSize(size: number | undefined): number {
  if (!size || !Number.isFinite(size) || size < 1) return MEMBER_PAGE_SIZE;
  return Math.min(Math.floor(size), MAX_PAGE_SIZE);
}

interface FilterSql {
  where: string;
  values: unknown[];
}

function buildFilter(filters: MemberFilters): FilterSql {
  const values: unknown[] = [];
  const clauses: string[] = [];

  const search = filters.search?.trim();
  if (search) {
    values.push(likeTerm(search));
    clauses.push(
      `(u.email ilike $${values.length} or coalesce(u.name, '') ilike $${values.length} or coalesce(p.display_name, '') ilike $${values.length})`,
    );
  }

  if (filters.plan) {
    values.push(filters.plan);
    clauses.push(`m.plan = $${values.length}`);
  }

  if (filters.status) {
    values.push(filters.status);
    clauses.push(`m.status = $${values.length}`);
  }

  if (filters.verified === "yes" || filters.verified === "no") {
    values.push(filters.verified === "yes");
    clauses.push(`u."emailVerified" = $${values.length}`);
  }

  if (filters.from) {
    values.push(filters.from, REPORTING_TIMEZONE);
    clauses.push(
      `(u."createdAt" at time zone $${values.length})::date >= $${values.length - 1}::date`,
    );
  }

  if (filters.to) {
    values.push(filters.to, REPORTING_TIMEZONE);
    clauses.push(
      `(u."createdAt" at time zone $${values.length})::date <= $${values.length - 1}::date`,
    );
  }

  return {
    where: clauses.length ? `where ${clauses.join(" and ")}` : "",
    values,
  };
}

const FROM_CLAUSE = `
  from "user" u
  left join member_profile p on p.user_id = u.id
  left join member_membership m on m.user_id = u.id
`;

export async function listMembers(filters: MemberFilters = {}): Promise<MemberPage> {
  const page = clampPage(filters.page);
  const pageSize = clampPageSize(filters.pageSize);

  if (!isDatabaseConfigured()) {
    return { rows: [], total: 0, page, pageSize, pageCount: 0 };
  }

  const { where, values } = buildFilter(filters);

  try {
    const [rows, totals] = await Promise.all([
      query<MemberRow>(
        `select
           u.id::text as id,
           u.email,
           u.name,
           p.display_name,
           u."emailVerified" as email_verified,
           u."createdAt" as created_at,
           m.plan,
           m.status,
           p.onboarding_completed,
           (select count(*)::int from member_watchlist w where w.user_id = u.id) as watchlist_count,
           (select count(*)::int from member_saved_item s where s.user_id = u.id) as saved_count,
           (select max(e.occurred_at) from member_login_event e where e.user_id = u.id) as last_login_at
         ${FROM_CLAUSE}
         ${where}
         order by u."createdAt" desc
         limit $${values.length + 1} offset $${values.length + 2}`,
        [...values, pageSize, (page - 1) * pageSize],
      ),
      query<{ total: number }>(
        `select count(*)::int as total ${FROM_CLAUSE} ${where}`,
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
      "[v0] admin member list failed:",
      cause instanceof Error ? cause.message : cause,
    );
    return { rows: [], total: 0, page, pageSize, pageCount: 0 };
  }
}

export interface MemberDetail extends MemberRow {
  experience: string | null;
  interests: string[];
  onboarding_step: string | null;
  membership_updated_at: string | null;
  current_period_end: string | null;
  watchlists: { id: string; name: string; items: number; created_at: string }[];
  saved: { id: string; kind: string; title: string; symbol: string | null; created_at: string }[];
  logins: { occurred_at: string }[];
}

export async function getMember(id: string): Promise<MemberDetail | null> {
  if (!isDatabaseConfigured()) return null;

  try {
    const rows = await query<MemberDetail>(
      `select
         u.id::text as id,
         u.email,
         u.name,
         p.display_name,
         u."emailVerified" as email_verified,
         u."createdAt" as created_at,
         m.plan,
         m.status,
         p.onboarding_completed,
         p.experience,
         coalesce(p.interests, '{}') as interests,
         p.onboarding_step,
         m.updated_at as membership_updated_at,
         m.current_period_end,
         (select count(*)::int from member_watchlist w where w.user_id = u.id) as watchlist_count,
         (select count(*)::int from member_saved_item s where s.user_id = u.id) as saved_count,
         (select max(e.occurred_at) from member_login_event e where e.user_id = u.id) as last_login_at,
         coalesce((
           select json_agg(json_build_object(
             'id', w.id::text, 'name', w.name, 'created_at', w.created_at,
             'items', (select count(*)::int from member_watchlist_item i where i.watchlist_id = w.id)
           ) order by w.created_at desc)
           from member_watchlist w where w.user_id = u.id
         ), '[]'::json) as watchlists,
         coalesce((
           select json_agg(json_build_object(
             'id', s.id::text, 'kind', s.kind, 'title', s.title,
             'symbol', s.symbol, 'created_at', s.created_at
           ) order by s.created_at desc)
           from (select * from member_saved_item where user_id = u.id order by created_at desc limit 20) s
         ), '[]'::json) as saved,
         coalesce((
           select json_agg(json_build_object('occurred_at', e.occurred_at) order by e.occurred_at desc)
           from (select occurred_at from member_login_event where user_id = u.id order by occurred_at desc limit 20) e
         ), '[]'::json) as logins
       from "user" u
       left join member_profile p on p.user_id = u.id
       left join member_membership m on m.user_id = u.id
       where u.id = $1
       limit 1`,
      [id],
    );

    return rows[0] ?? null;
  } catch (cause) {
    console.log(
      "[v0] admin member detail failed:",
      cause instanceof Error ? cause.message : cause,
    );
    return null;
  }
}

/** Distinct plans actually present, for the filter dropdown. */
export async function listPlans(): Promise<string[]> {
  if (!isDatabaseConfigured()) return [];

  try {
    const rows = await query<{ plan: string }>(
      `select distinct plan from member_membership order by plan`,
    );
    return rows.map((row) => row.plan);
  } catch {
    return [];
  }
}

export async function listStatuses(): Promise<string[]> {
  if (!isDatabaseConfigured()) return [];

  try {
    const rows = await query<{ status: string }>(
      `select distinct status from member_membership order by status`,
    );
    return rows.map((row) => row.status);
  } catch {
    return [];
  }
}
