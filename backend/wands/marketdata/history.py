"""Historical daily OHLCV collection.

Two providers, one contract.

Alpaca is the licensed production source. It is used whenever
``WANDS_ALPACA_DATA_KEY`` and ``WANDS_ALPACA_DATA_SECRET`` are configured, and
its bars are split-adjusted.

The Nasdaq public quote endpoint is a keyless development source. It serves the
same daily bars the exchange publishes, but it is a web endpoint rather than a
contracted feed, so every row it produces carries its own provider name and the
collector reports which source actually answered. Production should configure
Alpaca; the collector never mixes the two in one series.

Nothing here invents a bar. A trading day the provider did not return is
recorded as a gap in ``market_price_coverage``, never interpolated, and a
provider failure is recorded as an error rather than an empty success.
"""

from __future__ import annotations

import time
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any, Protocol, runtime_checkable

from sqlalchemy import select
from sqlalchemy.orm import Session

from wands.config import Settings
from wands.db.models import MarketCandleRow, MarketPriceCoverageRow
from wands.logging import get_logger
from wands.marketdata.base import (
    DataQuality,
    MarketDataError,
    ProviderDataError,
    ProviderNotConfigured,
    ProviderRateLimited,
    ProviderUnavailable,
)
from wands.marketdata.calendar import US_MARKET_HOLIDAYS
from wands.marketdata.rate_limit import RetryPolicy, TokenBucket, call_with_retry
from wands.marketdata.symbols import normalize_symbol
from wands.schemas import MarketType

logger = get_logger(__name__)

DAILY_INTERVAL = "1d"

# The research universe the member workspace reports on. Collection is bounded
# to these symbols so a run is a known cost rather than an open-ended crawl.
RESEARCH_UNIVERSE: tuple[str, ...] = ("AAPL", "MSFT", "NVDA", "AMD", "JPM")

USER_AGENT = "wands-engine/0.1 (+market-data)"


def _decimal(value: Any) -> Decimal | None:
    if value is None or value == "":
        return None
    text = str(value).replace("$", "").replace(",", "").strip()
    if not text or text in {"N/A", "--"}:
        return None
    try:
        return Decimal(text)
    except (InvalidOperation, ValueError):
        return None


def trading_days(start: date, end: date) -> list[date]:
    """Weekdays in the window that are not US market holidays.

    This is the denominator for coverage. It is a calendar fact, not a claim
    that a bar exists for each day.
    """
    days: list[date] = []
    cursor = start
    while cursor <= end:
        if cursor.weekday() < 5 and cursor not in US_MARKET_HOLIDAYS:
            days.append(cursor)
        cursor += timedelta(days=1)
    return days


@dataclass(frozen=True)
class HistoricalBar:
    symbol: str
    trading_date: date
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: Decimal
    provider: str
    adjustment: str | None
    retrieved_at: datetime
    quality: DataQuality = DataQuality.HISTORICAL

    @property
    def open_time(self) -> datetime:
        """Midnight UTC of the trading date.

        A daily bar has no intraday timestamp, so the date is the identity. Using
        midnight UTC keeps the unique constraint meaningful and comparable.
        """
        return datetime.combine(self.trading_date, datetime.min.time(), tzinfo=UTC)


@runtime_checkable
class HistoricalProvider(Protocol):
    name: str
    adjustment: str | None

    def is_configured(self) -> bool: ...

    def fetch_daily(self, symbol: str, start: date, end: date) -> list[HistoricalBar]: ...


