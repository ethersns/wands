"""The strategy simulator: point-in-time state, next-open fills, and costs.

The two tests that matter most are the leakage pair. A rule that reads a close
and fills at that same close is a time machine, and a rule whose state at bar
``i`` depends on bar ``i + 1`` is the same machine wearing a different hat. Both
are asserted directly rather than inferred from a plausible-looking equity curve.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from wands.intelligence import quant
from wands.intelligence.strategies import (
    EXIT_END_OF_DATA,
    EXIT_SIGNAL,
    MEAN_REVERSION,
    RULE_BREAKOUT,
    RULE_MOVING_AVERAGE,
    STATUS_INSUFFICIENT,
    STATUS_NO_PRICE_DATA,
    TREND,
    Bar,
    StrategyParameters,
    simulate,
    target_states,
)

# A Monday, so a weekday series starts on a session.
MONDAY = datetime(2024, 3, 4, tzinfo=UTC)


def _bars(rows, *, start: datetime = MONDAY, step: timedelta = timedelta(days=1)):
    """Bars from explicit ``(open, close)`` pairs, so fills are unambiguous."""
    return [
        Bar(
            at=start + step * index,
            open=float(open_price),
            high=max(float(open_price), float(close)) + 1.0,
            low=min(float(open_price), float(close)) - 1.0,
            close=float(close),
        )
        for index, (open_price, close) in enumerate(rows)
    ]


def _rising(count: int = 8, *, start: float = 100.0, step: float = 1.0):
    return _bars([(start + step * index, start + step * index) for index in range(count)])


def _fast_rule(**overrides) -> StrategyParameters:
    """A one-bar fast average against a two-bar slow average: the shortest rule."""
    base = {
        "kind": TREND,
        "rule": RULE_MOVING_AVERAGE,
        "fast_window": 1,
        "slow_window": 2,
        "cost_bps": 0.0,
    }
    base.update(overrides)
    return StrategyParameters(**base)


# --------------------------------------------------------------------------
# Point-in-time state
# --------------------------------------------------------------------------


def test_the_state_at_a_close_uses_only_bars_up_to_that_close():
    """Truncating the future must not change any earlier state."""
    bars = _rising(40)
    parameters = StrategyParameters(fast_window=3, slow_window=8)

    full = target_states(bars, parameters)

    for cut in (10, 20, 30, 39):
        truncated = target_states(bars[:cut], parameters)
        assert truncated == full[:cut], cut


def test_a_rule_cannot_see_the_bar_it_fills_on():
    """The state at the decision bar is unchanged by the next bar's prices."""
    bars = _rising(20)
    parameters = StrategyParameters(fast_window=2, slow_window=5)

    baseline = target_states(bars, parameters)

    # Replace every bar after the decision point with a crash. Nothing before
    # the crash may move.
    crashed = list(bars[:12]) + _bars(
        [(1.0, 1.0)] * 8, start=MONDAY + timedelta(days=12)
    )
    assert target_states(crashed, parameters)[:12] == baseline[:12]


def test_an_order_fills_at_the_next_open_not_the_decision_close():
    rows = [(100, 100), (100, 101), (104, 102), (107, 103), (103, 104), (104, 105)]
    bars = _bars(rows)

    result = simulate(bars, _fast_rule(), symbol="AAPL")

    assert result.trades, "the rising series should produce a trade"
    trade = result.trades[0]
    # The decision was made on bar 1's close of 101; the fill is bar 2's open of
    # 104, which is the first price an observer of that close could have got.
    assert trade.entry_at == bars[2].at
    assert trade.entry_price == pytest.approx(104.0)
    assert trade.entry_price != pytest.approx(bars[1].close)


