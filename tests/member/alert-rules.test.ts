import { describe, expect, it } from "vitest";

import type { InsiderTransaction, ResearchSignal } from "@/lib/api/contracts";
import {
  collectMatches,
  matchSignal,
  matchTransaction,
  ruleWatchesSymbol,
  type AlertRule,
} from "@/lib/member/alert-rules";

function rule(overrides: Partial<AlertRule> = {}): AlertRule {
  return {
    id: "rule-1",
    kind: "insider_purchase",
    symbol: null,
    minValue: null,
    minScore: null,
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function transaction(overrides: Partial<InsiderTransaction> = {}): InsiderTransaction {
  return {
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
    ...overrides,
  };
}

function signal(overrides: Partial<ResearchSignal> = {}): ResearchSignal {
  return {
    id: "sig-1",
    category: "INSIDER_PURCHASE_CLUSTER",
    symbol: "NVDA",
    sourceEventIds: ["tx-1"],
    eventTime: "2026-02-01T00:00:00.000Z",
    publicAvailableAt: "2026-02-03T14:00:00.000Z",
    calculatedAt: "2026-02-03T15:00:00.000Z",
    rawMeasurement: 3,
    rawUnit: "filings",
    score: 82,
    explanation: "Three officers bought within ten days.",
    dataQuality: "derived",
    confidenceNotes: "Based on three filings.",
    parameters: {},
    engineVersion: "1.0.0",
    ...overrides,
  };
}

describe("ruleWatchesSymbol", () => {
  it("matches only the named ticker when a rule names one", () => {
    const scoped = rule({ symbol: "NVDA" });
    expect(ruleWatchesSymbol(scoped, "NVDA", [])).toBe(true);
    expect(ruleWatchesSymbol(scoped, "AMD", ["AMD"])).toBe(false);
  });

  it("falls back to the watchlist when a rule names no ticker", () => {
    const broad = rule({ symbol: null });
    expect(ruleWatchesSymbol(broad, "AMD", ["AMD"])).toBe(true);
    expect(ruleWatchesSymbol(broad, "TSLA", ["AMD"])).toBe(false);
  });
});

describe("matchTransaction", () => {
  it("matches an open-market purchase", () => {
    const result = matchTransaction(rule(), transaction(), ["NVDA"]);
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.candidate.eventKey).toBe("insider:tx-1");
    expect(result.candidate.href).toBe("/app/insiders/tx-1");
    expect(result.candidate.title).toContain("NVDA");
  });

  it("does not match a sale against a purchase rule", () => {
    const result = matchTransaction(
      rule(),
      transaction({ classification: "open_market_sale", transactionCode: "S" }),
      ["NVDA"],
    );
    expect(result.matched).toBe(false);
  });

  it("does not match a grant, which is not an open-market purchase", () => {
    const result = matchTransaction(rule(), transaction({ classification: "award_grant" }), ["NVDA"]);
    expect(result.matched).toBe(false);
  });

  it("rejects a transaction below the dollar floor and says so", () => {
    const result = matchTransaction(rule({ minValue: 1_000_000 }), transaction(), ["NVDA"]);
    expect(result.matched).toBe(false);
    if (result.matched) return;
    expect(result.reason).toContain("threshold");
  });

  it("treats an unreported value as unknown, not as zero", () => {
    const result = matchTransaction(rule({ minValue: 1 }), transaction({ value: null }), ["NVDA"]);
    expect(result.matched).toBe(false);
    if (result.matched) return;
    expect(result.reason).toContain("no value");
  });

  it("still matches an unreported value when the rule sets no floor", () => {
    const result = matchTransaction(rule(), transaction({ value: null }), ["NVDA"]);
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.candidate.body).toContain("no value was reported");
  });

  it("reads a decimal serialised as a string", () => {
    const result = matchTransaction(
      rule({ minValue: 400_000 }),
      transaction({ value: "500000.00" as unknown as number }),
      ["NVDA"],
    );
    expect(result.matched).toBe(true);
  });
});

describe("matchSignal", () => {
  it("matches a signal at or above the score floor", () => {
    const result = matchSignal(rule({ kind: "signal", minScore: 80 }), signal(), ["NVDA"]);
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.candidate.eventKey).toBe("signal:sig-1");
    expect(result.candidate.body).toContain("not a probability");
  });

  it("rejects a signal below the score floor", () => {
    const result = matchSignal(rule({ kind: "signal", minScore: 90 }), signal(), ["NVDA"]);
    expect(result.matched).toBe(false);
  });

  it("rejects a signal with no score when a floor is set", () => {
    const result = matchSignal(rule({ kind: "signal", minScore: 10 }), signal({ score: null }), ["NVDA"]);
    expect(result.matched).toBe(false);
    if (result.matched) return;
    expect(result.reason).toContain("no score");
  });

  it("does not match a signal against an insider rule", () => {
    const result = matchSignal(rule(), signal(), ["NVDA"]);
    expect(result.matched).toBe(false);
  });
});

describe("collectMatches", () => {
  it("counts matches per rule and explains the rules that found nothing", () => {
    const rules = [
      rule({ id: "a" }),
      rule({ id: "b", minValue: 10_000_000 }),
      rule({ id: "c", kind: "signal", minScore: 50 }),
    ];

    const { candidates, outcomes } = collectMatches(
      rules,
      { transactions: [transaction()], signals: [signal()] },
      ["NVDA"],
    );

    expect(candidates.map((entry) => entry.ruleId)).toEqual(["a", "c"]);
    expect(outcomes.find((outcome) => outcome.ruleId === "a")?.matched).toBe(1);
    expect(outcomes.find((outcome) => outcome.ruleId === "b")?.matched).toBe(0);
    expect(outcomes.find((outcome) => outcome.ruleId === "b")?.reason).toContain("threshold");
    expect(outcomes.find((outcome) => outcome.ruleId === "c")?.matched).toBe(1);
  });

  it("reports an empty feed rather than a silent zero", () => {
    const { outcomes } = collectMatches([rule({ id: "a" })], { transactions: [], signals: [] }, ["NVDA"]);
    expect(outcomes[0].matched).toBe(0);
    expect(outcomes[0].reason).toContain("no filing");
  });

  it("does not match a symbol the member does not track", () => {
    const { candidates } = collectMatches(
      [rule({ id: "a" })],
      { transactions: [transaction({ symbol: "TSLA" })], signals: [] },
      ["NVDA"],
    );
    expect(candidates).toHaveLength(0);
  });
});
