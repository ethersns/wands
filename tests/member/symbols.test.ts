// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { query } from "@/lib/db";
import { assetHref } from "@/lib/member/links";
import {
  checkMemberSymbol,
  isCanonicalSymbol,
  normalizeSymbol,
  parseAssetSymbol,
  SymbolError,
  toMarketType,
} from "@/lib/member/symbols";
import { addWatchlistItem, listTrackedSymbols } from "@/lib/member/watchlists";

const queryMock = vi.mocked(query);

beforeEach(() => {
  queryMock.mockReset();
});

describe("stock symbol normalisation", () => {
  it("keeps the venue ticker and normalises case", () => {
    expect(normalizeSymbol("nvda", "stocks")).toBe("NVDA");
    expect(normalizeSymbol("  brk.b ", "stocks")).toBe("BRK.B");
    expect(normalizeSymbol("BRK-B", "stocks")).toBe("BRK-B");
  });

  it("rejects a crypto pair in the stock market", () => {
    expect(() => normalizeSymbol("BTC/USD", "stocks")).toThrow(SymbolError);
  });

  it("rejects anything that is not a ticker", () => {
    for (const value of ["", " ", "'; drop table users; --", "<script>"]) {
      expect(() => normalizeSymbol(value, "stocks"), value).toThrow(SymbolError);
    }
  });

  it("holds member input to the ticker pattern the app has always enforced", () => {
    // The engine's normaliser strips spaces and only requires alphanumerics,
    // so it accepts both of these. The member surface has never accepted
    // either, and that stricter rule is what the form and the API share.
    expect(normalizeSymbol("AB CD", "stocks")).toBe("ABCD");
    expect(normalizeSymbol("1ABC", "stocks")).toBe("1ABC");

    for (const value of ["AB CD", "1ABC", "not a ticker"]) {
      expect(checkMemberSymbol(value, "stocks"), value).toEqual({
        ok: false,
        message: "Enter a ticker like NVDA or BRK.B.",
      });
    }
  });
});

describe("crypto symbol normalisation", () => {
  it("accepts the canonical pairs the engine publishes", () => {
    expect(normalizeSymbol("BTC/USD", "crypto")).toBe("BTC/USD");
    expect(normalizeSymbol("eth/usd", "crypto")).toBe("ETH/USD");
    expect(normalizeSymbol("SOL/USD", "crypto")).toBe("SOL/USD");
  });

  it("translates provider and user spellings into the canonical pair", () => {
    expect(normalizeSymbol("btc-usd", "crypto")).toBe("BTC/USD");
    expect(normalizeSymbol("btc_usd", "crypto")).toBe("BTC/USD");
    expect(normalizeSymbol("XBTUSD", "crypto")).toBe("BTC/USD");
    expect(normalizeSymbol("XBT/USD", "crypto")).toBe("BTC/USD");
    expect(normalizeSymbol("ETHUSDT", "crypto")).toBe("ETH/USDT");
  });

  it("refuses a bare base asset instead of guessing a quote", () => {
    expect(() => normalizeSymbol("BTC", "crypto")).toThrow(/BTC\/USD/);
  });

  it("refuses a symbol with no recognisable quote asset", () => {
    expect(() => normalizeSymbol("FOOBAR", "crypto")).toThrow(SymbolError);
  });
});

describe("cross-market isolation", () => {
  it("treats BTC and BTC/USD as different instruments", () => {
    expect(normalizeSymbol("BTC", "stocks")).toBe("BTC");
    expect(normalizeSymbol("BTC/USD", "crypto")).toBe("BTC/USD");
    expect(isCanonicalSymbol("BTC", "crypto")).toBe(false);
    expect(isCanonicalSymbol("BTC/USD", "stocks")).toBe(false);
  });

  it("does not let a hyphenated ticker become a crypto pair", () => {
    expect(checkMemberSymbol("BRK-B", "stocks")).toEqual({ ok: true, symbol: "BRK-B" });
    expect(checkMemberSymbol("BRK-B", "crypto")).toEqual({ ok: true, symbol: "BRK/B" });
  });

  it("reports the market a stored value belongs to", () => {
    expect(toMarketType("equity")).toBe("stocks");
    expect(toMarketType("stocks")).toBe("stocks");
    expect(toMarketType("crypto")).toBe("crypto");
    expect(() => toMarketType("forex")).toThrow(SymbolError);
  });
});

describe("asset routing", () => {
  it("round-trips a crypto pair through the asset URL", () => {
    const href = assetHref("BTC/USD");
    expect(href).toBe("/app/assets/BTC%2FUSD");
    expect(parseAssetSymbol(href.split("/").pop() ?? "")).toEqual({
      symbol: "BTC/USD",
      marketType: "crypto",
    });
  });

  it("keeps a hyphenated ticker in the stock market", () => {
    expect(parseAssetSymbol("BRK-B")).toEqual({ symbol: "BRK-B", marketType: "stocks" });
    expect(parseAssetSymbol("brk.b")).toEqual({ symbol: "BRK.B", marketType: "stocks" });
  });

  it("rejects a segment that is not a canonical symbol", () => {
    expect(parseAssetSymbol("")).toBeNull();
    expect(parseAssetSymbol("TOOLONGSYMBOL")).toBeNull();
    expect(parseAssetSymbol("%E0%A4%A")).toBeNull();
  });
});

describe("watchlist persistence", () => {
  it("stores the market type alongside the canonical symbol", async () => {
    queryMock.mockResolvedValueOnce([{ id: "wl_1" }] as never);
    queryMock.mockResolvedValueOnce([
      {
        id: "item_1",
        symbol: "BTC/USD",
        market_type: "crypto",
        note: null,
        created_at: new Date("2026-01-01T00:00:00Z"),
      },
    ] as never);

    const item = await addWatchlistItem("user_1", "wl_1", "BTC/USD", "crypto");

    expect(item).toEqual({
      id: "item_1",
      symbol: "BTC/USD",
      marketType: "crypto",
      note: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    const [sql, params] = queryMock.mock.calls[1];
    expect(String(sql)).toContain("market_type");
    expect(params).toEqual(["user_1", "wl_1", "BTC/USD", "crypto", null]);
  });

  it("returns the market with every tracked symbol", async () => {
    queryMock.mockResolvedValueOnce([
      { symbol: "AAPL", market_type: "equity" },
      { symbol: "BTC/USD", market_type: "crypto" },
    ] as never);

    await expect(listTrackedSymbols("user_1")).resolves.toEqual([
      { symbol: "AAPL", marketType: "stocks" },
      { symbol: "BTC/USD", marketType: "crypto" },
    ]);
  });
});
