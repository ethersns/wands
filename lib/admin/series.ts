import { addDays, daysBetween } from "./period";

export interface DayPoint {
  day: string;
  value: number;
}

/**
 * Expands sparse `group by day` results into a continuous series.
 *
 * A chart that silently omits empty days draws a straight line through a week
 * of zero signups and reads as steady growth. Every day in the window is
 * present here, with an explicit zero, so a gap looks like a gap.
 */
export function fillSeries(
  rows: { day: string; value: number }[],
  from: string,
  to: string,
): DayPoint[] {
  const byDay = new Map(rows.map((row) => [row.day, Number(row.value)]));
  const span = daysBetween(from, to);

  if (span <= 0) return [];

  return Array.from({ length: span }, (_, index) => {
    const day = addDays(from, index);
    return { day, value: byDay.get(day) ?? 0 };
  });
}

export function sumSeries(points: DayPoint[]): number {
  return points.reduce((total, point) => total + point.value, 0);
}

/** Short axis label, e.g. "8 Nov". */
export function shortDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, date)));
}