class AlpacaHistoricalProvider:
    """Licensed daily bars from Alpaca, split-adjusted."""

    name = "alpaca"
    adjustment = "split"

    def __init__(
        self,
        *,
        key: str | None,
        secret: str | None,
        base_url: str = "https://data.alpaca.markets",
        feed: str = "iex",
        client: Any | None = None,
        timeout: float = 20.0,
        retry_policy: RetryPolicy | None = None,
        bucket: TokenBucket | None = None,
        sleep=time.sleep,
        clock=lambda: datetime.now(tz=UTC),
    ) -> None:
        self.key = key
        self.secret = secret
        self.base_url = base_url.rstrip("/")
        self.feed = feed
        self.timeout = timeout
        self._client = client
        self._retry = retry_policy or RetryPolicy()
        self._bucket = bucket if bucket is not None else TokenBucket(3.0, 5)
        self._sleep = sleep
        self._clock = clock

    def is_configured(self) -> bool:
        return bool(self.key and self.secret)

    def fetch_daily(self, symbol: str, start: date, end: date) -> list[HistoricalBar]:
        if not self.is_configured():
            raise ProviderNotConfigured(
                "Alpaca historical bars require WANDS_ALPACA_DATA_KEY and "
                "WANDS_ALPACA_DATA_SECRET."
            )
        canonical = normalize_symbol(symbol, MarketType.STOCKS)
        bars: list[HistoricalBar] = []
        page_token: str | None = None
        for _ in range(20):
            params: dict[str, Any] = {
                "timeframe": "1Day",
                "start": start.isoformat(),
                "end": end.isoformat(),
                "limit": 10000,
                "adjustment": "split",
                "feed": self.feed,
            }
            if page_token:
                params["page_token"] = page_token
            payload = self._get(f"/v2/stocks/{canonical}/bars", params)
            for raw in payload.get("bars") or []:
                parsed = self._bar(canonical, raw)
                if parsed is not None:
                    bars.append(parsed)
            page_token = payload.get("next_page_token")
            if not page_token:
                break
        bars.sort(key=lambda bar: bar.trading_date)
        return bars

    def _bar(self, symbol: str, raw: dict[str, Any]) -> HistoricalBar | None:
        stamp = raw.get("t")
        if not stamp:
            return None
        try:
            moment = datetime.fromisoformat(str(stamp).replace("Z", "+00:00"))
        except ValueError:
            return None
        values = [_decimal(raw.get(key)) for key in ("o", "h", "l", "c", "v")]
        if any(value is None for value in values):
            return None
        open_, high, low, close, volume = values
        return HistoricalBar(
            symbol=symbol,
            trading_date=moment.astimezone(UTC).date(),
            open=open_,
            high=high,
            low=low,
            close=close,
            volume=volume,
            provider=self.name,
            adjustment=self.adjustment,
            retrieved_at=self._clock(),
        )

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
            except Exception as exc:  # noqa: BLE001 - transport errors are retryable
                raise ProviderUnavailable(f"Alpaca request failed: {exc}") from exc

            status = getattr(response, "status_code", 0)
            if status == 429:
                raise ProviderRateLimited("Alpaca rate limited the request.")
            if status in (401, 403):
                raise ProviderNotConfigured(
                    "Alpaca rejected the market-data credentials or the account is not "
                    "entitled to historical bars."
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
                headers={"user-agent": USER_AGENT}, follow_redirects=True
            )
        return self._client


