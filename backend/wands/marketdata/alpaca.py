"""Alpaca market data for US equities.

Entitlement is the account's, not ours. The free plan serves the IEX feed in
real time and the consolidated SIP feed with a delay, so the provider is told
which feed it is using and labels the data accordingly. A delayed quote is never
reported as live, and the risk engine will not price an order against it.

Without credentials the provider reports ``ProviderNotConfigured``. It does not
fall back to a synthetic price.
"""

from __future__ import annotations

import time
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from wands.marketdata.base import (
    DataQuality,
    ProviderCandle,
    ProviderDataError,
    ProviderNotConfigured,
    ProviderQuote,
    ProviderRateLimited,
    ProviderUnavailable,
)
from wands.marketdata.calendar import session_for
from wands.marketdata.rate_limit import RetryPolicy, TokenBucket, call_with_retry
from wands.marketdata.symbols import normalize_symbol
from wands.schemas import CandleInterval, MarketType

ALPACA_TIMEFRAMES: dict[CandleInterval, str] = {
    CandleInterval.M1: "1Min",
    CandleInterval.M5: "5Min",
    CandleInterval.M15: "15Min",
    CandleInterval.H1: "1Hour",
    CandleInterval.H4: "4Hour",
    CandleInterval.D1: "1Day",
}


def _decimal(value: Any) -> Decimal | None:
    if value is None or value == "":
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None


