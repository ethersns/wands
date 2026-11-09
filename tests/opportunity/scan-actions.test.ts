// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ founder: vi.fn(), status: vi.fn(), advance: vi.fn() }));
vi.mock("@/lib/auth/founder", () => ({ requireFounder: mocks.founder }));
vi.mock("@/lib/api/opportunity", () => ({ getOpportunityScanStatus: mocks.status, getOpportunityScan: mocks.advance }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { readScannerAction, advanceScannerAction } from "@/lib/opportunity/scan-actions";

beforeEach(() => vi.resetAllMocks());

describe("shared scanner actions", () => {
  it("refuses status and resume before touching the engine for a non-founder", async () => {
    mocks.founder.mockResolvedValue({ ok: false, reason: "forbidden" });
    await expect(readScannerAction()).rejects.toThrow("Not authorised");
    expect((await advanceScannerAction({ runId: "scan", cursor: 10 })).ok).toBe(false);
    expect(mocks.status).not.toHaveBeenCalled();
    expect(mocks.advance).not.toHaveBeenCalled();
  });

  it("status reads never issue a mutating scan", async () => {
    mocks.founder.mockResolvedValue({ ok: true });
    mocks.status.mockResolvedValue({ ok: true, envelope: { data: null } });
    expect(await readScannerAction()).toBeNull();
    expect(mocks.status).toHaveBeenCalledOnce();
    expect(mocks.advance).not.toHaveBeenCalled();
  });

  it("forwards the acknowledged run, cursor and interval unchanged", async () => {
    mocks.founder.mockResolvedValue({ ok: true });
    const scan = { runId: "run", cursor: 19, status: "scanning", checked: 10, qualified: 0, candidates: [] };
    mocks.advance.mockResolvedValue({ ok: true, envelope: { data: scan } });
    const input = { runId: "run", cursor: 18, interval: "5m" };
    expect((await advanceScannerAction(input)).scan).toEqual(scan);
    expect(mocks.advance).toHaveBeenCalledExactlyOnceWith(input);
  });

  it("reports ambiguous timeouts without claiming nothing was recorded", async () => {
    mocks.founder.mockResolvedValue({ ok: true });
    mocks.advance.mockResolvedValue({ ok: false, error: { code: "timeout", message: "timeout" } });
    const result = await advanceScannerAction();
    expect(result.ok).toBe(false);
    expect(result.message).toContain("may have committed");
  });
});
