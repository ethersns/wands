"use server";

import { revalidatePath } from "next/cache";

import type { ApiError } from "@/lib/api/contracts";
import {
  evaluateOpportunityTest,
  recordOpportunityDecision,
  recordOpportunityTest,
  type OpportunityDecisionKind,
} from "@/lib/api/opportunity";
import type { ActionOutcome } from "@/lib/intelligence/action-outcome";
import { requireFounder } from "@/lib/auth/founder";
import { advanceScannerAction } from "./scan-actions";

/**
 * Manual research actions for the Opportunity Desk.
 *
 * These are reachable by anyone who can call a server action, so each one
 * authorises the caller itself before it does anything. The engine's admin role
 * is not a substitute: every request here carries the shared server-side engine
 * token, so the engine sees the token's authority rather than the member's. A
 * check that only the engine performs would let any signed-in member borrow
 * that authority, which is exactly the escalation this guard closes.
 *
 * The outcome returned here is the engine's own answer, so the client can never
 * show a success the backend did not acknowledge.
 *
 * None of these reaches the execution gateway. The desk records what the founder
 * decided and what the quoted price path did; it has no order path.
 */

const DESK_PATH = "/app/opportunity";

function outcome(
  ok: boolean,
  title: string,
  message: string,
  detail: string[] = [],
): ActionOutcome {
  return { ok, title, message, detail, at: new Date().toISOString() };
}

function failure(title: string, message: string, detail: string[] = []): ActionOutcome {
  return outcome(false, title, message, detail);
}

/**
 * The engine's refusal, translated. The desk is admin-only, so the most common
 * failure is a token that does not hold the role, and naming that is more useful
 * than echoing a status code.
 */
function explain(error: ApiError, action: string): string {
  if (error.code === "unauthorized") {
    return `The engine refused this ${action}. The configured engine token does not hold the admin role the Opportunity Desk requires.`;
  }
  if (error.code === "not_configured") {
    return "The trading engine is not connected. Set WANDS_ENGINE_URL and WANDS_ENGINE_TOKEN on the server to enable the desk.";
  }
  return error.message;
}

/**
 * The gate every action runs before it touches the engine. Returning an outcome
 * rather than throwing keeps the existing error-handling shape for authorised
 * users, and gives an unauthorised caller a plain refusal that names no engine
 * detail and confirms nothing about the desk's contents.
 */
async function denyUnlessFounder(): Promise<ActionOutcome | null> {
  const access = await requireFounder();
  if (access.ok) return null;

  return failure(
    "Not authorised",
    "The Opportunity Desk is limited to the founder account. Nothing was sent to the engine.",
  );
}

export async function runScanAction(): Promise<ActionOutcome> {
  return advanceScannerAction();
}

export async function recordDecisionAction(
  candidateId: string,
  decision: OpportunityDecisionKind,
  note: string,
): Promise<ActionOutcome> {
  const denied = await denyUnlessFounder();
  if (denied) return denied;

  const result = await recordOpportunityDecision(candidateId, decision, note);

  if (!result.ok) {
    return failure("The decision was not recorded", explain(result.error, "decision"), [
      `error code: ${result.error.code}`,
    ]);
  }

  revalidatePath(DESK_PATH);

  const data = result.envelope.data;
  return outcome(
    true,
    decision === "candidate_watched" ? "Candidate watched" : "Candidate rejected",
    "The engine stored the decision. It is a research note, not an order.",
    [
      `decided at: ${new Date(data.decidedAt).toLocaleString("en-US")}`,
      ...(data.note ? [`note: ${data.note}`] : []),
    ],
  );
}

export async function recordTestAction(
  candidateId: string,
  quantity?: string,
): Promise<ActionOutcome> {
  const denied = await denyUnlessFounder();
  if (denied) return denied;

  const result = await recordOpportunityTest(candidateId, quantity);

  if (!result.ok) {
    return failure("The paper test was not recorded", explain(result.error, "paper test"), [
      `error code: ${result.error.code}`,
    ]);
  }

  revalidatePath(DESK_PATH);

  const data = result.envelope.data;
  return outcome(
    true,
    `Paper test recorded for ${data.symbol}`,
    "The assumptions are frozen at the moment they were written down. Nothing was sent to a broker.",
    [
      `quantity: ${data.quantity}`,
      `deadline: ${new Date(data.deadline).toLocaleString("en-US")}`,
      `status: ${data.status}`,
    ],
  );
}

export async function evaluateTestAction(testId: string): Promise<ActionOutcome> {
  const denied = await denyUnlessFounder();
  if (denied) return denied;

  const result = await evaluateOpportunityTest(testId);

  if (!result.ok) {
    return failure("The test could not be evaluated", explain(result.error, "evaluation"), [
      `error code: ${result.error.code}`,
    ]);
  }

  revalidatePath(DESK_PATH);

  const data = result.envelope.data;
  return outcome(
    true,
    `Test ${data.status.replace(/_/g, " ")}`,
    data.exitReason,
    [
      ...(data.entryPrice ? [`entry: ${data.entryPrice}`] : []),
      ...(data.exitPrice ? [`exit: ${data.exitPrice}`] : []),
      ...(data.netReturn ? [`net: ${data.netReturn}`] : []),
      ...data.notes,
    ],
  );
}
