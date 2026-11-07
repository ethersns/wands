"""Historical daily OHLCV collection.

The collector's contract is narrow and testable: it persists what the provider
returned, it never fills a gap, and a provider failure is recorded as an error
rather than an empty success. No test reaches a venue; every provider is a fake.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal

from sqlalchemy import select

from wands.config import get_settings
from wands.db.models import MarketCandleRow, MarketPriceCoverageRow
from wands.marketdata.base import ProviderUnavailable
from wands.marketdata.history import (
    HistoricalBar,
    HistoricalBarCollector,
    trading_days,
)

WINDOW_START = date(2026, 11, 2)
WINDOW_END = date(2026, 11, 6)


class FakeProvider:
    name = "fake"
    adjustment = "split"

    def __init__(self, bars=None, *, error=None):
        self._bars = list(bars or [])
        self._error = error
        self.calls = 0

    def is_configured(self) -> bool:
        return True

    def fetch_daily(self, symbol, start, end):
        self.calls += 1
        if self._error is not None:
            raise self._error
        return [bar for bar in self._bars if start <= bar.trading_date <= end]


def _bar(day: date, *, close: str = "100.00") -> HistoricalBar:
    return HistoricalBar(
        symbol="AAPL",
        trading_date=day,
        open=Decimal("99.00"),
        high=Decimal("101.00"),
        low=Decimal("98.00"),
        close=Decimal(close),
        volume=Decimal("1000"),
        provider="fake",
        adjustment="split",
        retrieved_at=datetime(2026, 11, 7, tzinfo=UTC),
    )


def _collector(session, provider) -> HistoricalBarCollector:
    return HistoricalBarCollector(session, get_settings(), providers=[provider])


def test_trading_days_excludes_weekends_and_holidays():
    assert trading_days(WINDOW_START, WINDOW_END) == [
        date(2026, 11, 2),
        date(2026, 11, 3),
        date(2026, 11, 4),
        date(2026, 11, 5),
        date(2026, 11, 6),
    ]
    # 2026-11-07 and 2026-11-08 are a weekend, so the window is empty.
    assert trading_days(date(2026, 11, 7), date(2026, 11, 8)) == []


def test_collector_persists_bars_and_reports_complete_coverage(session):
    days = trading_days(WINDOW_START, WINDOW_END)
    provider = FakeProvider([_bar(day) for day in days])

    result = _collector(session, provider).collect_symbol(
        "AAPL", start=WINDOW_START, end=WINDOW_END
    )

    assert result.status == "complete"
    assert result.provider == "fake"
    assert result.inserted == len(days)
    assert result.missing_days == 0

    rows = session.scalars(select(MarketCandleRow)).all()
    assert len(rows) == len(days)
    assert {row.adjustment for row in rows} == {"split"}
    assert {row.provider for row in rows} == {"fake"}
    assert {row.interval for row in rows} == {"1d"}


def test_recollecting_the_same_window_is_idempotent(session):
    days = trading_days(WINDOW_START, WINDOW_END)
    provider = FakeProvider([_bar(day) for day in days])
    collector = _collector(session, provider)

    collector.collect_symbol("AAPL", start=WINDOW_START, end=WINDOW_END)
    second = collector.collect_symbol("AAPL", start=WINDOW_START, end=WINDOW_END)

    assert second.inserted == 0
    assert second.stored_days == len(days)
    assert len(session.scalars(select(MarketCandleRow)).all()) == len(days)


def test_a_missing_day_is_recorded_as_a_gap_and_never_filled(session):
    days = trading_days(WINDOW_START, WINDOW_END)
    provider = FakeProvider([_bar(day) for day in days[:-1]])

    result = _collector(session, provider).collect_symbol(
        "AAPL", start=WINDOW_START, end=WINDOW_END
    )

    assert result.status == "partial"
    assert result.missing_dates == [days[-1].isoformat()]
    # The gap is reported, not interpolated: one bar fewer than the calendar.
    assert len(session.scalars(select(MarketCandleRow)).all()) == len(days) - 1

    coverage = session.scalar(select(MarketPriceCoverageRow))
    assert coverage.missing_days == 1
    assert coverage.missing_dates == [days[-1].isoformat()]


def test_a_provider_failure_is_recorded_as_an_error_not_an_empty_success(session):
    provider = FakeProvider(error=ProviderUnavailable("venue down"))

    result = _collector(session, provider).collect_symbol(
        "AAPL", start=WINDOW_START, end=WINDOW_END
    )

    assert result.status == "error"
    assert result.provider is None
    assert "venue down" in (result.detail or "")
    assert session.scalars(select(MarketCandleRow)).all() == []

    coverage = session.scalar(select(MarketPriceCoverageRow))
    assert coverage.status == "error"
    assert coverage.stored_days == 0


def test_the_first_working_provider_answers_and_the_series_keeps_one_source(session):
    days = trading_days(WINDOW_START, WINDOW_END)
    broken = FakeProvider(error=ProviderUnavailable("venue down"))
    working = FakeProvider([_bar(day) for day in days])

    collector = HistoricalBarCollector(
        session, get_settings(), providers=[broken, working]
    )
    result = collector.collect_symbol("AAPL", start=WINDOW_START, end=WINDOW_END)

    assert result.status == "complete"
    assert result.provider == "fake"
    assert broken.calls == 1
    assert working.calls == 1
    assert {row.provider for row in session.scalars(select(MarketCandleRow)).all()} == {
        "fake"
    }
