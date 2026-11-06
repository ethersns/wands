"use server";

import { revalidatePath } from "next/cache";

import { setJobPaused, startBackfill } from "@/lib/api/endpoints";
import type { IntelBackfillRequest } from "@/lib/api/contracts";
import type { ActionOutcome } from "@/lib/intelligence/action-outcome";

/**
 * Administrative research actions.
 *
 * Every one of these is authorised by the engine, not by this UI: the request
 * carries the server-side engine token and the engine enforces the admin role.
 * The outcome returned here is the engine's own answer, so the client can never
 * show a success the backend did not acknowledge.
 */

function failure(title: string, message: string, detail: string[] = []): ActionOutcome {
  return { ok: false, title, message, detail, at: new Date().toISOString() };
}

export async function setJobPausedAction(
  name: string,
  paused: boolean,
): Promise<ActionOutcome> {
  const verb = paused ? "pause" : "resume";
  const result = await setJobPaused(name, paused);

  if (!result.ok) {
    return failure(
      `Could not ${verb} ${name}`,
      result.error.code === "unauthorized"
        ? "The engine refused this action. The configured engine token does not hold the admin role required to change collection jobs."
        : result.error.message,
      [`error code: ${result.error.code}`],
    );
  }

  revalidatePath("/intelligence/operations");

  return {
    ok: true,
    title: `${name} ${paused ? "paused" : "resumed"}`,
    message: `The engine acknowledged the change and reports the job as ${result.envelope.data.status}.`,
    detail: [
      `paused: ${result.envelope.data.paused ? "yes" : "no"}`,
      `status: ${result.envelope.data.status}`,
    ],
    at: new Date().toISOString(),
  };
}

export async function startBackfillAction(
  request: IntelBackfillRequest,
): Promise<ActionOutcome> {
  const result = await startBackfill(request);

  if (!result.ok) {
    return failure(
      "Backfill did not run",
      result.error.code === "unauthorized"
        ? "The engine refused this action. A bounded backfill requires the admin role on the engine token."
        : result.error.message,
      [`error code: ${result.error.code}`],
    );
  }

  revalidatePath("/intelligence/operations");
  revalidatePath("/intelligence/coverage");

  const data = result.envelope.data;
  const errors = data.errors.map((error) => `${error.kind}: ${error.message}`);

  return {
    ok: data.status === "ok" || data.status === "partial",
    title: `Backfill ${data.status}`,
    message:
      data.status === "failed"
        ? "The engine ran the backfill and ingested no filing."
        : `The engine ingested ${data.filingsNew} new filing${data.filingsNew === 1 ? "" : "s"} across ${data.streams} stream${data.streams === 1 ? "" : "s"}.`,
    detail: [
      `seen: ${data.filingsSeen}`,
      `new: ${data.filingsNew}`,
      `skipped: ${data.filingsSkipped}`,
      `unavailable: ${data.filingsUnavailable}`,
      `malformed: ${data.filingsMalformed}`,
      `stopped early: ${data.stoppedEarly ? "yes" : "no"}`,
      ...errors,
    ],
    at: new Date().toISOString(),
  };
}
