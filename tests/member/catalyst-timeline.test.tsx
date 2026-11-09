import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CatalystTimeline } from "@/components/member/catalyst-timeline";
import type { Catalyst } from "@/lib/api/research-contract";

function catalyst(overrides: Partial<Catalyst> = {}): Catalyst {
  return {
    id: "fed:fomc:2027-01-27",
    kind: "scheduled",
    category: "monetary_policy",
    title: "FOMC policy decision",
    symbols: [],
    market: "US",
    marketWide: true,
    scheduledDate: "2027-01-27",
    scheduledAt: null,
    timePrecision: "date_only",
    timeZone: "America/New_York",
    status: "scheduled",
    occurredAt: null,
    publishedAt: null,
    sourceName: "Federal Reserve FOMC calendar",
    sourceUrl: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
    sourceUpdatedAt: null,
    collectedAt: "2026-11-09T15:00:00Z",
    warnings: [],
    coverageLimitations: [],
    ...overrides,
  };
}

describe("catalyst timeline", () => {
  it("renders a date-only event as a date and never as a time", () => {
    render(<CatalystTimeline items={[catalyst()]} emptyTitle="none" emptyDescription="none" />);

    expect(screen.getByText("2027-01-27")).toBeDefined();
    expect(screen.getByText("date only")).toBeDefined();
    // The source published a day and no clock time, so no clock time may appear.
    expect(screen.queryByText(/\d{2}:\d{2}/)).toBeNull();
  });

  it("renders a disclosure on its publication instant in the stated zone", () => {
    render(
      <CatalystTimeline
        items={[
          catalyst({
            id: "sec:form4:0001-26-000001",
            kind: "disclosure",
            category: "insider_disclosure",
            title: "Apple Inc. filed Form 4 insider disclosure",
            marketWide: false,
            symbols: ["AAPL"],
            scheduledDate: null,
            publishedAt: "2026-11-05T21:30:00Z",
            timePrecision: "exact",
            timeZone: "UTC",
            status: "published",
            occurredAt: "2026-11-03T15:00:00Z",
            sourceName: "SEC EDGAR",
            sourceUrl: "https://www.sec.gov/Archives/edgar/data/320193/0001-26-000001",
          }),
        ]}
        emptyTitle="none"
        emptyDescription="none"
      />,
    );

    expect(screen.getByText("2026-11-05 21:30")).toBeDefined();
    expect(screen.getByText("publication time")).toBeDefined();
    expect(screen.getByText("happened 2026-11-03")).toBeDefined();
  });

  it("links a symbol-tagged catalyst to its asset page", () => {
    render(
      <CatalystTimeline
        items={[catalyst({ marketWide: false, symbols: ["AAPL"] })]}
        emptyTitle="none"
        emptyDescription="none"
      />,
    );

    const link = screen.getByRole("link", { name: "AAPL" });
    expect(link.getAttribute("href")).toBe("/app/assets/AAPL");
  });

  it("shows a source warning rather than hiding it", () => {
    render(
      <CatalystTimeline
        items={[
          catalyst({
            warnings: ["The decision date is derived from the meeting range."],
          }),
        ]}
        emptyTitle="none"
        emptyDescription="none"
      />,
    );

    expect(screen.getByText(/derived from the meeting range/)).toBeDefined();
  });

  it("opens the source document in a new tab with a screen-reader hint", () => {
    render(<CatalystTimeline items={[catalyst()]} emptyTitle="none" emptyDescription="none" />);

    const link = screen.getByRole("link", { name: /Federal Reserve FOMC calendar/ });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noreferrer");
    expect(screen.getByText(/opens in a new tab/)).toBeDefined();
  });

  it("renders the empty state instead of a blank list", () => {
    render(
      <CatalystTimeline
        items={[]}
        emptyTitle="No scheduled events in this window"
        emptyDescription="Nothing scheduled falls inside the selected window."
      />,
    );

    expect(screen.getByText("No scheduled events in this window")).toBeDefined();
  });
});
