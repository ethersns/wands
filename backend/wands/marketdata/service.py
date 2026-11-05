"""The market data service.

Responsibilities, in order of importance:

1. **Never invent a price.** A failed provider call produces no row, and a
   missing row produces ``None`` — not a zero, not yesterday's close.
2. **Persist what was received**, with the provider's timestamp and quality, so
   freshness is measured against the venue rather than against our own clock.
3. **Deduplicate.** Re-ingesting a bar is a no-op; the unique constraint is the
   guarantee and the pre-check is the fast path.
4. **Label provenance.** ``live``, ``delayed``, ``historical``, ``simulated`` and
   ``unavailable`` are distinct and are never collapsed into "real-time".

The service is synchronous on purpose: it is called from request handlers and
from a single background worker, and a synchronous call is far easier to reason
about when the question is "did this order get a real quote?".
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from wands.config import Settings, get_settings
from wands.db.models import MarketCandleRow, MarketQuoteRow
from wands.logging import get_logger
from wands.marketdata.alpaca import AlpacaDataProvider
from wands.marketdata.base import (
    DataQuality,
    MarketDataError,
    MarketDataProvider,
    ProviderCandle,
    ProviderNotConfigured,
    ProviderQuote,
)
from wands.marketdata.calendar import session_for
from wands.marketdata.kraken import KrakenPublicProvider
from wands.marketdata.rate_limit import RetryPolicy, TokenBucket
from wands.marketdata.symbols import (
    SymbolError,
    infer_market_type,
    normalize_symbol,
)
from wands.schemas import (
    Candle,
    CandleInterval,
    CandleSeries,
    MarketOverview,
    MarketSessionState,
    MarketType,
    Quote,
)

logger = get_logger(__name__)

ZERO = Decimal("0")


def as_utc(value: datetime | None) -> datetime | None:
    """SQLite returns naive datetimes; every comparison here is UTC."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


@dataclass(frozen=True)
class QuoteView:
    symbol: str
    name: str
    market_type: MarketType
    provider: str
    bid: Decimal | None
    ask: Decimal | None
    last: Decimal | None
    mid: Decimal | None
    spread_pct: Decimal | None
    volume_24h: Decimal | None
    high_24h: Decimal | None
    low_24h: Decimal | None
    change_24h_pct: Decimal | None
    session: MarketSessionState
    quality: DataQuality
    as_of: datetime | None
    age_seconds: float | None
    stale: bool
    strategy_eligible: bool
    timestamp_source: str = "provider"
    warnings: tuple[str, ...] = ()

    @property
    def executable_price(self) -> Decimal | None:
        """The price an order may be priced against, or ``None``.

        Requires a two-sided quote, a live quality label, a fresh timestamp and
        an open session. A candle close is never substituted: it is a print
        nobody is obliged to honour.
        """
        if self.quality is not DataQuality.LIVE:
            return None
        if self.stale or self.mid is None:
            return None
        if self.session not in (MarketSessionState.OPEN, MarketSessionState.ALWAYS):
            return None
        return self.mid

    def as_schema(self) -> Quote:
        return Quote(
            symbol=self.symbol,
            name=self.name,
            market_type=self.market_type,
            price=self.mid if self.mid is not None else self.last,
            change_24h_pct=self.change_24h_pct,
            change_abs=None,
            volume_24h=self.volume_24h,
            high_24h=self.high_24h,
            low_24h=self.low_24h,
            volatility_pct=None,
            session=self.session,
            as_of=self.as_of.isoformat().replace("+00:00", "Z") if self.as_of else None,
            age_seconds=round(self.age_seconds, 1) if self.age_seconds is not None else None,
            stale=self.stale,
            strategy_eligible=self.strategy_eligible,
            provider=self.provider,
            bid=self.bid,
            ask=self.ask,
            mid=self.mid,
            spread_pct=self.spread_pct,
            quality=str(self.quality),
            executable_price=self.executable_price,
            timestamp_source=self.timestamp_source,
        )


@dataclass
class ProviderHealth:
    provider: str
    configured: bool
    last_success_at: datetime | None = None
    last_error: str | None = None
    last_error_at: datetime | None = None
    consecutive_failures: int = 0
    latency_ms: float | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "provider": self.provider,
            "configured": self.configured,
            "lastSuccessAt": self.last_success_at.isoformat() if self.last_success_at else None,
            "lastError": self.last_error,
            "lastErrorAt": self.last_error_at.isoformat() if self.last_error_at else None,
            "consecutiveFailures": self.consecutive_failures,
            "latencyMs": self.latency_ms,
        }