def test_a_weekend_gap_is_not_a_session():
    """A fill waits for the next bar that exists, not the next calendar day."""
    friday = datetime(2024, 3, 1, tzinfo=UTC)
    bars = _bars(
        [(100, 100), (100, 101), (101, 102), (102, 103), (103, 104), (104, 105)],
        start=friday,
        step=timedelta(days=7),
    )
    # Friday, the following Friday, then Monday, Tuesday, Wednesday, Thursday.
    bars[2] = Bar(at=datetime(2024, 3, 11, tzinfo=UTC), open=101.0, high=103.0, low=100.0, close=102.0)
    bars[3] = Bar(at=datetime(2024, 3, 12, tzinfo=UTC), open=102.0, high=104.0, low=101.0, close=103.0)
    bars[4] = Bar(at=datetime(2024, 3, 13, tzinfo=UTC), open=103.0, high=105.0, low=102.0, close=104.0)
    bars[5] = Bar(at=datetime(2024, 3, 14, tzinfo=UTC), open=104.0, high=106.0, low=103.0, close=105.0)

    result = simulate(bars, _fast_rule(), symbol="AAPL")

    trade = result.trades[0]
    assert trade.entry_at == datetime(2024, 3, 11, tzinfo=UTC)
    assert trade.entry_at.weekday() == 0
    # Sessions held, not calendar days: entry Monday, exit Thursday.
    assert trade.bars_held == 3


# --------------------------------------------------------------------------
# Costs
# --------------------------------------------------------------------------


def test_costs_are_charged_on_both_legs():
    rows = [(100, 100), (100, 101), (101, 102), (102, 103), (103, 100), (100, 97), (97, 94)]
    bars = _bars(rows)

    result = simulate(bars, _fast_rule(cost_bps=11.0), symbol="AAPL")

    assert len(result.trades) == 1
    trade = result.trades[0]
    assert trade.exit_reason == EXIT_SIGNAL
    assert trade.cost > 0
    assert result.metrics["totalCosts"] == pytest.approx(trade.cost)
    assert trade.net_return < trade.gross_return


def test_a_gross_edge_smaller_than_the_round_trip_is_a_net_loss():
    rows = [
        (100, 100),
        (100, 100.2),
        (100.2, 100.4),
        (100.4, 100.6),
        (100.6, 100.2),
        (100.3, 100.0),
    ]
    bars = _bars(rows)

    result = simulate(bars, _fast_rule(cost_bps=100.0), symbol="AAPL")

    trade = result.trades[0]
    assert trade.gross_return > 0
    assert trade.net_return < 0


def test_a_zero_cost_run_keeps_the_gross_return():
    rows = [(100, 100), (100, 101), (101, 102), (102, 103), (103, 100), (100, 97)]
    bars = _bars(rows)

    result = simulate(bars, _fast_rule(cost_bps=0.0), symbol="AAPL")

    trade = result.trades[0]
    assert trade.cost == pytest.approx(0.0)
    assert trade.net_return == pytest.approx(trade.gross_return)


def test_position_sizing_scales_the_deployed_notional():
    rows = [(100, 100), (100, 101), (101, 102), (102, 103), (103, 100), (100, 97)]
    bars = _bars(rows)

    full = simulate(bars, _fast_rule(cost_bps=11.0, position_fraction=1.0), symbol="AAPL")
    half = simulate(bars, _fast_rule(cost_bps=11.0, position_fraction=0.5), symbol="AAPL")

    assert half.metrics["positionFraction"] == 0.5
    # Half the notional pays half the cost, and the per-trade return is unchanged
    # because it is measured against the notional that was actually deployed.
    assert half.metrics["totalCosts"] == pytest.approx(full.metrics["totalCosts"] / 2)
    assert half.trades[0].net_return == pytest.approx(full.trades[0].net_return)


# --------------------------------------------------------------------------
# Drawdown and the equity curve
# --------------------------------------------------------------------------


def test_the_reported_drawdown_matches_the_equity_curve():
    rows = [(100, 100), (100, 101), (101, 102), (102, 103), (103, 100), (100, 97), (97, 94)]
    bars = _bars(rows)

    result = simulate(bars, _fast_rule(), symbol="AAPL")

    curve = result.equity_curve
    peak = curve[0]
    worst = 0.0
    for value in curve:
        peak = max(peak, value)
        worst = min(worst, value / peak - 1.0)

    assert result.metrics["maxDrawdown"] == pytest.approx(worst)
    assert result.metrics["maxDrawdown"] < 0


