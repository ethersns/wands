"""Market data provider contracts.

A provider is a thin, honest adapter: it returns what the venue said, stamped
with the venue's own timestamp and an explicit quality label. It never fills a
gap with a plausible number, and it never upgrades delayed data to live.

The quality label is the whole point of this module. ``live``, ``delayed``,
``historical``, ``simulated`` and ``unavailable`` are different claims, and the
risk engine is allowed to price an order against only the first.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from typing import Protocol, runtime_checkable

from wands.schemas import CandleInterval, MarketSessionState, MarketType


class DataQuality(StrEnum):
    LIVE = "live"
    DELAYED = "delayed"
    HISTORICAL = "historical"
    SIMULATED = "simulated"
    UNAVAILABLE = "unavailable"


class MarketDataError(Exception):
    """Base class for provider failures. Never swallowed without a record."""


class ProviderNotConfigured(MarketDataError):
    """Credentials or entitlement are absent. Not retryable."""


class ProviderUnavailable(MarketDataError):
    """Transport failure, timeout or 5xx. Retryable."""


class ProviderRateLimited(MarketDataError):
    """The venue asked us to slow down. Retryable after a delay."""

    def __init__(self, message: str, *, retry_after_seconds: float | None = None) -> None:
        super().__init__(message)
        self.retry_after_seconds = retry_after_seconds


class ProviderDataError(MarketDataError):
    """The venue answered, but the payload cannot be trusted. Not retryable."""


@dataclass(frozen=True)
class ProviderQuote:
    symbol: str
    market_type: MarketType
    provider: str
    bid: Decimal | None
    ask: Decimal | None
    last: Decimal | None
    provider_timestamp: datetime
    quality: DataQuality
    session: MarketSessionState
    name: str = ""
    volume_24h: Decimal | None = None
    high_24h: Decimal | None = None
    low_24h: Decimal | None = None
    change_24h_pct: Decimal | None = None
    # ``provider`` when the venue stamped the quote, ``receipt`` when the venue
    # does not publish a timestamp and we had to use the moment we received it.
    timestamp_source: str = "provider"

    @property
    def mid(self) -> Decimal | None:
        """The only price an order may be priced against.

        A one-sided or crossed quote has no mid, and a candle close is not a
        quote: it is a historical print that nobody is obliged to trade at.
        """
        if self.bid is None or self.ask is None:
            return None
        if self.bid <= 0 or self.ask <= 0 or self.ask < self.bid:
            return None
        return (self.bid + self.ask) / Decimal("2")

    @property
    def spread_pct(self) -> Decimal | None:
        mid = self.mid
        if mid is None or mid <= 0:
            return None
        return (self.ask - self.bid) / mid * Decimal("100")


@dataclass(frozen=True)
class ProviderCandle:
    symbol: str
    market_type: MarketType
    provider: str
    interval: CandleInterval
    open_time: datetime
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: Decimal
    provider_timestamp: datetime
    quality: DataQuality = DataQuality.HISTORICAL


@runtime_checkable
class MarketDataProvider(Protocol):
    name: str
    market_type: MarketType
    supports_delayed: bool

    def is_configured(self) -> bool: ...

    def fetch_quote(self, symbol: str) -> ProviderQuote: ...

    def fetch_candles(
        self, symbol: str, interval: CandleInterval, *, limit: int = 200
    ) -> list[ProviderCandle]: ...
