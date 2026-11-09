// @vitest-environment node

import { describe, expect, it } from "vitest";

import { parseEntryInput, parseExitInput, parseSymbol } from "@/lib/money/validation";

const VALID = {
  symbol: "BTC/USD",
  entryPrice: "74027.45",
  quantity: "0.00135",
  fee: "0.10",
};

describe("parseSymbol", () => {
  it("normalises case and whitespace", () => {
    expect(parseSymbol(" btc/usd ")).toEqual({
      ok: true,
      symbol: "BTC/USD",
      marketType: "crypto",
    });
  });

  it("classifies a bare ticker as an equity", () => {
    expect(parseSymbol("nvda")).toEqual({ ok: true, symbol: "NVDA", marketType: "equity" });
  });

  it("refuses a symbol it cannot read", () => {
    for (const value of ["", "  ", "BTC US D", "BTC//USD", "BTC/USD/XYZ", "BTC$USD", 42, null]) {
      expect(parseSymbol(value).ok).toBe(false);
    }
  });
});

describe("parseEntryInput", () => {
  it("accepts a well-formed entry and normalises the decimals", () => {
    const result = parseEntryInput(VALID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.symbol).toBe("BTC/USD");
    expect(result.value.marketType).toBe("crypto");
    expect(result.value.entryPrice).toBe("74027.4500000000");
    expect(result.value.quantity).toBe("0.0013500000");
    expect(result.value.fee).toBe("0.1000000000");
  });

  it("defaults a missing fee to zero rather than leaving it null", () => {
    const result = parseEntryInput({ ...VALID, fee: "" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.fee).toBe("0.0000000000");
  });

  it("refuses a zero entry price", () => {
    const result = parseEntryInput({ ...VALID, entryPrice: "0" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toContain("greater than zero");
  });

  it("refuses a negative quantity", () => {
    const result = parseEntryInput({ ...VALID, quantity: "-1" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toContain("cannot be negative");
  });

  it("refuses a negative fee", () => {
    const result = parseEntryInput({ ...VALID, fee: "-0.5" });

    expect(result.ok).toBe(false);
  });

  it("refuses more precision than the column stores", () => {
    const result = parseEntryInput({ ...VALID, entryPrice: "1.00000000001" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toContain("10 decimal places");
  });

  it("refuses a non-numeric price", () => {
    const result = parseEntryInput({ ...VALID, entryPrice: "seventy thousand" });

    expect(result.ok).toBe(false);
  });

  it("refuses a missing price or quantity", () => {
    expect(parseEntryInput({ ...VALID, entryPrice: undefined }).ok).toBe(false);
    expect(parseEntryInput({ ...VALID, quantity: undefined }).ok).toBe(false);
  });

  it("refuses an absurd price", () => {
    const result = parseEntryInput({ ...VALID, entryPrice: "9999999999999" });

    expect(result.ok).toBe(false);
  });

  it("truncates a note to the column's limit", () => {
    const result = parseEntryInput({ ...VALID, note: "x".repeat(900) });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.note).toHaveLength(500);
  });

  it("keeps the plan that prompted the trade", () => {
    const result = parseEntryInput({
      ...VALID,
      candidateId: "candidate-1",
      plan: {
        referencePrice: "74000",
        targetPrice: "75000",
        stopPrice: "73500",
        reason: "range breakout",
        strategyKey: "intraday_breakout",
        strategyVersion: 1,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.candidateId).toBe("candidate-1");
    expect(result.value.plan?.targetPrice).toBe("75000.0000000000");
    expect(result.value.plan?.strategyVersion).toBe(1);
  });

  it("drops a non-integer strategy version instead of storing it", () => {
    const result = parseEntryInput({
      ...VALID,
      plan: { strategyVersion: 1.5 },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.plan?.strategyVersion).toBeNull();
  });

  it("reports every problem at once", () => {
    const result = parseEntryInput({ symbol: "!!", entryPrice: "0", quantity: "-2" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe("parseExitInput", () => {
  it("accepts a well-formed exit", () => {
    const result = parseExitInput({ exitPrice: "74100.5", fee: "0.2" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.exitPrice).toBe("74100.5000000000");
    expect(result.value.fee).toBe("0.2000000000");
  });

  it("defaults a missing fee to zero", () => {
    const result = parseExitInput({ exitPrice: "74100" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.fee).toBe("0.0000000000");
  });

  it("refuses a zero or missing exit price", () => {
    expect(parseExitInput({ exitPrice: "0" }).ok).toBe(false);
    expect(parseExitInput({}).ok).toBe(false);
  });
});
