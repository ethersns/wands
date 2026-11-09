// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const FOUNDER_ID = "founder-user-id";
const MEMBER_ID = "ordinary-member-id";

const getMemberSession = vi.fn();

vi.mock("@/lib/member/session", () => ({
  getMemberSession: () => getMemberSession(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/**
 * The journal and the engine are recorded rather than performed. The assertion
 * that matters for an unauthorised caller is that neither was touched at all.
 */
const journal = {
  openTrade: vi.fn(),
  closeTrade: vi.fn(),
};

vi.mock("@/lib/money/journal", () => ({
  openTrade: (...args: unknown[]) => journal.openTrade(...args),
  closeTrade: (...args: unknown[]) => journal.closeTrade(...args),
}));

const engine = {
  getOpportunityScan: vi.fn(),
};

vi.mock("@/lib/api/opportunity", () => ({
  getOpportunityScan: (...args: unknown[]) => engine.getOpportunityScan(...args),
}));

function sessionFor(userId: string) {
  return {
    user: { id: userId, email: `${userId}@wands.test`, name: "Test" },
    session: { id: "session-1" },
  };
}

function sideEffects() {
  return (
    journal.openTrade.mock.calls.length +
    journal.closeTrade.mock.calls.length +
    engine.getOpportunityScan.mock.calls.length
  );
}

/** A fresh module graph, so the scan cooldown does not leak between tests. */
async function loadActions() {
  vi.resetModules();
  return import("@/lib/money/actions");
}

const ENTRY = {
  symbol: "BTC/USD",
  entryPrice: "74027.45",
  quantity: "0.00135",
  fee: "0.10",
};

beforeEach(() => {
  vi.stubEnv("WANDS_FOUNDER_USER_IDS", FOUNDER_ID);
  getMemberSession.mockReset();
  for (const fn of [...Object.values(journal), ...Object.values(engine)]) fn.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("Money actions refuse a caller without the grant", () => {
  it("refuses an entry from an ordinary member without writing", async () => {
    getMemberSession.mockResolvedValue(sessionFor(MEMBER_ID));
    const { recordEntryAction } = await loadActions();

    const result = await recordEntryAction(ENTRY);

    expect(result.ok).toBe(false);
    expect(result.title).toBe("Not authorised");
    expect(sideEffects()).toBe(0);
  });

  it("refuses an exit from an ordinary member without writing", async () => {
    getMemberSession.mockResolvedValue(sessionFor(MEMBER_ID));
    const { recordExitAction } = await loadActions();

    const result = await recordExitAction("trade-1", { exitPrice: "74100" });

    expect(result.ok).toBe(false);
    expect(sideEffects()).toBe(0);
  });

  it("refuses a scan from an ordinary member without calling the engine", async () => {
    getMemberSession.mockResolvedValue(sessionFor(MEMBER_ID));
    const { runMoneyScanAction } = await loadActions();

    const result = await runMoneyScanAction();

    expect(result.ok).toBe(false);
    expect(sideEffects()).toBe(0);
  });

  it("refuses a refresh from an ordinary member", async () => {
    getMemberSession.mockResolvedValue(sessionFor(MEMBER_ID));
    const { refreshMoneyAction } = await loadActions();

    expect((await refreshMoneyAction()).ok).toBe(false);
  });

  it("refuses every action when nobody is signed in", async () => {
    getMemberSession.mockResolvedValue(null);
    const { recordEntryAction, recordExitAction, runMoneyScanAction, refreshMoneyAction } =
      await loadActions();

    const results = await Promise.all([
      recordEntryAction(ENTRY),
      recordExitAction("trade-1", { exitPrice: "74100" }),
      runMoneyScanAction(),
      refreshMoneyAction(),
    ]);

    expect(results.every((result) => result.ok === false)).toBe(true);
    expect(sideEffects()).toBe(0);
  });

  it("refuses every action when the allowlist is unconfigured", async () => {
    vi.stubEnv("WANDS_FOUNDER_USER_IDS", "");
    getMemberSession.mockResolvedValue(sessionFor(FOUNDER_ID));
    const { recordEntryAction, recordExitAction, runMoneyScanAction } = await loadActions();

    const results = await Promise.all([
      recordEntryAction(ENTRY),
      recordExitAction("trade-1", { exitPrice: "74100" }),
      runMoneyScanAction(),
    ]);

    expect(results.every((result) => result.ok === false)).toBe(true);
    expect(sideEffects()).toBe(0);
  });
});

describe("Money actions for the founder", () => {
  it("records an entry against the session user, not a client-supplied id", async () => {
    getMemberSession.mockResolvedValue(sessionFor(FOUNDER_ID));
    journal.openTrade.mockResolvedValue({
      ok: true,
      trade: {
        id: "trade-1",
        symbol: "BTC/USD",
        entryPrice: "74027.4500000000",
        entryQuantity: "0.0013500000",
        entryFee: "0.1000000000",
      },
    });
    const { recordEntryAction } = await loadActions();

    // A hostile client tries to write into another member's journal.
    const result = await recordEntryAction({ ...ENTRY, userId: MEMBER_ID } as never);

    expect(result.ok).toBe(true);
    expect(journal.openTrade).toHaveBeenCalledTimes(1);
    expect(journal.openTrade.mock.calls[0][0]).toBe(FOUNDER_ID);
  });

  it("does not write when the entry does not parse", async () => {
    getMemberSession.mockResolvedValue(sessionFor(FOUNDER_ID));
    const { recordEntryAction } = await loadActions();

    const result = await recordEntryAction({ ...ENTRY, entryPrice: "0" });

    expect(result.ok).toBe(false);
    expect(journal.openTrade).not.toHaveBeenCalled();
  });

  it("reports a duplicate open position as such", async () => {
    getMemberSession.mockResolvedValue(sessionFor(FOUNDER_ID));
    journal.openTrade.mockResolvedValue({
      ok: false,
      reason: "duplicate",
      message: "You already have an open position recorded for this setup.",
    });
    const { recordEntryAction } = await loadActions();

    const result = await recordEntryAction(ENTRY);

    expect(result.ok).toBe(false);
    expect(result.title).toBe("Already recorded");
  });

  it("never reports success when the write fails", async () => {
    getMemberSession.mockResolvedValue(sessionFor(FOUNDER_ID));
    journal.openTrade.mockResolvedValue({
      ok: false,
      reason: "failed",
      message: "connection terminated",
    });
    const { recordEntryAction } = await loadActions();

    expect((await recordEntryAction(ENTRY)).ok).toBe(false);
  });

  it("closes a position against the session user", async () => {
    getMemberSession.mockResolvedValue(sessionFor(FOUNDER_ID));
    journal.closeTrade.mockResolvedValue({
      ok: true,
      trade: { id: "trade-1", symbol: "BTC/USD", exitPrice: "74100", exitFee: "0.2" },
    });
    const { recordExitAction } = await loadActions();

    const result = await recordExitAction("trade-1", { exitPrice: "74100", fee: "0.2" });

    expect(result.ok).toBe(true);
    expect(journal.closeTrade.mock.calls[0][0]).toBe(FOUNDER_ID);
    expect(journal.closeTrade.mock.calls[0][1]).toBe("trade-1");
  });

  it("refuses an exit with no position id", async () => {
    getMemberSession.mockResolvedValue(sessionFor(FOUNDER_ID));
    const { recordExitAction } = await loadActions();

    const result = await recordExitAction("   ", { exitPrice: "74100" });

    expect(result.ok).toBe(false);
    expect(journal.closeTrade).not.toHaveBeenCalled();
  });

  it("reports a position that is not open rather than pretending it closed", async () => {
    getMemberSession.mockResolvedValue(sessionFor(FOUNDER_ID));
    journal.closeTrade.mockResolvedValue({
      ok: false,
      reason: "not_found",
      message: "That position is not open, or it does not belong to you.",
    });
    const { recordExitAction } = await loadActions();

    const result = await recordExitAction("trade-1", { exitPrice: "74100" });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("not open");
  });

  it("lets the founder scan and reports the engine's own answer", async () => {
    getMemberSession.mockResolvedValue(sessionFor(FOUNDER_ID));
    engine.getOpportunityScan.mockResolvedValue({
      ok: true,
      envelope: {
        data: {
          generatedAt: "2026-11-09T15:00:00Z",
          interval: "5m",
          candidates: [{ id: "c1" }],
          skipped: [{ symbol: "ETH/USD", reason: "no range" }],
          notes: [],
        },
      },
    });
    const { runMoneyScanAction } = await loadActions();

    const result = await runMoneyScanAction();

    expect(result.ok).toBe(true);
    expect(engine.getOpportunityScan).toHaveBeenCalledTimes(1);
  });

  it("never reports a successful scan when the engine refuses", async () => {
    getMemberSession.mockResolvedValue(sessionFor(FOUNDER_ID));
    engine.getOpportunityScan.mockResolvedValue({
      ok: false,
      error: { code: "unauthorized", message: "nope" },
    });
    const { runMoneyScanAction } = await loadActions();

    const result = await runMoneyScanAction();

    expect(result.ok).toBe(false);
    expect(result.message).toContain("admin role");
  });

  it("ignores a second scan inside the cooldown window", async () => {
    getMemberSession.mockResolvedValue(sessionFor(FOUNDER_ID));
    engine.getOpportunityScan.mockResolvedValue({
      ok: true,
      envelope: {
        data: {
          generatedAt: "2026-11-09T15:00:00Z",
          interval: "5m",
          candidates: [],
          skipped: [],
          notes: [],
        },
      },
    });
    const { runMoneyScanAction } = await loadActions();

    const first = await runMoneyScanAction();
    const second = await runMoneyScanAction();

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.title).toBe("A scan just ran");
    expect(engine.getOpportunityScan).toHaveBeenCalledTimes(1);
  });
});
