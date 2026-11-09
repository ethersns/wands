// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});

const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});

vi.mock("next/navigation", () => ({ notFound, redirect }));

const requireFounder = vi.fn();
vi.mock("@/lib/auth/founder", () => ({ requireFounder: () => requireFounder() }));

/**
 * Every read is recorded rather than performed. An unauthorised visit must not
 * cause a single one: each carries the privileged engine credential, and the
 * journal read is scoped to one account.
 */
const engine = {
  getOpportunityBudget: vi.fn(),
  getOpportunityCandidates: vi.fn(),
  getMarketHealth: vi.fn(),
  getMarketQuote: vi.fn(),
};

vi.mock("@/lib/api/opportunity", () => ({
  getOpportunityBudget: (...args: unknown[]) => engine.getOpportunityBudget(...args),
  getOpportunityCandidates: (...args: unknown[]) => engine.getOpportunityCandidates(...args),
}));

vi.mock("@/lib/api/markets", () => ({
  getMarketHealth: (...args: unknown[]) => engine.getMarketHealth(...args),
  getMarketQuote: (...args: unknown[]) => engine.getMarketQuote(...args),
}));

const listTrades = vi.fn();
vi.mock("@/lib/money/journal", () => ({
  listTrades: (...args: unknown[]) => listTrades(...args),
}));

vi.mock("@/components/money/money-desk", () => ({ MoneyDesk: () => null }));
vi.mock("@/components/shared/page-header", () => ({ PageHeader: () => null }));
vi.mock("@/components/shared/section-card", () => ({ SectionCard: () => null }));
vi.mock("@/components/shared/stat", () => ({ Stat: () => null }));

function reads() {
  return (
    engine.getOpportunityBudget.mock.calls.length +
    engine.getOpportunityCandidates.mock.calls.length +
    engine.getMarketHealth.mock.calls.length +
    engine.getMarketQuote.mock.calls.length +
    listTrades.mock.calls.length
  );
}

async function loadPage() {
  vi.resetModules();
  return (await import("@/app/app/money/page")).default;
}

beforeEach(() => {
  requireFounder.mockReset();
  notFound.mockClear();
  redirect.mockClear();
  listTrades.mockReset();
  listTrades.mockResolvedValue([]);
  for (const fn of Object.values(engine)) {
    fn.mockReset();
    fn.mockResolvedValue({ ok: false, error: { code: "unreachable", message: "down" } });
  }
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Money page", () => {
  it("sends an unauthenticated visitor to sign in without reading anything", async () => {
    requireFounder.mockResolvedValue({ ok: false, reason: "unauthenticated" });
    const page = await loadPage();

    await expect(page()).rejects.toThrow("NEXT_REDIRECT:/signin?next=%2Fapp%2Fmoney");
    expect(reads()).toBe(0);
  });

  it("hides the page from an ordinary authenticated member", async () => {
    requireFounder.mockResolvedValue({ ok: false, reason: "forbidden" });
    const page = await loadPage();

    await expect(page()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(reads()).toBe(0);
  });

  it("hides the page when the founder allowlist is unconfigured", async () => {
    requireFounder.mockResolvedValue({ ok: false, reason: "unconfigured" });
    const page = await loadPage();

    await expect(page()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(reads()).toBe(0);
  });

  it("reads the journal for the founder's own account", async () => {
    requireFounder.mockResolvedValue({
      ok: true,
      userId: "founder-user-id",
      email: "f@wands.test",
    });
    const page = await loadPage();

    await expect(page()).resolves.toBeTruthy();
    expect(listTrades).toHaveBeenCalledTimes(1);
    expect(listTrades.mock.calls[0][0]).toBe("founder-user-id");
  });

  it("prices one quote per distinct open symbol, not one per position", async () => {
    requireFounder.mockResolvedValue({
      ok: true,
      userId: "founder-user-id",
      email: "f@wands.test",
    });
    listTrades.mockResolvedValue([
      {
        id: "t1",
        symbol: "BTC/USD",
        marketType: "crypto",
        candidateId: null,
        strategyKey: null,
        strategyVersion: null,
        planReferencePrice: null,
        planTargetPrice: null,
        planStopPrice: null,
        planReason: null,
        status: "open",
        entryPrice: "74000.0000000000",
        entryQuantity: "0.0010000000",
        entryFee: "0.0000000000",
        reportedAt: "2026-11-09T10:00:00.000Z",
        exitPrice: null,
        exitFee: null,
        closedAt: null,
        note: null,
      },
      {
        id: "t2",
        symbol: "BTC/USD",
        marketType: "crypto",
        candidateId: null,
        strategyKey: null,
        strategyVersion: null,
        planReferencePrice: null,
        planTargetPrice: null,
        planStopPrice: null,
        planReason: null,
        status: "open",
        entryPrice: "74100.0000000000",
        entryQuantity: "0.0020000000",
        entryFee: "0.0000000000",
        reportedAt: "2026-11-09T10:05:00.000Z",
        exitPrice: null,
        exitFee: null,
        closedAt: null,
        note: null,
      },
    ]);
    const page = await loadPage();

    await expect(page()).resolves.toBeTruthy();
    expect(engine.getMarketQuote).toHaveBeenCalledTimes(1);
    expect(engine.getMarketQuote.mock.calls[0][0]).toBe("BTC/USD");
  });
});
