import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpportunityDesk } from "@/components/opportunity/opportunity-desk";
import { SWRConfig } from "swr";
import type {
  OpportunityCandidate,
  OpportunityDecision,
  OpportunityPaperTest,
} from "@/lib/api/opportunity";

const mocks = vi.hoisted(() => ({
  advanceScannerAction: vi.fn(),
  readScannerAction: vi.fn(),
  readMarketPulseAction: vi.fn(),
  recordDecisionAction: vi.fn(),
  recordTestAction: vi.fn(),
  evaluateTestAction: vi.fn(),
}));

vi.mock("@/lib/opportunity/actions", () => mocks);
vi.mock("@/lib/opportunity/scan-actions", () => mocks);

function candidate(overrides: Partial<OpportunityCandidate> = {}): OpportunityCandidate {
  return {
    id: "cand-1",
    latestDecision: null,
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
    <SWRConfig value={{ provider: () => new Map() }}>
      <OpportunityDesk
        candidates={candidates}
        decisions={decisions}
        tests={tests}
        candidatesError={candidatesError}
      />
    </SWRConfig>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readScannerAction.mockResolvedValue(null);
  mocks.readMarketPulseAction.mockResolvedValue({
    asOf: "2026-11-09T15:00:00Z",
    timestampSource: "provider",
    source: "Kraken public AssetPairs and Ticker REST endpoints",
    activeMarkets: 0,
    minimumTurnoverUsd: "100000",
    maxSpreadPct: "1",
    markets: [],
  });
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
    mocks.advanceScannerAction.mockResolvedValue({
      ok: false, message: "Provider unavailable; progress saved.",
    });

    renderDesk();
    expect(mocks.advanceScannerAction).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: /find opportunities/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /find opportunities/i }));

    await waitFor(() => expect(mocks.advanceScannerAction).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByText("Provider unavailable; progress saved.")).toBeInTheDocument(),
    );
  });

  it("requires explicit confirmation and a matching cursor before replacing a saved scan", async () => {
    const savedScan = {
      runId: "saved-run",
      status: "paused" as const,
      generatedAt: "2026-11-09T15:00:00Z",
      updatedAt: "2026-11-09T15:00:00Z",
      interval: "5m",
      cursor: 7,
      checked: 6,
      pairsChecked: 2,
      total: 664,
      activeUsdPairs: 660,
      qualified: 0,
      candidates: [],
      skipped: [],
      notes: [],
      lastError: null,
      nextBatchAt: null,
      busy: false,
      liquidity: { minUsdVolume24h: "100000", maxSpreadPct: "1" },
    };
    mocks.readScannerAction.mockResolvedValue(savedScan);
    mocks.advanceScannerAction.mockResolvedValue({
      ok: true,
      title: "Scan started",
      message: "A new bounded scan has started.",
      detail: [],
      at: "2026-11-09T15:01:00Z",
      scan: {
        ...savedScan,
        runId: "new-run",
        status: "complete",
        cursor: 45,
        checked: 44,
        total: 44,
        replacedRun: {
          runId: "saved-run",
          status: "paused",
          checked: 6,
          total: 664,
          qualified: 0,
          updatedAt: savedScan.updatedAt,
        },
      },
    });

    renderDesk();
    fireEvent.click(await screen.findByRole("button", { name: /Start new bounded scan/i }));
    expect(screen.getByText(/only the current resumable checkpoint is replaced/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Confirm new bounded scan/i }));

    await waitFor(() => expect(mocks.advanceScannerAction).toHaveBeenCalledWith({
      restart: true,
      replaceRunId: "saved-run",
      replaceCursor: 7,
    }));
  });

  it("discloses how many active Kraken pairs were not scanned", async () => {
    mocks.readScannerAction.mockResolvedValue({
      runId: "run-1",
      status: "complete",
      generatedAt: "2026-11-09T15:00:00Z",
      updatedAt: "2026-11-09T15:00:00Z",
      interval: "5m",
      cursor: 44,
      checked: 44,
      pairsChecked: 40,
      total: 44,
      activeUsdPairs: 800,
      qualified: 0,
      candidates: [],
      skipped: [],
      notes: ["Coverage: selected 40 of 800 online Kraken USD spot pairs; 760 online pairs were not scanned."],
      lastError: null,
      nextBatchAt: null,
      busy: false,
      liquidity: { minUsdVolume24h: "100000", maxSpreadPct: "1" },
    });

    renderDesk({ candidates: [] });

    expect(
      await screen.findByText(/selected 40 of 800 online Kraken USD spot pairs/),
    ).toBeInTheDocument();
  });

  it("says the engine is unreachable instead of showing an empty desk", () => {
    renderDesk({ candidates: [], candidatesError: "WANDS_ENGINE_URL is not set." });

    expect(screen.getByText(/the engine could not be reached/i)).toBeInTheDocument();
    expect(screen.getByText(/Radar unavailable: WANDS_ENGINE_URL is not set/i)).toBeInTheDocument();
  });
});
