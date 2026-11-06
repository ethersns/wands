import { describe, expect, it } from "vitest";

import type {
  InsiderTransaction,
  IntelCoverage,
  IntelJob,
  ResearchSignal,
} from "@/lib/api/contracts";
import {
  activeFilterCount,
  claimType,
  coverageGaps,
  distinctReportingPersons,
  EMPTY_SIGNAL_FILTERS,
  experimentStatus,
  filterSignals,
  freshnessCaveat,
  hasMeasuredHorizons,
  insiderDirection,
  isOpenMarketClass,
  jobHealth,
  nextRunLabel,
  provenanceLabel,
  readHorizons,
  readIdentifierCoverage,
  readPriceCoverage,
  researchReadiness,
  signalDistribution,
  sortRows,
  timestampPair,
  totalReportedValue,
  unpricedTransactions,
} from "@/lib/intelligence/presentation";

function signal(overrides: Partial<ResearchSignal> = {}): ResearchSignal {
  return {
    id: "sig-1",
    category: "INSIDER_PURCHASE_CLUSTER",
    symbol: "AAPL",
    sourceEventIds: ["evt-1"],
    eventTime: "2026-01-05T00:00:00Z",
    publicAvailableAt: "2026-01-07T21:30:00Z",
    calculatedAt: "2026-01-07T22:00:00Z",
    rawMeasurement: 3,
    rawUnit: "purchasers",
    score: 72,
    explanation: "Three reporting persons bought inside one window.",
    dataQuality: "derived",
    confidenceNotes: "A joint filing can inflate the purchaser count.",
    parameters: { windowDays: 30 },
    engineVersion: "1.1.0",
    ...overrides,
  };
}

function transaction(overrides: Partial<InsiderTransaction> = {}): InsiderTransaction {
  return {
    id: "tx-1",
    accessionNumber: "0000000000-26-000001",
    symbol: "AAPL",
    issuerName: "Apple Inc.",
    reportingPersonName: "A Person",
    reportingPersonCik: "0001",
    role: "Director",
    transactionDate: "2026-01-05",
    transactionCode: "P",
    classification: "open_market_purchase",
    isOpenMarket: true,
    securityTitle: "Common Stock",
    shares: 1000,
    pricePerShare: 150,
    value: 150_000,
    sharesOwnedAfter: 5000,
    directOrIndirect: "D",
    acceptedAt: "2026-01-07T21:30:00Z",
    isAmendment: false,
    sourceUrl: "https://www.sec.gov/Archives/edgar/data/1/2",
    description: "Open market purchase.",
    dataQuality: "reported",
    ...overrides,
  };
}

function coverage(overrides: Partial<IntelCoverage> = {}): IntelCoverage {
  return {
    filings: 10,
    transactions: 40,
    signals: 5,
    institutions: 2,
    holdings: 30,
    earliestFilingAt: "2025-01-01T00:00:00Z",
    latestFilingAt: "2026-01-01T00:00:00Z",
    earliestSignalAt: "2025-06-01T00:00:00Z",
    latestSignalAt: "2026-01-01T00:00:00Z",
    symbolsCovered: ["AAPL"],
    identifiers: {
      mappings: 10,
      distinctCusips: 10,
      verifiedCusips: 10,
      unresolvedCusips: 0,
      byStatus: { verified: 10 },
      fusionEligible: 10,
      sources: ["openfigi"],
    },
    backfill: [],
    priceCoverage: {
      symbolsWithSignals: 1,
      symbolsWithDailyBars: 1,
      missing: [],
      note: "",
    },
    caveats: [],
    ...overrides,
  };
}

function job(overrides: Partial<IntelJob> = {}): IntelJob {
  return {
    name: "insider_ownership",
    kind: "ownership",
    scheduleSeconds: 3600,
    enabled: true,
    paused: false,
    status: "idle",
    lastStatus: "ok",
    lastStartedAt: "2026-01-01T00:00:00Z",
    lastFinishedAt: "2026-01-01T00:01:00Z",
    nextRunAt: "2026-01-01T01:00:00Z",
    lastError: "",
    consecutiveFailures: 0,
    totalRuns: 10,
    totalFailures: 0,
    leaseOwner: null,
    leaseExpiresAt: null,
    metrics: {},
    ...overrides,
  };
}

describe("empty intelligence feeds", () => {
  it("reports no distribution for an empty signal feed", () => {
    expect(signalDistribution([])).toEqual([]);
  });

  it("returns an empty list when filtering an empty feed", () => {
    expect(filterSignals([], EMPTY_SIGNAL_FILTERS)).toEqual([]);
  });

  it("counts no active filters by default", () => {
    expect(activeFilterCount(EMPTY_SIGNAL_FILTERS)).toBe(0);
  });

  it("says an empty feed means nothing was collected, not that nothing happened", () => {
    const caveat = freshnessCaveat("never");
    expect(caveat).not.toBeNull();
    expect(caveat).toContain("nothing has been collected");
  });

  it("treats a feed with no filings as blocking rather than merely limited", () => {
    const readiness = researchReadiness(
      coverage({ filings: 0, transactions: 0, signals: 0 }),
    );
    expect(readiness.tone).toBe("loss");
    expect(readiness.verdict).toContain("Not enough data");
  });
});

