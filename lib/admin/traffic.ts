import "server-only";

import { isDatabaseConfigured, query } from "@/lib/db";

import { REPORTING_TIMEZONE, type DateRange } from "./period";
import { fillSeries, type DayPoint } from "./series";

/**
 * First-party web traffic.
 *
 * Wands had no analytics provider enabled, so this reads the `site_page_view`
 * table written by the beacon in `app/api/track/route.ts`. Two properties make
 * the numbers trustworthy:
 *
 *   * `visitor_hash` is salted with a value that rotates daily, so a "unique
 *     visitor" is unique *within a day* and cannot be followed across days.
 *   * Operator traffic is recorded but excluded from every figure here, so the
 *     founder browsing their own site does not inflate their own dashboard.
 *
 * `since` is the first day with a recorded view. Before that date the honest
 * answer is "not tracked", not zero.
 */

export interface TrafficSummary {
  views: number;
  visitors: number;
  tracked: boolean;
  since: string | null;
  series: DayPoint[];
  visitorSeries: DayPoint[];
  topPages: { path: string; views: number; visitors: number }[];
  landingPages: { path: string; views: number; visitors: number }[];
  referrers: { category: string; views: number }[];
  campaigns: {
    source: string;
    medium: string;
    campaign: string;
    views: number;
  }[];
}

export function emptyTraffic(range: DateRange): TrafficSummary {
  return {
    views: 0,
    visitors: 0,
    tracked: false,
    since: null,
    series: fillSeries([], range.from, range.to),
    visitorSeries: fillSeries([], range.from, range.to),
    topPages: [],
    landingPages: [],
    referrers: [],
    campaigns: [],
  };
}

export async function getTraffic(range: DateRange): Promise<TrafficSummary> {
  if (!isDatabaseConfigured()) return emptyTraffic(range);

  try {
    const [totals, viewSeries, visitorSeries, topPages, landingPages, referrers, campaigns] =
      await Promise.all([
        query<{ views: number; visitors: number; since: string | null }>(
          `select
             count(*)::int as views,
             count(distinct visitor_hash)::int as visitors,
             (select min(day)::text from site_page_view) as since
           from site_page_view
           where day between $1::date and $2::date and not is_operator`,
          [range.from, range.to],
        ),
        query<{ day: string; value: number }>(
          `select day::text as day, count(*)::int as value
           from site_page_view
           where day between $1::date and $2::date and not is_operator
           group by 1 order by 1`,
          [range.from, range.to],
        ),
        query<{ day: string; value: number }>(
          `select day::text as day, count(distinct visitor_hash)::int as value
           from site_page_view
           where day between $1::date and $2::date and not is_operator
           group by 1 order by 1`,
          [range.from, range.to],
        ),
        query<{ path: string; views: number; visitors: number }>(
          `select path, count(*)::int as views, count(distinct visitor_hash)::int as visitors
           from site_page_view
           where day between $1::date and $2::date and not is_operator
           group by path order by views desc limit 10`,
          [range.from, range.to],
        ),
        query<{ path: string; views: number; visitors: number }>(
          `select path, count(*)::int as views, count(distinct visitor_hash)::int as visitors
           from site_page_view
           where day between $1::date and $2::date
             and not is_operator
             and referrer_category <> 'internal'
           group by path order by views desc limit 10`,
          [range.from, range.to],
        ),
        query<{ category: string; views: number }>(
          `select referrer_category as category, count(*)::int as views
           from site_page_view
           where day between $1::date and $2::date and not is_operator
           group by referrer_category order by views desc limit 10`,
          [range.from, range.to],
        ),
        query<{ source: string; medium: string; campaign: string; views: number }>(
          `select
             coalesce(utm_source, '(none)') as source,
             coalesce(utm_medium, '(none)') as medium,
             coalesce(utm_campaign, '(none)') as campaign,
             count(*)::int as views
           from site_page_view
           where day between $1::date and $2::date
             and not is_operator
             and (utm_source is not null or utm_medium is not null or utm_campaign is not null)
           group by 1, 2, 3 order by views desc limit 15`,
          [range.from, range.to],
        ),
      ]);

    const total = totals[0];

    return {
      views: total?.views ?? 0,
      visitors: total?.visitors ?? 0,
      tracked: Boolean(total?.since),
      since: total?.since ?? null,
      series: fillSeries(viewSeries, range.from, range.to),
      visitorSeries: fillSeries(visitorSeries, range.from, range.to),
      topPages,
      landingPages,
      referrers,
      campaigns,
    };
  } catch (cause) {
    console.log(
      "[wands] admin traffic query failed:",
      cause instanceof Error ? cause.message : cause,
    );
    return emptyTraffic(range);
  }
}

export { REPORTING_TIMEZONE };
