import "server-only";

import { isDatabaseConfigured, query } from "@/lib/db";

import { REPORTING_TIMEZONE, type DateRange } from "./period";

/**
 * Security activity for the control centre.
 *
 * Two sources, kept distinct because they answer different questions:
 *
 *   * `member_login_event` — successful sign-ins, with the IP and user agent
 *     captured at the time. This is the durable history; Better Auth's
 *     `session` row is deleted on sign-out and cannot serve this purpose.
 *   * `member_security_event` — failed sign-ins, revoked sessions and account
 *     status changes.
 *
 * IP addresses are personal data. They are shown to the operator because
 * investigating an account is the reason the column exists, and they are
 * pruned after 180 days by `pruneOldSecurityEvents`. Nothing here geolocates:
 * an address is not a location.
 */

export interface SignInRow {
  occurred_at: string;
  user_id: string | null;
  email: string | null;
  ip_address: string | null;
  user_agent: string | null;
}

export interface SecurityEventRow {
  occurred_at: string;
  kind: string;
  outcome: string;
  user_id: string | null;
  email: string | null;
  ip_address: string | null;
  user_agent: string | null;
  detail: Record<string, unknown>;
}

export interface SecuritySummary {
  signIns: number;
  failedSignIns: number;
  distinctAccounts: number;
  suspensions: number;
  deletions: number;
  withIp: number;
  withoutIp: number;
  firstSignInAt: string | null;
  kinds: { kind: string; count: number }[];
}

export async function getSecuritySummary(range: DateRange): Promise<SecuritySummary> {
  const empty: SecuritySummary = {
    signIns: 0,
    failedSignIns: 0,
    distinctAccounts: 0,
    suspensions: 0,
    deletions: 0,
    withIp: 0,
    withoutIp: 0,
    firstSignInAt: null,
    kinds: [],
  };

  if (!isDatabaseConfigured()) return empty;

  const tz = REPORTING_TIMEZONE;

  try {
    const [signIns, events, kinds] = await Promise.all([
      query<{
        total: number;
        distinct_accounts: number;
        with_ip: number;
        without_ip: number;
        first_at: string | null;
      }>(
        `select
           count(*)::int as total,
           count(distinct user_id)::int as distinct_accounts,
           count(ip_address)::int as with_ip,
           count(*) filter (where ip_address is null)::int as without_ip,
           min(occurred_at) as first_at
         from member_login_event
         where (occurred_at at time zone $1)::date between $2::date and $3::date`,
        [tz, range.from, range.to],
      ),
      query<{ failed: number; suspensions: number; deletions: number }>(
        `select
           count(*) filter (where kind = 'sign_in_failed')::int as failed,
           count(*) filter (where kind = 'account_suspended')::int as suspensions,
           count(*) filter (where kind = 'account_deleted')::int as deletions
         from member_security_event
         where (occurred_at at time zone $1)::date between $2::date and $3::date`,
        [tz, range.from, range.to],
      ),
      query<{ kind: string; count: number }>(
        `select kind, count(*)::int as count
         from member_security_event
         where (occurred_at at time zone $1)::date between $2::date and $3::date
         group by 1 order by count desc limit 10`,
        [tz, range.from, range.to],
      ),
    ]);

    return {
      signIns: signIns[0]?.total ?? 0,
      failedSignIns: events[0]?.failed ?? 0,
      distinctAccounts: signIns[0]?.distinct_accounts ?? 0,
      suspensions: events[0]?.suspensions ?? 0,
      deletions: events[0]?.deletions ?? 0,
      withIp: signIns[0]?.with_ip ?? 0,
      withoutIp: signIns[0]?.without_ip ?? 0,
      firstSignInAt: signIns[0]?.first_at ?? null,
      kinds,
    };
  } catch (cause) {
    console.log(
      "[wands] admin security summary failed:",
      cause instanceof Error ? cause.message : cause,
    );
    return empty;
  }
}

export async function listSignIns(
  range: DateRange,
  limit = 50,
): Promise<SignInRow[]> {
  if (!isDatabaseConfigured()) return [];

  try {
    return await query<SignInRow>(
      `select e.occurred_at, e.user_id, u.email, e.ip_address, e.user_agent
       from member_login_event e
       left join "user" u on u.id = e.user_id
       where (e.occurred_at at time zone $1)::date between $2::date and $3::date
       order by e.occurred_at desc
       limit $4`,
      [REPORTING_TIMEZONE, range.from, range.to, Math.min(Math.max(limit, 1), 200)],
    );
  } catch {
    return [];
  }
}

export async function listSecurityEvents(
  range: DateRange,
  limit = 50,
): Promise<SecurityEventRow[]> {
  if (!isDatabaseConfigured()) return [];

  try {
    return await query<SecurityEventRow>(
      `select v.occurred_at, v.kind, v.outcome, v.user_id, u.email,
              v.ip_address, v.user_agent, v.detail
       from member_security_event v
       left join "user" u on u.id = v.user_id
       where (v.occurred_at at time zone $1)::date between $2::date and $3::date
       order by v.occurred_at desc
       limit $4`,
      [REPORTING_TIMEZONE, range.from, range.to, Math.min(Math.max(limit, 1), 200)],
    );
  } catch {
    return [];
  }
}

/**
 * Human labels for the event kinds.
 *
 * Kept here rather than in the page so the audit page and the security page
 * cannot describe the same event two different ways.
 */
export const SECURITY_EVENT_LABELS: Record<string, string> = {
  sign_in_failed: "Failed sign-in",
  session_revoked: "Session revoked",
  account_suspended: "Account suspended",
  account_reactivated: "Account reactivated",
  account_deleted: "Account deleted",
};

export function securityEventLabel(kind: string): string {
  return SECURITY_EVENT_LABELS[kind] ?? kind.replace(/_/g, " ");
}
