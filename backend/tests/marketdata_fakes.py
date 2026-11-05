"""Deterministic market-data fakes.

No test in this suite may reach a venue. These fakes return fixed payloads and
record every call, so a test can assert on both the parsed result and the number
of requests that were made.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

from wands.marketdata.base import (
    DataQuality,
    ProviderCandle,
    ProviderDataError,
    ProviderQuote,
)
from wands.schemas import CandleInterval, MarketSessionState, MarketType

FIXED_NOW = datetime(2026, 11, 5, 14, 0, 0, tzinfo=UTC)


def make_quote(
    symbol: str = "BTC/USD",
    *,
    bid: str | None = "100.00",
    ask: str | None = "100.20",
    last: str | None = "100.10",
    at: datetime | None = None,
    quality: DataQuality = DataQuality.LIVE,
    market_type: MarketType = MarketType.CRYPTO,
    session: MarketSessionState = MarketSessionState.ALWAYS,
    provider: str = "fake",
    change: str | None = None,
) -> ProviderQuote:
    return ProviderQuote(
        symbol=symbol,
        market_type=market_type,
        provider=provider,
        bid=Decimal(bid) if bid is not None else None,
        ask=Decimal(ask) if ask is not None else None,
        last=Decimal(last) if last is not None else None,
        provider_timestamp=at or FIXED_NOW,
        quality=quality,
        session=session,
        name=symbol,
        volume_24h=Decimal("250"),
        high_24h=Decimal("105"),
        low_24h=Decimal("95"),
        change_24h_pct=Decimal(change) if change is not None else None,
    )


def make_candles(
    symbol: str = "BTC/USD",
    *,
    interval: CandleInterval = CandleInterval.H1,
    count: int = 3,
    start: datetime | None = None,
    base: str = "100",
    market_type: MarketType = MarketType.CRYPTO,
    provider: str = "fake",
) -> list[ProviderCandle]:
    origin = start or (FIXED_NOW - timedelta(hours=count))
    price = Decimal(base)
    candles: list[ProviderCandle] = []
    for index in range(count):
        open_time = origin + timedelta(hours=index)
        candles.append(
            ProviderCandle(
                symbol=symbol,
                market_type=market_type,
                provider=provider,
                interval=interval,
                open_time=open_time,
                open=price,
                high=price + Decimal("1"),
                low=price - Decimal("1"),
                close=price + Decimal("0.5"),
                volume=Decimal("10"),
                provider_timestamp=open_time + timedelta(hours=1),
            )
        )
        price += Decimal("0.5")
    return candles


class FakeProvider:
    """A provider that returns exactly what it was given."""

    supports_delayed = False

    def __init__(
        self,
        *,
        name: str = "fake",
        market_type: MarketType = MarketType.CRYPTO,
        quotes: dict[str, ProviderQuote] | None = None,
        candles: dict[tuple[str, str], list[ProviderCandle]] | None = None,
        error: Exception | None = None,
        configured: bool = True,
    ) -> None:
        self.name = name
        self.market_type = market_type
        self.quotes = quotes or {}
        self.candles = candles or {}
        self.error = error
        self.configured = configured
        self.quote_calls = 0
        self.candle_calls = 0

    def is_configured(self) -> bool:
        return self.configured

    def fetch_quote(self, symbol: str) -> ProviderQuote:
        self.quote_calls += 1
        if self.error is not None:
            raise self.error
        quote = self.quotes.get(symbol)
        if quote is None:
            raise ProviderDataError(f"No fake quote for {symbol}.")
        return quote

    def fetch_candles(
        self, symbol: str, interval: CandleInterval, *, limit: int = 200
    ) -> list[ProviderCandle]:
        self.candle_calls += 1
        if self.error is not None:
            raise self.error
        return list(self.candles.get((symbol, str(interval)), []))[-limit:]


@dataclass
class FakeResponse:
    status_code: int
    payload: dict[str, Any]
    headers: dict[str, str] = field(default_factory=dict)

    def json(self) -> dict[str, Any]:
        return self.payload


class FakeHttpClient:
    """Returns queued responses in order. An ``Exception`` entry is raised."""

    def __init__(self, responses: list[Any] | Any) -> None:
        self._responses = list(responses) if isinstance(responses, list) else [responses]
        self.calls: list[tuple[str, dict[str, Any] | None]] = []

    def get(self, url: str, params: dict[str, Any] | None = None, **_: Any) -> FakeResponse:
        self.calls.append((url, params))
        if not self._responses:
            raise AssertionError("FakeHttpClient ran out of responses.")
        result = self._responses.pop(0)
        if isinstance(result, Exception):
            raise result
        return result


def kraken_ticker_payload(
    *,
    bid: str = "100.00",
    ask: str = "100.20",
    last: str = "100.10",
    errors: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "error": errors or [],
        "result": {
            "XXBTZUSD": {
                "a": [ask, "1", "1.000"],
                "b": [bid, "1", "1.000"],
                "c": [last, "0.1"],
                "v": ["10.0", "250.0"],
                "h": ["101.0", "105.0"],
                "l": ["99.0", "95.0"],
                "o": "98.0",
            }
        },
    }


def kraken_ohlc_payload(*, rows: int = 3) -> dict[str, Any]:
    start = int((FIXED_NOW - timedelta(hours=rows)).timestamp())
    series = []
    for index in range(rows):
        series.append(
            [
                start + index * 3600,
                "100",
                "101",
                "99",
                "100.5",
                "100.2",
                "12.5",
                42,
            ]
        )
    return {"error": [], "result": {"XXBTZUSD": series, "last": start}}


def alpaca_snapshot_payload(
    *,
    bid: float = 100.0,
    ask: float = 100.2,
    last: float = 100.1,
    previous_close: float = 99.0,
) -> dict[str, Any]:
    return {
        "latestQuote": {"bp": bid, "ap": ask, "t": "2026-11-05T14:00:00Z"},
        "latestTrade": {"p": last, "t": "2026-11-05T14:00:01Z"},
        "dailyBar": {
            "o": 99.0,
            "h": 101.0,
            "l": 98.0,
            "c": last,
            "v": 1000,
            "t": "2026-11-05T14:00:00Z",
        },
        "prevDailyBar": {"c": previous_close},
    }


def alpaca_bars_payload(*, count: int = 2) -> dict[str, Any]:
    bars = []
    for index in range(count):
        bars.append(
            {
                "t": f"2026-11-05T{12 + index:02d}:00:00Z",
                "o": 99.0,
                "h": 100.0,
                "l": 98.0,
                "c": 99.5,
                "v": 100,
            }
        )
    return {"bars": bars}
