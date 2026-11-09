import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ResearchDashboard } from "@/lib/api/research-contract";

const reads = vi.hoisted(() => ({
  dashboard: vi.fn(),
  coverage: vi.fn(),
  catalysts: vi.fn(),
  insiders: vi.fn(),
  institutions: vi.fn(),
  signals: vi.fn(),
  watchlists: vi.fn(),
}));

vi.mock("@/lib/member/research", () => ({
  memberResearch: {
    dashboard: reads.dashboard,
    coverage: reads.coverage,
    catalysts: reads.catalysts,
    insiders: reads.insiders,
    institutions: reads.institutions,
    signals: reads.signals,
  },
}));

vi.mock("@/lib/member/watchlists", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/member/watchlists")>();
  return { ...actual, listWatchlists: reads.watchlists };
});

import * as briefModule from "@/lib/member/brief";
import { getMarketBrief } from "@/lib/member/brief";

const AS_OF = "2026-11-09T15:00:00Z";

function envelope<T>(data: T, overrides: { unreachable?: boolean; warnings?: string[] } = {}) {
  return {
    data,
    provenance: "live" as const,
    generatedAt: AS_OF,
    warnings: overrides.warnings ?? [],
    unreachable: overrides.unreachable ?? false,
  };
}

function dashboardData(): ResearchDashboard {
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

const coverageData = () => ({
  status: "complete" as const,
  windowStart: null,
  windowEnd: null,
  symbolsCovered: 0,
  symbolsRequested: 0,
  gaps: [],
  caveats: [],
});

const catalystFeedData = () => ({
  items: [],
  sources: [],
  windowStart: "2026-10-10",
  windowEnd: "2026-12-09",
  upcoming: 0,
  recent: 0,
  caveats: [],
  coverageLimitations: [],
});

const insiderFeedData = () => ({ items: [], total: 0, page: 1, limit: 200, hasMore: false });
const institutionFeedData = () => ({ items: [], total: 0, page: 1, limit: 50, hasMore: false });
const signalFeedData = () => ({ items: [], total: 0, page: 1, limit: 200, hasMore: false });

function watchlist(name: string, symbols: string[], isDefault = false) {
  return {
    id: `wl-${name}`,
    name,
    isDefault,
    createdAt: "2026-11-01T00:00:00Z",
    items: symbols.map((symbol, index) => ({
      id: `item-${name}-${index}`,
      symbol,
      marketType: "equity",
      note: null,
      createdAt: "2026-11-01T00:00:00Z",
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  reads.watchlists.mockResolvedValue([watchlist("My watchlist", ["AAPL"], true)]);
  reads.dashboard.mockResolvedValue(envelope(dashboardData()));
  reads.coverage.mockResolvedValue(envelope(coverageData()));
  reads.catalysts.mockResolvedValue(envelope(catalystFeedData()));
  reads.insiders.mockResolvedValue(envelope(insiderFeedData()));
  reads.institutions.mockResolvedValue(envelope(institutionFeedData()));
  reads.signals.mockResolvedValue(envelope(signalFeedData()));
});

describe("market brief read layer", () => {
  it("issues one bounded read per source and never one per symbol", async () => {
    await getMarketBrief("user-1");

    expect(reads.dashboard).toHaveBeenCalledTimes(1);
    expect(reads.coverage).toHaveBeenCalledTimes(1);
    expect(reads.catalysts).toHaveBeenCalledTimes(1);
    expect(reads.insiders).toHaveBeenCalledTimes(1);
    expect(reads.institutions).toHaveBeenCalledTimes(1);
    expect(reads.signals).toHaveBeenCalledTimes(1);
    expect(reads.watchlists).toHaveBeenCalledTimes(1);
  });

  it("costs the same number of reads for a large watchlist", async () => {
    reads.watchlists.mockResolvedValue([
      watchlist(
        "Big",
        Array.from({ length: 50 }, (_, index) => `SYM${index}`),
        true,
      ),
    ]);

    const brief = await getMarketBrief("user-1");

    expect(brief.watchlist).toHaveLength(50);
    expect(reads.dashboard).toHaveBeenCalledTimes(1);
    expect(reads.insiders).toHaveBeenCalledTimes(1);
    expect(reads.signals).toHaveBeenCalledTimes(1);
    expect(reads.catalysts).toHaveBeenCalledTimes(1);
    expect(reads.watchlists).toHaveBeenCalledTimes(1);
  });

  it("scopes the watchlist read to the signed-in member", async () => {
    await getMarketBrief("user-42");

    expect(reads.watchlists).toHaveBeenCalledWith("user-42");
  });

  it("derives tracked symbols from the single watchlist read", async () => {
    reads.watchlists.mockResolvedValue([
      watchlist("Core", ["MSFT", "AAPL"], true),
      watchlist("Speculative", ["AAPL", "NVDA"]),
    ]);

    const brief = await getMarketBrief("user-1");

    expect(brief.watchlist).toEqual(["AAPL", "MSFT", "NVDA"]);
    expect(brief.watchlistCount).toBe(2);
    expect(reads.watchlists).toHaveBeenCalledTimes(1);
  });

  it("keeps one member's symbols out of another member's brief", async () => {
    reads.watchlists.mockImplementation(async (userId: string) =>
      userId === "user-1" ? [watchlist("Mine", ["AAPL"], true)] : [watchlist("Theirs", ["TSLA"], true)],
    );

    const mine = await getMarketBrief("user-1");
    const theirs = await getMarketBrief("user-2");

    expect(mine.watchlist).toEqual(["AAPL"]);
    expect(theirs.watchlist).toEqual(["TSLA"]);
    expect(reads.watchlists).toHaveBeenNthCalledWith(1, "user-1");
    expect(reads.watchlists).toHaveBeenNthCalledWith(2, "user-2");
  });

  it("passes bounded limits rather than asking for the whole universe", async () => {
    await getMarketBrief("user-1");

    expect(reads.insiders).toHaveBeenCalledWith({ limit: 200 });
    expect(reads.signals).toHaveBeenCalledWith({ limit: 200 });
    expect(reads.institutions).toHaveBeenCalledWith(1, 8);
    expect(reads.catalysts).toHaveBeenCalledWith({ windowDays: 30 });
  });

  it("reports which sources were unreachable instead of one flat flag", async () => {
    reads.signals.mockResolvedValue(envelope(signalFeedData(), { unreachable: true }));

    const brief = await getMarketBrief("user-1");

    expect(brief.availability).toBe("partial");
    expect(brief.unreachable).toBe(false);
    expect(brief.sources.find((source) => source.key === "signals")?.state).toBe("unavailable");
    expect(brief.sources.find((source) => source.key === "insiders")?.state).toBe("empty");
  });

  it("does not pass a fabricated assessment time when the dashboard is unreachable", async () => {
    // The unreachable payload is stamped with the current clock; the brief must
    // not treat that as a real assessment time.
    reads.dashboard.mockResolvedValue(envelope(dashboardData(), { unreachable: true }));

    const brief = await getMarketBrief("user-1");

    expect(brief.timeBasis).toBe("indeterminate");
    expect(brief.asOf).toBeNull();
    expect(brief.context.counts).toBeNull();
  });

  it("deduplicates warnings arriving from several envelopes", async () => {
    reads.dashboard.mockResolvedValue(envelope(dashboardData(), { warnings: ["engine slow"] }));
    reads.coverage.mockResolvedValue(envelope(coverageData(), { warnings: ["engine slow"] }));

    const brief = await getMarketBrief("user-1");

    expect(brief.warnings).toEqual(["engine slow"]);
  });

  it("exposes no trading, operator or execution entry point", () => {
    const exported = Object.keys(briefModule).sort();

    expect(exported).toEqual(["BRIEF_RULES", "buildMarketBrief", "getMarketBrief"]);
    for (const name of exported) {
      expect(name).not.toMatch(/order|trade|execute|backfill|job|admin|operator/i);
    }
  });

  it("reaches only customer-safe research reads", async () => {
    const actual = await vi.importActual<typeof import("@/lib/member/research")>(
      "@/lib/member/research",
    );

    const surface = Object.keys(actual.memberResearch).sort();
    expect(surface).toEqual([
      "asset",
      "catalysts",
      "coverage",
      "dashboard",
      "experiment",
      "experiments",
      "insiderTransaction",
      "insiders",
      "institutionChanges",
      "institutions",
      "prices",
      "signal",
      "signals",
      "sources",
    ]);

    for (const name of surface) {
      expect(name).not.toMatch(/order|trade|execute|backfill|job|admin|operator|bot|risk/i);
    }
  });
});