@dataclass(frozen=True)
class Overview:
    quotes: list[QuoteView]
    watchlist: list[str]
    feed_updated_at: datetime | None
    feed_healthy: bool
    provenance: str
    warnings: list[str] = field(default_factory=list)

    def as_schema(self) -> MarketOverview:
        return MarketOverview(
            quotes=[quote.as_schema() for quote in self.quotes],
            watchlist=self.watchlist,
            feed_updated_at=(
                self.feed_updated_at.isoformat().replace("+00:00", "Z")
                if self.feed_updated_at
                else None
            ),
            feed_healthy=self.feed_healthy,
        )


def default_providers(settings: Settings) -> dict[MarketType, MarketDataProvider]:
    if not settings.market_data_enabled:
        return {}
    retry = RetryPolicy(max_attempts=max(1, settings.market_data_max_retries))
    kraken = KrakenPublicProvider(
        base_url=settings.kraken_base_url,
        timeout=settings.market_data_timeout_seconds,
        retry_policy=retry,
        bucket=TokenBucket(settings.kraken_rate_limit_per_second, 3),
    )
    alpaca = AlpacaDataProvider(
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
        delayed=settings.alpaca_data_delayed,
        timeout=settings.market_data_timeout_seconds,
        retry_policy=retry,
        bucket=TokenBucket(3.0, 5),
    )
    return {MarketType.CRYPTO: kraken, MarketType.STOCKS: alpaca}


