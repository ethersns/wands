import { beforeEach, describe, expect, it, vi } from "vitest";

import type { InsiderTransaction } from "@/lib/api/contracts";

const query = vi.fn();
const getPrefs = vi.fn();
const createNotification = vi.fn();
const listTrackedSymbols = vi.fn();
const insiders = vi.fn();
const signals = vi.fn();

vi.mock("@/lib/db", () => ({ query: (...args: unknown[]) => query(...args) }));
vi.mock("@/lib/member/notifications", () => ({
  getPrefs: (...args: unknown[]) => getPrefs(...args),
  createNotification: (...args: unknown[]) => createNotification(...args),
}));
vi.mock("@/lib/member/watchlists", () => ({
  listTrackedSymbols: (...args: unknown[]) => listTrackedSymbols(...args),
}));
vi.mock("@/lib/member/research", () => ({
  memberResearch: {
    insiders: (...args: unknown[]) => insiders(...args),
    signals: (...args: unknown[]) => signals(...args),
  },
}));

const { runAlertSweep } = await import("@/lib/member/alerts");

const RULE_ROW = {
  id: "rule-1",
  kind: "insider_purchase",
  symbol: "NVDA",
  min_value: "250000.00",
  min_score: null,
  enabled: true,
  created_at: new Date("2026-01-01T00:00:00.000Z"),
};

const TRANSACTION: InsiderTransaction = {
  id: "tx-1",
  accessionNumber: "0000000000-26-000001",
  symbol: "NVDA",
  issuerName: "NVIDIA Corp",
  reportingPersonName: "Jane Doe",
  reportingPersonCik: "0001234567",
  role: "Director",
  transactionDate: "2026-02-01",
  transactionCode: "P",
  classification: "open_market_purchase",
  isOpenMarket: true,
  securityTitle: "Common Stock",
  shares: 1000,
  pricePerShare: 500,
  value: 500_000,
  sharesOwnedAfter: 10_000,
  directOrIndirect: "D",
  acceptedAt: "2026-02-03T14:00:00.000Z",
  isAmendment: false,
  sourceUrl: "https://www.sec.gov/example",
  description: "Open-market purchase",
  dataQuality: "reported",
};

function envelope<T>(data: T, overrides: Record<string, unknown> = {}) {
  return {
    data,
    provenance: "live",
    generatedAt: "2026-02-03T15:00:00.000Z",
    source: "wands-engine",
    warnings: [],
    unreachable: false,
    ...overrides,
  };
}

const EMPTY_FEED = { items: [], total: 0, page: 1, limit: 50, hasMore: false };

/** Routes the module's SQL to the answer each statement needs. */
function wireDatabase({ deliveryInserts = 1 } = {}) {
  let remaining = deliveryInserts;

  query.mockImplementation((text: string) => {
    if (text.includes("from member_alert_rule")) return Promise.resolve([RULE_ROW]);
    if (text.includes("insert into member_alert_delivery")) {
      if (remaining <= 0) return Promise.resolve([]);
      remaining -= 1;
      return Promise.resolve([{ id: "delivery-1" }]);
    }
    return Promise.resolve([]);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getPrefs.mockResolvedValue({
    insiderActivity: true,
    institutionalFilings: true,
    assetSignals: true,
    productUpdates: false,
  });
  listTrackedSymbols.mockResolvedValue([{ symbol: "NVDA", marketType: "stocks" }]);
  createNotification.mockResolvedValue({ id: "notification-1" });
  insiders.mockResolvedValue(envelope({ ...EMPTY_FEED, items: [TRANSACTION], total: 1 }));
  signals.mockResolvedValue(envelope(EMPTY_FEED));
  wireDatabase();
});

describe("runAlertSweep", () => {
  it("writes a notification for a matching event", async () => {
    const result = await runAlertSweep("user-1");

    expect(result.evaluated).toBe(1);
    expect(result.created).toBe(1);
    expect(createNotification).toHaveBeenCalledTimes(1);

    const [userId, input] = createNotification.mock.calls[0];
    expect(userId).toBe("user-1");
    expect(input.kind).toBe("alert:insider_purchase");
    expect(input.href).toBe("/app/insiders/tx-1");
    expect(input.title).toContain("NVDA");
  });

  it("does not report the same event twice", async () => {
    wireDatabase({ deliveryInserts: 0 });

    const result = await runAlertSweep("user-1");

    expect(result.created).toBe(0);
    expect(result.alreadyReported).toBe(1);
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("holds insider rules back when insider alerts are switched off", async () => {
    getPrefs.mockResolvedValue({
      insiderActivity: false,
      institutionalFilings: true,
      assetSignals: true,
      productUpdates: false,
    });

    const result = await runAlertSweep("user-1");

    expect(result.evaluated).toBe(0);
    expect(result.created).toBe(0);
    expect(insiders).not.toHaveBeenCalled();
    expect(result.notes.join(" ")).toContain("switched off in your preferences");
  });

  it("reports an unreachable engine instead of a silent zero", async () => {
    insiders.mockResolvedValue(
      envelope(EMPTY_FEED, {
        provenance: "unavailable",
        unreachable: true,
        warnings: ["WANDS_ENGINE_URL is not configured."],
      }),
    );

    const result = await runAlertSweep("user-1");

    expect(result.created).toBe(0);
    expect(result.evaluated).toBe(0);
    expect(result.notes).toContain("WANDS_ENGINE_URL is not configured.");
    expect(result.outcomes[0].reason).toBe("The research engine could not be reached.");
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("says so when there is no rule to run", async () => {
    query.mockResolvedValue([]);

    const result = await runAlertSweep("user-1");

    expect(result.evaluated).toBe(0);
    expect(result.notes[0]).toContain("No alert rule exists yet");
  });

  /** A rule with no ticker watches the whole watchlist. */
  function wireWatchlistWideRule() {
    query.mockImplementation((text: string) => {
      if (text.includes("from member_alert_rule")) {
        return Promise.resolve([{ ...RULE_ROW, symbol: null }]);
      }
      if (text.includes("insert into member_alert_delivery")) {
        return Promise.resolve([{ id: "delivery-1" }]);
      }
      return Promise.resolve([]);
    });
  }

  it("does not match a watchlist-wide rule against a crypto pair", async () => {
    // The insider feed is SEC equity data. A crypto pair on the watchlist must
    // not be matched against it, even when a record carries the same symbol.
    wireWatchlistWideRule();
    listTrackedSymbols.mockResolvedValue([{ symbol: "BTC/USD", marketType: "crypto" }]);
    insiders.mockResolvedValue(
      envelope({ ...EMPTY_FEED, items: [{ ...TRANSACTION, symbol: "BTC/USD" }], total: 1 }),
    );

    const result = await runAlertSweep("user-1");

    expect(result.created).toBe(0);
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("still matches a watchlist-wide rule against a stock", async () => {
    wireWatchlistWideRule();
    listTrackedSymbols.mockResolvedValue([
      { symbol: "NVDA", marketType: "stocks" },
      { symbol: "BTC/USD", marketType: "crypto" },
    ]);

    const result = await runAlertSweep("user-1");

    expect(result.created).toBe(1);
  });
});
