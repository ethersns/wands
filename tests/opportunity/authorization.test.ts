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
 * Every engine call is recorded rather than performed. The point of these tests
 * is that an unauthorised caller never reaches the engine at all, so a call
 * count of zero is the assertion that matters.
 */
const engine = {
  getOpportunityScan: vi.fn(),
  recordOpportunityDecision: vi.fn(),
  recordOpportunityTest: vi.fn(),
  evaluateOpportunityTest: vi.fn(),
};

vi.mock("@/lib/api/opportunity", () => ({
  getOpportunityScan: (...args: unknown[]) => engine.getOpportunityScan(...args),
  recordOpportunityDecision: (...args: unknown[]) => engine.recordOpportunityDecision(...args),
  recordOpportunityTest: (...args: unknown[]) => engine.recordOpportunityTest(...args),
  evaluateOpportunityTest: (...args: unknown[]) => engine.evaluateOpportunityTest(...args),
}));

function sessionFor(userId: string, extra: Record<string, unknown> = {}) {
  return {
    user: { id: userId, email: `${userId}@wands.test`, name: "Test", ...extra },
    session: { id: "session-1" },
  };
}

function engineCalls() {
  return (
    engine.getOpportunityScan.mock.calls.length +
    engine.recordOpportunityDecision.mock.calls.length +
    engine.recordOpportunityTest.mock.calls.length +
    engine.evaluateOpportunityTest.mock.calls.length
  );
}

/** A fresh module graph, so the scan cooldown does not leak between tests. */
async function loadActions() {
  vi.resetModules();
  return import("@/lib/opportunity/actions");
}