describe("missing prices", () => {
  it("finds transactions whose value is absent", () => {
    const rows = [
      transaction({ id: "a", value: 100 }),
      transaction({ id: "b", value: null, pricePerShare: null }),
    ];
    expect(unpricedTransactions(rows).map((row) => row.id)).toEqual(["b"]);
  });

  it("returns null rather than zero when no line reported a price", () => {
    const rows = [transaction({ value: null }), transaction({ id: "b", value: null })];
    expect(totalReportedValue(rows)).toBeNull();
  });

  it("sums only the priced lines", () => {
    const rows = [
      transaction({ id: "a", value: 100 }),
      transaction({ id: "b", value: null }),
      transaction({ id: "c", value: 50 }),
    ];
    expect(totalReportedValue(rows)).toBe(150);
  });

  it("keeps a horizon mean null when the engine supplied no statistic", () => {
    const rows = readHorizons({
      horizons: [{ horizonDays: 5, sampleSize: 0, descriptive: null }],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].mean).toBeNull();
    expect(rows[0].sampleSize).toBe(0);
  });
});

describe("unresolved identifiers", () => {
  it("computes resolution coverage from counts", () => {
    const identifiers = readIdentifierCoverage({
      mappings: 10,
      distinctCusips: 8,
      verifiedCusips: 6,
      unresolvedCusips: 2,
      fusionEligible: 6,
      byStatus: { verified: 6, unresolved: 2 },
      sources: ["openfigi"],
    });

    expect(identifiers.distinctCusips).toBe(8);
    expect(identifiers.unresolvedCusips).toBe(2);
    expect(identifiers.resolvedPct).toBeCloseTo(75);
    expect(identifiers.byStatus[0]).toEqual({ status: "verified", count: 6 });
  });

  it("reports no percentage when no CUSIP is stored", () => {
    expect(readIdentifierCoverage({}).resolvedPct).toBeNull();
  });

  it("raises a coverage gap for unresolved CUSIPs", () => {
    const gaps = coverageGaps(
      coverage({
        identifiers: {
          distinctCusips: 4,
          verifiedCusips: 1,
          unresolvedCusips: 3,
        },
      }),
    );
    const gap = gaps.find((entry) => entry.label.includes("unresolved CUSIP"));
    expect(gap).toBeDefined();
    expect(gap?.detail).toContain("omitted from fusion rankings");
  });

  it("raises a gap for symbols without daily bars", () => {
    const prices = readPriceCoverage({
      symbolsWithSignals: 3,
      symbolsWithDailyBars: 1,
      missing: ["MSFT", "NVDA"],
      note: "A symbol without daily bars cannot be validated.",
    });
    expect(prices.coveredPct).toBeCloseTo(33.333, 2);

    const gaps = coverageGaps(
      coverage({
        priceCoverage: {
          symbolsWithSignals: 3,
          symbolsWithDailyBars: 1,
          missing: ["MSFT", "NVDA"],
        },
      }),
    );
    expect(gaps.some((entry) => entry.label.includes("without daily bars"))).toBe(true);
  });
});

describe("missing experiment metrics", () => {
  it("reads no horizons from an empty metrics object", () => {
    expect(readHorizons({})).toEqual([]);
    expect(hasMeasuredHorizons({})).toBe(false);
  });

  it("does not treat a horizon with no mean as measured", () => {
    expect(
      hasMeasuredHorizons({
        horizons: [{ horizonDays: 5, sampleSize: 4, descriptive: { mean: null } }],
      }),
    ).toBe(false);
  });

  it("classifies a result with no execution assumptions as descriptive", () => {
    const claim = claimType({
      executionAssumptions: {},
      costAssumptions: {},
      metrics: {},
    });
    expect(claim.label).toBe("Descriptive event study");
    expect(claim.detail).toContain("No fills");
  });

  it("classifies a result with a cost assumption as a hypothetical simulation", () => {
    const claim = claimType({
      executionAssumptions: { fillModel: "next_open" },
      costAssumptions: {},
      metrics: { costBps: 5 },
    });
    expect(claim.label).toBe("Hypothetical simulation");
    expect(claim.detail).toContain("Not a realised account result");
  });

  it("maps a no-price experiment to a loss tone", () => {
    expect(experimentStatus("no_price_data")).toEqual({
      label: "No price data",
      tone: "loss",
    });
  });
});

describe("paper versus live provenance", () => {
  it("labels a live payload as coming from the engine", () => {
    expect(provenanceLabel("live")).toBe("Engine");
  });

  it("labels an unavailable payload explicitly", () => {
    expect(provenanceLabel("unavailable")).toBe("Unavailable");
  });

  it("labels a demo payload as a fixture", () => {
    expect(provenanceLabel("demo")).toBe("Demo fixture");
  });
});