class MarketDataService:
    def __init__(
        self,
        session: Session,
        *,
        providers: dict[MarketType, MarketDataProvider] | None = None,
        settings: Settings | None = None,
        clock=lambda: datetime.now(tz=UTC),
        max_quote_age_seconds: int = 30,
    ) -> None:
        self.session = session
        self.settings = settings or get_settings()
        self._clock = clock
        self.max_quote_age_seconds = max_quote_age_seconds
        self.providers = providers if providers is not None else default_providers(self.settings)
        self._health: dict[str, ProviderHealth] = {}
        self._last_latency_ms: float | None = None

    # -- configuration -----------------------------------------------------

    @property
    def watchlist(self) -> list[str]:
        raw = self.settings.market_watchlist
        return [item.strip() for item in raw.split(",") if item.strip()]

    def provider_for(self, market_type: MarketType | str) -> MarketDataProvider | None:
        return self.providers.get(MarketType(market_type))

    def health(self) -> dict[str, ProviderHealth]:
        for provider in self.providers.values():
            entry = self._health.setdefault(
                provider.name,
                ProviderHealth(provider=provider.name, configured=provider.is_configured()),
            )
            entry.configured = provider.is_configured()
        return self._health

    def latency_ms(self) -> float | None:
        return self._last_latency_ms

    # -- quotes ------------------------------------------------------------

    def refresh_quote(self, symbol: str, market_type: MarketType | str) -> QuoteView | None:
        market = MarketType(market_type)
        try:
            canonical = normalize_symbol(symbol, market)
        except SymbolError as exc:
            logger.warning(
                "symbol rejected",
                extra={
                    "event": "marketdata.symbol",
                    "context": {"symbol": symbol, "error": str(exc)},
                },
            )
            return None

        provider = self.provider_for(market)
        if provider is None:
            return None
        if not provider.is_configured():
            self._record_failure(
                provider.name,
                ProviderNotConfigured(f"{provider.name} is not configured."),
            )
            return None

        started = time.perf_counter()
        try:
            quote = provider.fetch_quote(canonical)
        except MarketDataError as exc:
            self._record_failure(provider.name, exc)
            return None
        except Exception as exc:  # noqa: BLE001 - a provider bug must not 500 the API
            self._record_failure(provider.name, MarketDataError(str(exc)))
            return None

        latency = (time.perf_counter() - started) * 1000
        self._record_success(provider.name, latency)
        row = self._persist_quote(quote)
        return self._view(row)

    def refresh_watchlist(self, symbols: list[str] | None = None) -> list[QuoteView]:
        views: list[QuoteView] = []
        for raw in symbols or self.watchlist:
            try:
                market = infer_market_type(raw)
                canonical = normalize_symbol(raw, market)
            except SymbolError:
                continue
            view = self.refresh_quote(canonical, market)
            if view is not None:
                views.append(view)
        return views

    def latest_quote(self, symbol: str, market_type: MarketType | str) -> QuoteView | None:
        market = MarketType(market_type)
        try:
            canonical = normalize_symbol(symbol, market)
        except SymbolError:
            return None
        row = self.session.scalar(
            select(MarketQuoteRow)
            .where(
                MarketQuoteRow.symbol == canonical,
                MarketQuoteRow.market_type == str(market),
            )
            .order_by(MarketQuoteRow.provider_timestamp.desc())
            .limit(1)
        )
        return self._view(row) if row is not None else None

    def quote(
        self,
        symbol: str,
        market_type: MarketType | str,
        *,
        refresh_if_stale: bool = True,
    ) -> QuoteView | None:
        view = self.latest_quote(symbol, market_type)
        if view is not None and not view.stale:
            return view
        if refresh_if_stale:
            refreshed = self.refresh_quote(symbol, market_type)
            if refreshed is not None:
                return refreshed
        return view

    # -- candles -----------------------------------------------------------

    def candles(
        self,
        symbol: str,
        interval: CandleInterval | str,
        *,
        market_type: MarketType | str | None = None,
        limit: int = 200,
        refresh_if_empty: bool = True,
    ) -> CandleSeries:
        market = MarketType(market_type) if market_type else infer_market_type(symbol)
        canonical = normalize_symbol(symbol, market)
        candle_interval = CandleInterval(interval)

        rows = self._candle_rows(canonical, candle_interval, limit)
        if not rows and refresh_if_empty:
            self.refresh_candles(canonical, candle_interval, market_type=market, limit=limit)
            rows = self._candle_rows(canonical, candle_interval, limit)

        return CandleSeries(
            symbol=canonical,
            interval=candle_interval,
            candles=[
                Candle(
                    time=int(as_utc(row.open_time).timestamp()),
                    open=Decimal(row.open),
                    high=Decimal(row.high),
                    low=Decimal(row.low),
                    close=Decimal(row.close),
                    volume=Decimal(row.volume),
                )
                for row in rows
            ],
        )

    def refresh_candles(
        self,
        symbol: str,
        interval: CandleInterval | str,
        *,
        market_type: MarketType | str | None = None,
        limit: int = 200,
    ) -> int:
        market = MarketType(market_type) if market_type else infer_market_type(symbol)
        canonical = normalize_symbol(symbol, market)
        provider = self.provider_for(market)
        if provider is None or not provider.is_configured():
            return 0

        started = time.perf_counter()
        try:
            candles = provider.fetch_candles(
                canonical, CandleInterval(interval), limit=limit
            )
        except MarketDataError as exc:
            self._record_failure(provider.name, exc)
            return 0
        except Exception as exc:  # noqa: BLE001
            self._record_failure(provider.name, MarketDataError(str(exc)))
            return 0

        self._record_success(provider.name, (time.perf_counter() - started) * 1000)
        return self._persist_candles(candles)

    def _candle_rows(
        self, symbol: str, interval: CandleInterval, limit: int
    ) -> list[MarketCandleRow]:
        rows = self.session.scalars(
            select(MarketCandleRow)
            .where(
                MarketCandleRow.symbol == symbol,
                MarketCandleRow.interval == str(interval),
            )
            .order_by(MarketCandleRow.open_time.desc())
            .limit(max(1, min(limit, 1000)))
        ).all()
        return list(reversed(rows))

    # -- overview ----------------------------------------------------------

    def overview(
        self,
        symbols: list[str] | None = None,
        *,
        refresh: bool = False,
        initial_refresh_limit: int = 3,
    ) -> Overview:
        watchlist = symbols or self.watchlist
        quotes: list[QuoteView] = []
        warnings: list[str] = []
        refreshed = 0

        for raw in watchlist:
            try:
                market = infer_market_type(raw)
                canonical = normalize_symbol(raw, market)
            except SymbolError as exc:
                warnings.append(str(exc))
                continue

            view = self.latest_quote(canonical, market)
            needs_refresh = refresh or view is None
            if needs_refresh and refreshed < (len(watchlist) if refresh else initial_refresh_limit):
                refreshed += 1
                view = self.refresh_quote(canonical, market) or view

            if view is None:
                warnings.append(
                    f"No quote is available for {canonical}. The price is unknown, not zero."
                )
                continue
            quotes.append(view)

        for provider_health in self.health().values():
            if not provider_health.configured:
                warnings.append(
                    f"{provider_health.provider} market data is not configured, so its "
                    "instruments are unavailable."
                )
            elif provider_health.last_error:
                warnings.append(
                    f"{provider_health.provider} last failed: {provider_health.last_error}"
                )

        live = [quote for quote in quotes if quote.quality is DataQuality.LIVE and not quote.stale]
        feed_updated_at = max(
            (quote.as_of for quote in quotes if quote.as_of is not None), default=None
        )
        provenance = "live" if live else "unavailable"
        if not quotes:
            warnings.append(
                "No market data has been ingested yet. Prices are unknown, not zero."
            )

        return Overview(
            quotes=quotes,
            watchlist=[quote.symbol for quote in quotes],
            feed_updated_at=feed_updated_at,
            feed_healthy=bool(live),
            provenance=provenance,
            warnings=warnings,
        )

    def stalest_quote_age_seconds(self) -> float | None:
        row = self.session.scalar(
            select(MarketQuoteRow).order_by(MarketQuoteRow.provider_timestamp.asc()).limit(1)
        )
        if row is None:
            return None
        as_of = as_utc(row.provider_timestamp)
        if as_of is None:
            return None
        return max(0.0, (self._clock() - as_of).total_seconds())

    # -- persistence -------------------------------------------------------

    def _persist_quote(self, quote: ProviderQuote) -> MarketQuoteRow:
        existing = self.session.scalar(
            select(MarketQuoteRow)
            .where(
                MarketQuoteRow.provider == quote.provider,
                MarketQuoteRow.symbol == quote.symbol,
                MarketQuoteRow.provider_timestamp == quote.provider_timestamp,
            )
            .limit(1)
        )
        if existing is not None:
            return existing

        row = MarketQuoteRow(
            provider=quote.provider,
            symbol=quote.symbol,
            market_type=str(quote.market_type),
            bid=quote.bid,
            ask=quote.ask,
            last=quote.last,
            spread_pct=quote.spread_pct,
            volume_24h=quote.volume_24h,
            high_24h=quote.high_24h,
            low_24h=quote.low_24h,
            change_24h_pct=quote.change_24h_pct,
            session=str(quote.session),
            quality=str(quote.quality),
            provider_timestamp=quote.provider_timestamp,
        )
        self.session.add(row)
        self.session.flush()
        return row

    def _persist_candles(self, candles: list[ProviderCandle]) -> int:
        if not candles:
            return 0

        first = candles[0]
        existing = set(
            self.session.scalars(
                select(MarketCandleRow.open_time).where(
                    MarketCandleRow.provider == first.provider,
                    MarketCandleRow.symbol == first.symbol,
                    MarketCandleRow.interval == str(first.interval),
                    MarketCandleRow.open_time >= candles[0].open_time,
                    MarketCandleRow.open_time <= candles[-1].open_time,
                )
            ).all()
        )
        existing_normalised = {as_utc(value) for value in existing}

        inserted = 0
        for candle in candles:
            if as_utc(candle.open_time) in existing_normalised:
                continue
            self.session.add(
                MarketCandleRow(
                    provider=candle.provider,
                    symbol=candle.symbol,
                    market_type=str(candle.market_type),
                    interval=str(candle.interval),
                    open_time=candle.open_time,
                    open=candle.open,
                    high=candle.high,
                    low=candle.low,
                    close=candle.close,
                    volume=candle.volume,
                    quality=str(candle.quality),
                    provider_timestamp=candle.provider_timestamp,
                )
            )
            existing_normalised.add(as_utc(candle.open_time))
            inserted += 1
        self.session.flush()
        return inserted

    # -- views -------------------------------------------------------------

    def _view(self, row: MarketQuoteRow) -> QuoteView:
        now = self._clock()
        as_of = as_utc(row.provider_timestamp)
        age = max(0.0, (now - as_of).total_seconds()) if as_of is not None else None
        stale = age is None or age > self.max_quote_age_seconds

        market = MarketType(row.market_type)
        session = session_for(market, now)
        quality = DataQuality(row.quality)

        bid = Decimal(row.bid) if row.bid is not None else None
        ask = Decimal(row.ask) if row.ask is not None else None
        last = Decimal(row.last) if row.last is not None else None
        mid: Decimal | None = None
        spread: Decimal | None = None
        if bid is not None and ask is not None and bid > ZERO and ask >= bid:
            mid = (bid + ask) / Decimal("2")
            if mid > ZERO:
                spread = (ask - bid) / mid * Decimal("100")

        change = Decimal(row.change_24h_pct) if row.change_24h_pct is not None else None
        if change is None and last is not None:
            change = self._derive_change_24h(row.symbol, market, last)

        max_spread = Decimal(str(self.settings.max_spread_pct))
        eligible = (
            quality is DataQuality.LIVE
            and not stale
            and session.is_open
            and mid is not None
            and spread is not None
            and spread <= max_spread
        )

        warnings: list[str] = []
        if quality is DataQuality.DELAYED:
            warnings.append(
                f"{row.symbol} is delayed data from {row.provider}; it is not real-time and "
                "cannot be used to price an order."
            )
        if stale:
            warnings.append(
                f"{row.symbol} quote is {age:.0f}s old, beyond the "
                f"{self.max_quote_age_seconds}s freshness policy."
                if age is not None
                else f"{row.symbol} quote has no timestamp and cannot be trusted."
            )
        if mid is None:
            warnings.append(
                f"{row.symbol} has no two-sided bid/ask quote, so it has no executable price."
            )

        return QuoteView(
            symbol=row.symbol,
            name=row.symbol.replace("/", " "),
            market_type=market,
            provider=row.provider,
            bid=bid,
            ask=ask,
            last=last,
            mid=mid,
            spread_pct=spread,
            volume_24h=Decimal(row.volume_24h) if row.volume_24h is not None else None,
            high_24h=Decimal(row.high_24h) if row.high_24h is not None else None,
            low_24h=Decimal(row.low_24h) if row.low_24h is not None else None,
            change_24h_pct=change,
            session=session.state,
            quality=quality,
            as_of=as_of,
            age_seconds=age,
            stale=stale,
            strategy_eligible=eligible,
            warnings=tuple(warnings),
        )

    def _derive_change_24h(
        self, symbol: str, market: MarketType, last: Decimal
    ) -> Decimal | None:
        """Derive a rolling 24h change from stored hourly closes.

        Only used when the provider does not publish one. If there is no stored
        history the answer is ``None`` — a made-up percentage is worse than a
        blank cell.
        """
        cutoff = self._clock() - timedelta(hours=24)
        row = self.session.scalar(
            select(MarketCandleRow)
            .where(
                MarketCandleRow.symbol == symbol,
                MarketCandleRow.market_type == str(market),
                MarketCandleRow.interval == str(CandleInterval.H1),
                MarketCandleRow.open_time <= cutoff,
            )
            .order_by(MarketCandleRow.open_time.desc())
            .limit(1)
        )
        if row is None:
            return None
        reference = Decimal(row.close)
        if reference <= ZERO:
            return None
        return (last - reference) / reference * Decimal("100")

    # -- health ------------------------------------------------------------

    def _record_success(self, provider: str, latency_ms: float) -> None:
        entry = self._health.setdefault(
            provider, ProviderHealth(provider=provider, configured=True)
        )
        entry.last_success_at = self._clock()
        entry.last_error = None
        entry.consecutive_failures = 0
        entry.latency_ms = round(latency_ms, 2)
        self._last_latency_ms = round(latency_ms, 2)

    def _record_failure(self, provider: str, error: MarketDataError) -> None:
        entry = self._health.setdefault(
            provider, ProviderHealth(provider=provider, configured=True)
        )
        entry.last_error = f"{type(error).__name__}: {error}"
        entry.last_error_at = self._clock()
        entry.consecutive_failures += 1
        logger.warning(
            "market data provider failed",
            extra={
                "event": "marketdata.provider_error",
                "context": {
                    "provider": provider,
                    "error": type(error).__name__,
                    "detail": str(error),
                    "consecutiveFailures": entry.consecutive_failures,
                },
            },
        )
