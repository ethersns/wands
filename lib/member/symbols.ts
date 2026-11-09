/**
 * Canonical symbol normalisation for member surfaces.
 *
 * `normalizeSymbol` mirrors `backend/wands/marketdata/symbols.py` rule for rule.
 * Member watchlists live in Postgres and are written by the Next.js app, so they
 * never round-trip through the Python engine and the boundary rule has to exist
 * on both sides. `tests/member/symbols.test.ts` pins the cases the two share; if
 * the engine's rule changes, this file changes with it.
 *
 * The canonical forms are the engine's:
 *   crypto — `BASE/QUOTE`, e.g. `BTC/USD`
 *   stocks — the venue ticker, e.g. `AAPL`, `BRK.B`
 *
 * Storing two spellings of one instrument is how a watchlist ends up with two
 * half-sized entries, so nothing here guesses: an input either normalises to a
 * canonical symbol or it is rejected.
 */

export const MARKET_TYPES = ["stocks", "crypto"] as const;

export type MemberMarketType = (typeof MARKET_TYPES)[number];

export const MARKET_LABELS: Record<MemberMarketType, string> = {
  stocks: "Stocks",
  crypto: "Crypto",
};

/**
 * The ticker shape the member surface has always enforced. The engine strips
 * spaces from provider input; a member typing a symbol is held to the stricter
 * rule, so `not a ticker` stays rejected rather than becoming `NOTATICKER`.
 */
export const STOCK_SYMBOL_PATTERN = /^[A-Z][A-Z0-9.-]{0,9}$/;

/** Longest first so `USDT` is matched before `USD`. */
export const CRYPTO_QUOTE_ASSETS = [
  "USDT",
  "USDC",
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "AUD",
  "CHF",
  "BTC",
  "ETH",
] as const;

const BASE_ALIASES: Record<string, string> = {
  XBT: "BTC",
  XDG: "DOGE",
};

export class SymbolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SymbolError";
  }
}

export function isMarketType(value: unknown): value is MemberMarketType {
  return value === "stocks" || value === "crypto";
}

/**
 * Rows written before crypto support carry `equity`, which is not a
 * `MarketType`. Reading it as `stocks` keeps those rows valid without
 * rewriting stored history.
 */
export function toMarketType(value: unknown): MemberMarketType {
  if (value === "equity") return "stocks";
  if (isMarketType(value)) return value;
  throw new SymbolError(`Unknown market type: ${String(value)}`);
}

/** The engine's normaliser, reproduced. Throws `SymbolError` on bad input. */
export function normalizeSymbol(raw: string, marketType: MemberMarketType): string {
  const market = toMarketType(marketType);
  const text = (raw ?? "").trim().toUpperCase();
  if (!text) throw new SymbolError("A symbol is required.");

  if (market === "stocks") {
    const cleaned = text.replace(/ /g, "");
    if (/[^A-Z0-9]/.test(cleaned.replace(/[.-]/g, ""))) {
      throw new SymbolError(`"${raw}" is not a valid equity ticker.`);
    }
    return cleaned;
  }

  const unified = text.replace(/-/g, "/").replace(/_/g, "/");
  if (unified.includes("/")) {
    const [baseRaw, quote] = unified.split("/");
    const base = BASE_ALIASES[baseRaw] ?? baseRaw;
    if (!base || !quote) throw new SymbolError(`"${raw}" is not a valid crypto pair.`);
    return `${base}/${quote}`;
  }

  for (const quote of CRYPTO_QUOTE_ASSETS) {
    if (unified.endsWith(quote) && unified.length > quote.length) {
      const base = unified.slice(0, -quote.length);
      return `${BASE_ALIASES[base] ?? base}/${quote}`;
    }
  }

  throw new SymbolError(`"${raw}" has no recognisable quote asset. Use a pair such as BTC/USD.`);
}

export type SymbolCheck = { ok: true; symbol: string } | { ok: false; message: string };

/**
 * The member-surface rule, in one place so the form and the API cannot drift.
 *
 * Stocks keep the ticker pattern the app has always enforced; crypto goes
 * through the engine's canonical normaliser. A bare base asset is refused in
 * the crypto market rather than guessed at, which is what keeps `BTC` and
 * `BTC/USD` from being confused for one another.
 */
export function checkMemberSymbol(raw: string, marketType: MemberMarketType): SymbolCheck {
  const market = toMarketType(marketType);
  const text = (raw ?? "").trim().toUpperCase();

  if (market === "stocks") {
    return STOCK_SYMBOL_PATTERN.test(text)
      ? { ok: true, symbol: text }
      : { ok: false, message: "Enter a ticker like NVDA or BRK.B." };
  }

  try {
    return { ok: true, symbol: normalizeSymbol(text, "crypto") };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof SymbolError ? error.message : "Enter a pair like BTC/USD.",
    };
  }
}

export function isCanonicalSymbol(symbol: string, marketType: MemberMarketType): boolean {
  const check = checkMemberSymbol(symbol, marketType);
  return check.ok && check.symbol === symbol;
}

/**
 * Resolve a symbol from a URL segment.
 *
 * The market is read from the symbol's own shape — a pair carries a slash, a
 * ticker does not — rather than from the engine's `infer_market_type`, which
 * classifies `BRK-B` as crypto because of the hyphen. A URL is not a place to
 * guess.
 */
export function parseAssetSymbol(raw: string): { symbol: string; marketType: MemberMarketType } | null {
  let text: string;
  try {
    text = decodeURIComponent(raw ?? "").trim();
  } catch {
    return null;
  }
  if (!text) return null;

  const marketType: MemberMarketType = text.includes("/") ? "crypto" : "stocks";
  const check = checkMemberSymbol(text, marketType);
  return check.ok ? { symbol: check.symbol, marketType } : null;
}
