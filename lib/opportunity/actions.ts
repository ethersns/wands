"use server";

import { revalidatePath } from "next/cache";

import type { ApiError } from "@/lib/api/contracts";
import {
  evaluateOpportunityTest,
  getOpportunityScan,
  recordOpportunityDecision,
  recordOpportunityTest,
  type OpportunityDecisionKind,
} from "@/lib/api/opportunity";
import type { ActionOutcome } from "@/lib/intelligence/action-outcome";

/**
 * Manual research actions for the Opportunity Desk.
 *
 * Every one of these is authorised by the engine, not by this UI: the request
 * carries the server-side engine token and the engine enforces the admin role.
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

export async function runScanAction(): Promise<ActionOutcome> {
  const result = await getOpportunityScan();

  if (!result.ok) {
    return failure("The scan did not run", explain(result.error, "scan"), [
      `error code: ${result.error.code}`,
    ]);
  }

  revalidatePath(DESK_PATH);

  const data = result.envelope.data;
  const skipped = data.skipped.map((item) => `${item.symbol}: ${item.reason}`);

  if (data.candidates.length === 0) {
    return outcome(
      true,
      "No qualifying opportunities",
      "The rule did not find a setup that met its conditions. A quiet scan is a normal result, not a failure.",
      skipped,
    );
  }

  return outcome(
    true,
    `${data.candidates.length} candidate${data.candidates.length === 1 ? "" : "s"} recorded`,
    `The engine stored what qualified on ${data.interval} candles. A candidate is a hypothesis to look at, not a trade.`,
    skipped,
  );
}

export async function recordDecisionAction(
  candidateId: string,
  decision: OpportunityDecisionKind,
  note: string,
): Promise<ActionOutcome> {
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
