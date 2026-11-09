// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  addWatchlistItemSchema,
  notificationPrefsSchema,
  onboardingSchema,
  saveItemSchema,
  symbolSchema,
  watchlistNameSchema,
} from "@/lib/member/validation";

describe("symbol validation", () => {
  it("accepts ordinary tickers and normalises case", () => {
    expect(symbolSchema.parse("nvda")).toBe("NVDA");
    expect(symbolSchema.parse("  brk.b ")).toBe("BRK.B");
    expect(symbolSchema.parse("BRK-B")).toBe("BRK-B");
  });

  it("rejects anything that is not a ticker", () => {
    for (const value of ["", " ", "1ABC", "TOOLONGSYMBOL", "AB CD", "'; drop table users; --", "<script>"]) {
      expect(symbolSchema.safeParse(value).success, value).toBe(false);
    }
  });
});

describe("watchlist validation", () => {
  it("requires a name and caps its length", () => {
    expect(watchlistNameSchema.parse("  Semis  ")).toBe("Semis");
    expect(watchlistNameSchema.safeParse("").success).toBe(false);
    expect(watchlistNameSchema.safeParse("x".repeat(61)).success).toBe(false);
  });

  it("rejects an item without a valid symbol", () => {
    expect(addWatchlistItemSchema.safeParse({ symbol: "nvda" }).success).toBe(true);
    expect(addWatchlistItemSchema.safeParse({ symbol: "not a ticker" }).success).toBe(false);
  });
});

describe("watchlist market selection", () => {
  it("defaults a bare ticker to stocks", () => {
    expect(addWatchlistItemSchema.parse({ symbol: "nvda" })).toMatchObject({
      symbol: "NVDA",
      marketType: "stocks",
    });
  });

  it("accepts a crypto pair when the market is explicit", () => {
    expect(addWatchlistItemSchema.parse({ symbol: "btc-usd", marketType: "crypto" })).toMatchObject({
      symbol: "BTC/USD",
      marketType: "crypto",
    });
  });

  it("rejects a bare base asset in the crypto market", () => {
    expect(addWatchlistItemSchema.safeParse({ symbol: "BTC", marketType: "crypto" }).success).toBe(false);
  });

  it("rejects a crypto pair in the stock market", () => {
    expect(addWatchlistItemSchema.safeParse({ symbol: "BTC/USD", marketType: "stocks" }).success).toBe(
      false,
    );
  });

  it("rejects an unknown market", () => {
    expect(addWatchlistItemSchema.safeParse({ symbol: "NVDA", marketType: "forex" }).success).toBe(false);
  });
});

describe("saved item validation", () => {
  it("accepts a well formed save", () => {
    const parsed = saveItemSchema.parse({
      kind: "signal",
      refId: "sig_123",
      symbol: "nvda",
      title: "Purchase cluster",
    });
    expect(parsed.symbol).toBe("NVDA");
  });

  it("rejects an unknown kind", () => {
    expect(saveItemSchema.safeParse({ kind: "trade", refId: "x", title: "y" }).success).toBe(false);
  });

  it("rejects an empty reference", () => {
    expect(saveItemSchema.safeParse({ kind: "signal", refId: "", title: "y" }).success).toBe(false);
  });
});

describe("notification preferences", () => {
  it("requires every flag to be a boolean", () => {
    const valid = {
      insiderActivity: true,
      institutionalFilings: false,
      assetSignals: true,
      productUpdates: false,
    };
    expect(notificationPrefsSchema.safeParse(valid).success).toBe(true);
    expect(notificationPrefsSchema.safeParse({ ...valid, assetSignals: "yes" }).success).toBe(false);
  });
});

describe("onboarding payload", () => {
  it("accepts a partial step update", () => {
    expect(onboardingSchema.safeParse({ step: "interests" }).success).toBe(true);
    expect(onboardingSchema.safeParse({ completed: true }).success).toBe(true);
  });

  it("rejects an unknown step", () => {
    expect(onboardingSchema.safeParse({ step: "billing" }).success).toBe(false);
  });

  it("rejects a seed list containing an invalid ticker", () => {
    expect(onboardingSchema.safeParse({ seedSymbols: ["NVDA", "not a ticker"] }).success).toBe(false);
  });
});
