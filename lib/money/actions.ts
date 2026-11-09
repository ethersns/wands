"use server";

import { revalidatePath } from "next/cache";

import { advanceScannerAction } from "@/lib/opportunity/scan-actions";
import { requireFounder } from "@/lib/auth/founder";
import type { ActionOutcome } from "@/lib/intelligence/action-outcome";
import { closeTrade, openTrade } from "./journal";
import { parseEntryInput, parseExitInput } from "./validation";

/**
 * The write half of the Money journal.
 *
 * Every action authorises the caller itself. A server action is reachable by
 * anyone who can post to it, so the founder grant is re-checked here rather
 * than trusted from the page that rendered the form. The user id used for the
 * row comes from that verified session, never from the request body: a client
 * that could name its own `user_id` could write into another member's journal.
 *
 * Nothing here places an order, and nothing here invents a price. An entry is
 * recorded only from numbers the founder typed, and a scan only reports what
 * the engine itself returned.
 */

const MONEY_PATH = "/app/money";

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

async function denyUnlessFounder(): Promise<ActionOutcome | null> {
  const access = await requireFounder();
  if (access.ok) return null;

  return failure(
    "Not authorised",
    "The Money journal is limited to the founder account. Nothing was recorded.",
  );
}

export async function runMoneyScanAction(): Promise<ActionOutcome> {
  return advanceScannerAction();
}

export async function recordEntryAction(raw: {
  symbol?: unknown;
  entryPrice?: unknown;
  quantity?: unknown;
  fee?: unknown;
  note?: unknown;
  candidateId?: unknown;
  plan?: {
    referencePrice?: unknown;
    targetPrice?: unknown;
    stopPrice?: unknown;
    reason?: unknown;
    strategyKey?: unknown;
    strategyVersion?: unknown;
  } | null;
}): Promise<ActionOutcome> {
  const access = await requireFounder();
  if (!access.ok) {
    return failure(
      "Not authorised",
      "The Money journal is limited to the founder account. Nothing was recorded.",
    );
  }

  const parsed = parseEntryInput(raw);
  if (!parsed.ok) {
    return failure("The entry was not recorded", "Some values could not be read.", parsed.errors);
  }

  const result = await openTrade(access.userId, parsed.value);

  if (!result.ok) {
    return failure(
      result.reason === "duplicate" ? "Already recorded" : "The entry was not recorded",
      result.message,
    );
  }

  revalidatePath(MONEY_PATH);

  return outcome(
    true,
    `Entry recorded for ${result.trade.symbol}`,
    "This is your reported fill, not an exchange confirmation. Nothing was sent to a broker.",
    [
      `entry: ${result.trade.entryPrice}`,
      `quantity: ${result.trade.entryQuantity}`,
      `fee: ${result.trade.entryFee}`,
    ],
  );
}

export async function recordExitAction(
  tradeId: string,
  raw: { exitPrice?: unknown; fee?: unknown },
): Promise<ActionOutcome> {
  const access = await requireFounder();
  if (!access.ok) {
    return failure(
      "Not authorised",
      "The Money journal is limited to the founder account. Nothing was recorded.",
    );
  }

  if (typeof tradeId !== "string" || !tradeId.trim()) {
    return failure("The exit was not recorded", "No position was identified.");
  }

  const parsed = parseExitInput(raw);
  if (!parsed.ok) {
    return failure("The exit was not recorded", "Some values could not be read.", parsed.errors);
  }

  const result = await closeTrade(access.userId, tradeId, parsed.value);

  if (!result.ok) {
    return failure("The exit was not recorded", result.message);
  }

  revalidatePath(MONEY_PATH);

  return outcome(
    true,
    `Exit recorded for ${result.trade.symbol}`,
    "The position is closed. The final P&L is computed from the two prices you reported.",
    [`exit: ${result.trade.exitPrice}`, `fee: ${result.trade.exitFee}`],
  );
}

/**
 * Re-reads the page so open positions pick up a fresh quote. It deliberately
 * does not write anything: a refresh that could change a stored price would
 * make the journal disagree with the founder's exchange.
 */
export async function refreshMoneyAction(): Promise<ActionOutcome> {
  const denied = await denyUnlessFounder();
  if (denied) return denied;

  revalidatePath(MONEY_PATH);

  return outcome(
    true,
    "Prices refreshed",
    "Open positions were re-priced from the engine's latest verified quote.",
  );
}