def test_a_curve_that_only_rises_has_no_drawdown():
    bars = _rising(30)
    result = simulate(bars, _fast_rule(), symbol="AAPL")

    assert result.metrics["maxDrawdown"] == pytest.approx(0.0)


def test_the_benchmark_is_buy_and_hold_of_the_same_instrument():
    bars = _rising(30, start=100.0, step=1.0)
    result = simulate(bars, _fast_rule(), symbol="AAPL")

    expected = (bars[-1].close - bars[0].open) / bars[0].open
    assert result.metrics["benchmarkReturn"] == pytest.approx(expected)
    assert result.benchmark_curve[0] == pytest.approx(bars[0].close / bars[0].open)


# --------------------------------------------------------------------------
# Insufficient and missing data
# --------------------------------------------------------------------------


def test_too_few_bars_is_insufficient_rather_than_a_result():
    bars = _rising(4)
    parameters = StrategyParameters(fast_window=5, slow_window=20)

    result = simulate(bars, parameters, symbol="AAPL")

    assert result.status == STATUS_INSUFFICIENT
    assert result.trades == []
    assert result.metrics == {}
    assert result.coverage["bars"] == 4
    assert any("not enough" in flag for flag in result.flags)


def test_no_bars_is_no_price_data():
    result = simulate([], _fast_rule(), symbol="AAPL")

    assert result.status == STATUS_NO_PRICE_DATA
    assert result.trades == []
    assert result.metrics == {}
    assert result.flags


def test_a_series_with_no_trades_reports_zero_rather_than_a_ratio():
    bars = _bars([(100, 100)] * 12)
    result = simulate(bars, _fast_rule(), symbol="AAPL")

    assert result.trades == []
    assert result.metrics["tradeCount"] == 0
    assert result.metrics["winRate"] is None
    assert result.metrics["averageTradeReturn"] is None
    assert result.metrics["tradeReturnInterval"]["lower"] is None


# --------------------------------------------------------------------------
# Adjustment consistency
# --------------------------------------------------------------------------


def test_an_unadjusted_split_is_read_as_a_loss_so_the_series_must_be_adjusted():
    """The engine trusts the series it is given; adjustment is the data layer's job.

    A 4:1 split that is not adjusted for looks like a 75% collapse. The simulator
    must not silently repair it, because a repair rule that guesses would also
    hide a genuine collapse. The study therefore has to supply adjusted bars, and
    this test pins that contract.
    """
    unadjusted = _bars([(400, 400), (400, 400), (400, 400), (100, 100), (100, 100), (100, 100)])
    adjusted = _bars([(100, 100), (100, 100), (100, 100), (100, 100), (100, 100), (100, 100)])

    broken = simulate(unadjusted, _fast_rule(), symbol="AAPL")
    repaired = simulate(adjusted, _fast_rule(), symbol="AAPL")

    assert broken.metrics["benchmarkReturn"] == pytest.approx(-0.75)
    assert repaired.metrics["benchmarkReturn"] == pytest.approx(0.0)


# --------------------------------------------------------------------------
# Strategy state
# --------------------------------------------------------------------------


def test_the_breakout_rule_holds_its_state_between_breaks():
    # A flat range, then a break above it, then a drift that stays inside.
    rows = [(100, 100)] * 6 + [(100, 106), (106, 105), (105, 104), (104, 103)]
    bars = _bars(rows)
    parameters = StrategyParameters(kind=TREND, rule=RULE_BREAKOUT, breakout_window=5)

    states = target_states(bars, parameters)

    assert states[5] == 0
    assert states[6] == 1, "a close above the prior high enters"
    assert states[7] == 1, "a close inside the range holds the position"
    assert states[8] == 1
    assert states[9] == 1


def test_the_breakout_rule_exits_on_a_close_below_the_prior_low():
    rows = [(100, 100)] * 6 + [(100, 106), (106, 105), (105, 90), (90, 89)]
    bars = _bars(rows)
    parameters = StrategyParameters(kind=TREND, rule=RULE_BREAKOUT, breakout_window=5)

    states = target_states(bars, parameters)

    assert states[6] == 1
    assert states[8] == 0, "a close below the prior low exits"


