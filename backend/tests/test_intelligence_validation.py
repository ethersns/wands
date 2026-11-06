"""Signal validation: point-in-time entry, costs, and honest missing data.

The entry-timing tests are the reason this module exists. A backtest that fills
at a price printed before the signal was public produces a beautiful result and
means nothing, so the boundary is asserted from both sides of the session open.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from wands.config import get_settings
from wands.intelligence.validation import (
    RESULT_COMPLETE,
    RESULT_INSUFFICIENT,
    RESULT_NO_PRICE_DATA,
    TRADE_DELISTED,
    TRADE_MISSING_BENCHMARK,
    TRADE_MISSING_PRICE,
    TRADE_OK,
    SignalObservation,
    SignalValidator,
)

from .intelligence_fakes import FakePriceProvider, daily_series

# A Monday, so the generated weekday series starts on a session.
MONDAY = datetime(2024, 3, 4, 9, 30, tzinfo=UTC)


def _provider(*, symbol: str = "AAPL", sessions: int = 80, **kwargs) -> FakePriceProvider:
    return FakePriceProvider(
        series={
            symbol: daily_series(symbol, MONDAY, sessions, **kwargs),
            "SPY": daily_series("SPY", MONDAY, sessions, start_price=500.0, daily_return=0.001),
        }
    )


def _observation(
    *, symbol: str = "AAPL", available: datetime, signal_id: str = "s1", category: str = "C"
) -> SignalObservation:
    return SignalObservation(
        signal_id=signal_id,
        category=category,
        symbol=symbol,
        public_available_at=available,
    )


def _validator(provider: FakePriceProvider) -> SignalValidator:
    return SignalValidator(None, get_settings(), prices=provider)


def test_entry_is_the_next_session_after_availability():
    provider = _provider()
    # Published at 18:00 on Monday, after the close.
    available = datetime(2024, 3, 4, 18, 0, tzinfo=UTC)
    result = _validator(provider).evaluate(
        [_observation(available=available)], horizons=[1], benchmark="SPY"
    )

    trade = result.horizons[0].trades[0]
    assert trade.status == TRADE_OK
    # Tuesday's open, not Monday's.
    assert trade.entry_at == datetime(2024, 3, 5, 9, 30, tzinfo=UTC)


def test_a_signal_published_during_a_session_waits_for_the_next_one():
    provider = _provider()
    # 10:00 on Monday: the 09:30 open has already printed.
    available = datetime(2024, 3, 4, 10, 0, tzinfo=UTC)
    result = _validator(provider).evaluate(
        [_observation(available=available)], horizons=[1], benchmark="SPY"
    )

    trade = result.horizons[0].trades[0]
    assert trade.entry_at == datetime(2024, 3, 5, 9, 30, tzinfo=UTC)


def test_a_signal_published_before_the_open_can_use_that_open():
    provider = _provider()
    available = datetime(2024, 3, 4, 8, 0, tzinfo=UTC)
    result = _validator(provider).evaluate(
        [_observation(available=available)], horizons=[1], benchmark="SPY"
    )

    trade = result.horizons[0].trades[0]
    assert trade.entry_at == datetime(2024, 3, 4, 9, 30, tzinfo=UTC)


def test_a_one_day_horizon_exits_at_that_sessions_close():
    provider = _provider()
    available = datetime(2024, 3, 4, 18, 0, tzinfo=UTC)
    result = _validator(provider).evaluate(
        [_observation(available=available)], horizons=[1], benchmark="SPY"
    )

    trade = result.horizons[0].trades[0]
    assert trade.entry_at == trade.exit_at


def test_a_five_day_horizon_exits_five_sessions_later():
    provider = _provider()
    available = datetime(2024, 3, 4, 18, 0, tzinfo=UTC)
    result = _validator(provider).evaluate(
        [_observation(available=available)], horizons=[5], benchmark="SPY"
    )

    trade = result.horizons[0].trades[0]
    # Tuesday entry, so the fifth session is the following Monday.
    assert trade.entry_at == datetime(2024, 3, 5, 9, 30, tzinfo=UTC)
    assert trade.exit_at == datetime(2024, 3, 11, 9, 30, tzinfo=UTC)


def test_costs_are_deducted_from_every_trade():
    provider = _provider(daily_return=0.01)
    available = datetime(2024, 3, 4, 18, 0, tzinfo=UTC)
    result = _validator(provider).evaluate(
        [_observation(available=available)], horizons=[1], benchmark="SPY", cost_bps=25
    )

    trade = result.horizons[0].trades[0]
    assert trade.gross_return is not None and trade.net_return is not None
    assert trade.net_return == pytest.approx(trade.gross_return - 0.0025)


def test_a_gross_edge_smaller_than_the_round_trip_is_a_loss():
    # 1 basis point of drift against 11 basis points of cost.
    provider = _provider(daily_return=0.0001)
    available = datetime(2024, 3, 4, 18, 0, tzinfo=UTC)
    result = _validator(provider).evaluate(
        [_observation(available=available)], horizons=[1], benchmark="SPY"
    )

    trade = result.horizons[0].trades[0]
    assert trade.net_return < 0


def test_a_symbol_with_no_prices_is_recorded_not_dropped():
    provider = _provider()
    available = datetime(2024, 3, 4, 18, 0, tzinfo=UTC)
    result = _validator(provider).evaluate(
        [_observation(symbol="NOPRICE", available=available)], horizons=[1], benchmark="SPY"
    )

    trade = result.horizons[0].trades[0]
    assert trade.status == TRADE_MISSING_PRICE
    assert trade.net_return is None
    assert result.status == RESULT_NO_PRICE_DATA
    assert any("No historical price data" in flag for flag in result.flags)


def test_a_series_that_ends_before_the_exit_is_reported_as_delisted():
    # Only three sessions exist, so a five-day horizon cannot be closed.
    provider = FakePriceProvider(
        series={
            "AAPL": daily_series("AAPL", MONDAY, 3),
            "SPY": daily_series("SPY", MONDAY, 80, start_price=500.0),
        }
    )
    available = datetime(2024, 3, 4, 18, 0, tzinfo=UTC)
    result = _validator(provider).evaluate(
        [_observation(available=available)], horizons=[5], benchmark="SPY"
    )

    trade = result.horizons[0].trades[0]
    assert trade.status == TRADE_DELISTED
    assert trade.entry_price is not None
    assert trade.exit_price is None


def test_a_missing_benchmark_bar_removes_the_excess_return_only():
    provider = FakePriceProvider(series={"AAPL": daily_series("AAPL", MONDAY, 80)})
    available = datetime(2024, 3, 4, 18, 0, tzinfo=UTC)
    result = _validator(provider).evaluate(
        [_observation(available=available)], horizons=[1], benchmark="SPY"
    )

    trade = result.horizons[0].trades[0]
    assert trade.status == TRADE_MISSING_BENCHMARK
    assert trade.net_return is not None
    assert trade.benchmark_return is None
    assert trade.excess_return is None


def test_the_benchmark_is_matched_on_the_same_sessions():
    provider = _provider(daily_return=0.01)
    available = datetime(2024, 3, 4, 18, 0, tzinfo=UTC)
    result = _validator(provider).evaluate(
        [_observation(available=available)], horizons=[5], benchmark="SPY"
    )

    trade = result.horizons[0].trades[0]
    assert trade.benchmark_return is not None
    # SPY drifts 0.1% a session, so five sessions is about 0.5%.
    assert trade.benchmark_return == pytest.approx(0.005, abs=1e-3)


def test_the_sample_is_split_by_availability_time():
    provider = _provider(sessions=200)
    observations = [
        _observation(
            available=datetime(2024, 3, 4, 18, 0, tzinfo=UTC) + timedelta(days=index * 3),
            signal_id=f"s{index}",
        )
        for index in range(20)
    ]
    result = _validator(provider).evaluate(observations, horizons=[1], benchmark="SPY")

    assert [split.label for split in result.splits] == ["in_sample", "out_of_sample"]
    in_sample, out_of_sample = result.splits
    assert in_sample.end < out_of_sample.start
    assert in_sample.horizons[0].coverage["trades"] > 0
    assert out_of_sample.horizons[0].coverage["trades"] > 0


def test_overlapping_windows_are_reported_as_a_smaller_effective_sample():
    provider = _provider(sessions=200)
    # Three signals on the same symbol a day apart, all held for twenty days.
    observations = [
        _observation(
            available=datetime(2024, 3, 4, 18, 0, tzinfo=UTC) + timedelta(days=index),
            signal_id=f"s{index}",
        )
        for index in range(3)
    ]
    result = _validator(provider).evaluate(observations, horizons=[20], benchmark="SPY")

    assert result.overlap["overlappingPairs"] == 3
    assert result.overlap["overlapRatio"] == 1.0
    assert any("overlapping holding window" in flag for flag in result.flags)


def test_a_small_sample_is_flagged_rather_than_reported_as_a_finding():
    provider = _provider()
    available = datetime(2024, 3, 4, 18, 0, tzinfo=UTC)
    result = _validator(provider).evaluate(
        [_observation(available=available)], horizons=[1], benchmark="SPY"
    )

    assert result.status == RESULT_INSUFFICIENT
    assert any("fewer than" in flag for flag in result.flags)


def test_a_complete_result_reports_an_interval_and_a_p_value():
    provider = _provider(sessions=400, daily_return=0.002)
    observations = [
        _observation(
            available=datetime(2024, 3, 4, 18, 0, tzinfo=UTC) + timedelta(days=index * 2),
            signal_id=f"s{index}",
        )
        for index in range(40)
    ]
    result = _validator(provider).evaluate(observations, horizons=[1], benchmark="SPY")

    horizon = result.horizons[0]
    assert result.status == RESULT_COMPLETE
    assert horizon.interval is not None and horizon.interval.lower is not None
    assert horizon.significance is not None and horizon.significance.p_value is not None
    assert horizon.excess_significance is not None


def test_no_signals_is_an_explicit_empty_result():
    result = _validator(_provider()).evaluate([], horizons=[1])
    assert result.status == RESULT_INSUFFICIENT
    assert result.sample_size == 0
    assert result.flags


def test_coverage_names_the_symbols_without_prices():
    provider = _provider()
    available = datetime(2024, 3, 4, 18, 0, tzinfo=UTC)
    result = _validator(provider).evaluate(
        [
            _observation(available=available, signal_id="a"),
            _observation(symbol="NOPRICE", available=available, signal_id="b"),
        ],
        horizons=[1],
        benchmark="SPY",
    )

    assert result.coverage["distinctSymbols"] == 2
    assert result.coverage["symbolsWithPrices"] == 1
    assert result.coverage["symbolsWithoutPrices"] == ["NOPRICE"]
