// @vitest-environment node

import { describe, expect, it } from "vitest";

import { fillSeries, shortDay, sumSeries } from "@/lib/admin/series";

describe("fillSeries", () => {
  it("inserts an explicit zero for a day with no rows", () => {
    const series = fillSeries(
      [
        { day: "2026-11-01", value: 2 },
        { day: "2026-11-04", value: 5 },
      ],
      "2026-11-01",
      "2026-11-04",
    );

    expect(series).toEqual([
      { day: "2026-11-01", value: 2 },
      { day: "2026-11-02", value: 0 },
      { day: "2026-11-03", value: 0 },
      { day: "2026-11-04", value: 5 },
    ]);
  });

  it("returns one point for a single-day window", () => {
    expect(fillSeries([], "2026-11-08", "2026-11-08")).toEqual([
      { day: "2026-11-08", value: 0 },
    ]);
  });

  it("returns nothing for an inverted window", () => {
    expect(fillSeries([], "2026-11-08", "2026-11-01")).toEqual([]);
  });

  it("ignores rows outside the window", () => {
    const series = fillSeries(
      [
        { day: "2026-10-31", value: 9 },
        { day: "2026-11-02", value: 1 },
        { day: "2026-11-09", value: 7 },
      ],
      "2026-11-01",
      "2026-11-03",
    );

    expect(series.map((point) => point.value)).toEqual([0, 1, 0]);
  });

  it("coerces string counts from the driver", () => {
    const series = fillSeries(
      [{ day: "2026-11-01", value: "3" as unknown as number }],
      "2026-11-01",
      "2026-11-01",
    );
    expect(series[0].value).toBe(3);
  });

  it("crosses a month boundary", () => {
    const series = fillSeries([], "2026-01-30", "2026-02-02");
    expect(series.map((point) => point.day)).toEqual([
      "2026-01-30",
      "2026-01-31",
      "2026-02-01",
      "2026-02-02",
    ]);
  });
});

describe("sumSeries", () => {
  it("adds the window", () => {
    expect(
      sumSeries([
        { day: "2026-11-01", value: 2 },
        { day: "2026-11-02", value: 3 },
      ]),
    ).toBe(5);
  });

  it("is zero for an empty series", () => {
    expect(sumSeries([])).toBe(0);
  });
});

describe("shortDay", () => {
  it("formats a day without shifting it", () => {
    expect(shortDay("2026-11-08")).toBe("8 Nov");
    expect(shortDay("2026-01-01")).toBe("1 Jan");
  });
});
