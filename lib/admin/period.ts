/**
 * Reporting windows for the admin control centre.
 *
 * Every business metric is grouped by calendar day in the reporting timezone,
 * not in UTC and not in the server's local zone. A signup at 00:30 in London is
 * a Tuesday signup even though it is still Monday in UTC, and a dashboard that
 * disagrees with the founder's own calendar is worse than no dashboard.
 *
 * Dates are handled as `YYYY-MM-DD` strings throughout. Day arithmetic runs in
 * UTC on those strings, which is exact because a calendar date has no timezone
 * of its own — the timezone only enters when a timestamp is bucketed, and that
 * happens in SQL via `AT TIME ZONE`.
 */

export const REPORTING_TIMEZONE = "Europe/London";

export const RANGE_PRESETS = ["today", "7d", "30d", "90d", "custom"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

/** Guards against a hand-edited `?from=` turning into a full-table scan. */
const MAX_RANGE_DAYS = 366;

export interface DateRange {
  preset: RangePreset;
  /** Inclusive first day, `YYYY-MM-DD` in the reporting timezone. */
  from: string;
  /** Inclusive last day, `YYYY-MM-DD` in the reporting timezone. */
  to: string;
  /** Number of calendar days covered, always >= 1. */
  days: number;
  label: string;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Today's calendar date in the reporting timezone. */
export function todayInReportingZone(now: Date = new Date()): string {
  // `en-CA` formats as YYYY-MM-DD, which is the shape the rest of this module
  // and the SQL comparisons expect.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORTING_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function toUtcMs(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return Date.UTC(year, month - 1, date);
}

function fromUtcMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(day: string, delta: number): string {
  return fromUtcMs(toUtcMs(day) + delta * 86_400_000);
}

/** Inclusive day count between two `YYYY-MM-DD` values. */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / 86_400_000) + 1;
}

function isValidDay(value: string | undefined | null): value is string {
  if (!value || !ISO_DAY.test(value)) return false;
  const [year, month, date] = value.split("-").map(Number);
  if (month < 1 || month > 12 || date < 1 || date > 31) return false;
  // Rejects 2026-02-31, which `Date.UTC` would silently roll forward.
  return fromUtcMs(toUtcMs(value)) === value && year >= 2000 && year <= 2100;
}

function presetDays(preset: Exclude<RangePreset, "custom">): number {
  switch (preset) {
    case "today":
      return 1;
    case "7d":
      return 7;
    case "30d":
      return 30;
    case "90d":
      return 90;
  }
}

function labelFor(preset: RangePreset, days: number): string {
  switch (preset) {
    case "today":
      return "Today";
    case "7d":
      return "Last 7 days";
    case "30d":
      return "Last 30 days";
    case "90d":
      return "Last 90 days";
    case "custom":
      return `${days} day${days === 1 ? "" : "s"}`;
  }
}

/**
 * Resolves a range from URL search params. Anything unrecognised, malformed or
 * out of bounds falls back to the 30-day default rather than erroring, so a
 * stale bookmark still renders a dashboard.
 */
export function resolveRange(
  params: { preset?: string; from?: string; to?: string } = {},
  now: Date = new Date(),
): DateRange {
  const today = todayInReportingZone(now);
  const requested = params.preset as RangePreset | undefined;

  if (requested === "custom" && isValidDay(params.from) && isValidDay(params.to)) {
    const [start, end] = params.from <= params.to
      ? [params.from, params.to]
      : [params.to, params.from];

    const span = daysBetween(start, end);

    if (span <= MAX_RANGE_DAYS) {
      return { preset: "custom", from: start, to: end, days: span, label: labelFor("custom", span) };
    }
  }

  const preset: Exclude<RangePreset, "custom"> =
    requested && requested !== "custom" && RANGE_PRESETS.includes(requested)
      ? requested
      : "30d";

  const days = presetDays(preset);

  return {
    preset,
    from: addDays(today, -(days - 1)),
    to: today,
    days,
    label: labelFor(preset, days),
  };
}

/**
 * The equal-length window immediately before `range`. Used for the "vs previous
 * period" comparison, which is only shown when the earlier window is actually
 * covered by recorded data.
 */
export function previousRange(range: DateRange): DateRange {
  const to = addDays(range.from, -1);
  const from = addDays(to, -(range.days - 1));

  return {
    preset: "custom",
    from,
    to,
    days: range.days,
    label: `Previous ${range.days} days`,
  };
}

/** Percentage change, or `null` when there is no baseline to compare against. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

/** Human label for the reporting timezone, e.g. "Europe/London (GMT)". */
export function timezoneLabel(now: Date = new Date()): string {
  const zone =
    new Intl.DateTimeFormat("en-GB", {
      timeZone: REPORTING_TIMEZONE,
      timeZoneName: "short",
    })
      .formatToParts(now)
      .find((part) => part.type === "timeZoneName")?.value ?? "GMT";

  return `${REPORTING_TIMEZONE} (${zone})`;
}
