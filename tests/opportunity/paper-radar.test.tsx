import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PaperRadar } from "@/components/opportunity/paper-radar";
import type { OpportunityCandidate } from "@/lib/api/opportunity";

const { recordDecisionAction } = vi.hoisted(() => ({ recordDecisionAction: vi.fn() }));
vi.mock("@/lib/opportunity/actions", () => ({ recordDecisionAction }));

function candidate(overrides: Partial<OpportunityCandidate> = {}): OpportunityCandidate {
  return {
    id: "btc", symbol: "BTC/USD", marketType: "crypto", latestDecision: null,
    strategyKey: "intraday_breakout", strategyVersion: 1,
    observedAt: "2026-11-09T15:00:00Z", createdAt: "2026-11-09T15:06:00Z",
    referencePrice: "101.2", invalidationPrice: "99.80000001", targetPrice: "104", rangeHigh: "100",
    volumeRatio: 2, breakoutMargin: 0.012, whyQualified: "Closed above the range on higher volume.",
    entryCondition: "Enter at the next completed candle open.", invalidationCondition: "Exit at the trigger low.",
    exitCondition: "Exit at target or time stop.", maxHoldingHours: 4,
    sizing: { quantity: null, notional: null, riskAtStop: null, bindingConstraint: "exposure", rejectedReason: "Insufficient size", feasible: false },
    costs: { feeBps: 5, slippageBps: 10 }, dataQuality: { fresh: true, ageSeconds: 30, warnings: ["Research only"] },
    rankReason: "Volume before breakout margin.", ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("Paper Radar", () => {
  it("ranks the loaded candidates using volume then breakout margin without mutating input", () => {
    const candidates = [candidate(), candidate({ id: "eth", symbol: "ETH/USD", volumeRatio: 3 }), candidate({ id: "sol", symbol: "SOL/USD", volumeRatio: 3, breakoutMargin: 0.02 })];
    render(<PaperRadar candidates={candidates} error={null} />);
    const rows = within(screen.getByRole("list", { name: "Ranked paper setups" })).getAllByRole("listitem");
    expect(rows.map((row) => within(row).getByRole("heading").textContent)).toEqual(["1. SOL/USD", "2. ETH/USD", "3. BTC/USD"]);
    expect(candidates[0].id).toBe("btc");
  });

  it("exposes honest timestamps, precise stops and an expandable detail disclosure", () => {
    render(<PaperRadar candidates={[candidate()]} error={null} />);
    const summary = screen.getByText("Setup details · BTC/USD");
    expect(summary.closest("details")).not.toHaveAttribute("open");
    fireEvent.click(summary);
    expect(summary.closest("details")).toHaveAttribute("open");
    expect(screen.getByText("99.80000001")).toBeInTheDocument();
    expect(screen.getByText("2026-11-09 15:06:00 UTC")).toBeInTheDocument();
    expect(screen.getByText(/current freshness is not verified/)).toBeInTheDocument();
    expect(screen.getByText(/Insufficient size/)).toBeInTheDocument();
    expect(recordDecisionAction).not.toHaveBeenCalled();
  });

  it("waits for server acknowledgement before removing a setup", async () => {
    let resolve!: (result: { ok: boolean; message: string }) => void;
    recordDecisionAction.mockReturnValue(new Promise((done) => { resolve = done; }));
    render(<PaperRadar candidates={[candidate()]} error={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss BTC/USD setup" }));
    expect(screen.getByText("1. BTC/USD")).toBeInTheDocument();
    expect(screen.getByRole("button")).toBeDisabled();
    expect(recordDecisionAction).toHaveBeenCalledWith("btc", "candidate_rejected", "Dismissed from Paper Radar.");
    resolve({ ok: true, message: "Saved" });
    await waitFor(() => expect(screen.queryByText("1. BTC/USD")).not.toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent("engine saved");
  });

  it.each(["refused", "network"])("retains a setup when dismissal is %s", async (mode) => {
    if (mode === "network") recordDecisionAction.mockRejectedValue(new Error("Offline"));
    else recordDecisionAction.mockResolvedValue({ ok: false, message: "Engine refused" });
    render(<PaperRadar candidates={[candidate()]} error={null} />);
    fireEvent.click(screen.getByRole("button"));
    await screen.findByRole("alert");
    expect(screen.getByText("1. BTC/USD")).toBeInTheDocument();
    expect(screen.getByRole("button")).toBeEnabled();
  });

  it("honors persisted dismissals on a fresh mount and retains watched setups", () => {
    render(<PaperRadar candidates={[candidate({ latestDecision: "candidate_rejected" }), candidate({ id: "eth", symbol: "ETH/USD", latestDecision: "candidate_watched" })]} error={null} />);
    expect(screen.queryByText(/BTC\/USD/)).not.toBeInTheDocument();
    expect(screen.getByText("1. ETH/USD")).toBeInTheDocument();
  });

  it("fails closed for an older engine without durable decision state", () => {
    render(<PaperRadar candidates={[candidate({ latestDecision: undefined })]} error={null} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Update the engine");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("distinguishes an engine failure from no matching setups", () => {
    render(<PaperRadar candidates={[]} error="Engine unavailable" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Engine unavailable");
    expect(screen.queryByText("No undismissed setups")).not.toBeInTheDocument();
  });
});
