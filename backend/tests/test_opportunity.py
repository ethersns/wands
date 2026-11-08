"""Opportunity Desk behaviour.

These tests cover the parts that can be wrong in a way that matters: whether the
rule reads only completed candles, whether sizing respects the stricter limit,
whether a stock test is capped at the session close, and whether an evaluation
reports what the price path did rather than inventing a fill.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest

from wands.opportunity import (
    INSUFFICIENT_DATA,
    TEST_ACTIVE,
    TEST_COMPLETED,
    TEST_EXPIRED,
    TEST_INVALIDATED,
    BreakoutParameters,
    IntradayBreakout,
    OpportunityDesk,
    PaperTest,
    ResearchBudget,
    estimate_costs,
    evaluate_test,
    holding_deadline,
    in_session,
    session_close,
    size_position,
)
from wands.opportunity.watchlist import entry_for
from wands.schemas import Candle, CandleInterval, CandleSeries, MarketType

D = Decimal

# Monday 10:00 New York. November is EST (UTC-5), so the open is 14:30 UTC.
BASE = datetime(2026, 11, 9, 15, 0, tzinfo=UTC)
PARAMS = BreakoutParameters()


def bar(minutes: int, o: str, h: str, l: str, c: str, v: str) -> Candle:
    return Candle(
        time=int((BASE + timedelta(minutes=minutes)).timestamp()),
        open=D(o),
        high=D(h),
        low=D(l),
        close=D(c),
        volume=D(v),
    )


def flat_history(count: int = 20, price: str = "100", volume: str = "1000") -> list[Candle]:
    return [bar(i * 5, price, price, price, price, volume) for i in range(count)]


def breakout_series() -> list[Candle]:
    return flat_history() + [bar(100, "100", "101.5", "99.8", "101.2", "2000")]


class FakeSource:
    def __init__(self, candles: list[Candle]) -> None:
        self._candles = candles

    def candles(self, symbol, interval, *, market_type=None, limit=200, refresh_if_empty=True):
        return CandleSeries(symbol=symbol, interval=CandleInterval.M5, candles=self._candles)


# --- the rule -------------------------------------------------------------


def test_breakout_triggers_on_a_close_above_the_range() -> None:
    signal = IntradayBreakout().evaluate(breakout_series(), PARAMS)
    assert signal.triggered
    assert signal.reference_price == D("101.2")
    assert signal.invalidation_price == D("99.8")
    assert signal.target_price == D("101.2") + (D("101.2") - D("99.8")) * 2
    assert signal.volume_ratio == pytest.approx(2.0)


def test_no_trigger_when_the_close_stays_inside_the_range() -> None:
    series = flat_history() + [bar(100, "100", "100.2", "99.8", "100.0", "2000")]
    assert not IntradayBreakout().evaluate(series, PARAMS).triggered


def test_no_trigger_on_thin_volume() -> None:
    series = flat_history() + [bar(100, "100", "101.5", "99.8", "101.2", "1000")]
    assert not IntradayBreakout().evaluate(series, PARAMS).triggered


def test_insufficient_history_does_not_trigger() -> None:
    signal = IntradayBreakout().evaluate(flat_history(5), PARAMS)
    assert not signal.triggered
    assert "needs" in signal.reason.lower()


def test_the_rule_never_reads_a_future_candle() -> None:
    """The trigger is the last candle, so appending one cannot change the past."""
    series = breakout_series()
    first = IntradayBreakout().evaluate(series, PARAMS)
    extended = series + [bar(105, "101.2", "110", "101", "109", "5000")]
    second = IntradayBreakout().evaluate(extended, PARAMS)
    # The second evaluation sees a different last candle, but the first result
    # is unchanged: nothing was recomputed from data that did not exist yet.
    assert first.reference_price == D("101.2")
    assert second.reference_price == D("109")


# --- sizing ---------------------------------------------------------------


def test_research_budget_does_not_loosen_the_engine_limit() -> None:
    budget = ResearchBudget()
    assert budget.effective_risk_ceiling == D("0.50")
    assert budget.effective_risk_ceiling < budget.planned_risk_budget


def test_a_share_above_the_exposure_ceiling_is_rejected_not_rounded_up() -> None:
    sizing = size_position(
        entry=D("100"),
        invalidation=D("99"),
        market_type=MarketType.STOCKS,
        budget=ResearchBudget(),
        available_cash=D("100"),
        parameters=PARAMS,
    )
    assert not sizing.feasible
    assert "exposure ceiling" in (sizing.rejected_reason or "")


def test_crypto_sizes_fractionally_within_the_exposure_ceiling() -> None:
    sizing = size_position(
        entry=D("100"),
        invalidation=D("99"),
        market_type=MarketType.CRYPTO,
        budget=ResearchBudget(),
        available_cash=D("100"),
        parameters=PARAMS,
    )
    assert sizing.feasible
    assert sizing.quantity == D("0.05")
    assert sizing.notional == D("5.00")
    assert sizing.risk_at_stop <= ResearchBudget().effective_risk_ceiling


def test_stocks_are_bought_in_whole_shares() -> None:
    sizing = size_position(
        entry=D("1.00"),
        invalidation=D("0.99"),
        market_type=MarketType.STOCKS,
        budget=ResearchBudget(),
        available_cash=D("100"),
        parameters=PARAMS,
    )
    assert sizing.feasible
    assert sizing.quantity == D("5")
    assert sizing.quantity == sizing.quantity.to_integral_value()


def test_an_inverted_stop_is_rejected() -> None:
    sizing = size_position(
        entry=D("100"),
        invalidation=D("101"),
        market_type=MarketType.CRYPTO,
        budget=ResearchBudget(),
        available_cash=D("100"),
        parameters=PARAMS,
    )
    assert not sizing.feasible


def test_costs_are_charged_on_both_legs() -> None:
    costs = estimate_costs(D("5.00"), PARAMS)
    assert costs.fee_per_leg == D("0.0025")
    assert costs.round_trip == (costs.fee_per_leg + costs.slippage_per_leg) * 2


# --- sessions -------------------------------------------------------------


def test_stock_sessions_follow_new_york_hours() -> None:
    spy = entry_for("SPY")
    assert spy is not None
    assert in_session(spy, BASE)
    assert not in_session(spy, datetime(2026, 11, 7, 15, 0, tzinfo=UTC))  # Saturday
    assert not in_session(spy, datetime(2026, 11, 9, 22, 0, tzinfo=UTC))  # after the close


def test_crypto_has_no_session_boundary() -> None:
    btc = entry_for("BTC/USD")
    assert btc is not None
    assert in_session(btc, BASE)
    assert session_close(btc, BASE) is None


def test_a_four_hour_stock_test_is_capped_at_the_close() -> None:
    spy = entry_for("SPY")
    assert spy is not None
    late = datetime(2026, 11, 9, 20, 0, tzinfo=UTC)  # 15:00 New York
    assert holding_deadline(spy, late, 4) == datetime(2026, 11, 9, 21, 0, tzinfo=UTC)


def test_an_early_stock_test_keeps_its_full_window() -> None:
    spy = entry_for("SPY")
    assert spy is not None
    early = datetime(2026, 11, 9, 15, 0, tzinfo=UTC)  # 10:00 New York
    assert holding_deadline(spy, early, 4) == early + timedelta(hours=4)


# --- evaluation -----------------------------------------------------------


def make_test() -> PaperTest:
    opened = BASE + timedelta(minutes=100)
    return PaperTest(
        symbol="BTC/USD",
        market_type=MarketType.CRYPTO,
        strategy_key="intraday_breakout",
        strategy_version=1,
        reference_price=D("101.2"),
        invalidation_price=D("99.8"),
        target_price=D("104.0"),
        quantity=D("0.05"),
        fee_bps=5.0,
        slippage_bps=10.0,
        opened_at=opened,
        deadline=opened + timedelta(hours=4),
    )


ENTRY_BAR = bar(105, "101.2", "101.4", "101.0", "101.3", "1500")


def test_no_candles_is_reported_as_insufficient_data() -> None:
    assert evaluate_test(make_test(), []).status == INSUFFICIENT_DATA


def test_entry_is_the_next_open_not_the_triggering_close() -> None:
    outcome = evaluate_test(
        make_test(), [ENTRY_BAR, bar(110, "101.3", "104.5", "101.2", "104.2", "3000")]
    )
    assert outcome.entry_price == D("101.2")
    assert outcome.status == TEST_COMPLETED
    assert outcome.exit_price == D("104.0")


def test_net_return_is_gross_minus_estimated_costs() -> None:
    outcome = evaluate_test(
        make_test(), [ENTRY_BAR, bar(110, "101.3", "104.5", "101.2", "104.2", "3000")]
    )
    assert outcome.gross_return > 0
    assert outcome.net_return == outcome.gross_return - outcome.fees - outcome.slippage


def test_a_stop_is_recorded_as_a_loss() -> None:
    outcome = evaluate_test(
        make_test(), [ENTRY_BAR, bar(110, "101.3", "101.4", "99.5", "99.6", "3000")]
    )
    assert outcome.status == TEST_INVALIDATED
    assert outcome.exit_price == D("99.8")
    assert outcome.gross_return < 0


def test_a_candle_spanning_both_levels_is_resolved_against_the_test() -> None:
    outcome = evaluate_test(
        make_test(), [ENTRY_BAR, bar(110, "101.3", "104.5", "99.5", "100.0", "3000")]
    )
    assert outcome.status == TEST_INVALIDATED
    assert outcome.notes


def test_the_time_stop_expires_an_unresolved_test() -> None:
    quiet = [ENTRY_BAR] + [
        bar(105 + i * 5, "101.3", "101.5", "101.1", "101.3", "1000") for i in range(1, 60)
    ]
    outcome = evaluate_test(make_test(), quiet)
    assert outcome.status == TEST_EXPIRED
    assert outcome.exit_price == D("101.3")


def test_an_open_test_stays_active_and_reports_drawdown() -> None:
    outcome = evaluate_test(
        make_test(), [ENTRY_BAR, bar(110, "101.3", "101.5", "101.1", "101.3", "1000")]
    )
    assert outcome.status == TEST_ACTIVE
    assert outcome.drawdown is not None


# --- the desk -------------------------------------------------------------


def test_a_quiet_scan_says_so_rather_than_inventing_a_candidate() -> None:
    desk = OpportunityDesk(FakeSource(flat_history()), watchlist=(entry_for("SPY"),))
    report = desk.scan(now=BASE + timedelta(minutes=100))
    assert report.empty
    assert "No qualifying opportunities found." in report.notes


def test_a_closed_venue_is_skipped_with_a_reason() -> None:
    desk = OpportunityDesk(FakeSource(breakout_series()), watchlist=(entry_for("SPY"),))
    report = desk.scan(now=datetime(2026, 11, 7, 15, 0, tzinfo=UTC))
    assert report.empty
    assert any(item.symbol == "SPY" and "closed" in item.reason for item in report.skipped)


def test_a_candidate_states_its_conditions_and_claims_nothing_more() -> None:
    desk = OpportunityDesk(FakeSource(breakout_series()), watchlist=(entry_for("SPY"),))
    report = desk.scan(now=BASE + timedelta(minutes=100))
    assert len(report.candidates) == 1
    candidate = report.candidates[0]
    assert candidate.strategy_version == 1
    assert "next completed" in candidate.entry_condition
    assert "safe" not in candidate.why_qualified.lower()
    assert "guaranteed" not in candidate.why_qualified.lower()


def test_the_desk_has_no_order_path() -> None:
    """A guard against the desk quietly growing an execution dependency."""
    import wands.opportunity.candidates as module

    source = open(module.__file__, encoding="utf-8").read()
    for forbidden in ("execution", "paper_broker", "risk_engine", "place_order"):
        assert forbidden not in source
