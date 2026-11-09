/**
 * Fixed-point arithmetic for reported trade P&L.
 *
 * Money is not a float. `0.1 + 0.2` is not `0.3` in binary floating point, and a
 * P&L that is off by a fraction of a cent is a P&L the founder cannot reconcile
 * against their exchange. Every value here is a `bigint` scaled by 10^10, which
 * covers a crypto quantity to eight decimals and a price to ten, and every
 * operation rounds once, explicitly, at the end.
 *
 * Nothing in this module reads a price. It only does arithmetic on numbers the
 * founder typed or the engine reported, so it cannot invent one.
 */

/** Ten decimal places. Prices and quantities are both stored at this scale. */
export const SCALE = 10n ** 10n;

const DECIMAL = /^-?\d+(\.\d+)?$/;

/**
 * Parses a decimal string into a scaled integer.
 *
 * Returns `null` rather than throwing or coercing, because a caller that cannot
 * tell "0" from "not a number" would record a zero price as a real one. More
 * than ten decimal places is refused rather than truncated: silently dropping
 * digits from a price is the same class of bug as rounding it.
 */
export function parseDecimal(raw: string): bigint | null {
  const text = raw.trim();
  if (!text || !DECIMAL.test(text)) return null;

  const negative = text.startsWith("-");
  const unsigned = negative ? text.slice(1) : text;
  const [whole, fraction = ""] = unsigned.split(".");

  if (fraction.length > 10) return null;

  const padded = fraction.padEnd(10, "0");
  const value = BigInt(whole) * SCALE + BigInt(padded || "0");

  return negative ? -value : value;
}

/**
 * Renders a scaled integer with exactly `digits` decimal places.
 *
 * The value is rounded, not truncated. Truncating a loss would understate it
 * and truncating a gain would understate that too, so the displayed figure
 * would disagree with the founder's exchange in whichever direction happened to
 * favour the story. Rounding is the only rendering that is neutral.
 */
export function formatDecimal(value: bigint, digits = 2): string {
  const rounded = roundTo(value, digits);
  const negative = rounded < 0n;
  const magnitude = negative ? -rounded : rounded;

  const whole = magnitude / SCALE;
  const fraction = magnitude % SCALE;

  const padded = fraction.toString().padStart(10, "0").slice(0, digits);
  const sign = negative ? "-" : "";

  return digits > 0 ? `${sign}${whole}.${padded}` : `${sign}${whole}`;
}

/**
 * Rounds a scaled value to `digits` decimal places, half away from zero, and
 * returns it at the same scale it was given. Returning the bare quotient would
 * silently change the unit of the value, which is how a rounding helper becomes
 * a source of wrong money.
 */
export function roundTo(value: bigint, digits: number): bigint {
  if (digits >= 10) return value;

  const factor = 10n ** BigInt(10 - digits);
  const negative = value < 0n;
  const magnitude = negative ? -value : value;

  const quotient = magnitude / factor;
  const remainder = magnitude % factor;
  const rounded = remainder * 2n >= factor ? quotient + 1n : quotient;

  return (negative ? -rounded : rounded) * factor;
}

function multiply(a: bigint, b: bigint): bigint {
  const product = a * b;
  const negative = product < 0n;
  const magnitude = negative ? -product : product;

  const quotient = magnitude / SCALE;
  const remainder = magnitude % SCALE;
  const rounded = remainder * 2n >= SCALE ? quotient + 1n : quotient;

  return negative ? -rounded : rounded;
}

export interface OpenPnl {
  /** entry price × quantity */
  costBasis: bigint;
  /** (current − entry) × quantity, before any fee */
  unrealizedGross: bigint;
  /**
   * Gross less the entry fee. The exit fee is deliberately excluded: it has not
   * been paid yet, and including an estimate would present a guess as a result.
   */
  unrealizedNet: bigint;
  /** Net over cost basis, as a fraction. `null` when the basis is zero. */
  returnFraction: number | null;
}

export function computeOpenPnl(input: {
  entryPrice: bigint;
  quantity: bigint;
  entryFee: bigint;
  currentPrice: bigint;
}): OpenPnl {
  const costBasis = multiply(input.entryPrice, input.quantity);
  const unrealizedGross = multiply(input.currentPrice - input.entryPrice, input.quantity);
  const unrealizedNet = unrealizedGross - input.entryFee;

  return {
    costBasis,
    unrealizedGross,
    unrealizedNet,
    returnFraction: fractionOf(unrealizedNet, costBasis),
  };
}

export interface ClosedPnl {
  costBasis: bigint;
  proceeds: bigint;
  grossPnl: bigint;
  netPnl: bigint;
  returnFraction: number | null;
}

export function computeClosedPnl(input: {
  entryPrice: bigint;
  quantity: bigint;
  entryFee: bigint;
  exitPrice: bigint;
  exitFee: bigint;
}): ClosedPnl {
  const costBasis = multiply(input.entryPrice, input.quantity);
  const proceeds = multiply(input.exitPrice, input.quantity);
  const grossPnl = proceeds - costBasis;
  const netPnl = grossPnl - input.entryFee - input.exitFee;

  return {
    costBasis,
    proceeds,
    grossPnl,
    netPnl,
    returnFraction: fractionOf(netPnl, costBasis),
  };
}

/**
 * A ratio for display only. It is computed in floating point because it is
 * never stored and never summed; the money itself stays in `bigint`.
 */
function fractionOf(part: bigint, whole: bigint): number | null {
  if (whole === 0n) return null;
  return Number(part) / Number(whole);
}

/** Formats a fraction as a signed percentage, e.g. `+2.41%`. */
export function formatPercent(fraction: number | null, digits = 2): string {
  if (fraction === null || !Number.isFinite(fraction)) return "—";
  const percent = fraction * 100;
  const sign = percent > 0 ? "+" : "";
  return `${sign}${percent.toFixed(digits)}%`;
}

/**
 * Risk-to-reward from the plan, not from the fill.
 *
 * `(target − reference) / (reference − stop)`. Returns `null` when the stop is
 * not below the reference, because a ratio computed from a nonsensical plan
 * would look like a real number.
 */
export function riskReward(input: {
  reference: bigint;
  target: bigint;
  stop: bigint;
}): number | null {
  const reward = input.target - input.reference;
  const risk = input.reference - input.stop;

  if (risk <= 0n) return null;
  return Number(reward) / Number(risk);
}