beforeEach(() => {
  vi.stubEnv("WANDS_FOUNDER_USER_IDS", FOUNDER_ID);
  getMemberSession.mockReset();
  for (const fn of Object.values(engine)) fn.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("founder allowlist", () => {
  it("grants nothing when the allowlist is absent", async () => {
    vi.stubEnv("WANDS_FOUNDER_USER_IDS", "");
    const { founderConfigured, founderUserIds } = await import("@/lib/auth/founder");

    expect(founderConfigured()).toBe(false);
    expect(founderUserIds().size).toBe(0);
  });

  it("treats a whitespace-only allowlist as unconfigured", async () => {
    vi.stubEnv("WANDS_FOUNDER_USER_IDS", "   ,  , ");
    const { founderConfigured } = await import("@/lib/auth/founder");

    expect(founderConfigured()).toBe(false);
  });

  it("parses a comma-separated allowlist and ignores padding", async () => {
    vi.stubEnv("WANDS_FOUNDER_USER_IDS", ` ${FOUNDER_ID} , second-id `);
    const { founderUserIds } = await import("@/lib/auth/founder");

    expect([...founderUserIds()]).toEqual([FOUNDER_ID, "second-id"]);
  });

  it("refuses a null or empty user id", async () => {
    const { isFounderUserId } = await import("@/lib/auth/founder");

    expect(isFounderUserId(null)).toBe(false);
    expect(isFounderUserId(undefined)).toBe(false);
    expect(isFounderUserId("")).toBe(false);
  });
});

describe("requireFounder", () => {
  it("denies an unauthenticated request", async () => {
    getMemberSession.mockResolvedValue(null);
    const { requireFounder } = await import("@/lib/auth/founder");

    expect(await requireFounder()).toEqual({ ok: false, reason: "unauthenticated" });
  });

  it("denies an ordinary authenticated member", async () => {
    getMemberSession.mockResolvedValue(sessionFor(MEMBER_ID));
    const { requireFounder } = await import("@/lib/auth/founder");

    expect(await requireFounder()).toEqual({ ok: false, reason: "forbidden" });
  });

  it("denies everyone when the allowlist is missing", async () => {
    vi.stubEnv("WANDS_FOUNDER_USER_IDS", "");
    getMemberSession.mockResolvedValue(sessionFor(FOUNDER_ID));
    const { requireFounder } = await import("@/lib/auth/founder");

    expect(await requireFounder()).toEqual({ ok: false, reason: "unconfigured" });
  });

  it("grants the configured founder", async () => {
    getMemberSession.mockResolvedValue(sessionFor(FOUNDER_ID));
    const { requireFounder } = await import("@/lib/auth/founder");

    const access = await requireFounder();

    expect(access.ok).toBe(true);
    expect(access.ok && access.userId).toBe(FOUNDER_ID);
  });

  it("ignores a role value carried on the session user", async () => {
    // A client cannot set this, but a future code path might trust it. The
    // decision must come from the allowlist, not from a role-shaped field.
    getMemberSession.mockResolvedValue(sessionFor(MEMBER_ID, { role: "admin" }));
    const { requireFounder } = await import("@/lib/auth/founder");

    expect(await requireFounder()).toEqual({ ok: false, reason: "forbidden" });
  });

  it("does not grant the founder id to a different account", async () => {
    getMemberSession.mockResolvedValue(sessionFor(`${FOUNDER_ID}-suffix`));
    const { requireFounder } = await import("@/lib/auth/founder");

    expect(await requireFounder()).toEqual({ ok: false, reason: "forbidden" });
  });
});

describe("desk server actions", () => {
  it("refuses a scan from an ordinary member without calling the engine", async () => {
    getMemberSession.mockResolvedValue(sessionFor(MEMBER_ID));
    const { runScanAction } = await loadActions();

    const result = await runScanAction();

    expect(result.ok).toBe(false);
    expect(result.title).toBe("Not authorised");
    expect(engineCalls()).toBe(0);
  });

  it("refuses a decision from an ordinary member without calling the engine", async () => {
    getMemberSession.mockResolvedValue(sessionFor(MEMBER_ID));
    const { recordDecisionAction } = await loadActions();

    const result = await recordDecisionAction("candidate-1", "candidate_watched", "note");

    expect(result.ok).toBe(false);
    expect(engineCalls()).toBe(0);
  });

  it("refuses a paper test from an ordinary member without calling the engine", async () => {
    getMemberSession.mockResolvedValue(sessionFor(MEMBER_ID));
    const { recordTestAction } = await loadActions();

    const result = await recordTestAction("candidate-1", "1");

    expect(result.ok).toBe(false);
    expect(engineCalls()).toBe(0);
  });

  it("refuses an evaluation from an ordinary member without calling the engine", async () => {
    getMemberSession.mockResolvedValue(sessionFor(MEMBER_ID));
    const { evaluateTestAction } = await loadActions();

    const result = await evaluateTestAction("test-1");

    expect(result.ok).toBe(false);
    expect(engineCalls()).toBe(0);
  });

  it("refuses every action when nobody is signed in", async () => {
    getMemberSession.mockResolvedValue(null);
    const { runScanAction, recordDecisionAction, recordTestAction, evaluateTestAction } =
      await loadActions();

    const results = await Promise.all([
      runScanAction(),
      recordDecisionAction("candidate-1", "candidate_rejected", ""),
      recordTestAction("candidate-1"),
      evaluateTestAction("test-1"),
    ]);

    expect(results.every((result) => result.ok === false)).toBe(true);
    expect(engineCalls()).toBe(0);
  });

  it("refuses every action when the allowlist is unconfigured", async () => {
    vi.stubEnv("WANDS_FOUNDER_USER_IDS", "");
    getMemberSession.mockResolvedValue(sessionFor(FOUNDER_ID));
    const { runScanAction, recordDecisionAction, recordTestAction, evaluateTestAction } =
      await loadActions();

    const results = await Promise.all([
      runScanAction(),
      recordDecisionAction("candidate-1", "candidate_watched", ""),
      recordTestAction("candidate-1"),
      evaluateTestAction("test-1"),
    ]);

    expect(results.every((result) => result.ok === false)).toBe(true);
    expect(engineCalls()).toBe(0);
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
    const { runScanAction } = await loadActions();

    const result = await runScanAction();

    expect(result.ok).toBe(true);
    expect(engine.getOpportunityScan).toHaveBeenCalledTimes(1);
  });

  it("never reports success when the engine refuses", async () => {
    getMemberSession.mockResolvedValue(sessionFor(FOUNDER_ID));
    engine.getOpportunityScan.mockResolvedValue({
      ok: false,
      error: { code: "unauthorized", message: "nope" },
    });
    const { runScanAction } = await loadActions();

    const result = await runScanAction();

    expect(result.ok).toBe(false);
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
    const { runScanAction } = await loadActions();

    const first = await runScanAction();
    const second = await runScanAction();

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.title).toBe("A scan just ran");
    expect(engine.getOpportunityScan).toHaveBeenCalledTimes(1);
  });

  it("lets the founder retry immediately after a failed scan", async () => {
    getMemberSession.mockResolvedValue(sessionFor(FOUNDER_ID));
    engine.getOpportunityScan.mockResolvedValue({
      ok: false,
      error: { code: "unreachable", message: "down" },
    });
    const { runScanAction } = await loadActions();

    await runScanAction();
    await runScanAction();

    expect(engine.getOpportunityScan).toHaveBeenCalledTimes(2);
  });
});
