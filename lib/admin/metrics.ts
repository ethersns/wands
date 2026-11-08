import "server-only";

import { isDatabaseConfigured, query } from "@/lib/db";

import {
  REPORTING_TIMEZONE,
  percentChange,
  previousRange,
  todayInReportingZone,
  type DateRange,
} from "./period";
import { fillSeries, type DayPoint } from "./series";

/**
 * Business overview metrics.
 *
 * Every number here is read from a table that already records it. Nothing is
 * estimated, extrapolated or seeded. Where a source has no history yet the
 * result carries `tracked: false` and the UI says "Not yet tracked" rather than
 * rendering a zero, because "we have not measured this" and "this is zero" are
 * different facts and only one of them is true.
 */

export interface MetricWindow {
  current: number;
  previous: number;
  /** `null` when the previous window has no baseline to divide by. */
  change: number | null;
}

export interface MembershipSlice {
  plan: string;
  status: string;
  count: number;
}

export interface PageRow {
  path: string;
  views: number;
  visitors: number;
}

export interface ReferrerRow {
  category: string;
  views: number;
}

export interface Overview {
  degraded: boolean;
  timezone: string;
  members: {
    total: number;
    today: number;
    window: MetricWindow;
    firstAt: string | null;
  };
  waitlist: {
    total: number;
    today: number;
    window: MetricWindow;
    firstAt: string | null;
  };
  traffic: {
    views: number;
    visitors: number;
    tracked: boolean;
    since: string | null;
  };
  signIns: {
    window: number;
    tracked: boolean;
    since: string | null;
    activeSessions: number;
  };
  membership: MembershipSlice[];
  /**
   * Waitlist emails that later became member accounts, matched on the
   * normalised address the waitlist already stores. This is a real conversion
   * because both sides are recorded facts, not an attribution guess.
   */
  conversion: { matched: number; waitlistTotal: number; rate: number | null };
  onboarding: { completed: number; total: number };
  engagement: {
    membersWithWatchlist: number;
    membersWithSaved: number;
    watchlistItems: number;
    savedItems: number;
  };
  registrations: DayPoint[];
  signInSeries: DayPoint[];
  topPages: PageRow[];
  referrers: ReferrerRow[];
}

function emptyWindow(): MetricWindow {
  return { current: 0, previous: 0, change: null };
}

export function emptyOverview(range: DateRange): Overview {
  return {
    degraded: true,
    timezone: REPORTING_TIMEZONE,
    members: { total: 0, today: 0, window: emptyWindow(), firstAt: null },
    waitlist: { total: 0, today: 0, window: emptyWindow(), firstAt: null },
    traffic: { views: 0, visitors: 0, tracked: false, since: null },
    signIns: { window: 0, tracked: false, since: null, activeSessions: 0 },
    membership: [],
    conversion: { matched: 0, waitlistTotal: 0, rate: null },
    onboarding: { completed: 0, total: 0 },
    engagement: {
      membersWithWatchlist: 0,
      membersWithSaved: 0,
      watchlistItems: 0,
      savedItems: 0,
    },
    registrations: fillSeries([], range.from, range.to),
    signInSeries: fillSeries([], range.from, range.to),
    topPages: [],
    referrers: [],
  };
}

interface CountRow {
  total: number;
  today: number;
  current: number;
  previous: number;
  first_at: string | null;
}

