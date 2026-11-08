import { describe, expect, it } from "vitest";

import type { QuantExperiment } from "@/lib/api/research-contract";
import {
  evaluationTone,
  formatPercent,
  formatPoints,
  formatPValue,
  formatShare,
  headline,
  humanizeKey,
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

describe("formatPoints", () => {
  it("labels a difference of two returns as points, not as a return", () => {
    expect(formatPoints(0.494 - 1.628)).toBe("-113.4 pp");
    expect(formatPoints(0.12)).toBe("+12.0 pp");
  });

  it("reports a missing difference as missing", () => {
    expect(formatPoints(null)).toBe("—");
  });
});

describe("humanizeKey", () => {
  it("turns a metric key into a readable label", () => {
    expect(humanizeKey("meanExcessVsMatched")).toBe("Mean excess vs matched");
    expect(humanizeKey("costDrag")).toBe("Cost drag");
    expect(humanizeKey("total_costs")).toBe("Total costs");
  });
});

describe("formatPercent", () => {
  it("keeps the sign on a return", () => {
    expect(formatPercent(0.5305042815176799)).toBe("+53.1%");
    expect(formatPercent(-3.800589700339395)).toBe("-380.1%");
  });
});

describe("evaluationTone", () => {
  it("reserves the clean tone for a genuinely held-out result", () => {
    expect(evaluationTone("held_out")).toBe("emerald");
  });

  it("marks a retrospective result as limited rather than as a pass", () => {
    expect(evaluationTone("retrospective_validation")).toBe("warn");
  });

  it("does not imply evidence when the status is missing", () => {
    expect(evaluationTone(undefined)).toBe("neutral");
    expect(evaluationTone("in_sample")).toBe("neutral");
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
