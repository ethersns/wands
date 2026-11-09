"""Kraken public market data.

Uses only the public REST endpoints — no API key, no account, no order path.
That is deliberate: market data must be obtainable without a credential that
could also trade.

Two honesty rules are enforced here:

* Kraken's ticker does not publish a quote timestamp. When the ``Date`` response
  header is absent we stamp the quote with the receipt time and say so via
  ``timestamp_source = "receipt"`` rather than implying the venue stamped it.
* The last row of an OHLC response is the in-progress candle. It is dropped, so
  a half-formed bar can never be mistaken for a closed one.
"""

from __future__ import annotations

import time
from datetime import UTC, datetime, timedelta
from decimal import Decimal, InvalidOperation
from email.utils import parsedate_to_datetime
from typing import Any

from wands.marketdata.base import (
    DataQuality,
    ProviderCandle,
    ProviderDataError,
    ProviderQuote,
    ProviderRateLimited,
    ProviderUnavailable,
)
from wands.marketdata.calendar import session_for
from wands.marketdata.rate_limit import RetryPolicy, TokenBucket, call_with_retry
from wands.marketdata.symbols import normalize_symbol, provider_symbol
from wands.schemas import CandleInterval, MarketType

KRAKEN_INTERVALS: dict[CandleInterval, int] = {
    CandleInterval.M1: 1,
    CandleInterval.M5: 5,
    CandleInterval.M15: 15,
    CandleInterval.H1: 60,
    CandleInterval.H4: 240,
    CandleInterval.D1: 1440,
}

INTERVAL_SECONDS: dict[CandleInterval, int] = {
    CandleInterval.M1: 60,
    CandleInterval.M5: 300,
    CandleInterval.M15: 900,
    CandleInterval.H1: 3600,
    CandleInterval.H4: 14400,
    CandleInterval.D1: 86400,
}


def _decimal(value: Any) -> Decimal | None:
    if value is None or value == "":
        return None
    try:
        parsed = Decimal(str(value))
        return parsed if parsed.is_finite() else None
    except (InvalidOperation, ValueError):
        return None


def _positive_number(data: dict[str, Any], field: str, index: int) -> Decimal | None:
    values = data.get(field)
    if not isinstance(values, list) or len(values) <= index:
        return None
    value = _decimal(values[index])
    return value if value is not None and value > 0 else None


