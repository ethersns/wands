import { describe, expect, it } from "vitest";

import type { QuantExperiment } from "@/lib/api/research-contract";
import {
  formatPercent,
  formatPValue,
  formatShare,
  headline,
} from "@/lib/member/quant";

describe("formatPValue", () => {
  it("never prints a probability of zero", () => {
    expect(formatPValue(3.51918552273144e-5)).toBe("< 0.0001");
    expect(formatPValue(0)).toBe("< 0.0001");
  });

  it("keeps two significant figures above the reporting floor", () => {
    expect(formatPValue(0.0423)).toBe("0.042");
    expect(formatPValue(0.5)).toBe("0.50");
    expect(formatPValue(0.00012)).toBe("0.00012");
  });

  it("reports a missing p-value as missing rather than as zero", () => {
    expect(formatPValue(null)).toBe("—");
    expect(formatPValue(undefined)).toBe("—");
    expect(formatPValue(Number.NaN)).toBe("—");
  });
});

describe("formatShare", () => {
  it("prints a share without a sign", () => {
    expect(formatShare(0.76)).toBe("76.0%");
    expect(formatShare(0.157, 0)).toBe("16%");
  });

  it("reports a missing share as missing", () => {
    expect(formatShare(null)).toBe("—");
  });
});

describe("formatPercent", () => {
  it("keeps the sign on a return", () => {
    expect(formatPercent(0.5305042815176799)).toBe("+53.1%");
    expect(formatPercent(-3.800589700339395)).toBe("-380.1%");
  });
});

describe("headline", () => {
  const experiment = {
    id: "1",
    name: "Mean reversion",
    status: "complete",
    sampleSize: 75,
    metrics: {
      study: "strategy_baseline",
      summary: {
        tradeCount: 75,
        meanStrategyReturn: 0.531,
        meanBenchmarkReturn: 4.331,
        meanExcessReturn: -3.8,
        meanMatchedBenchmarkReturn: 0.412,
        meanExcessVsMatched: 0.12,
        meanExposure: 0.157,
      },
    },
  } as unknown as QuantExperiment;

  it("leads with the exposure-matched comparison, not the full-period one", () => {
    const result = headline(experiment);

    expect(result.label).toBe("Excess vs matched hold");
    expect(result.value).toBe("+12.0%");
  });

  it("states the exposure so the full-period gap is not read as skill", () => {
    const result = headline(experiment);

    expect(result.hint).toContain("16% of bars");
    expect(result.hint).toContain("+53.1%");
    expect(result.hint).toContain("+41.2%");
  });
});
