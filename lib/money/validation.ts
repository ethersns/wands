/**
 * Validation for the numbers a founder types into the Money journal.
 *
 * Every value here arrives from a form, so every value is treated as hostile
 * text until it parses. The rules are deliberately strict about the things that
 * would corrupt a P&L — a zero price, a negative quantity, a fee that is not a
 * number — and lenient about nothing else.
 *
 * The output is a normalised decimal string at ten decimal places, which is
 * what the `numeric(28, 10)` columns expect. Parsing to a float anywhere on
 * this path would round a price before it was stored.
 */

import { formatDecimal, parseDecimal } from "./calc";

export type MarketType = "crypto" | "equity";

const SYMBOL = /^[A-Z0-9]{1,10}(\/[A-Z0-9]{1,10})?$/;

/** A price above this is not a price; it is a typo or an attack. */
const MAX_PRICE = 1_000_000_000n * 10n ** 10n;
/** A quantity above this is not a position; it is a typo or an attack. */
const MAX_QUANTITY = 1_000_000_000_000n * 10n ** 10n;
const MAX_FEE = 1_000_000_000n * 10n ** 10n;
const MAX_NOTE = 500;

export interface ParsedPlan {
  referencePrice: string | null;
  targetPrice: string | null;
  stopPrice: string | null;
  reason: string | null;
  strategyKey: string | null;
  strategyVersion: number | null;
}

export interface ParsedEntry {
  symbol: string;
  marketType: MarketType;
  entryPrice: string;
  quantity: string;
  fee: string;
  note: string | null;
  candidateId: string | null;
  plan: ParsedPlan | null;
}

export interface ParsedExit {
  exitPrice: string;
  fee: string;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

function decimal(
  raw: unknown,
  label: string,
  options: { min: bigint; max: bigint; allowZero: boolean },
  errors: string[],
): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") {
    errors.push(`${label} is required.`);
    return null;
  }

  const text = String(raw).trim();
  if (!text) {
    errors.push(`${label} is required.`);
    return null;
  }

  const parsed = parseDecimal(text);
  if (parsed === null) {
    errors.push(`${label} must be a number with at most 10 decimal places.`);
    return null;
  }

  if (parsed < 0n) {
    errors.push(`${label} cannot be negative.`);
    return null;
  }

  if (!options.allowZero && parsed === 0n) {
    errors.push(`${label} must be greater than zero.`);
    return null;
  }

  if (parsed < options.min || parsed > options.max) {
    errors.push(`${label} is outside the range this journal accepts.`);
    return null;
  }

  return formatDecimal(parsed, 10);
}

function optionalDecimal(
  raw: unknown,
  label: string,
  max: bigint,
  errors: string[],
): string | null {
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  return decimal(raw, label, { min: 0n, max, allowZero: true }, errors);
}

function text(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

/**
 * A symbol is normalised, not guessed. `btc/usd` becomes `BTC/USD`, and a
 * crypto pair without a quote asset is refused rather than assumed to be USD.
 */
export function parseSymbol(raw: unknown): { ok: true; symbol: string; marketType: MarketType } | { ok: false; error: string } {
  if (typeof raw !== "string") {
    return { ok: false, error: "A symbol is required." };
  }

  // Only the ends are trimmed. Stripping internal whitespace would turn
  // "BTC US D" into "BTCUSD" and silently reinterpret a typo as a different
  // instrument, which is worse than refusing it.
  const symbol = raw.trim().toUpperCase();
  if (!symbol) {
    return { ok: false, error: "A symbol is required." };
  }

  if (!SYMBOL.test(symbol)) {
    return {
      ok: false,
      error: "Use a ticker such as NVDA, or a pair such as BTC/USD.",
    };
  }

  return {
    ok: true,
    symbol,
    marketType: symbol.includes("/") ? "crypto" : "equity",
  };
}

export function parseEntryInput(raw: {
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
}): ParseResult<ParsedEntry> {
  const errors: string[] = [];

  const symbolResult = parseSymbol(raw.symbol);
  if (!symbolResult.ok) errors.push(symbolResult.error);

  const entryPrice = decimal(
    raw.entryPrice,
    "Entry price",
    { min: 0n, max: MAX_PRICE, allowZero: false },
    errors,
  );
  const quantity = decimal(
    raw.quantity,
    "Quantity",
    { min: 0n, max: MAX_QUANTITY, allowZero: false },
    errors,
  );
  const fee = optionalDecimal(raw.fee, "Fee", MAX_FEE, errors) ?? formatDecimal(0n, 10);

  const note = text(raw.note, MAX_NOTE);
  const candidateId = text(raw.candidateId, 200);

  let plan: ParsedPlan | null = null;
  if (raw.plan) {
    const referencePrice = optionalDecimal(raw.plan.referencePrice, "Plan reference price", MAX_PRICE, errors);
    const targetPrice = optionalDecimal(raw.plan.targetPrice, "Plan target", MAX_PRICE, errors);
    const stopPrice = optionalDecimal(raw.plan.stopPrice, "Plan stop", MAX_PRICE, errors);

    const version = Number(raw.plan.strategyVersion);

    plan = {
      referencePrice,
      targetPrice,
      stopPrice,
      reason: text(raw.plan.reason, MAX_NOTE),
      strategyKey: text(raw.plan.strategyKey, 100),
      strategyVersion: Number.isInteger(version) && version > 0 ? version : null,
    };
  }

  if (errors.length > 0 || !symbolResult.ok || !entryPrice || !quantity) {
    return { ok: false, errors: errors.length > 0 ? errors : ["The entry could not be read."] };
  }

  return {
    ok: true,
    value: {
      symbol: symbolResult.symbol,
      marketType: symbolResult.marketType,
      entryPrice,
      quantity,
      fee,
      note,
      candidateId,
      plan,
    },
  };
}

export function parseExitInput(raw: {
  exitPrice?: unknown;
  fee?: unknown;
}): ParseResult<ParsedExit> {
  const errors: string[] = [];

  const exitPrice = decimal(
    raw.exitPrice,
    "Exit price",
    { min: 0n, max: MAX_PRICE, allowZero: false },
    errors,
  );
  const fee = optionalDecimal(raw.fee, "Fee", MAX_FEE, errors) ?? formatDecimal(0n, 10);

  if (errors.length > 0 || !exitPrice) {
    return { ok: false, errors: errors.length > 0 ? errors : ["The exit could not be read."] };
  }

  return { ok: true, value: { exitPrice, fee } };
}
