"""Symbol normalisation.

Every symbol that enters the system is normalised once, at the boundary, into a
single canonical form:

* crypto — ``BASE/QUOTE``, e.g. ``BTC/USD``
* stocks — the venue ticker, e.g. ``AAPL``, ``BRK.B``

Provider-specific spellings (Kraken's ``XBTUSD``, a user typing ``btc-usd``) are
translated at the adapter, never stored. Storing two spellings of the same
instrument is how a portfolio ends up with two half-sized positions.
"""

from __future__ import annotations

from wands.schemas import MarketType

# Longest first so ``USDT`` is matched before ``USD``.
CRYPTO_QUOTE_ASSETS: tuple[str, ...] = (
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
)

# Venue aliases for the base asset.
BASE_ALIASES: dict[str, str] = {
    "XBT": "BTC",
    "XDG": "DOGE",
}

# Kraken spells some assets differently in its REST pairs.
KRAKEN_BASE: dict[str, str] = {
    "BTC": "XBT",
    "DOGE": "XDG",
}


class SymbolError(ValueError):
    """The symbol cannot be normalised. Rejecting is better than guessing."""


def normalize_symbol(raw: str, market_type: MarketType | str) -> str:
    market = MarketType(market_type)
    text = (raw or "").strip().upper()
    if not text:
        raise SymbolError("A symbol is required.")

    if market is MarketType.STOCKS:
        cleaned = text.replace(" ", "")
        if not cleaned.replace(".", "").replace("-", "").isalnum():
            raise SymbolError(f"{raw!r} is not a valid equity ticker.")
        return cleaned

    unified = text.replace("-", "/").replace("_", "/")
    if "/" in unified:
        base, _, quote = unified.partition("/")
        base = BASE_ALIASES.get(base, base)
        if not base or not quote:
            raise SymbolError(f"{raw!r} is not a valid crypto pair.")
        return f"{base}/{quote}"

    for quote in CRYPTO_QUOTE_ASSETS:
        if unified.endswith(quote) and len(unified) > len(quote):
            base = unified[: -len(quote)]
            return f"{BASE_ALIASES.get(base, base)}/{quote}"

    raise SymbolError(
        f"{raw!r} has no recognisable quote asset. Use a pair such as BTC/USD."
    )


def provider_symbol(canonical: str, provider: str) -> str:
    """Translate a canonical symbol into the venue's spelling."""
    if provider == "kraken":
        base, _, quote = canonical.partition("/")
        if not quote:
            raise SymbolError(f"{canonical!r} is not a crypto pair.")
        return f"{KRAKEN_BASE.get(base, base)}{quote}"
    if provider == "alpaca":
        return canonical
    return canonical.replace("/", "")


def base_asset(canonical: str, market_type: MarketType | str) -> str:
    if MarketType(market_type) is MarketType.CRYPTO:
        return canonical.partition("/")[0]
    return canonical


def quote_currency(canonical: str, market_type: MarketType | str) -> str:
    """The currency a position in this instrument is denominated in."""
    if MarketType(market_type) is MarketType.CRYPTO:
        _, _, quote = canonical.partition("/")
        return quote or "USD"
    return "USD"


def infer_market_type(raw: str) -> MarketType:
    text = (raw or "").strip()
    if "/" in text or "-" in text or "_" in text:
        return MarketType.CRYPTO
    upper = text.upper()
    if any(upper.endswith(quote) for quote in CRYPTO_QUOTE_ASSETS) and len(upper) > 6:
        return MarketType.CRYPTO
    return MarketType.STOCKS
