import { describe, expect, it } from "vitest";

import type {
  InsiderFeed,
  InsiderTransaction,
  Institution,
  InstitutionFeed,
  ResearchSignal,
  SignalFeed,
} from "@/lib/api/contracts";
import type {
  Catalyst,
  CatalystFeed,
  ResearchCoverageDisclosure,
  ResearchDashboard,
} from "@/lib/api/research-contract";
import { buildMarketBrief, type MarketBriefInputs } from "@/lib/member/brief-model";

/**
 * Deterministic fixtures. These are not live data: they exercise the selection
 * rules, and a passing suite says nothing about what the engine currently holds.
 */

const AS_OF = "2026-11-09T15:00:00Z";

function coverage(overrides: Partial<ResearchCoverageDisclosure> = {}): ResearchCoverageDisclosure {
  return {
    status: "complete",
    windowStart: "2026-01-01",
    windowEnd: "2026-11-08",
    symbolsCovered: 24,
    symbolsRequested: 24,
    gaps: [],
    caveats: [],
    ...overrides,
  };
}

function dashboard(overrides: Partial<ResearchDashboard> = {}): ResearchDashboard {
  return {
    asOf: AS_OF,
    freshness: "fresh",
    counts: {
      filings: 120,
      transactions: 340,
      signals: 12,
      institutions: 8,
      holdings: 90,
      symbols: 24,
    },
    latestFilingAt: "2026-11-08T20:00:00Z",
    latestSignalAt: "2026-11-07T14:00:00Z",
    topSignals: [],
    recentPurchases: [],
    coverage: coverage(),
    caveats: [],
    ...overrides,
  };
}

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

