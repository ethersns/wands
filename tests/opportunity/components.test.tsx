import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpportunityDesk } from "@/components/opportunity/opportunity-desk";
import type {
  OpportunityCandidate,
  OpportunityDecision,
  OpportunityPaperTest,
} from "@/lib/api/opportunity";

const mocks = vi.hoisted(() => ({
  runScanAction: vi.fn(),
  recordDecisionAction: vi.fn(),
  recordTestAction: vi.fn(),
  evaluateTestAction: vi.fn(),
}));

vi.mock("@/lib/opportunity/actions", () => mocks);

function candidate(overrides: Partial<OpportunityCandidate> = {}): OpportunityCandidate {
  return {
    id: "cand-1",
    symbol: "BTC/USD",
    marketType: "crypto",
    strategyKey: "intraday_breakout",
    strategyVersion: 1,
    observedAt: "2026-11-09T15:00:00Z",
    referencePrice: "101.2",
    invalidationPrice: "99.8",
    targetPrice: "104.0",
    rangeHigh: "100.0",
    volumeRatio: 2,
    breakoutMargin: 0.012,
    whyQualified: "Closed above the 20-candle high on 2.00x average volume.",
    entryCondition: "Enter at the open of the next completed 5-minute candle.",
    invalidationCondition: "Exit at or below 99.8000.",
    exitCondition: "Target 104.0000, or the 4-hour time stop.",
    maxHoldingHours: 4,
    sizing: {
      quantity: "0.05",
      notional: "5.06",
      riskAtStop: "0.07",
      bindingConstraint: "maximum position exposure",
      rejectedReason: null,
      feasible: true,
    },
    costs: { feeBps: 5, slippageBps: 10 },
    dataQuality: { fresh: true, ageSeconds: 30, warnings: [] },
    rankReason: "Volume 2.00x its 20-candle average.",
    createdAt: "2026-11-09T15:00:00Z",
    ...overrides,
  };
}

function paperTest(overrides: Partial<OpportunityPaperTest> = {}): OpportunityPaperTest {
  return {
    id: "test-1",
    candidateId: "cand-1",
    symbol: "BTC/USD",
    marketType: "crypto",
    strategyKey: "intraday_breakout",
    strategyVersion: 1,
    referencePrice: "101.2",
    invalidationPrice: "99.8",
    targetPrice: "104.0",
    quantity: "0.05000000",
    openedAt: "2026-11-09T16:40:00Z",
    deadline: "2026-11-09T20:40:00Z",
    status: "test_active",
    exitReason: "The test is still open.",
    entryPrice: null,
    exitPrice: null,
    exitAt: null,
    holdingSeconds: null,
    grossReturn: null,
    fees: null,
    slippage: null,
    netReturn: null,
    drawdown: null,
    notes: [],
    ...overrides,
  };
}

function decision(overrides: Partial<OpportunityDecision> = {}): OpportunityDecision {
  return {
    id: "dec-1",
    candidateId: "cand-1",
    decision: "candidate_watched",
    note: "Watching the retest.",
    decidedAt: "2026-11-09T16:00:00Z",
    ...overrides,
  };
}