class NasdaqHistoricalProvider:
    """Keyless daily bars from the Nasdaq public quote endpoint.

    This is a development source. It is not a contracted feed, so it is labelled
    as its own provider and never presented as Alpaca data.

    The endpoint returns a split-adjusted series: NVDA's 2023 close comes back as
    the post-10:1-split value with no discontinuity at the split date. The label
    says so, because a split-adjusted close and a raw close are different
    numbers for the same day and a reader must not have to infer which they have.
    """

    name = "nasdaq"
    adjustment = "split"

    BASE_URL = "https://api.nasdaq.com/api/quote"

    def __init__(
        self,
        *,
        client: Any | None = None,
        timeout: float = 25.0,
        retry_policy: RetryPolicy | None = None,
        bucket: TokenBucket | None = None,
        sleep=time.sleep,
        clock=lambda: datetime.now(tz=UTC),
    ) -> None:
        self.timeout = timeout
        self._client = client
        self._retry = retry_policy or RetryPolicy(max_attempts=3, base_delay_seconds=1.0)
        self._bucket = bucket if bucket is not None else TokenBucket(1.0, 2)
        self._sleep = sleep
        self._clock = clock

    def is_configured(self) -> bool:
        return True

    def fetch_daily(self, symbol: str, start: date, end: date) -> list[HistoricalBar]:
        canonical = normalize_symbol(symbol, MarketType.STOCKS)
        payload = self._get(canonical, start, end)
        data = payload.get("data")
        if not isinstance(data, dict):
            raise ProviderDataError(
                f"Nasdaq returned no historical table for {canonical}."
            )
        rows = ((data.get("tradesTable") or {}).get("rows")) or []
        if not isinstance(rows, list):
            raise ProviderDataError(f"Nasdaq returned a malformed table for {canonical}.")

        bars: list[HistoricalBar] = []
        for raw in rows:
            parsed = self._bar(canonical, raw)
            if parsed is not None and start <= parsed.trading_date <= end:
                bars.append(parsed)
        bars.sort(key=lambda bar: bar.trading_date)
        return bars

    def _bar(self, symbol: str, raw: dict[str, Any]) -> HistoricalBar | None:
        stamp = raw.get("date")
        if not stamp:
            return None
        try:
            trading_date = datetime.strptime(str(stamp).strip(), "%m/%d/%Y").date()
        except ValueError:
            return None
        values = [_decimal(raw.get(key)) for key in ("open", "high", "low", "close", "volume")]
        if any(value is None for value in values):
            return None
        open_, high, low, close, volume = values
        return HistoricalBar(
            symbol=symbol,
            trading_date=trading_date,
            open=open_,
            high=high,
            low=low,
            close=close,
            volume=volume,
            provider=self.name,
            adjustment=self.adjustment,
            retrieved_at=self._clock(),
        )

    def _get(self, symbol: str, start: date, end: date) -> dict[str, Any]:
        def operation() -> dict[str, Any]:
            now = time.monotonic()
            if not self._bucket.try_acquire(now):
                raise ProviderRateLimited(
                    "Nasdaq rate limit reached.",
                    retry_after_seconds=self._bucket.retry_after(now),
                )
            try:
                response = self._http().get(
                    f"{self.BASE_URL}/{symbol}/historical",
                    params={
                        "assetclass": "stocks",
                        "fromdate": start.isoformat(),
                        "todate": end.isoformat(),
                        "limit": 9999,
                    },
                    headers={
                        "accept": "application/json, text/plain, */*",
                        "accept-language": "en-US,en;q=0.9",
                    },
                    timeout=self.timeout,
                )
            except Exception as exc:  # noqa: BLE001
                raise ProviderUnavailable(f"Nasdaq request failed: {exc}") from exc

            status = getattr(response, "status_code", 0)
            if status == 429:
                raise ProviderRateLimited("Nasdaq rate limited the request.")
            if status in (401, 403):
                raise ProviderNotConfigured(
                    "Nasdaq refused the request. The public endpoint may be blocking "
                    "this host."
                )
            if status >= 500:
                raise ProviderUnavailable(f"Nasdaq returned HTTP {status}.")
            if status != 200:
                raise ProviderDataError(f"Nasdaq returned HTTP {status}.")
            try:
                payload = response.json()
            except Exception as exc:  # noqa: BLE001
                raise ProviderDataError("Nasdaq returned a non-JSON body.") from exc
            if not isinstance(payload, dict):
                raise ProviderDataError("Nasdaq returned an unexpected body.")
            return payload

        return call_with_retry(operation, policy=self._retry, sleep=self._sleep)

    def _http(self):
        if self._client is None:
            import httpx

            self._client = httpx.Client(
                headers={"user-agent": USER_AGENT}, follow_redirects=True
            )
        return self._client


def default_historical_providers(settings: Settings) -> list[HistoricalProvider]:
    """Alpaca when entitled, otherwise the keyless development source.

    The two are never combined: a series has one provider, so a reader can tell
    exactly what it is looking at.
    """
    alpaca = AlpacaHistoricalProvider(
        key=(
            settings.alpaca_data_key.get_secret_value()
            if settings.alpaca_data_key is not None
            else None
        ),
        secret=(
            settings.alpaca_data_secret.get_secret_value()
            if settings.alpaca_data_secret is not None
            else None
        ),
        base_url=settings.alpaca_data_base_url,
        feed=settings.alpaca_data_feed,
    )
    if alpaca.is_configured():
        return [alpaca]
    return [NasdaqHistoricalProvider()]


