// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  computeClosedPnl,
  computeOpenPnl,
  formatDecimal,
  formatPercent,
  parseDecimal,
  riskReward,
  roundTo,
} from "@/lib/money/calc";

/** Parses a literal that the tests have already established is valid. */
function d(value: string): bigint {
  const parsed = parseDecimal(value);
  if (parsed === null) throw new Error(`test fixture is not a decimal: ${value}`);
  return parsed;
}

describe("parseDecimal", () => {
  it("scales a whole number", () => {
    expect(parseDecimal("1")).toBe(10_000_000_000n);
  });

  it("scales a fractional number", () => {
    expect(parseDecimal("0.1")).toBe(1_000_000_000n);
    expect(parseDecimal("74027.45")).toBe(740_274_500_000_000n);
  });

  it("accepts the full ten decimal places", () => {
    expect(parseDecimal("0.0000000001")).toBe(1n);
  });

  it("refuses more precision than it can store rather than truncating", () => {
    expect(parseDecimal("0.00000000001")).toBeNull();
  });

  it("refuses text that is not a decimal", () => {
    for (const value of ["", " ", "abc", "1,000", "1e5", "0x10", "--1", "1.2.3"]) {
      expect(parseDecimal(value)).toBeNull();
    }
  });

  it("keeps the sign", () => {
    expect(parseDecimal("-2.5")).toBe(-25_000_000_000n);
  });

  it("trims surrounding whitespace", () => {
    expect(parseDecimal("  3.5  ")).toBe(35_000_000_000n);
  });
});

describe("formatDecimal", () => {
  it("renders a fixed number of decimal places", () => {
    expect(formatDecimal(d("74027.45"), 2)).toBe("74027.45");
    expect(formatDecimal(d("1"), 2)).toBe("1.00");
    expect(formatDecimal(d("1"), 0)).toBe("1");
  });

  it("renders a negative value with its sign", () => {
    expect(formatDecimal(d("-1.5"), 2)).toBe("-1.50");
  });

  it("round-trips through parseDecimal", () => {
    for (const value of ["0.0000000001", "123.456789", "0", "999999.9999999999"]) {
      expect(formatDecimal(d(value), 10)).toBe(
        value.includes(".") ? value.padEnd(value.indexOf(".") + 11, "0") : `${value}.0000000000`,
      );
    }
  });
});

describe("roundTo", () => {
  it("rounds half away from zero", () => {
    expect(formatDecimal(roundTo(d("1.005"), 2), 2)).toBe("1.01");
    expect(formatDecimal(roundTo(d("-1.005"), 2), 2)).toBe("-1.01");
  });

  it("leaves a value that already fits untouched", () => {
    expect(roundTo(d("1.5"), 2)).toBe(d("1.5"));
  });
});

describe("computeOpenPnl", () => {
  it("computes cost basis, gross and net of the entry fee", () => {
    const pnl = computeOpenPnl({
      entryPrice: d("100"),
      quantity: d("2"),
      entryFee: d("1"),
      currentPrice: d("110"),
    });

    expect(formatDecimal(pnl.costBasis, 2)).toBe("200.00");
    expect(formatDecimal(pnl.unrealizedGross, 2)).toBe("20.00");
    expect(formatDecimal(pnl.unrealizedNet, 2)).toBe("19.00");
    expect(pnl.returnFraction).toBeCloseTo(0.095, 10);
  });

  it("reports a loss as a negative net", () => {
    const pnl = computeOpenPnl({
      entryPrice: d("100"),
      quantity: d("2"),
      entryFee: d("1"),
      currentPrice: d("90"),
    });

    expect(formatDecimal(pnl.unrealizedGross, 2)).toBe("-20.00");
    expect(formatDecimal(pnl.unrealizedNet, 2)).toBe("-21.00");
    expect(pnl.returnFraction).toBeCloseTo(-0.105, 10);
  });

  it("does not lose a tenth to binary floating point", () => {
    const pnl = computeOpenPnl({
      entryPrice: d("0.1"),
      quantity: d("3"),
      entryFee: 0n,
      currentPrice: d("0.1"),
    });

    expect(formatDecimal(pnl.costBasis, 2)).toBe("0.30");
    expect(formatDecimal(pnl.unrealizedNet, 2)).toBe("0.00");
  });

  it("handles a fractional crypto quantity", () => {
    const pnl = computeOpenPnl({
      entryPrice: d("74027.45"),
      quantity: d("0.00135"),
      entryFee: d("0.10"),
      currentPrice: d("74100"),
    });

    // 0.00135 × 74027.45 = 99.9370575; at 74100 it is 100.035
    expect(formatDecimal(pnl.costBasis, 2)).toBe("99.94");
    expect(formatDecimal(pnl.unrealizedGross, 2)).toBe("0.10");
    expect(formatDecimal(pnl.unrealizedNet, 2)).toBe("0.00");
  });
});

describe("computeClosedPnl", () => {
  it("deducts both fees from the gross result", () => {
    const pnl = computeClosedPnl({
      entryPrice: d("100"),
      quantity: d("2"),
      entryFee: d("1"),
      exitPrice: d("110"),
      exitFee: d("1"),
    });

    expect(formatDecimal(pnl.costBasis, 2)).toBe("200.00");
    expect(formatDecimal(pnl.proceeds, 2)).toBe("220.00");
    expect(formatDecimal(pnl.grossPnl, 2)).toBe("20.00");
    expect(formatDecimal(pnl.netPnl, 2)).toBe("18.00");
    expect(pnl.returnFraction).toBeCloseTo(0.09, 10);
  });

  it("turns a small gross gain into a net loss once fees are paid", () => {
    const pnl = computeClosedPnl({
      entryPrice: d("100"),
      quantity: d("1"),
      entryFee: d("0.5"),
      exitPrice: d("100.4"),
      exitFee: d("0.5"),
    });

    expect(formatDecimal(pnl.grossPnl, 2)).toBe("0.40");
    expect(formatDecimal(pnl.netPnl, 2)).toBe("-0.60");
    expect(pnl.returnFraction).toBeLessThan(0);
  });

  it("returns null rather than dividing by a zero basis", () => {
    const pnl = computeClosedPnl({
      entryPrice: 0n,
      quantity: d("1"),
      entryFee: 0n,
      exitPrice: d("10"),
      exitFee: 0n,
    });

    expect(pnl.returnFraction).toBeNull();
  });
});

describe("formatPercent", () => {
  it("signs a positive return", () => {
    expect(formatPercent(0.095)).toBe("+9.50%");
  });

  it("keeps the minus on a loss", () => {
    expect(formatPercent(-0.105)).toBe("-10.50%");
  });

  it("shows a dash when the ratio is unknown", () => {
    expect(formatPercent(null)).toBe("—");
  });
});

describe("riskReward", () => {
  it("divides reward by risk", () => {
    expect(riskReward({ reference: d("100"), target: d("110"), stop: d("95") })).toBeCloseTo(2, 10);
  });

  it("refuses a stop at or above the reference", () => {
    expect(riskReward({ reference: d("100"), target: d("110"), stop: d("100") })).toBeNull();
    expect(riskReward({ reference: d("100"), target: d("110"), stop: d("105") })).toBeNull();
  });
});
