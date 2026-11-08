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
 * The desk reads are recorded rather than performed. An unauthorised visit must
 * not cause a single one, because each carries the privileged engine token.
 */
const engine = {
  getOpportunityBudget: vi.fn(),
  getOpportunityCandidates: vi.fn(),
  getOpportunityDecisions: vi.fn(),
  getOpportunityTests: vi.fn(),
};

vi.mock("@/lib/api/opportunity", () => ({
  getOpportunityBudget: (...args: unknown[]) => engine.getOpportunityBudget(...args),
  getOpportunityCandidates: (...args: unknown[]) => engine.getOpportunityCandidates(...args),
  getOpportunityDecisions: (...args: unknown[]) => engine.getOpportunityDecisions(...args),
  getOpportunityTests: (...args: unknown[]) => engine.getOpportunityTests(...args),
}));

vi.mock("@/components/opportunity/opportunity-desk", () => ({ OpportunityDesk: () => null }));
vi.mock("@/components/shared/page-header", () => ({ PageHeader: () => null }));
vi.mock("@/components/shared/section-card", () => ({ SectionCard: () => null }));

function engineCalls() {
  return (
    engine.getOpportunityBudget.mock.calls.length +
    engine.getOpportunityCandidates.mock.calls.length +
    engine.getOpportunityDecisions.mock.calls.length +
    engine.getOpportunityTests.mock.calls.length
  );
}

async function loadPage() {
  vi.resetModules();
  return (await import("@/app/app/opportunity/page")).default;
}

beforeEach(() => {
  requireFounder.mockReset();
  notFound.mockClear();
  redirect.mockClear();
  for (const fn of Object.values(engine)) {
    fn.mockReset();
    fn.mockResolvedValue({ ok: false, error: { code: "unreachable", message: "down" } });
  }
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Opportunity Desk page", () => {
  it("sends an unauthenticated visitor to sign in without reading the desk", async () => {
    requireFounder.mockResolvedValue({ ok: false, reason: "unauthenticated" });
    const page = await loadPage();

    await expect(page()).rejects.toThrow("NEXT_REDIRECT:/signin?next=%2Fapp%2Fopportunity");
    expect(engineCalls()).toBe(0);
  });

  it("hides the desk from an ordinary authenticated member", async () => {
    requireFounder.mockResolvedValue({ ok: false, reason: "forbidden" });
    const page = await loadPage();

    await expect(page()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(engineCalls()).toBe(0);
  });

  it("hides the desk when the founder allowlist is unconfigured", async () => {
    requireFounder.mockResolvedValue({ ok: false, reason: "unconfigured" });
    const page = await loadPage();

    await expect(page()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(engineCalls()).toBe(0);
  });

  it("loads the desk for the founder", async () => {
    requireFounder.mockResolvedValue({ ok: true, userId: "founder-user-id", email: "f@wands.test" });
    const page = await loadPage();

    await expect(page()).resolves.toBeTruthy();
    expect(engineCalls()).toBe(4);
  });
});