@dataclass(frozen=True)
class CoverageResult:
    symbol: str
    provider: str | None
    expected_days: int
    stored_days: int
    missing_days: int
    missing_dates: list[str] = field(default_factory=list)
    inserted: int = 0
    status: str = "empty"
    detail: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "symbol": self.symbol,
            "provider": self.provider,
            "expectedDays": self.expected_days,
            "storedDays": self.stored_days,
            "missingDays": self.missing_days,
            "missingDates": list(self.missing_dates),
            "inserted": self.inserted,
            "status": self.status,
            "detail": self.detail,
        }


class HistoricalBarCollector:
    """Fetches daily bars, persists them, and records what was missing."""

    def __init__(
        self,
        session: Session,
        settings: Settings,
        *,
        providers: Sequence[HistoricalProvider] | None = None,
    ) -> None:
        self.session = session
        self.settings = settings
        self.providers = (
            list(providers)
            if providers is not None
            else default_historical_providers(settings)
        )

    def collect(
        self, symbols: Sequence[str], *, start: date, end: date
    ) -> list[CoverageResult]:
        return [self.collect_symbol(symbol, start=start, end=end) for symbol in symbols]

    def collect_symbol(self, symbol: str, *, start: date, end: date) -> CoverageResult:
        canonical = normalize_symbol(symbol, MarketType.STOCKS)
        expected = trading_days(start, end)

        provider_name: str | None = None
        bars: list[HistoricalBar] = []
        failure: str | None = None

        for provider in self.providers:
            try:
                bars = provider.fetch_daily(canonical, start, end)
            except MarketDataError as exc:
                failure = f"{provider.name}: {exc}"
                logger.warning(
                    "historical collection failed",
                    extra={"symbol": canonical, "provider": provider.name, "error": str(exc)},
                )
                continue
            provider_name = provider.name
            failure = None
            break

        if provider_name is None:
            result = CoverageResult(
                symbol=canonical,
                provider=None,
                expected_days=len(expected),
                stored_days=0,
                missing_days=len(expected),
                missing_dates=[day.isoformat() for day in expected],
                inserted=0,
                status="error",
                detail=failure or "No historical provider is configured.",
            )
            self._record(result, start=start, end=end)
            return result

        inserted = self._persist(bars)
        stored = self._stored_dates(canonical, provider_name, start, end)
        missing = [day for day in expected if day not in stored]

        if not stored:
            status = "empty"
        elif missing:
            status = "partial"
        else:
            status = "complete"

        result = CoverageResult(
            symbol=canonical,
            provider=provider_name,
            expected_days=len(expected),
            stored_days=len(stored),
            missing_days=len(missing),
            missing_dates=[day.isoformat() for day in missing],
            inserted=inserted,
            status=status,
            detail=(
                None
                if status == "complete"
                else f"{len(missing)} trading day(s) in the window have no stored bar."
            ),
        )
        self._record(result, start=start, end=end)
        return result

    def _persist(self, bars: Sequence[HistoricalBar]) -> int:
        if not bars:
            return 0
        first, last = bars[0], bars[-1]
        existing = {
            moment.date()
            for moment in self.session.scalars(
                select(MarketCandleRow.open_time).where(
                    MarketCandleRow.provider == first.provider,
                    MarketCandleRow.symbol == first.symbol,
                    MarketCandleRow.interval == DAILY_INTERVAL,
                    MarketCandleRow.open_time >= first.open_time,
                    MarketCandleRow.open_time <= last.open_time,
                )
            ).all()
        }
        inserted = 0
        for bar in bars:
            if bar.trading_date in existing:
                continue
            self.session.add(
                MarketCandleRow(
                    provider=bar.provider,
                    symbol=bar.symbol,
                    market_type=str(MarketType.STOCKS),
                    interval=DAILY_INTERVAL,
                    open_time=bar.open_time,
                    open=bar.open,
                    high=bar.high,
                    low=bar.low,
                    close=bar.close,
                    volume=bar.volume,
                    quality=str(bar.quality),
                    adjustment=bar.adjustment,
                    provider_timestamp=bar.open_time,
                )
            )
            existing.add(bar.trading_date)
            inserted += 1
        if inserted:
            # The session is configured with autoflush=False, so the coverage
            # query that follows would otherwise not see these rows and would
            # report a freshly collected window as empty.
            self.session.flush()
        return inserted

    def _stored_dates(
        self, symbol: str, provider: str, start: date, end: date
    ) -> set[date]:
        lower = datetime.combine(start, datetime.min.time(), tzinfo=UTC)
        upper = datetime.combine(end, datetime.min.time(), tzinfo=UTC)
        return {
            moment.date()
            for moment in self.session.scalars(
                select(MarketCandleRow.open_time).where(
                    MarketCandleRow.provider == provider,
                    MarketCandleRow.symbol == symbol,
                    MarketCandleRow.interval == DAILY_INTERVAL,
                    MarketCandleRow.open_time >= lower,
                    MarketCandleRow.open_time <= upper,
                )
            ).all()
        }

    def _record(self, result: CoverageResult, *, start: date, end: date) -> None:
        lower = datetime.combine(start, datetime.min.time(), tzinfo=UTC)
        upper = datetime.combine(end, datetime.min.time(), tzinfo=UTC)
        provider = result.provider or "none"
        row = self.session.scalar(
            select(MarketPriceCoverageRow).where(
                MarketPriceCoverageRow.provider == provider,
                MarketPriceCoverageRow.symbol == result.symbol,
                MarketPriceCoverageRow.interval == DAILY_INTERVAL,
                MarketPriceCoverageRow.window_start == lower,
                MarketPriceCoverageRow.window_end == upper,
            )
        )
        if row is None:
            row = MarketPriceCoverageRow(
                provider=provider,
                symbol=result.symbol,
                interval=DAILY_INTERVAL,
                window_start=lower,
                window_end=upper,
            )
            self.session.add(row)
        row.expected_days = result.expected_days
        row.stored_days = result.stored_days
        row.missing_days = result.missing_days
        row.missing_dates = list(result.missing_dates)
        row.status = result.status
        row.detail = result.detail
        row.retrieved_at = datetime.now(tz=UTC)
        # autoflush is off, so flush explicitly to make the recorded coverage
        # visible to the caller in the same transaction.
        self.session.flush()


