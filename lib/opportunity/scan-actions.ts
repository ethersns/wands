"use server";

import { revalidatePath } from "next/cache";
import { getOpportunityMarketPulse, getOpportunityScan, getOpportunityScanStatus, type MarketPulseSnapshot, type OpportunityScan, type ScanRequest } from "@/lib/api/opportunity";
import type { ActionOutcome } from "@/lib/intelligence/action-outcome";
import { requireFounder } from "@/lib/auth/founder";

export type ScanOutcome = ActionOutcome & { scan?: OpportunityScan | null };

function failure(message: string): ScanOutcome {
  return { ok: false, title: "Scan paused", message, detail: [], at: new Date().toISOString() };
}

export async function readScannerAction(): Promise<OpportunityScan | null> {
  const access = await requireFounder();
  if (!access.ok) throw new Error("Not authorised");
  const result = await getOpportunityScanStatus();
  if (!result.ok) throw new Error(result.error.message);
  return result.envelope.data;
}

export async function readMarketPulseAction(): Promise<MarketPulseSnapshot> {
  const access = await requireFounder();
  if (!access.ok) throw new Error("Not authorised");
  const result = await getOpportunityMarketPulse();
  if (!result.ok) throw new Error(result.error.message);
  return result.envelope.data;
}

export async function advanceScannerAction(input: ScanRequest = {}): Promise<ScanOutcome> {
  const access = await requireFounder();
  if (!access.ok) {
    return { ...failure("This scanner is limited to the founder account. Nothing was sent to the engine."), title: "Not authorised" };
  }
  const result = await getOpportunityScan(input);
  if (!result.ok) return failure(result.error.code === "unauthorized"
    ? "The engine token does not hold the admin role required by the scanner."
    : `${result.error.message} Read status before resuming; the last batch may have committed.`);
  const scan = result.envelope.data;
  if (scan?.candidates.length) {
    revalidatePath("/app/money");
    revalidatePath("/app/opportunity");
  }
  return {
    ok: true,
    title: scan?.status === "complete" ? "Scan complete" : "Scan checkpoint saved",
    message: scan ? `${scan.checked} markets checked; ${scan.qualified} qualifying setups. Research only, not trades.` : "Another batch is starting. Read status to continue.",
    detail: [],
    at: new Date().toISOString(),
    scan,
  };
}