function renderDesk({
  candidates = [candidate()],
  decisions = [] as OpportunityDecision[],
  tests = [] as OpportunityPaperTest[],
  candidatesError = null as string | null,
} = {}) {
  return render(
    <OpportunityDesk
      candidates={candidates}
      decisions={decisions}
      tests={tests}
      candidatesError={candidatesError}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Opportunity Desk manual controls", () => {
  it("offers watch, reject and a paper test for an undecided candidate", () => {
    renderDesk();

    expect(screen.getByRole("button", { name: /^watch$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^reject$/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /record hypothetical paper test/i }),
    ).toBeInTheDocument();
  });

  it("shows the recorded decision instead of offering the same action twice", () => {
    renderDesk({ decisions: [decision()] });

    const card = within(screen.getByRole("article"));
    expect(card.getByText(/^watched$/i)).toBeInTheDocument();
    expect(card.getByText(/watching the retest/i)).toBeInTheDocument();
    expect(card.queryByRole("button", { name: /^watch$/i })).not.toBeInTheDocument();
    expect(card.queryByRole("button", { name: /^reject$/i })).not.toBeInTheDocument();
  });

  it("refuses to offer a paper test for a candidate that could not be sized", () => {
    renderDesk({
      candidates: [
        candidate({
          sizing: {
            quantity: null,
            notional: null,
            riskAtStop: null,
            bindingConstraint: "maximum position exposure",
            rejectedReason: "One share costs 100.00, above the 5.00 exposure ceiling.",
            feasible: false,
          },
        }),
      ],
    });

    expect(
      screen.getByRole("button", { name: /record hypothetical paper test/i }),
    ).toBeDisabled();
    expect(screen.getByText(/not evidence/i)).toBeInTheDocument();
  });

  it("does not show a success until the server confirms it", async () => {
    mocks.recordDecisionAction.mockResolvedValue({
      ok: true,
      title: "Candidate watched",
      message: "The engine stored the decision.",
      detail: [],
      at: "2026-11-09T16:00:00Z",
    });

    renderDesk();
    expect(screen.queryByText("Candidate watched")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^watch$/i }));

    await waitFor(() => expect(screen.getByText("Candidate watched")).toBeInTheDocument());
    expect(mocks.recordDecisionAction).toHaveBeenCalledWith("cand-1", "candidate_watched", "");
  });

  it("surfaces the engine's refusal rather than a quiet no-op", async () => {
    mocks.recordDecisionAction.mockResolvedValue({
      ok: false,
      title: "The decision was not recorded",
      message: "The engine refused this decision.",
      detail: ["error code: unauthorized"],
      at: "2026-11-09T16:00:00Z",
    });

    renderDesk();
    fireEvent.click(screen.getByRole("button", { name: /^reject$/i }));

    await waitFor(() =>
      expect(screen.getByText("The decision was not recorded")).toBeInTheDocument(),
    );
    expect(screen.getByText(/error code: unauthorized/i)).toBeInTheDocument();
  });

  it("reports a transport failure without claiming anything was recorded", async () => {
    mocks.recordTestAction.mockRejectedValue(new Error("network down"));

    renderDesk();
    fireEvent.click(screen.getByRole("button", { name: /record hypothetical paper test/i }));

    await waitFor(() =>
      expect(screen.getByText(/nothing was recorded/i)).toBeInTheDocument(),
    );
  });

  it("offers evaluation for an active test and not for a settled one", () => {
    const { unmount } = renderDesk({ tests: [paperTest()] });
    expect(screen.getByRole("button", { name: /evaluate against the candles/i })).toBeInTheDocument();
    unmount();

    renderDesk({
      tests: [
        paperTest({
          status: "test_completed",
          exitReason: "Price reached the target.",
          entryPrice: "101.2",
          exitPrice: "104.0",
          netReturn: "0.13",
          fees: "0.005",
          slippage: "0.01",
        }),
      ],
    });
    const card = within(screen.getByRole("article"));
    expect(
      card.queryByRole("button", { name: /evaluate against the candles/i }),
    ).not.toBeInTheDocument();
    expect(card.getByText(/target reached/i)).toBeInTheDocument();
  });

  it("runs a scan only when asked", async () => {
    mocks.runScanAction.mockResolvedValue({
      ok: true,
      title: "No qualifying opportunities",
      message: "A quiet scan is a normal result, not a failure.",
      detail: [],
      at: "2026-11-09T16:00:00Z",
    });

    renderDesk();
    expect(mocks.runScanAction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /run scan/i }));

    await waitFor(() => expect(mocks.runScanAction).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByText("No qualifying opportunities")).toBeInTheDocument(),
    );
  });

  it("says the engine is unreachable instead of showing an empty desk", () => {
    renderDesk({ candidates: [], candidatesError: "WANDS_ENGINE_URL is not set." });

    expect(screen.getByText(/the engine could not be reached/i)).toBeInTheDocument();
    expect(screen.getByText(/WANDS_ENGINE_URL is not set/i)).toBeInTheDocument();
  });
});