def coverage_report(session: Session, symbols: Sequence[str] | None = None) -> list[dict[str, Any]]:
    """Latest stored coverage per symbol, newest window first."""
    query = select(MarketPriceCoverageRow).order_by(
        MarketPriceCoverageRow.symbol, MarketPriceCoverageRow.retrieved_at.desc()
    )
    if symbols:
        query = query.where(MarketPriceCoverageRow.symbol.in_(list(symbols)))
    seen: set[str] = set()
    report: list[dict[str, Any]] = []
    for row in session.scalars(query).all():
        if row.symbol in seen:
            continue
        seen.add(row.symbol)
        report.append(
            {
                "symbol": row.symbol,
                "provider": row.provider,
                "interval": row.interval,
                "windowStart": row.window_start.date().isoformat(),
                "windowEnd": row.window_end.date().isoformat(),
                "expectedDays": row.expected_days,
                "storedDays": row.stored_days,
                "missingDays": row.missing_days,
                "missingDates": list(row.missing_dates or []),
                "status": row.status,
                "detail": row.detail,
                "retrievedAt": row.retrieved_at.isoformat(),
            }
        )
    return report


__all__ = [
    "DAILY_INTERVAL",
    "RESEARCH_UNIVERSE",
    "AlpacaHistoricalProvider",
    "CoverageResult",
    "HistoricalBar",
    "HistoricalBarCollector",
    "HistoricalProvider",
    "NasdaqHistoricalProvider",
    "coverage_report",
    "default_historical_providers",
    "trading_days",
]