class KrakenPublicProvider:
    name = "kraken"
    market_type = MarketType.CRYPTO
    supports_delayed = False

    def __init__(
        self,
        *,
        client: Any | None = None,
        base_url: str = "https://api.kraken.com",
        timeout: float = 10.0,
        retry_policy: RetryPolicy | None = None,
        bucket: TokenBucket | None = None,
        sleep=time.sleep,
        clock=lambda: datetime.now(tz=UTC),
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self._client = client
        self._retry = retry_policy or RetryPolicy()
        self._bucket = bucket if bucket is not None else TokenBucket(1.0, 2)
        self._sleep = sleep
        self._clock = clock

    # -- provider protocol -------------------------------------------------

    def is_configured(self) -> bool:
        return True

    def fetch_quote(self, symbol: str) -> ProviderQuote:
        canonical = normalize_symbol(symbol, MarketType.CRYPTO)
        payload = self._get("/0/public/Ticker", {"pair": provider_symbol(canonical, "kraken")})
        data = self._first_result(payload, canonical)

        bid = _decimal((data.get("b") or [None])[0])
        ask = _decimal((data.get("a") or [None])[0])
        last = _decimal((data.get("c") or [None])[0])
        if bid is None and ask is None and last is None:
            raise ProviderDataError(f"Kraken returned no usable price for {canonical}.")

        volume = data.get("v") or []
        high = data.get("h") or []
        low = data.get("l") or []

        stamped, source = self._quote_timestamp(payload)
        session = session_for(MarketType.CRYPTO, self._clock())

        return ProviderQuote(
            symbol=canonical,
            market_type=MarketType.CRYPTO,
            provider=self.name,
            bid=bid,
            ask=ask,
            last=last,
            provider_timestamp=stamped,
            quality=DataQuality.LIVE,
            session=session.state,
            name=canonical.replace("/", " "),
            volume_24h=_decimal(volume[1]) if len(volume) > 1 else None,
            high_24h=_decimal(high[1]) if len(high) > 1 else None,
            low_24h=_decimal(low[1]) if len(low) > 1 else None,
            # Kraken's ticker exposes today's open, not a rolling 24h window, so
            # the change is left unknown here and derived from stored candles by
            # the service rather than mislabelled.
            change_24h_pct=None,
            timestamp_source=source,
        )

    def fetch_candles(
        self, symbol: str, interval: CandleInterval, *, limit: int = 200
    ) -> list[ProviderCandle]:
        canonical = normalize_symbol(symbol, MarketType.CRYPTO)
        minutes = KRAKEN_INTERVALS[CandleInterval(interval)]
        payload = self._get(
            "/0/public/OHLC",
            {"pair": provider_symbol(canonical, "kraken"), "interval": minutes},
        )
        result = payload.get("result") or {}
        rows = next((value for key, value in result.items() if key != "last"), None)
        if not isinstance(rows, list):
            raise ProviderDataError(f"Kraken returned no OHLC series for {canonical}.")

        # The final row is the candle still forming. Dropping it is the
        # difference between a closed bar and a guess.
        closed = rows[:-1] if rows else []
        span = timedelta(seconds=INTERVAL_SECONDS[CandleInterval(interval)])

        candles: list[ProviderCandle] = []
        for row in closed[-max(1, limit) :]:
            if not isinstance(row, list) or len(row) < 7:
                continue
            open_time = datetime.fromtimestamp(int(row[0]), tz=UTC)
            values = [_decimal(row[index]) for index in (1, 2, 3, 4, 6)]
            if any(value is None for value in values):
                continue
            open_, high, low, close, volume = values
            candles.append(
                ProviderCandle(
                    symbol=canonical,
                    market_type=MarketType.CRYPTO,
                    provider=self.name,
                    interval=CandleInterval(interval),
                    open_time=open_time,
                    open=open_,
                    high=high,
                    low=low,
                    close=close,
                    volume=volume,
                    provider_timestamp=open_time + span,
                    quality=DataQuality.HISTORICAL,
                )
            )
        return candles

    def market_snapshot(self, markets: list[dict[str, Any]]) -> dict[str, Any]:
        """Return one bounded-in-cost ticker snapshot for the supplied USD catalogue."""
        payload = self._get("/0/public/Ticker", {})
        tickers = payload.get("result")
        if not isinstance(tickers, dict) or not tickers:
            raise ProviderDataError("Kraken returned no ticker snapshot for USD market discovery.")

        def non_negative(data: dict[str, Any], field: str, index: int) -> Decimal | None:
            values = data.get(field)
            if not isinstance(values, list) or len(values) <= index:
                return None
            value = _decimal(values[index])
            return value if value is not None and value >= 0 else None

        as_of, timestamp_source = self._quote_timestamp(payload)
        observations: list[dict[str, Any]] = []
        for market in markets:
            ticker = tickers.get(market["pair"])
            warnings: list[str] = []
            if not isinstance(ticker, dict):
                warnings.append("Kraken did not return a ticker for this market.")
                ticker = {}

            bid = _positive_number(ticker, "b", 0)
            ask = _positive_number(ticker, "a", 0)
            last = _positive_number(ticker, "c", 0)
            volume = non_negative(ticker, "v", 1)
            vwap = _positive_number(ticker, "p", 1)
            high = _positive_number(ticker, "h", 1)
            low = _positive_number(ticker, "l", 1)
            raw_day_open = _decimal(ticker.get("o"))
            day_open = raw_day_open if raw_day_open is not None and raw_day_open > 0 else None

            turnover = volume * vwap if volume is not None and vwap is not None else None
            midpoint = (bid + ask) / 2 if bid is not None and ask is not None and ask >= bid else None
            spread = (ask - bid) / midpoint * 100 if midpoint is not None and midpoint > 0 else None
            range_pct = (
                (high - low) / ((high + low) / 2) * 100
                if high is not None and low is not None and high >= low and high + low > 0
                else None
            )
            day_change = (
                (last - day_open) / day_open * 100
                if last is not None and day_open is not None and day_open > 0
                else None
            )
            if turnover is None:
                warnings.append("24h USD turnover is unavailable because Kraken volume or VWAP is missing.")
            if spread is None:
                warnings.append("A valid two-sided bid/ask spread is unavailable.")
            if day_change is None:
                warnings.append("Change from Kraken's UTC day open is unavailable.")
            if range_pct is None:
                warnings.append("24h high-low range is unavailable.")

            observations.append(
                {
                    "symbol": market["symbol"],
                    "status": market["status"],
                    "tickerAvailable": bool(ticker),
                    "provider": self.name,
                    "lastPrice": None if last is None else str(last),
                    "bid": None if bid is None else str(bid),
                    "ask": None if ask is None else str(ask),
                    "baseVolume24h": None if volume is None else str(volume),
                    "vwap24h": None if vwap is None else str(vwap),
                    "turnover24hUsd": None if turnover is None else str(turnover),
                    "high24h": None if high is None else str(high),
                    "low24h": None if low is None else str(low),
                    "dayOpen": None if day_open is None else str(day_open),
                    "dayChangePct": None if day_change is None else str(day_change),
                    "range24hPct": None if range_pct is None else str(range_pct),
                    "spreadPct": None if spread is None else str(spread),
                    "warnings": warnings,
                }
            )

        observations.sort(key=lambda item: item["symbol"])
        return {
            "asOf": as_of.isoformat(),
            "timestampSource": timestamp_source,
            "markets": observations,
        }

    def discover_usd_pairs(self) -> list[dict[str, Any]]:
        payload = self._get("/0/public/AssetPairs", {"aclass_base": "currency"})
        result = payload.get("result")
        if not isinstance(result, dict) or not result:
            raise ProviderDataError("Kraken returned no asset-pair catalogue.")
        pairs: dict[str, dict[str, Any]] = {}
        for key, data in result.items():
            if not isinstance(data, dict) or data.get("quote") not in ("ZUSD", "USD"):
                continue
            if data.get("aclass_base") != "currency" or data.get("aclass_quote") != "currency":
                continue
            wsname = data.get("wsname", "")
            if not isinstance(wsname, str) or not wsname.endswith("/USD") or "." in key:
                continue
            symbol = normalize_symbol(wsname, MarketType.CRYPTO)
            pairs[symbol] = {
                "symbol": symbol,
                "pair": key,
                "status": data.get("status", "unknown"),
            }
        if not pairs:
            raise ProviderDataError("Kraken returned no identifiable USD spot markets.")
        return sorted(pairs.values(), key=lambda pair: pair["symbol"])

    def rank_usd_pairs(
        self,
        markets: list[dict[str, Any]],
        *,
        limit: int,
        min_usd_volume: Decimal,
        max_spread_pct: Decimal,
    ) -> tuple[list[dict[str, Any]], int]:
        """Select liquid active USD pairs from Kraken's one-request ticker snapshot."""
        payload = self._get("/0/public/Ticker", {})
        tickers = payload.get("result")
        if not isinstance(tickers, dict) or not tickers:
            raise ProviderDataError("Kraken returned no ticker snapshot for USD market ranking.")

        eligible: list[tuple[Decimal, str, dict[str, Any]]] = []
        for market in markets:
            ticker = tickers.get(market["pair"])
            if not isinstance(ticker, dict):
                continue

            bid, ask = _positive_number(ticker, "b", 0), _positive_number(ticker, "a", 0)
            volume = _positive_number(ticker, "v", 1)
            vwap = _positive_number(ticker, "p", 1)
            if bid is None or ask is None or ask < bid or volume is None or vwap is None:
                continue
            if volume * vwap < min_usd_volume:
                continue
            spread = (ask - bid) / ((ask + bid) / 2) * 100
            if spread > max_spread_pct:
                continue
            eligible.append((volume * vwap, market["symbol"], market))

        eligible.sort(key=lambda item: (-item[0], item[1]))
        return [market for _, _, market in eligible[:limit]], len(eligible)

    def check_liquidity(self, pair: str, *, min_usd_volume: Decimal, max_spread_pct: Decimal) -> str | None:
        payload = self._get("/0/public/Ticker", {"pair": pair})
        data = self._first_result(payload, pair)

        def number(field: str, index: int) -> Decimal | None:
            values = data.get(field)
            if not isinstance(values, list) or len(values) <= index:
                return None
            value = _decimal(values[index])
            return value if value is not None and value.is_finite() and value > 0 else None

        bid, ask = number("b", 0), number("a", 0)
        volume, vwap = number("v", 1), number("p", 1)
        if bid is None or ask is None or ask < bid or volume is None or vwap is None:
            return "Liquidity unavailable: a valid two-sided quote and 24h volume/VWAP are required."
        turnover = volume * vwap
        if turnover < min_usd_volume:
            return f"Insufficient liquidity: 24h USD turnover {turnover:.2f} is below {min_usd_volume}."
        spread = (ask - bid) / ((ask + bid) / 2) * 100
        if spread > max_spread_pct:
            return f"Insufficient liquidity: spread {spread:.4f}% exceeds {max_spread_pct}%."
        return None

    def close(self) -> None:
        if self._client is not None:
            self._client.close()

    # -- internals ---------------------------------------------------------

    def _first_result(self, payload: dict[str, Any], symbol: str) -> dict[str, Any]:
        errors = payload.get("error") or []
        if errors:
            raise ProviderDataError(f"Kraken rejected the request: {'; '.join(errors)}")
        result = payload.get("result") or {}
        if not result:
            raise ProviderDataError(f"Kraken returned an empty result for {symbol}.")
        first = next(iter(result.values()))
        if not isinstance(first, dict):
            raise ProviderDataError(f"Kraken returned an unexpected payload for {symbol}.")
        return first

    def _quote_timestamp(self, payload: dict[str, Any]) -> tuple[datetime, str]:
        header = payload.get("__date_header__")
        if header:
            try:
                parsed = parsedate_to_datetime(header)
                if parsed.tzinfo is None:
                    parsed = parsed.replace(tzinfo=UTC)
                return parsed.astimezone(UTC), "provider"
            except (TypeError, ValueError):
                pass
        return self._clock(), "receipt"

    def _get(self, path: str, params: dict[str, Any]) -> dict[str, Any]:
        def operation() -> dict[str, Any]:
            now = time.monotonic()
            if not self._bucket.try_acquire(now):
                raise ProviderRateLimited(
                    "Kraken public rate limit reached.",
                    retry_after_seconds=self._bucket.retry_after(now),
                )
            try:
                response = self._http().get(f"{self.base_url}{path}", params=params, timeout=self.timeout)
            except Exception as exc:  # noqa: BLE001 - transport errors are all retryable
                raise ProviderUnavailable(f"Kraken request failed: {exc}") from exc

            status = getattr(response, "status_code", 0)
            if status == 429:
                headers = getattr(response, "headers", {}) or {}
                raw = headers.get("retry-after") or headers.get("Retry-After")
                retry_after = _decimal(raw)
                if retry_after is None and raw:
                    try:
                        retry_after = Decimal(
                            str((parsedate_to_datetime(raw) - self._clock()).total_seconds())
                        )
                    except (TypeError, ValueError):
                        pass
                raise ProviderRateLimited(
                    "Kraken rate limited the request.",
                    retry_after_seconds=max(0, float(retry_after)) if retry_after is not None else None,
                )
            if status >= 500:
                raise ProviderUnavailable(f"Kraken returned HTTP {status}.")
            if status != 200:
                raise ProviderDataError(f"Kraken returned HTTP {status}.")

            try:
                payload = response.json()
            except Exception as exc:  # noqa: BLE001
                raise ProviderDataError("Kraken returned a non-JSON body.") from exc
            if not isinstance(payload, dict):
                raise ProviderDataError("Kraken returned an unexpected body.")
            errors = payload.get("error") or []
            if errors:
                message = "; ".join(str(error) for error in errors)
                if "rate limit" in message.lower() or "throttl" in message.lower():
                    retry_at = _decimal(message.rsplit(":", 1)[-1].strip())
                    raise ProviderRateLimited(
                        f"Kraken throttled the request: {message}",
                        retry_after_seconds=max(0, float(retry_at) - self._clock().timestamp())
                        if retry_at is not None
                        else None,
                    )
                raise ProviderDataError(f"Kraken rejected the request: {message}")
            headers = getattr(response, "headers", {}) or {}
            payload["__date_header__"] = headers.get("date") or headers.get("Date")
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
