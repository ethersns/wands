import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MarketBriefView } from "@/components/member/market-brief";
import type { Catalyst, CatalystFeed, ResearchDashboard } from "@/lib/api/research-contract";
import { buildMarketBrief, type MarketBriefInputs } from "@/lib/member/brief-model";

const AS_OF = "2026-11-09T15:00:00Z";

function catalyst(overrides: Partial<Catalyst> = {}): Catalyst {
  return {
    id: "fed:fomc:2026-11-12",
    kind: "scheduled",
    category: "monetary_policy",
    title: "FOMC policy decision",
    symbols: [],
    market: "US",
    marketWide: true,
    scheduledDate: "2026-11-12",
    scheduledAt: null,
    timePrecision: "date_only",
    timeZone: "America/New_York",
    status: "scheduled",
    occurredAt: null,
    publishedAt: null,
    sourceName: "Federal Reserve FOMC calendar",
    sourceUrl: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
    sourceUpdatedAt: null,
    collectedAt: "2026-11-09T14:00:00Z",
    warnings: [],
    coverageLimitations: [],
    ...overrides,
  };
}

function catalystFeed(items: Catalyst[] = []): CatalystFeed {
  return {
    items,
    sources: [
      {
        source: "fed_fomc",
        label: "Federal Reserve FOMC calendar",
        status: "ok",
        detail: "read",
        eventCount: items.length,
        sourceUrl: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
        fetchedAt: "2026-11-09T14:00:00Z",
      },
    ],
    windowStart: "2026-10-10",
    windowEnd: "2026-12-09",
    upcoming: items.length,
    recent: 0,
    caveats: [],
    coverageLimitations: [],
  };
}

function dashboard(): ResearchDashboard {
  return {
    asOf: AS_OF,
    freshness: "fresh",
    counts: { filings: 0, transactions: 0, signals: 0, institutions: 0, holdings: 0, symbols: 0 },
    latestFilingAt: null,
    latestSignalAt: null,
    topSignals: [],
    recentPurchases: [],
    coverage: {
      status: "complete",
      windowStart: null,
      windowEnd: null,
      symbolsCovered: 0,
      symbolsRequested: 0,
      gaps: [],
      caveats: [],
    },
    caveats: [],
  };
}

function brief(overrides: Partial<MarketBriefInputs> = {}) {
  return buildMarketBrief({
    asOf: AS_OF,
    watchlist: [],
    dashboard: dashboard(),
    coverage: {
      status: "complete",
      windowStart: null,
      windowEnd: null,
      symbolsCovered: 0,
      symbolsRequested: 0,
      gaps: [],
      caveats: [],
    },
    catalysts: catalystFeed(),
    insiders: { items: [], total: 0, page: 1, limit: 50, hasMore: false },
    institutions: { items: [], total: 0, page: 1, limit: 50, hasMore: false },
    signals: { items: [], total: 0, page: 1, limit: 50, hasMore: false },
    unreachable: false,
    warnings: [],
    ...overrides,
  });
}

describe("market brief view", () => {
  it("renders every section of the briefing", () => {
    render(<MarketBriefView brief={brief()} />);

    expect(screen.getByText("Market context")).toBeDefined();
    expect(screen.getByText("Upcoming catalysts")).toBeDefined();
    expect(screen.getByText("Insider disclosures")).toBeDefined();
    expect(screen.getByText("Institutional filings")).toBeDefined();
    expect(screen.getByText("Research signals")).toBeDefined();
    expect(screen.getByText("What deserves investigation")).toBeDefined();
    expect(screen.getByText("Known limitations")).toBeDefined();
  });

  it("renders a date-only catalyst as a day and never as a clock time", () => {
    render(<MarketBriefView brief={brief({ catalysts: catalystFeed([catalyst()]) })} />);

    expect(screen.getByText("2026-11-12")).toBeDefined();
    expect(screen.getByText("date only")).toBeDefined();

    const section = screen.getByText("Upcoming catalysts").closest("section");
    const row = within(section as HTMLElement).getByText("FOMC policy decision").closest("li");
    expect(row?.textContent).not.toMatch(/\d{2}:\d{2}/);
  });

  it("states that no market-wide performance data exists", () => {
    render(<MarketBriefView brief={brief()} />);

    expect(
      screen.getByText(/No index, volatility or price-change series is part of the research contract/),
    ).toBeDefined();
  });

  it("shows an honest empty state when nothing crossed a rule", () => {
    render(<MarketBriefView brief={brief()} />);

    expect(screen.getByText("Nothing crossed a rule")).toBeDefined();
    expect(screen.getByText("Add a ticker")).toBeDefined();
  });

  it("explains how items were selected", () => {
    render(<MarketBriefView brief={brief()} />);

    expect(screen.getByText("How these items were selected")).toBeDefined();
    expect(screen.getByText(/not recommendations to trade/)).toBeDefined();
  });

  it("labels a research ranking as a ranking, not a probability", () => {
    render(
      <MarketBriefView
        brief={brief({
          signals: {
            items: [
              {
                id: "sig-1",
                category: "INSIDER_PURCHASE_CLUSTER",
                symbol: "AAPL",
                sourceEventIds: ["tx-1"],
                eventTime: "2026-11-05T00:00:00Z",
                publicAvailableAt: "2026-11-08T21:30:00Z",
                calculatedAt: "2026-11-08T21:35:00Z",
                rawMeasurement: 3,
                rawUnit: "distinct purchasers",
                score: 72,
                explanation: "Three distinct officers purchased in the same week.",
                dataQuality: "derived",
                confidenceNotes: "Derived from three Form 4 filings.",
                parameters: {},
                engineVersion: "1.0.0",
              },
            ],
            total: 1,
            page: 1,
            limit: 50,
            hasMore: false,
          },
        })}
      />,
    );

    expect(screen.getByText(/research ranking 72\/100 · not a probability/)).toBeDefined();
  });

  it("says no ranking exists rather than showing a zero", () => {
    render(
      <MarketBriefView
        brief={brief({
          signals: {
            items: [
              {
                id: "sig-2",
                category: "VOLUME_ANOMALY",
                symbol: "AAPL",
                sourceEventIds: [],
                eventTime: "2026-11-05T00:00:00Z",
                publicAvailableAt: "2026-11-08T21:30:00Z",
                calculatedAt: "2026-11-08T21:35:00Z",
                rawMeasurement: 2.4,
                rawUnit: "z-score",
                score: null,
                explanation: "Volume ran above its trailing range.",
                dataQuality: "derived",
                confidenceNotes: "Derived from daily bars.",
                parameters: {},
                engineVersion: "1.0.0",
              },
            ],
            total: 1,
            page: 1,
            limit: 50,
            hasMore: false,
          },
        })}
      />,
    );

    expect(screen.getByText("no research ranking")).toBeDefined();
  });

  it("marks an unreachable engine in the masthead", () => {
    render(<MarketBriefView brief={brief({ unreachable: true })} />);

    expect(screen.getByText("engine unreachable")).toBeDefined();
  });
});
