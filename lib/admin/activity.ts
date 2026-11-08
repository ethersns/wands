import "server-only";

import { isDatabaseConfigured, query } from "@/lib/db";

import { REPORTING_TIMEZONE, type DateRange } from "./period";
import { fillSeries, type DayPoint } from "./series";

/**
 * Registration, sign-in and engagement activity.
 *
 * Four events are kept distinct because conflating them is how dashboards start
 * lying: a member account created, onboarding completed, a waitlist signup, and
 * a returning sign-in are different things and are counted separately.
 *
 * "Active member" has one explicit definition here: an account that recorded at
 * least one successful sign-in inside the window. It is not "has a row in the
 * database", because a row proves an account exists, not that anyone used it.
 */

export interface ActivitySummary {
  registrations: DayPoint[];
  signIns: DayPoint[];
  activeMembers: DayPoint[];
  onboarding: DayPoint[];
  totals: {
    registrations: number;
    signIns: number;
    activeMembers: number;
    onboardingCompleted: number;
    onboardingStarted: number;
  };
  signInTracked: boolean;
  signInSince: string | null;
  engagement: {
    watchlistCreators: number;
    savedCreators: number;
    watchlistItems: number;
    savedItems: number;
    notificationsRead: number;
  };
  recentSignIns: { user_id: string; email: string | null; occurred_at: string }[];
}

export function emptyActivity(range: DateRange): ActivitySummary {
  return {
    registrations: fillSeries([], range.from, range.to),
    signIns: fillSeries([], range.from, range.to),
    activeMembers: fillSeries([], range.from, range.to),
    onboarding: fillSeries([], range.from, range.to),
    totals: {
      registrations: 0,
      signIns: 0,
      activeMembers: 0,
      onboardingCompleted: 0,
      onboardingStarted: 0,
    },
    signInTracked: false,
    signInSince: null,
    engagement: {
      watchlistCreators: 0,
      savedCreators: 0,
      watchlistItems: 0,
      savedItems: 0,
      notificationsRead: 0,
    },
    recentSignIns: [],
  };
}

export async function getActivity(range: DateRange): Promise<ActivitySummary> {
  if (!isDatabaseConfigured()) return emptyActivity(range);

  const tz = REPORTING_TIMEZONE;

  try {
    const [
      registrations,
      signIns,
      activeMembers,
      onboarding,
      totals,
      engagement,
      recentSignIns,
    ] = await Promise.all([
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
      query<{ day: string; value: number }>(
        `select day::text as day, count(distinct user_id)::int as value
         from member_login_event
         where day between $1::date and $2::date
         group by 1 order by 1`,
        [range.from, range.to],
      ),
      query<{ day: string; value: number }>(
        `select (updated_at at time zone $1)::date::text as day, count(*)::int as value
         from member_profile
         where onboarding_completed
           and (updated_at at time zone $1)::date between $2::date and $3::date
         group by 1 order by 1`,
        [tz, range.from, range.to],
      ),
      query<{
        registrations: number;
        sign_ins: number;
        active_members: number;
        onboarding_completed: number;
        onboarding_started: number;
        sign_in_since: string | null;
      }>(
        `select
           (select count(*)::int from "user"
             where ("createdAt" at time zone $1)::date between $2::date and $3::date) as registrations,
           (select count(*)::int from member_login_event
             where day between $2::date and $3::date) as sign_ins,
           (select count(distinct user_id)::int from member_login_event
             where day between $2::date and $3::date) as active_members,
           (select count(*)::int from member_profile where onboarding_completed) as onboarding_completed,
           (select count(*)::int from member_profile) as onboarding_started,
           (select min(day)::text from member_login_event) as sign_in_since`,
        [tz, range.from, range.to],
      ),
      query<{
        watchlist_creators: number;
        saved_creators: number;
        watchlist_items: number;
        saved_items: number;
        notifications_read: number;
      }>(
        `select
           (select count(distinct user_id)::int from member_watchlist
             where (created_at at time zone $1)::date between $2::date and $3::date) as watchlist_creators,
           (select count(distinct user_id)::int from member_saved_item
             where (created_at at time zone $1)::date between $2::date and $3::date) as saved_creators,
           (select count(*)::int from member_watchlist_item
             where (created_at at time zone $1)::date between $2::date and $3::date) as watchlist_items,
           (select count(*)::int from member_saved_item
             where (created_at at time zone $1)::date between $2::date and $3::date) as saved_items,
           (select count(*)::int from member_notification
             where read_at is not null
               and (read_at at time zone $1)::date between $2::date and $3::date) as notifications_read`,
        [tz, range.from, range.to],
      ),
      query<{ user_id: string; email: string | null; occurred_at: string }>(
        `select e.user_id, u.email, e.occurred_at
         from member_login_event e
         left join "user" u on u.id = e.user_id
         order by e.occurred_at desc
         limit 10`,
      ),
    ]);

    const total = totals[0];

    return {
      registrations: fillSeries(registrations, range.from, range.to),
      signIns: fillSeries(signIns, range.from, range.to),
      activeMembers: fillSeries(activeMembers, range.from, range.to),
      onboarding: fillSeries(onboarding, range.from, range.to),
      totals: {
        registrations: total?.registrations ?? 0,
        signIns: total?.sign_ins ?? 0,
        activeMembers: total?.active_members ?? 0,
        onboardingCompleted: total?.onboarding_completed ?? 0,
        onboardingStarted: total?.onboarding_started ?? 0,
      },
      signInTracked: Boolean(total?.sign_in_since),
      signInSince: total?.sign_in_since ?? null,
      engagement: {
        watchlistCreators: engagement[0]?.watchlist_creators ?? 0,
        savedCreators: engagement[0]?.saved_creators ?? 0,
        watchlistItems: engagement[0]?.watchlist_items ?? 0,
        savedItems: engagement[0]?.saved_items ?? 0,
        notificationsRead: engagement[0]?.notifications_read ?? 0,
      },
      recentSignIns,
    };
  } catch (cause) {
    console.log(
      "[v0] admin activity query failed:",
      cause instanceof Error ? cause.message : cause,
    );
    return emptyActivity(range);
  }
}