export async function getOverview(range: DateRange): Promise<Overview> {
  if (!isDatabaseConfigured()) return emptyOverview(range);

  const previous = previousRange(range);
  const today = todayInReportingZone();
  const tz = REPORTING_TIMEZONE;

  try {
    const [
      memberRows,
      waitlistRows,
      trafficRows,
      signInRows,
      sessionRows,
      membershipRows,
      conversionRows,
      onboardingRows,
      engagementRows,
      registrationSeries,
      signInSeries,
      topPages,
      referrers,
    ] = await Promise.all([
      query<CountRow>(
        `with scoped as (
           select ("createdAt" at time zone $1)::date as d, "createdAt" as at from "user"
         )
         select
           (select count(*)::int from scoped) as total,
           (select count(*)::int from scoped where d = $2::date) as today,
           (select count(*)::int from scoped where d between $3::date and $4::date) as current,
           (select count(*)::int from scoped where d between $5::date and $6::date) as previous,
           (select min(at) from scoped) as first_at`,
        [tz, today, range.from, range.to, previous.from, previous.to],
      ),
      query<CountRow>(
        `with scoped as (
           select (created_at at time zone $1)::date as d, created_at as at
           from public.waitlist_signup
         )
         select
           (select count(*)::int from scoped) as total,
           (select count(*)::int from scoped where d = $2::date) as today,
           (select count(*)::int from scoped where d between $3::date and $4::date) as current,
           (select count(*)::int from scoped where d between $5::date and $6::date) as previous,
           (select min(at) from scoped) as first_at`,
        [tz, today, range.from, range.to, previous.from, previous.to],
      ),
      query<{ views: number; visitors: number; since: string | null }>(
        `select
           count(*)::int as views,
           count(distinct visitor_hash)::int as visitors,
           (select min(day)::text from site_page_view) as since
         from site_page_view
         where day between $1::date and $2::date and not is_operator`,
        [range.from, range.to],
      ),
      query<{ n: number; since: string | null }>(
        `select
           count(*)::int as n,
           (select min(day)::text from member_login_event) as since
         from member_login_event
         where day between $1::date and $2::date`,
        [range.from, range.to],
      ),
      query<{ n: number }>(
        `select count(*)::int as n from session where "expiresAt" > now()`,
      ),
      query<MembershipSlice>(
        `select plan, status, count(*)::int as count
         from member_membership
         group by plan, status
         order by count desc, plan asc`,
      ),
      query<{ matched: number; total: number }>(
        `select
           (select count(*)::int
              from public.waitlist_signup w
              join "user" u on lower(u.email) = w.email_normalized) as matched,
           (select count(*)::int from public.waitlist_signup) as total`,
      ),
      query<{ completed: number; total: number }>(
        `select
           count(*) filter (where onboarding_completed)::int as completed,
           count(*)::int as total
         from member_profile`,
      ),
      query<{
        members_with_watchlist: number;
        members_with_saved: number;
        watchlist_items: number;
        saved_items: number;
      }>(
        `select
           (select count(distinct user_id)::int from member_watchlist) as members_with_watchlist,
           (select count(distinct user_id)::int from member_saved_item) as members_with_saved,
           (select count(*)::int from member_watchlist_item
             where (created_at at time zone $1)::date between $2::date and $3::date) as watchlist_items,
           (select count(*)::int from member_saved_item
             where (created_at at time zone $1)::date between $2::date and $3::date) as saved_items`,
        [tz, range.from, range.to],
      ),
      query<{ day: string; value: number }>(
        `select ("createdAt" at time zone $1)::date::text as day, count(*)::int as value
         from "user"
         where ("createdAt" at time zone $1)::date between $2::date and $3::date
         group by 1 order by 1`,
        [tz, range.from, range.to],
      ),
      query<{ day: string; value: number }>(
        `select day::text as day, count(*)::int as value
         from member_login_event
         where day between $1::date and $2::date
         group by 1 order by 1`,
        [range.from, range.to],
      ),
      query<PageRow>(
        `select path, count(*)::int as views, count(distinct visitor_hash)::int as visitors
         from site_page_view
         where day between $1::date and $2::date and not is_operator
         group by path
         order by views desc
         limit 8`,
        [range.from, range.to],
      ),
      query<ReferrerRow>(
        `select referrer_category as category, count(*)::int as views
         from site_page_view
         where day between $1::date and $2::date and not is_operator
         group by referrer_category
         order by views desc
         limit 8`,
        [range.from, range.to],
      ),
    ]);

    const members = memberRows[0];
    const waitlist = waitlistRows[0];
    const traffic = trafficRows[0];
    const signIns = signInRows[0];
    const engagement = engagementRows[0];

    return {
      degraded: false,
      timezone: REPORTING_TIMEZONE,
      members: {
        total: members?.total ?? 0,
        today: members?.today ?? 0,
        window: {
          current: members?.current ?? 0,
          previous: members?.previous ?? 0,
          change: percentChange(members?.current ?? 0, members?.previous ?? 0),
        },
        firstAt: members?.first_at ?? null,
      },
      waitlist: {
        total: waitlist?.total ?? 0,
        today: waitlist?.today ?? 0,
        window: {
          current: waitlist?.current ?? 0,
          previous: waitlist?.previous ?? 0,
          change: percentChange(waitlist?.current ?? 0, waitlist?.previous ?? 0),
        },
        firstAt: waitlist?.first_at ?? null,
      },
      traffic: {
        views: traffic?.views ?? 0,
        visitors: traffic?.visitors ?? 0,
        tracked: Boolean(traffic?.since),
        since: traffic?.since ?? null,
      },
      signIns: {
        window: signIns?.n ?? 0,
        tracked: Boolean(signIns?.since),
        since: signIns?.since ?? null,
        activeSessions: sessionRows[0]?.n ?? 0,
      },
      membership: membershipRows,
      conversion: {
        matched: conversionRows[0]?.matched ?? 0,
        waitlistTotal: conversionRows[0]?.total ?? 0,
        rate:
          (conversionRows[0]?.total ?? 0) > 0
            ? ((conversionRows[0]?.matched ?? 0) / (conversionRows[0]?.total ?? 1)) * 100
            : null,
      },
      onboarding: {
        completed: onboardingRows[0]?.completed ?? 0,
        total: onboardingRows[0]?.total ?? 0,
      },
      engagement: {
        membersWithWatchlist: engagement?.members_with_watchlist ?? 0,
        membersWithSaved: engagement?.members_with_saved ?? 0,
        watchlistItems: engagement?.watchlist_items ?? 0,
        savedItems: engagement?.saved_items ?? 0,
      },
      registrations: fillSeries(registrationSeries, range.from, range.to),
      signInSeries: fillSeries(signInSeries, range.from, range.to),
      topPages,
      referrers,
    };
  } catch (cause) {
    console.log(
      "[v0] admin overview query failed:",
      cause instanceof Error ? cause.message : cause,
    );
    return emptyOverview(range);
  }
}