def _timestamp(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


class AlpacaDataProvider:
    name = "alpaca"
    market_type = MarketType.STOCKS
    supports_delayed = True

    def __init__(
        self,
        *,
        key: str | None,
        secret: str | None,
        base_url: str = "https://data.alpaca.markets",
        feed: str = "iex",
        delayed: bool = False,
        client: Any | None = None,
        timeout: float = 10.0,
        retry_policy: RetryPolicy | None = None,
        bucket: TokenBucket | None = None,
        sleep=time.sleep,
        clock=lambda: datetime.now(tz=UTC),
    ) -> None:
        self.key = key
        self.secret = secret
        self.base_url = base_url.rstrip("/")
        self.feed = feed
        self.delayed = delayed
        self.timeout = timeout
        self._client = client
        self._retry = retry_policy or RetryPolicy()
        self._bucket = bucket if bucket is not None else TokenBucket(3.0, 5)
        self._sleep = sleep
        self._clock = clock

    # -- provider protocol -------------------------------------------------

    def is_configured(self) -> bool:
        return bool(self.key and self.secret)

    @property
    def quality(self) -> DataQuality:
        return DataQuality.DELAYED if self.delayed else DataQuality.LIVE

    def fetch_quote(self, symbol: str) -> ProviderQuote:
        if not self.is_configured():
            raise ProviderNotConfigured(
                "Alpaca market data requires WANDS_ALPACA_DATA_KEY and "
                "WANDS_ALPACA_DATA_SECRET."
            )
        canonical = normalize_symbol(symbol, MarketType.STOCKS)
        payload = self._get(f"/v2/stocks/{canonical}/snapshot", {"feed": self.feed})

        latest_quote = payload.get("latestQuote") or {}
        latest_trade = payload.get("latestTrade") or {}
        daily = payload.get("dailyBar") or {}
        previous = payload.get("prevDailyBar") or {}

        bid = _decimal(latest_quote.get("bp"))
        ask = _decimal(latest_quote.get("ap"))
        last = _decimal(latest_trade.get("p")) or _decimal(daily.get("c"))
        if bid is None and ask is None and last is None:
            raise ProviderDataError(f"Alpaca returned no usable price for {canonical}.")

        stamped = (
            _timestamp(latest_quote.get("t"))
            or _timestamp(latest_trade.get("t"))
            or _timestamp(daily.get("t"))
            or self._clock()
        )

        change_pct: Decimal | None = None
        previous_close = _decimal(previous.get("c"))
        if last is not None and previous_close is not None and previous_close > 0:
            change_pct = (last - previous_close) / previous_close * Decimal("100")

        session = session_for(MarketType.STOCKS, self._clock())

        return ProviderQuote(
            symbol=canonical,
            market_type=MarketType.STOCKS,
            provider=self.name,
            bid=bid,
            ask=ask,
            last=last,
            provider_timestamp=stamped,
            quality=self.quality,
            session=session.state,
            name=canonical,
            volume_24h=_decimal(daily.get("v")),
            high_24h=_decimal(daily.get("h")),
            low_24h=_decimal(daily.get("l")),
            change_24h_pct=change_pct,
            timestamp_source="provider",
        )

    def fetch_candles(
        self, symbol: str, interval: CandleInterval, *, limit: int = 200
    ) -> list[ProviderCandle]:
        if not self.is_configured():
            raise ProviderNotConfigured(
                "Alpaca market data requires WANDS_ALPACA_DATA_KEY and "
                "WANDS_ALPACA_DATA_SECRET."
            )
        canonical = normalize_symbol(symbol, MarketType.STOCKS)
        payload = self._get(
            f"/v2/stocks/{canonical}/bars",
            {
                "timeframe": ALPACA_TIMEFRAMES[CandleInterval(interval)],
                "limit": max(1, min(limit, 1000)),
                "feed": self.feed,
                "adjustment": "split",
            },
        )
        bars = payload.get("bars") or []
        if not isinstance(bars, list):
            raise ProviderDataError(f"Alpaca returned no bars for {canonical}.")

        candles: list[ProviderCandle] = []
        for bar in bars:
            open_time = _timestamp(bar.get("t"))
            values = [_decimal(bar.get(key)) for key in ("o", "h", "l", "c", "v")]
            if open_time is None or any(value is None for value in values):
                continue
            open_, high, low, close, volume = values
            candles.append(
                ProviderCandle(
                    symbol=canonical,
                    market_type=MarketType.STOCKS,
                    provider=self.name,
                    interval=CandleInterval(interval),
                    open_time=open_time,
                    open=open_,
                    high=high,
                    low=low,
                    close=close,
                    volume=volume,
                    provider_timestamp=open_time,
                    quality=DataQuality.HISTORICAL,
                )
            )
        return candles

    # -- internals ---------------------------------------------------------

    def _get(self, path: str, params: dict[str, Any]) -> dict[str, Any]:
        def operation() -> dict[str, Any]:
            now = time.monotonic()
            if not self._bucket.try_acquire(now):
                raise ProviderRateLimited(
                    "Alpaca market data rate limit reached.",
                    retry_after_seconds=self._bucket.retry_after(now),
                )
            try:
                response = self._http().get(
                    f"{self.base_url}{path}",
                    params=params,
                    headers={
                        "APCA-API-KEY-ID": self.key or "",
                        "APCA-API-SECRET-KEY": self.secret or "",
                    },
                    timeout=self.timeout,
                )
            except Exception as exc:  # noqa: BLE001 - transport errors are all retryable
                raise ProviderUnavailable(f"Alpaca request failed: {exc}") from exc

            status = getattr(response, "status_code", 0)
            if status == 429:
                raise ProviderRateLimited("Alpaca rate limited the request.")
            if status in (401, 403):
                raise ProviderNotConfigured(
                    "Alpaca rejected the market-data credentials or the account is not "
                    "entitled to this feed."
                )
            if status >= 500:
                raise ProviderUnavailable(f"Alpaca returned HTTP {status}.")
            if status != 200:
                raise ProviderDataError(f"Alpaca returned HTTP {status}.")

            try:
                payload = response.json()
            except Exception as exc:  # noqa: BLE001
                raise ProviderDataError("Alpaca returned a non-JSON body.") from exc
            if not isinstance(payload, dict):
                raise ProviderDataError("Alpaca returned an unexpected body.")
            return payload

        return call_with_retry(operation, policy=self._retry, sleep=self._sleep)

    def _http(self):
        if self._client is None:
            import httpx

            self._client = httpx.Client(
                headers={"user-agent": "wands-engine/0.1 (+market-data)"},
                follow_redirects=True,
            )
        return self._client
