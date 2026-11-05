"""Market data: providers, calendars, freshness, persistence and deduplication.

Every provider response here is a fixed fixture. Nothing in this module touches
a network, and nothing depends on a venue being open.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import func, select

from wands.db.models import MarketCandleRow, MarketQuoteRow
from wands.db.session import session_scope
from wands.marketdata.alpaca import AlpacaDataProvider
from wands.marketdata.base import (
    DataQuality,
    ProviderDataError,
    ProviderNotConfigured,
    ProviderUnavailable,
)
from wands.marketdata.calendar import session_for
from wands.marketdata.kraken import KrakenPublicProvider
from wands.marketdata.rate_limit import RetryPolicy, TokenBucket
from wands.marketdata.service import MarketDataService
from wands.marketdata.symbols import (
    SymbolError,
    infer_market_type,
    normalize_symbol,
    provider_symbol,
)
from wands.schemas import CandleInterval, MarketSessionState, MarketType

from .conftest import settings
from .marketdata_fakes import (
    FIXED_NOW,
    FakeHttpClient,
    FakeProvider,
    FakeResponse,
    alpaca_bars_payload,
    alpaca_snapshot_payload,
    kraken_ohlc_payload,
    kraken_ticker_payload,
    make_candles,
    make_quote,
)

MARKET_OPEN_NOW = datetime(2026, 11, 5, 15, 0, tzinfo=UTC)  # 10:00 in New York


def service(session, provider, *, now=FIXED_NOW, max_age=30) -> MarketDataService:
    return MarketDataService(
        session,
        providers={provider.market_type: provider},
        settings=settings(),
        clock=lambda: now,
        max_quote_age_seconds=max_age,
    )


def kraken(client, *, sleep=None) -> KrakenPublicProvider:
    return KrakenPublicProvider(
        client=client,
        retry_policy=RetryPolicy(max_attempts=3, base_delay_seconds=0.01),
        bucket=TokenBucket(1000.0, 1000),
        sleep=sleep or (lambda _: None),
        clock=lambda: FIXED_NOW,
    )


def alpaca(client, *, delayed: bool = False, key="key", secret="secret") -> AlpacaDataProvider:
    return AlpacaDataProvider(
        key=key,
        secret=secret,
        client=client,
        delayed=delayed,
        retry_policy=RetryPolicy(max_attempts=2, base_delay_seconds=0.01),
        bucket=TokenBucket(1000.0, 1000),
        sleep=lambda _: None,
        clock=lambda: MARKET_OPEN_NOW,
    )


# --- symbols --------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("btc-usd", "BTC/USD"),
        ("BTCUSD", "BTC/USD"),
        ("XBTUSD", "BTC/USD"),
        ("eth_usdt", "ETH/USDT"),
        ("sol/usd", "SOL/USD"),
    ],
)
def test_crypto_symbols_are_normalised(raw, expected):
    assert normalize_symbol(raw, MarketType.CRYPTO) == expected


@pytest.mark.parametrize(("raw", "expected"), [("aapl", "AAPL"), ("BRK.B", "BRK.B")])
def test_equity_symbols_are_normalised(raw, expected):
    assert normalize_symbol(raw, MarketType.STOCKS) == expected


def test_a_crypto_symbol_without_a_quote_asset_is_rejected():
    with pytest.raises(SymbolError):
        normalize_symbol("BTC", MarketType.CRYPTO)


def test_kraken_uses_its_own_base_asset_spelling():
    assert provider_symbol("BTC/USD", "kraken") == "XBTUSD"
    assert provider_symbol("ETH/USD", "kraken") == "ETHUSD"


def test_market_type_is_inferred_from_the_symbol():
    assert infer_market_type("BTC/USD") is MarketType.CRYPTO
    assert infer_market_type("AAPL") is MarketType.STOCKS


# --- calendars ------------------------------------------------------------


def test_crypto_is_always_open():
    window = session_for(MarketType.CRYPTO, FIXED_NOW)
    assert window.is_open
    assert window.state is MarketSessionState.ALWAYS


def test_us_equity_regular_session_is_open():
    window = session_for(MarketType.STOCKS, MARKET_OPEN_NOW)
    assert window.is_open
    assert window.state is MarketSessionState.OPEN


def test_us_equity_weekend_is_closed():
    saturday = datetime(2026, 11, 7, 15, 0, tzinfo=UTC)
    window = session_for(MarketType.STOCKS, saturday)
    assert not window.is_open
    assert window.state is MarketSessionState.CLOSED


def test_us_equity_holiday_is_closed():
    christmas = datetime(2026, 12, 25, 15, 0, tzinfo=UTC)
    window = session_for(MarketType.STOCKS, christmas)
    assert not window.is_open
    assert window.state is MarketSessionState.CLOSED


def test_us_equity_premarket_is_not_tradeable():
    premarket = datetime(2026, 11, 5, 13, 0, tzinfo=UTC)  # 08:00 New York
    window = session_for(MarketType.STOCKS, premarket)
    assert window.state is MarketSessionState.PRE
    assert not window.is_open


# --- rate limiting and backoff -------------------------------------------


def test_token_bucket_limits_then_refills():
    bucket = TokenBucket(1.0, 2)
    assert bucket.try_acquire(0.0)
    assert bucket.try_acquire(0.0)
    assert not bucket.try_acquire(0.0)
    assert bucket.try_acquire(1.0)


def test_backoff_is_exponential_and_capped():
    policy = RetryPolicy(max_attempts=5, base_delay_seconds=0.5, max_delay_seconds=2.0)
    assert [policy.delay_for(attempt) for attempt in range(5)] == [0.5, 1.0, 2.0, 2.0, 2.0]


# --- Kraken ---------------------------------------------------------------


def test_kraken_ticker_is_parsed_with_the_provider_timestamp():
    client = FakeHttpClient(
        FakeResponse(
            200,
            kraken_ticker_payload(),
            {"date": "Thu, 05 Nov 2026 14:00:00 GMT"},
        )
    )
    quote = kraken(client).fetch_quote("BTC/USD")

    assert quote.bid == Decimal("100.00")
    assert quote.ask == Decimal("100.20")
    assert quote.last == Decimal("100.10")
    assert quote.quality is DataQuality.LIVE
    assert quote.timestamp_source == "provider"
    assert quote.provider_timestamp == FIXED_NOW
    assert quote.mid == Decimal("100.10")


def test_kraken_drops_the_in_progress_candle():
    client = FakeHttpClient(FakeResponse(200, kraken_ohlc_payload(rows=3)))
    candles = kraken(client).fetch_candles("BTC/USD", CandleInterval.H1)
    assert len(candles) == 2
    assert all(candle.quality is DataQuality.HISTORICAL for candle in candles)


def test_kraken_rate_limit_is_retried_with_backoff():
    sleeps: list[float] = []
    client = FakeHttpClient(
        [FakeResponse(429, {}), FakeResponse(200, kraken_ticker_payload())]
    )
    quote = kraken(client, sleep=sleeps.append).fetch_quote("BTC/USD")

    assert quote.last == Decimal("100.10")
    assert len(client.calls) == 2
    assert sleeps, "a rate limit must trigger a backoff"


def test_kraken_transport_failure_is_retried_then_raised():
    client = FakeHttpClient([RuntimeError("connection reset")] * 3)
    with pytest.raises(ProviderUnavailable):
        kraken(client).fetch_quote("BTC/USD")
    assert len(client.calls) == 3


def test_kraken_error_payload_is_not_retried():
    client = FakeHttpClient(
        FakeResponse(200, kraken_ticker_payload(errors=["EQuery:Unknown asset pair"]))
    )
    with pytest.raises(ProviderDataError):
        kraken(client).fetch_quote("BTC/USD")
    assert len(client.calls) == 1


# --- Alpaca ---------------------------------------------------------------


def test_alpaca_without_credentials_is_not_configured():
    provider = AlpacaDataProvider(key=None, secret=None)
    assert not provider.is_configured()
    with pytest.raises(ProviderNotConfigured):
        provider.fetch_quote("AAPL")


def test_alpaca_snapshot_is_parsed():
    client = FakeHttpClient(FakeResponse(200, alpaca_snapshot_payload()))
    quote = alpaca(client).fetch_quote("AAPL")

    assert quote.bid == Decimal("100.0")
    assert quote.ask == Decimal("100.2")
    assert quote.last == Decimal("100.1")
    assert quote.quality is DataQuality.LIVE
    assert quote.change_24h_pct is not None
    assert quote.change_24h_pct > 0


def test_alpaca_delayed_feed_is_labelled_delayed():
    client = FakeHttpClient(FakeResponse(200, alpaca_snapshot_payload()))
    quote = alpaca(client, delayed=True).fetch_quote("AAPL")
    assert quote.quality is DataQuality.DELAYED


def test_alpaca_bars_are_parsed():
    client = FakeHttpClient(FakeResponse(200, alpaca_bars_payload(count=2)))
    candles = alpaca(client).fetch_candles("AAPL", CandleInterval.H1)
    assert len(candles) == 2
    assert candles[0].symbol == "AAPL"


# --- service: persistence and deduplication ------------------------------


def test_quotes_are_persisted_once_per_provider_timestamp(session):
    provider = FakeProvider(quotes={"BTC/USD": make_quote()})
    svc = service(session, provider)

    assert svc.refresh_quote("BTC/USD", MarketType.CRYPTO) is not None
    assert svc.refresh_quote("BTC/USD", MarketType.CRYPTO) is not None

    assert session.scalar(select(func.count()).select_from(MarketQuoteRow)) == 1


def test_candles_are_deduplicated(session):
    provider = FakeProvider(candles={("BTC/USD", "1h"): make_candles(count=3)})
    svc = service(session, provider)

    assert svc.refresh_candles("BTC/USD", CandleInterval.H1) == 3
    assert svc.refresh_candles("BTC/USD", CandleInterval.H1) == 0
    assert session.scalar(select(func.count()).select_from(MarketCandleRow)) == 3


def test_persisted_data_survives_a_service_restart():
    provider = FakeProvider(
        quotes={"BTC/USD": make_quote()},
        candles={("BTC/USD", "1h"): make_candles(count=3)},
    )
    with session_scope() as first:
        svc = service(first, provider)
        svc.refresh_quote("BTC/USD", MarketType.CRYPTO)
        svc.refresh_candles("BTC/USD", CandleInterval.H1)

    with session_scope() as second:
        restarted = service(second, FakeProvider())
        view = restarted.latest_quote("BTC/USD", MarketType.CRYPTO)
        series = restarted.candles(
            "BTC/USD", CandleInterval.H1, refresh_if_empty=False
        )

    assert view is not None
    assert view.last == Decimal("100.10")
    assert len(series.candles) == 3


# --- service: freshness and eligibility ----------------------------------


def test_a_stale_quote_has_no_executable_price(session):
    quote = make_quote(at=FIXED_NOW - timedelta(seconds=120))
    svc = service(session, FakeProvider(quotes={"BTC/USD": quote}), max_age=30)

    view = svc.refresh_quote("BTC/USD", MarketType.CRYPTO)

    assert view is not None
    assert view.stale
    assert view.executable_price is None
    assert not view.strategy_eligible
    assert any("freshness" in warning for warning in view.warnings)


def test_a_delayed_quote_is_never_executable(session):
    quote = make_quote(quality=DataQuality.DELAYED)
    svc = service(session, FakeProvider(quotes={"BTC/USD": quote}))

    view = svc.refresh_quote("BTC/USD", MarketType.CRYPTO)

    assert view is not None
    assert view.executable_price is None
    assert not view.strategy_eligible
    assert any("delayed" in warning for warning in view.warnings)


def test_a_one_sided_quote_has_no_executable_price(session):
    quote = make_quote(bid=None)
    svc = service(session, FakeProvider(quotes={"BTC/USD": quote}))

    view = svc.refresh_quote("BTC/USD", MarketType.CRYPTO)

    assert view is not None
    assert view.mid is None
    assert view.executable_price is None


def test_a_closed_session_has_no_executable_price(session):
    quote = make_quote(
        symbol="AAPL",
        market_type=MarketType.STOCKS,
        session=MarketSessionState.CLOSED,
    )
    provider = FakeProvider(market_type=MarketType.STOCKS, quotes={"AAPL": quote})
    svc = service(session, provider, now=FIXED_NOW)  # 09:00 New York, pre-market

    view = svc.refresh_quote("AAPL", MarketType.STOCKS)

    assert view is not None
    assert view.executable_price is None
    assert not view.strategy_eligible


def test_a_fresh_two_sided_quote_in_an_open_session_is_executable(session):
    quote = make_quote(
        symbol="AAPL",
        market_type=MarketType.STOCKS,
        session=MarketSessionState.OPEN,
        at=MARKET_OPEN_NOW,
    )
    provider = FakeProvider(market_type=MarketType.STOCKS, quotes={"AAPL": quote})
    svc = service(session, provider, now=MARKET_OPEN_NOW)

    view = svc.refresh_quote("AAPL", MarketType.STOCKS)

    assert view is not None
    assert view.executable_price == Decimal("100.10")
    assert view.strategy_eligible


def test_a_wide_spread_is_not_strategy_eligible(session):
    quote = make_quote(bid="100", ask="110")
    svc = service(session, FakeProvider(quotes={"BTC/USD": quote}))

    view = svc.refresh_quote("BTC/USD", MarketType.CRYPTO)

    assert view is not None
    assert view.spread_pct is not None
    assert not view.strategy_eligible


# --- service: failures ----------------------------------------------------


def test_a_provider_failure_persists_nothing(session):
    provider = FakeProvider(error=ProviderUnavailable("venue down"))
    svc = service(session, provider)

    assert svc.refresh_quote("BTC/USD", MarketType.CRYPTO) is None
    assert session.scalar(select(func.count()).select_from(MarketQuoteRow)) == 0

    health = svc.health()["fake"]
    assert health.consecutive_failures == 1
    assert health.last_error is not None


def test_an_unconfigured_provider_is_reported_not_guessed(session):
    provider = FakeProvider(configured=False)
    svc = service(session, provider)

    assert svc.refresh_quote("BTC/USD", MarketType.CRYPTO) is None
    assert not svc.health()["fake"].configured


def test_overview_is_unavailable_when_no_quote_can_be_obtained(session):
    svc = service(session, FakeProvider(error=ProviderUnavailable("venue down")))

    overview = svc.overview(["BTC/USD"])

    assert overview.provenance == "unavailable"
    assert overview.quotes == []
    assert overview.feed_healthy is False
    assert overview.warnings


def test_overview_is_live_when_a_fresh_quote_exists(session):
    svc = service(session, FakeProvider(quotes={"BTC/USD": make_quote()}))

    overview = svc.overview(["BTC/USD"])

    assert overview.provenance == "live"
    assert overview.feed_healthy is True
    assert len(overview.quotes) == 1
    assert overview.quotes[0].symbol == "BTC/USD"


def test_change_24h_is_derived_from_stored_candles_when_the_provider_omits_it(session):
    candles = make_candles(
        count=1, start=FIXED_NOW - timedelta(hours=25), base="90"
    )
    provider = FakeProvider(
        quotes={"BTC/USD": make_quote(last="100")},
        candles={("BTC/USD", "1h"): candles},
    )
    svc = service(session, provider)
    svc.refresh_candles("BTC/USD", CandleInterval.H1)

    view = svc.refresh_quote("BTC/USD", MarketType.CRYPTO)

    assert view is not None
    assert view.change_24h_pct is not None
    assert view.change_24h_pct > 0


def test_change_24h_is_unknown_without_history(session):
    svc = service(session, FakeProvider(quotes={"BTC/USD": make_quote()}))

    view = svc.refresh_quote("BTC/USD", MarketType.CRYPTO)

    assert view is not None
    assert view.change_24h_pct is None


def test_candles_are_empty_when_the_provider_has_none(session):
    svc = service(session, FakeProvider())

    series = svc.candles("BTC/USD", CandleInterval.H1)

    assert series.candles == []
    assert series.symbol == "BTC/USD"