function catalystFeed(items: Catalyst[] = [], overrides: Partial<CatalystFeed> = {}): CatalystFeed {
  return {
    items,
    sources: [
      {
        source: "fed_fomc",
        label: "Federal Reserve FOMC calendar",
        status: "ok",
        detail: "read 1 event",
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
    ...overrides,
  };
}

function insider(overrides: Partial<InsiderTransaction> = {}): InsiderTransaction {
  return {
    id: "tx-1",
    accessionNumber: "0000000000-26-000001",
    symbol: "AAPL",
    issuerName: "Apple Inc.",
    reportingPersonName: "Jane Director",
    reportingPersonCik: "0001234567",
    role: "Director",
    transactionDate: "2026-11-05",
    transactionCode: "P",
    classification: "open_market_purchase",
    isOpenMarket: true,
    securityTitle: "Common Stock",
    shares: 1000,
    pricePerShare: 190.5,
    value: 190500,
    sharesOwnedAfter: 5000,
    directOrIndirect: "D",
    acceptedAt: "2026-11-07T21:30:00Z",
    isAmendment: false,
    sourceUrl: "https://www.sec.gov/Archives/edgar/data/320193/000000000026000001/x.xml",
    description: "Open-market purchase",
    dataQuality: "reported",
    ...overrides,
  };
}

function insiderFeed(items: InsiderTransaction[] = []): InsiderFeed {
  return { items, total: items.length, page: 1, limit: 50, hasMore: false };
}

function institution(overrides: Partial<Institution> = {}): Institution {
  return {
    cik: "0001067983",
    name: "Example Capital LP",
    periods: ["2026-06-30"],
    latestPeriod: "2026-06-30",
    latestPublicAvailableAt: "2026-08-14T20:00:00Z",
    reportedValueUsd: 1_200_000_000,
    positionCount: 42,
    caveats: [],
    ...overrides,
  };
}

function institutionFeed(items: Institution[] = []): InstitutionFeed {
  return { items, total: items.length, page: 1, limit: 50, hasMore: false };
}

function signal(overrides: Partial<ResearchSignal> = {}): ResearchSignal {
  return {
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
    ...overrides,
  };
}

function signalFeed(items: ResearchSignal[] = []): SignalFeed {
  return { items, total: items.length, page: 1, limit: 50, hasMore: false };
}

function inputs(overrides: Partial<MarketBriefInputs> = {}): MarketBriefInputs {
  return {
    asOf: AS_OF,
    watchlist: [],
    dashboard: dashboard(),
    coverage: coverage(),
    catalysts: catalystFeed(),
    insiders: insiderFeed(),
    institutions: institutionFeed(),
    signals: signalFeed(),
    unreachable: false,
    warnings: [],
    ...overrides,
  };
}

describe("founder market brief", () => {
  it("assembles a complete source-backed brief from every feed", () => {
    const brief = buildMarketBrief(
      inputs({
        watchlist: ["AAPL"],
        catalysts: catalystFeed([catalyst()]),
        insiders: insiderFeed([insider()]),
        institutions: institutionFeed([institution()]),
        signals: signalFeed([signal()]),
      }),
    );

    const reasons = brief.investigations.map((item) => item.reason);
    expect(reasons).toContain("watched_disclosure");
    expect(reasons).toContain("market_catalyst");
    expect(reasons).toContain("watched_signal");

    expect(brief.upcomingCatalysts).toHaveLength(1);
    expect(brief.insiderDisclosures).toHaveLength(1);
    expect(brief.institutionalFilings).toHaveLength(1);
    expect(brief.signals).toHaveLength(1);
    expect(brief.watchlist).toEqual(["AAPL"]);
  });

  it("attributes every investigation to a named source", () => {
    const brief = buildMarketBrief(
      inputs({
        watchlist: ["AAPL"],
        catalysts: catalystFeed([catalyst()]),
        insiders: insiderFeed([insider()]),
        signals: signalFeed([signal()]),
      }),
    );

    expect(brief.investigations.length).toBeGreaterThan(0);
    for (const item of brief.investigations) {
      expect(item.sourceName).toBeTruthy();
      if (item.sourceUrl) {
        expect(item.sourceUrl.startsWith("https://")).toBe(true);
      }
    }
  });

  it("reports an empty but healthy brief without inventing activity", () => {
    const brief = buildMarketBrief(inputs());

    expect(brief.investigations).toEqual([]);
    expect(brief.upcomingCatalysts).toEqual([]);
    expect(brief.insiderDisclosures).toEqual([]);
    expect(brief.signals).toEqual([]);
    // A healthy empty brief still states what it cannot cover.
    expect(brief.limitations.some((item) => item.key === "category:earnings")).toBe(true);
    expect(brief.limitations.some((item) => item.key === "market:index")).toBe(true);
  });

  it("surfaces an unreachable engine instead of a zero", () => {
    const brief = buildMarketBrief(
      inputs({
        unreachable: true,
        dashboard: dashboard({ freshness: "never", latestFilingAt: null, latestSignalAt: null }),
        warnings: ["engine unreachable"],
      }),
    );

    expect(brief.unreachable).toBe(true);
    expect(brief.warnings).toContain("engine unreachable");
    const stale = brief.investigations.find((item) => item.reason === "source_stale");
    expect(stale).toBeDefined();
    expect(stale?.detail).toContain("nothing was collected");
  });

  it("flags stale collection as a reason to investigate", () => {
    const brief = buildMarketBrief(inputs({ dashboard: dashboard({ freshness: "stale" }) }));

    const stale = brief.investigations.find((item) => item.reason === "source_stale");
    expect(stale).toBeDefined();
    expect(stale?.title).toContain("stale");
  });

  it("states that no market-wide price data exists rather than implying flat markets", () => {
    const brief = buildMarketBrief(inputs());

    expect(brief.context.priceDataNote).toContain("not how the market performed");
    const gap = brief.limitations.find((item) => item.key === "market:index");
    expect(gap?.severity).toBe("gap");
    expect(gap?.detail).toContain("No index, volatility or price-change series");
  });

  it("keeps a date-only catalyst as a day and never invents a time", () => {
    const brief = buildMarketBrief(inputs({ catalysts: catalystFeed([catalyst()]) }));

    const item = brief.investigations.find((entry) => entry.reason === "market_catalyst");
    expect(item?.observedAt).toBe("2026-11-12");
    expect(item?.observedAt).not.toContain("T");
    expect(item?.dataQuality).toBe("date_only");
  });

  it("dates a disclosure by its filing time, not its transaction date", () => {
    // Traded 40 days ago, filed 2 days ago: still a new disclosure.
    const recentlyFiled = buildMarketBrief(
      inputs({
        watchlist: ["AAPL"],
        insiders: insiderFeed([
          insider({ transactionDate: "2026-09-30", acceptedAt: "2026-11-07T21:30:00Z" }),
        ]),
      }),
    );
    expect(
      recentlyFiled.investigations.some((item) => item.reason === "watched_disclosure"),
    ).toBe(true);

    // Traded yesterday, filed 40 days ago: not a new disclosure.
    const staleFiling = buildMarketBrief(
      inputs({
        watchlist: ["AAPL"],
        insiders: insiderFeed([
          insider({ transactionDate: "2026-11-08", acceptedAt: "2026-09-30T21:30:00Z" }),
        ]),
      }),
    );
    expect(staleFiling.investigations.some((item) => item.reason === "watched_disclosure")).toBe(
      false,
    );
  });

  it("treats a 13F as a delayed quarterly snapshot, not live activity", () => {
    const brief = buildMarketBrief(inputs({ institutions: institutionFeed([institution()]) }));

    expect(brief.institutionalFilings[0].latestPeriod).toBe("2026-06-30");
    expect(brief.institutionalFilings[0].latestPublicAvailableAt).toBe("2026-08-14T20:00:00Z");
    const caveat = brief.limitations.find((item) => item.key === "institutional:delay");
    expect(caveat?.detail).toContain("never live buying or selling");
  });

  it("does not fire watchlist rules when no symbol is watched", () => {
    const brief = buildMarketBrief(
      inputs({
        watchlist: [],
        insiders: insiderFeed([insider()]),
        signals: signalFeed([signal()]),
      }),
    );

    expect(brief.investigations.some((item) => item.reason === "watched_disclosure")).toBe(false);
    expect(brief.investigations.some((item) => item.reason === "watched_signal")).toBe(false);
    // The records are still listed; they are simply not prioritised.
    expect(brief.insiderDisclosures).toHaveLength(1);
  });

  it("ignores non-open-market filings for the disclosure rule", () => {
    const brief = buildMarketBrief(
      inputs({
        watchlist: ["AAPL"],
        insiders: insiderFeed([
          insider({ classification: "award_grant", isOpenMarket: false, transactionCode: "A" }),
        ]),
      }),
    );

    expect(brief.investigations.some((item) => item.reason === "watched_disclosure")).toBe(false);
  });

  it("prioritises by rule, then recency, deterministically", () => {
    const brief = buildMarketBrief(
      inputs({
        watchlist: ["AAPL"],
        dashboard: dashboard({ freshness: "stale" }),
        catalysts: catalystFeed([catalyst()]),
        insiders: insiderFeed([insider()]),
        signals: signalFeed([signal()]),
      }),
    );

    const reasons = brief.investigations.map((item) => item.reason);
    expect(reasons).toEqual([
      "watched_disclosure",
      "market_catalyst",
      "watched_signal",
      "source_stale",
    ]);

    // Same inputs, same output: no clock, no randomness, no map iteration order.
    const again = buildMarketBrief(
      inputs({
        watchlist: ["AAPL"],
        dashboard: dashboard({ freshness: "stale" }),
        catalysts: catalystFeed([catalyst()]),
        insiders: insiderFeed([insider()]),
        signals: signalFeed([signal()]),
      }),
    );
    expect(again.investigations).toEqual(brief.investigations);
  });

  it("caps the investigation list so the brief stays readable", () => {
    const many = Array.from({ length: 20 }, (_, index) =>
      insider({ id: `tx-${index}`, acceptedAt: `2026-11-0${(index % 8) + 1}T21:30:00Z` }),
    );
    const brief = buildMarketBrief(
      inputs({ watchlist: ["AAPL"], insiders: insiderFeed(many) }),
    );

    expect(brief.investigations.length).toBeLessThanOrEqual(8);
  });

  it("orders watched symbols first in the disclosure list", () => {
    const brief = buildMarketBrief(
      inputs({
        watchlist: ["MSFT"],
        insiders: insiderFeed([
          insider({ id: "a", symbol: "AAPL", acceptedAt: "2026-11-08T21:30:00Z" }),
          insider({ id: "b", symbol: "MSFT", acceptedAt: "2026-11-01T21:30:00Z" }),
        ]),
      }),
    );

    expect(brief.insiderDisclosures[0].symbol).toBe("MSFT");
  });

  it("preserves the engine's own counts and timestamps unchanged", () => {
    const source = dashboard();
    const brief = buildMarketBrief(inputs({ dashboard: source }));

    expect(brief.context.counts).toEqual(source.counts);
    expect(brief.context.latestFilingAt).toBe(source.latestFilingAt);
    expect(brief.context.latestSignalAt).toBe(source.latestSignalAt);
    expect(brief.context.freshness).toBe(source.freshness);
  });

  it("reports a failed catalyst source as both a gap and a reason to investigate", () => {
    const brief = buildMarketBrief(
      inputs({
        catalysts: catalystFeed([], {
          sources: [
            {
              source: "fed_fomc",
              label: "Federal Reserve FOMC calendar",
              status: "failed",
              detail: "HTTP 503 from the calendar host",
              eventCount: 0,
              sourceUrl: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
              fetchedAt: "2026-11-09T14:00:00Z",
            },
          ],
        }),
      }),
    );

    expect(brief.investigations.some((item) => item.reason === "source_stale")).toBe(true);
    expect(brief.limitations.some((item) => item.key === "source:fed_fomc")).toBe(true);
  });

  it("does not surface a cancelled or already-published event as upcoming", () => {
    const brief = buildMarketBrief(
      inputs({
        catalysts: catalystFeed([
          catalyst({ id: "c1", status: "cancelled" }),
          catalyst({ id: "c2", status: "published", kind: "disclosure" }),
        ]),
      }),
    );

    expect(brief.upcomingCatalysts).toEqual([]);
    expect(brief.recentCatalysts).toHaveLength(2);
  });
});
