// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  REPORTING_TIMEZONE,
  addDays,
  daysBetween,
  percentChange,
  previousRange,
  resolveRange,
  timezoneLabel,
  todayInReportingZone,
} from "@/lib/admin/period";

describe("reporting timezone", () => {
  it("uses a single declared zone", () => {
    expect(REPORTING_TIMEZONE).toBe("Europe/London");
  });

  it("rolls to the next day once London passes midnight in summer time", () => {
    // 23:30 UTC on 1 July is 00:30 BST on 2 July.
    expect(todayInReportingZone(new Date("2026-07-01T23:30:00Z"))).toBe("2026-07-02");
  });

  it("stays on the same day before midnight in winter time", () => {
    // 23:30 UTC on 15 January is 23:30 GMT on 15 January.
    expect(todayInReportingZone(new Date("2026-01-15T23:30:00Z"))).toBe("2026-01-15");
  });

  it("rolls over at 00:00 GMT in winter", () => {
    expect(todayInReportingZone(new Date("2026-01-15T00:00:00Z"))).toBe("2026-01-15");
    expect(todayInReportingZone(new Date("2026-01-15T23:59:59Z"))).toBe("2026-01-15");
    expect(todayInReportingZone(new Date("2026-01-16T00:00:00Z"))).toBe("2026-01-16");
  });

  it("labels the zone with its current abbreviation", () => {
    expect(timezoneLabel(new Date("2026-01-15T12:00:00Z"))).toContain("Europe/London");
    expect(timezoneLabel(new Date("2026-07-15T12:00:00Z"))).toContain("Europe/London");
  });
});

describe("day arithmetic", () => {
  it("crosses month and year boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("counts days inclusively", () => {
    expect(daysBetween("2026-01-01", "2026-01-01")).toBe(1);
    expect(daysBetween("2026-01-01", "2026-01-07")).toBe(7);
  });
});

describe("range resolution", () => {
  const now = new Date("2026-11-08T12:00:00Z");

  it("defaults to the last 30 days", () => {
    const range = resolveRange({}, now);
    expect(range.preset).toBe("30d");
    expect(range.to).toBe("2026-11-08");
    expect(range.from).toBe("2026-10-10");
    expect(range.days).toBe(30);
  });

  it("resolves each preset to an inclusive window ending today", () => {
    expect(resolveRange({ preset: "today" }, now)).toMatchObject({
      from: "2026-11-08",
      to: "2026-11-08",
      days: 1,
    });
    expect(resolveRange({ preset: "7d" }, now)).toMatchObject({
      from: "2026-11-02",
      to: "2026-11-08",
      days: 7,
    });
    expect(resolveRange({ preset: "90d" }, now)).toMatchObject({ days: 90 });
  });

  it("accepts a valid custom range", () => {
    const range = resolveRange(
      { preset: "custom", from: "2026-01-01", to: "2026-01-31" },
      now,
    );
    expect(range.preset).toBe("custom");
    expect(range.days).toBe(31);
  });

  it("swaps a reversed custom range instead of returning nothing", () => {
    const range = resolveRange(
      { preset: "custom", from: "2026-01-31", to: "2026-01-01" },
      now,
    );
    expect(range.from).toBe("2026-01-01");
    expect(range.to).toBe("2026-01-31");
  });

  it("rejects a malformed custom range and falls back", () => {
    expect(resolveRange({ preset: "custom", from: "not-a-date", to: "2026-01-31" }, now).preset).toBe(
      "30d",
    );
    expect(resolveRange({ preset: "custom", from: "2026-02-31", to: "2026-03-01" }, now).preset).toBe(
      "30d",
    );
  });

  it("refuses an unbounded custom range", () => {
    const range = resolveRange(
      { preset: "custom", from: "2000-01-01", to: "2026-01-01" },
      now,
    );
    expect(range.preset).toBe("30d");
    expect(range.days).toBe(30);
  });

  it("ignores an unknown preset", () => {
    expect(resolveRange({ preset: "all-time" }, now).preset).toBe("30d");
  });
});

describe("previous period", () => {
  it("is the equal-length window immediately before", () => {
    const range = resolveRange({ preset: "7d" }, new Date("2026-11-08T12:00:00Z"));
    const previous = previousRange(range);

    expect(previous.to).toBe("2026-11-01");
    expect(previous.from).toBe("2026-10-26");
    expect(previous.days).toBe(range.days);
  });

  it("does not overlap the current window", () => {
    const range = resolveRange({ preset: "30d" }, new Date("2026-11-08T12:00:00Z"));
    const previous = previousRange(range);
    expect(previous.to < range.from).toBe(true);
  });
});

describe("percent change", () => {
  it("returns null when there is no baseline", () => {
    expect(percentChange(5, 0)).toBeNull();
    expect(percentChange(0, 0)).toBeNull();
  });

  it("computes growth and decline", () => {
    expect(percentChange(10, 5)).toBe(100);
    expect(percentChange(5, 10)).toBe(-50);
    expect(percentChange(0, 4)).toBe(-100);
  });
});