def test_the_volatility_filter_blocks_entries_in_a_wild_series():
    # A violent saw pattern: the deviation is stretched but so is volatility.
    rows = [
        (100, 100),
        (100, 130),
        (130, 90),
        (90, 125),
        (125, 85),
        (85, 120),
        (120, 80),
        (80, 118),
        (118, 78),
        (78, 116),
        (116, 76),
        (76, 114),
    ]
    bars = _bars(rows)
    filtered = StrategyParameters(
        kind=MEAN_REVERSION,
        lookback=3,
        entry_z=-0.5,
        exit_z=0.0,
        volatility_window=3,
        max_volatility=0.5,
    )
    unfiltered = StrategyParameters(
        kind=MEAN_REVERSION,
        lookback=3,
        entry_z=-0.5,
        exit_z=0.0,
        volatility_window=3,
        max_volatility=None,
    )

    assert sum(target_states(bars, filtered)) == 0
    assert sum(target_states(bars, unfiltered)) > 0


def test_an_open_position_is_closed_at_the_final_close_and_labelled():
    bars = _rising(12)
    result = simulate(bars, _fast_rule(), symbol="AAPL")

    assert len(result.trades) == 1
    trade = result.trades[0]
    assert trade.exit_reason == EXIT_END_OF_DATA
    assert trade.exit_at == bars[-1].at
    assert trade.exit_price == pytest.approx(bars[-1].close)


# --------------------------------------------------------------------------
# Parameter validation
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "overrides",
    [
        {"fast_window": 10, "slow_window": 5},
        {"fast_window": 0},
        {"position_fraction": 0.0},
        {"position_fraction": 1.5},
        {"cost_bps": -1.0},
        {"kind": "momentum"},
        {"rule": "crystal_ball"},
    ],
)
def test_impossible_parameters_are_rejected(overrides):
    parameters = _fast_rule(**overrides)

    assert parameters.validate()
    with pytest.raises(ValueError):
        simulate(_rising(20), parameters, symbol="AAPL")


def test_parameters_round_trip_through_their_stored_form():
    parameters = StrategyParameters(
        kind=MEAN_REVERSION,
        lookback=15,
        entry_z=-1.5,
        exit_z=0.25,
        volatility_window=10,
        max_volatility=0.4,
        position_fraction=0.75,
        cost_bps=7.5,
    )

    assert StrategyParameters.from_dict(parameters.as_dict()) == parameters


def test_the_warmup_is_the_longest_window_the_rule_reads():
    assert StrategyParameters(fast_window=5, slow_window=30).warmup() == 30
    assert StrategyParameters(rule=RULE_BREAKOUT, breakout_window=55).warmup() == 55
    assert (
        StrategyParameters(
            kind=MEAN_REVERSION, lookback=20, volatility_window=40
        ).warmup()
        == 40
    )


# --------------------------------------------------------------------------
# The metrics that must not be manufactured
# --------------------------------------------------------------------------


def test_a_single_trade_has_no_confidence_interval():
    rows = [(100, 100), (100, 101), (101, 102), (102, 103), (103, 100), (100, 97)]
    bars = _bars(rows)

    result = simulate(bars, _fast_rule(), symbol="AAPL")

    assert result.metrics["tradeCount"] == 1
    assert result.metrics["tradeReturnInterval"]["lower"] is None
    assert result.metrics["tradeReturnSignificance"]["pValue"] is None


def test_a_flat_curve_has_no_sharpe():
    bars = _bars([(100, 100)] * 12)
    result = simulate(bars, _fast_rule(), symbol="AAPL")

    assert result.metrics["sharpe"]["value"] is None


def test_the_drawdown_helper_agrees_with_the_simulated_curve():
    rows = [(100, 100), (100, 101), (101, 102), (102, 103), (103, 100), (100, 97), (97, 94)]
    bars = _bars(rows)
    result = simulate(bars, _fast_rule(), symbol="AAPL")

    measured = quant.max_drawdown(result.equity_curve)

    assert measured.max_drawdown == pytest.approx(result.metrics["maxDrawdown"])