describe("source timestamp display", () => {
  it("computes the lag between the event and its publication", () => {
    const pair = timestampPair("2026-01-05T00:00:00Z", "2026-01-07T00:00:00Z");
    expect(pair.lagSeconds).toBe(172_800);
  });

  it("returns a null lag for an unparseable timestamp", () => {
    expect(timestampPair("not-a-date", "2026-01-07T00:00:00Z").lagSeconds).toBeNull();
  });

  it("never reports a negative lag", () => {
    const pair = timestampPair("2026-01-07T00:00:00Z", "2026-01-05T00:00:00Z");
    expect(pair.lagSeconds).toBe(0);
  });
});

describe("insider classification", () => {
  it("treats only open-market codes as market decisions", () => {
    expect(isOpenMarketClass("open_market_purchase")).toBe(true);
    expect(isOpenMarketClass("open_market_sale")).toBe(true);
    expect(isOpenMarketClass("award_grant")).toBe(false);
    expect(isOpenMarketClass("gift")).toBe(false);
    expect(isOpenMarketClass("tax_withholding")).toBe(false);
  });

  it("gives a direction only to open-market activity", () => {
    expect(insiderDirection("open_market_purchase")).toBe("buy");
    expect(insiderDirection("open_market_sale")).toBe("sell");
    expect(insiderDirection("award_grant")).toBeNull();
    expect(insiderDirection("derivative_exercise")).toBeNull();
  });

  it("counts distinct reporting persons by CIK", () => {
    const rows = [
      transaction({ id: "a", reportingPersonCik: "1" }),
      transaction({ id: "b", reportingPersonCik: "1" }),
      transaction({ id: "c", reportingPersonCik: "2" }),
    ];
    expect(distinctReportingPersons(rows)).toBe(2);
  });
});

describe("admin-only operations", () => {
  it("flags a job with repeated failures as unhealthy", () => {
    expect(jobHealth(job({ consecutiveFailures: 3 }))).toEqual({
      label: "3 consecutive failures",
      tone: "loss",
    });
  });

  it("flags a single failure as a warning rather than healthy", () => {
    expect(jobHealth(job({ consecutiveFailures: 1 })).tone).toBe("primary");
  });

  it("reports a healthy job only when nothing has failed", () => {
    expect(jobHealth(job())).toEqual({ label: "Healthy", tone: "profit" });
  });

  it("calls a scheduled time in the past overdue rather than 'ago'", () => {
    const now = new Date("2026-02-10T14:00:00Z").getTime();
    const result = nextRunLabel("2026-02-10T12:00:00Z", now);
    expect(result.overdue).toBe(true);
    expect(result.label).toBe("overdue by 2h 0m");
  });

  it("reports a future scheduled time as upcoming", () => {
    const now = new Date("2026-02-10T14:00:00Z").getTime();
    const result = nextRunLabel("2026-02-10T15:00:00Z", now);
    expect(result.overdue).toBe(false);
    expect(result.label).toBe("in 1h 0m");
  });

  it("reports no schedule when the engine supplied none", () => {
    expect(nextRunLabel(null)).toEqual({ label: "not scheduled", overdue: false });
  });
});

describe("sorting", () => {
  it("sorts missing values last in both directions", () => {
    const rows = [{ v: 2 }, { v: null }, { v: 1 }];
    const asc = sortRows(rows, (row) => row.v, "asc").map((row) => row.v);
    const desc = sortRows(rows, (row) => row.v, "desc").map((row) => row.v);
    expect(asc).toEqual([1, 2, null]);
    expect(desc).toEqual([2, 1, null]);
  });
});

describe("signal filtering", () => {
  it("drops signals below the minimum score", () => {
    const rows = [signal({ id: "a", score: 80 }), signal({ id: "b", score: 20 })];
    const filtered = filterSignals(rows, { ...EMPTY_SIGNAL_FILTERS, minScore: 50 });
    expect(filtered.map((row) => row.id)).toEqual(["a"]);
  });

  it("drops a signal with no score when a minimum is set", () => {
    const rows = [signal({ id: "a", score: null })];
    expect(filterSignals(rows, { ...EMPTY_SIGNAL_FILTERS, minScore: 1 })).toEqual([]);
  });

  it("filters by availability window against the public timestamp", () => {
    const now = new Date("2026-02-01T00:00:00Z").getTime();
    const rows = [
      signal({ id: "recent", publicAvailableAt: "2026-01-31T00:00:00Z" }),
      signal({ id: "old", publicAvailableAt: "2025-11-01T00:00:00Z" }),
    ];
    const filtered = filterSignals(
      rows,
      { ...EMPTY_SIGNAL_FILTERS, availability: "7d" },
      now,
    );
    expect(filtered.map((row) => row.id)).toEqual(["recent"]);
  });

  it("counts each active filter once", () => {
    expect(
      activeFilterCount({
        symbol: "aapl",
        category: "MARKET_TREND",
        minScore: 40,
        dataQuality: "derived",
        availability: "24h",
      }),
    ).toBe(5);
  });
});
