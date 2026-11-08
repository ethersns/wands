import "server-only";

import { isDatabaseConfigured, query } from "@/lib/db";

import { REPORTING_TIMEZONE } from "./period";
import { csvCell } from "./waitlist";

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
  /** Account status, which is separate from the membership status above. */
  accountStatus?: "active" | "suspended";
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
  /** `active` unless a suspension row exists. Never null. */
  account_status: string;
  suspended_at: string | null;
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

  if (filters.accountStatus === "suspended") {
    clauses.push(`a.status = 'suspended'`);
  } else if (filters.accountStatus === "active") {
    clauses.push(`coalesce(a.status, 'active') = 'active'`);
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
  left join member_account_status a on a.user_id = u.id
`;

/** Columns shared by the list and the export, so the two cannot drift. */
const ROW_COLUMNS = `
  u.id::text as id,
  u.email,
  u.name,
  p.display_name,
  u."emailVerified" as email_verified,
  u."createdAt" as created_at,
  m.plan,
  m.status,
  p.onboarding_completed,
  coalesce(a.status, 'active') as account_status,
  a.suspended_at,
  (select count(*)::int from member_watchlist w where w.user_id = u.id) as watchlist_count,
  (select count(*)::int from member_saved_item s where s.user_id = u.id) as saved_count,
  (select max(e.occurred_at) from member_login_event e where e.user_id = u.id) as last_login_at
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
        `select ${ROW_COLUMNS}
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
      "[wands] admin member list failed:",
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
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  suspension_reason: string | null;
  suspended_by: string | null;
  reactivated_at: string | null;
  reactivated_by: string | null;
  account_updated_at: string | null;
  session_count: number;
  last_ip: string | null;
  last_user_agent: string | null;
  notification_prefs: {
    insider_activity: boolean;
    institutional_filings: boolean;
    asset_signals: boolean;
    product_updates: boolean;
  } | null;
  watchlists: { id: string; name: string; items: number; created_at: string }[];
  saved: { id: string; kind: string; title: string; symbol: string | null; created_at: string }[];
  logins: { occurred_at: string; ip_address: string | null; user_agent: string | null }[];
  security_events: {
    occurred_at: string;
    kind: string;
    outcome: string;
    ip_address: string | null;
    detail: Record<string, unknown>;
  }[];
}

export async function getMember(id: string): Promise<MemberDetail | null> {
  if (!isDatabaseConfigured()) return null;

  try {
    const rows = await query<MemberDetail>(
      `select
         ${ROW_COLUMNS},
         p.experience,
         coalesce(p.interests, '{}') as interests,
         p.onboarding_step,
         m.updated_at as membership_updated_at,
         m.current_period_end,
         m.stripe_customer_id,
         m.stripe_subscription_id,
         a.reason as suspension_reason,
         a.suspended_by,
         a.reactivated_at,
         a.reactivated_by,
         a.updated_at as account_updated_at,
         (select count(*)::int from session s where s."userId" = u.id) as session_count,
         (select s."ipAddress" from session s where s."userId" = u.id order by s."createdAt" desc limit 1) as last_ip,
         (select s."userAgent" from session s where s."userId" = u.id order by s."createdAt" desc limit 1) as last_user_agent,
         (select json_build_object(
            'insider_activity', n.insider_activity,
            'institutional_filings', n.institutional_filings,
            'asset_signals', n.asset_signals,
            'product_updates', n.product_updates
          ) from member_notification_pref n where n.user_id = u.id) as notification_prefs,
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
           select json_agg(json_build_object(
             'occurred_at', e.occurred_at, 'ip_address', e.ip_address, 'user_agent', e.user_agent
           ) order by e.occurred_at desc)
           from (select occurred_at, ip_address, user_agent from member_login_event
                 where user_id = u.id order by occurred_at desc limit 20) e
         ), '[]'::json) as logins,
         coalesce((
           select json_agg(json_build_object(
             'occurred_at', v.occurred_at, 'kind', v.kind, 'outcome', v.outcome,
             'ip_address', v.ip_address, 'detail', v.detail
           ) order by v.occurred_at desc)
           from (select occurred_at, kind, outcome, ip_address, detail from member_security_event
                 where user_id = u.id order by occurred_at desc limit 20) v
         ), '[]'::json) as security_events
       ${FROM_CLAUSE}
       where u.id = $1
       limit 1`,
      [id],
    );

    return rows[0] ?? null;
  } catch (cause) {
    console.log(
      "[wands] admin member detail failed:",
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

/** Bounded export. A member export is a support task, not a data dump. */
const MAX_EXPORT_ROWS = 10_000;

export async function exportMembers(filters: MemberFilters = {}): Promise<MemberRow[]> {
  if (!isDatabaseConfigured()) return [];

  const { where, values } = buildFilter(filters);

  try {
    return await query<MemberRow>(
      `select ${ROW_COLUMNS}
       ${FROM_CLAUSE}
       ${where}
       order by u."createdAt" desc
       limit $${values.length + 1}`,
      [...values, MAX_EXPORT_ROWS],
    );
  } catch (cause) {
    console.log(
      "[wands] admin member export failed:",
      cause instanceof Error ? cause.message : cause,
    );
    return [];
  }
}

/**
 * Member CSV.
 *
 * Shares `csvCell` with the waitlist export, so quoting and formula-injection
 * neutralisation are identical in both files. Password hashes, session tokens
 * and reset tokens are not selected by `ROW_COLUMNS`, so they cannot appear
 * here even by accident.
 */
export function toMemberCsv(rows: MemberRow[]): string {
  const header = [
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
  ];

  const lines = rows.map((row) =>
    [
      row.id,
      row.email,
      row.name,
      row.display_name,
      row.created_at,
      row.email_verified ? "yes" : "no",
      row.plan,
      row.status,
      row.account_status,
      row.suspended_at,
      row.onboarding_completed ? "yes" : "no",
      row.watchlist_count,
      row.saved_count,
      row.last_login_at,
    ]
      .map(csvCell)
      .join(","),
  );

  return [header.map(csvCell).join(","), ...lines].join("\r\n");
}
