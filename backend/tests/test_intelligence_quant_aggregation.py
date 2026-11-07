"""Return aggregation, benchmark alignment, and statistical reporting.

The bug these tests exist to prevent: a headline that added five per-symbol
percentage returns together and printed the total beside a *mean* buy-and-hold
return. The two numbers were not the same kind of quantity, and the comparison
implied a portfolio loss no long-only account could have suffered.

Every expected value here is written out by hand rather than captured from a
run, so a change in the aggregation has to disagree with arithmetic to pass.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from wands.config import get_settings
from wands.db.models import IntelExperimentRow
from wands.intelligence import quant
from wands.intelligence.experiments import ExperimentRunner
from wands.intelligence.strategies import (
    MEAN_REVERSION,
    RULE_BREAKOUT,
    RULE_MOVING_AVERAGE,
    TREND,
    Bar,
    StrategyParameters,
    _matched_curve,
    simulate,
)
from wands.intelligence.studies import portfolio_figures

from .test_intelligence_studies import _candles, _lab, _strategy_definition

MONDAY = datetime(2024, 3, 4, tzinfo=UTC)


def _bars(rows):
    return [
        Bar(
            at=MONDAY + timedelta(days=index),
            open=float(open_price),
            high=max(float(open_price), float(close)) + 1.0,
            low=min(float(open_price), float(close)) - 1.0,
            close=float(close),
        )
        for index, (open_price, close) in enumerate(rows)
    ]


def _rising(count: int = 60, *, start: float = 100.0, step: float = 1.0):
    return _bars([(start + step * index, start + step * index) for index in range(count)])


def _item(symbol: str, **metrics) -> dict:
    return {"symbol": symbol, "status": "complete", "metrics": metrics}


def _flat(**overrides) -> dict:
    base = {
        "totalReturn": 0.0,
        "benchmarkReturn": 0.0,
        "matchedBenchmarkReturn": 0.0,
        "exposure": 0.5,
        "costDrag": 0.0,
    }
    base.update(overrides)
    return base


# -- aggregation -----------------------------------------------------------


def test_portfolio_return_is_the_mean_of_symbol_returns_not_their_sum():
    completed = [
        _item("A", **_flat(totalReturn=0.10, benchmarkReturn=0.20)),
        _item("B", **_flat(totalReturn=0.20, benchmarkReturn=0.20)),
        _item("C", **_flat(totalReturn=0.30, benchmarkReturn=0.20)),
        _item("D", **_flat(totalReturn=0.40, benchmarkReturn=0.20)),
        _item("E", **_flat(totalReturn=0.50, benchmarkReturn=0.20)),
    ]

    figures = portfolio_figures(completed)

    assert figures["meanStrategyReturn"] == pytest.approx(0.30)
    assert figures["meanStrategyReturn"] != pytest.approx(1.50)
    assert figures["meanBenchmarkReturn"] == pytest.approx(0.20)
    assert figures["meanExcessReturn"] == pytest.approx(0.10)


def test_excess_vs_matched_compares_the_rule_against_the_same_exposure():
    completed = [
        _item("A", **_flat(totalReturn=0.50, benchmarkReturn=1.60, matchedBenchmarkReturn=0.40)),
        _item("B", **_flat(totalReturn=0.20, benchmarkReturn=1.20, matchedBenchmarkReturn=0.10)),
    ]

    figures = portfolio_figures(completed)

    # Mean rule 0.35, mean full hold 1.40, mean matched hold 0.25.
    assert figures["meanExcessReturn"] == pytest.approx(0.35 - 1.40)
    assert figures["meanExcessVsMatched"] == pytest.approx(0.35 - 0.25)


def test_the_median_is_reported_beside_a_mean_one_symbol_can_decide():
    completed = [
        _item("A", **_flat(totalReturn=0.01)),
        _item("B", **_flat(totalReturn=0.02)),
        _item("C", **_flat(totalReturn=0.03)),
        _item("D", **_flat(totalReturn=0.04)),
        _item("E", **_flat(totalReturn=10.0)),
    ]

    figures = portfolio_figures(completed)

    assert figures["meanStrategyReturn"] == pytest.approx(2.02)
    assert figures["medianStrategyReturn"] == pytest.approx(0.03)


def test_a_missing_benchmark_is_none_and_never_zero():
    completed = [
        _item(
            "A",
            totalReturn=0.10,
            benchmarkReturn=None,
            matchedBenchmarkReturn=None,
            exposure=0.5,
            costDrag=0.0,
        )
    ]

    figures = portfolio_figures(completed)

    assert figures["meanBenchmarkReturn"] is None
    assert figures["meanExcessReturn"] is None
    assert figures["meanExcessVsMatched"] is None
    assert figures["meanStrategyReturn"] == pytest.approx(0.10)


def test_no_measured_symbols_produces_no_figures():
    figures = portfolio_figures([])

    assert figures["meanStrategyReturn"] is None
    assert figures["meanBenchmarkReturn"] is None
    assert figures["meanExcessVsMatched"] is None
    assert figures["meanExposure"] is None


# -- benchmark alignment ---------------------------------------------------


def test_matched_curve_holds_only_the_bars_the_rule_was_invested():
    bars = _bars([(100, 100), (100, 110), (110, 121), (121, 121), (121, 133.1)])
    held = [False, True, True, False, True]

    curve = _matched_curve(bars, held)

    # 110/100, then 121/110, then flat, then 133.1/121.
    assert curve == pytest.approx([1.0, 1.10, 1.21, 1.21, 1.331])


def test_matched_curve_ignores_a_rally_while_in_cash():
    bars = _bars([(100, 100), (100, 200), (200, 200)])
    held = [False, False, False]

    assert _matched_curve(bars, held) == pytest.approx([1.0, 1.0, 1.0])


def test_benchmark_and_matched_curves_align_with_the_equity_curve():
    result = simulate(
        _rising(),
        StrategyParameters(
            kind=TREND, rule=RULE_MOVING_AVERAGE, fast_window=2, slow_window=5
        ),
        symbol="TEST",
    )

    assert len(result.equity_curve) == len(result.curve_dates)
    assert len(result.benchmark_curve) == len(result.curve_dates)
    assert len(result.matched_curve) == len(result.curve_dates)


def test_a_rule_that_never_enters_has_no_matched_return_but_a_positive_full_hold():
    parameters = StrategyParameters(
        kind=MEAN_REVERSION,
        lookback=5,
        entry_z=-50.0,
        exit_z=0.0,
        volatility_window=5,
        cost_bps=0.0,
    )

    result = simulate(_rising(), parameters, symbol="TEST")

    assert result.metrics["tradeCount"] == 0
    assert result.metrics["exposure"] == pytest.approx(0.0)
    assert result.metrics["matchedBenchmarkReturn"] == pytest.approx(0.0)
    assert result.metrics["benchmarkReturn"] > 0


def test_cost_drag_is_a_return_difference_not_a_sum_of_trade_fractions():
    parameters = StrategyParameters(
        kind=TREND, rule=RULE_MOVING_AVERAGE, fast_window=2, slow_window=5
    )

    free = simulate(_rising(), parameters.__class__(**{**parameters.__dict__, "cost_bps": 0.0}), symbol="TEST")
    paid = simulate(
        _rising(), parameters.__class__(**{**parameters.__dict__, "cost_bps": 50.0}), symbol="TEST"
    )

    drag = free.metrics["totalReturn"] - paid.metrics["totalReturn"]

    assert drag > 0
    # A long-only unlevered portfolio cannot lose more than its capital, so a
    # cost figure above 100% would be a unit error rather than a bad strategy.
    assert drag < 1.0


# -- statistical reporting -------------------------------------------------


def test_multiple_testing_correction_rejects_only_what_survives_the_family():
    report = quant.multiple_testing_report([0.001, 0.02, 0.5])

    assert report.tests == 3
    assert report.survivors == [True, True, False]
    assert report.bonferroni_alpha == pytest.approx(0.05 / 3)


def test_a_p_value_from_a_finite_sample_is_never_exactly_zero():
    values = [0.01 + 0.001 * (index % 5) for index in range(40)]

    test = quant.significance(values)

    assert test.p_value is not None
    assert test.p_value > 0
    assert test.p_value < 1


def test_a_small_sample_is_flagged_rather_than_promoted():
    assert quant.describe([0.01, 0.02, 0.03]).small_sample is True
    assert quant.describe([0.01] * 40).small_sample is False


# -- end to end ------------------------------------------------------------


def test_the_study_summary_reports_a_mean_and_never_a_sum(session):
    _candles(session, symbol="AAPL", step=0.4)
    _candles(session, symbol="MSFT", step=0.9)

    outcome = _lab(session).run_strategy_study(
        _strategy_definition(
            parameters={
                "symbols": ["AAPL", "MSFT"],
                "strategy": {
                    "kind": TREND,
                    "rule": RULE_MOVING_AVERAGE,
                    "fastWindow": 5,
                    "slowWindow": 20,
                    "costBps": 11.0,
                },
            }
        )
    )

    summary = outcome.payload["summary"]
    series = [
        item for item in outcome.payload["series"] if item["status"] == "complete"
    ]
    returns = [item["metrics"]["totalReturn"] for item in series]

    assert summary["meanStrategyReturn"] == pytest.approx(sum(returns) / len(returns))
    assert summary["meanStrategyReturn"] != pytest.approx(sum(returns))
    assert summary["meanMatchedBenchmarkReturn"] is not None
    assert summary["meanExcessVsMatched"] is not None
    assert summary["meanExposure"] is not None
    assert summary["costDrag"] is not None
    assert "definitions" in outcome.payload
    assert "meanExcessVsMatched" in outcome.payload["definitions"]


def test_the_feed_shows_one_row_per_study_and_keeps_the_newest_definition(session):
    """A superseded definition must not be listed beside the current one.

    The older row never recorded the fields the current one reports, so it
    renders as a result full of dashes rather than as a superseded result.
    """
    _candles(session, symbol="AAPL", step=0.4)
    lab = _lab(session)
    parameters = {
        "symbols": ["AAPL"],
        "strategy": {
            "kind": TREND,
            "rule": RULE_MOVING_AVERAGE,
            "fastWindow": 5,
            "slowWindow": 20,
        },
    }

    lab.run_strategy_study(_strategy_definition(parameters=parameters))
    lab.run_strategy_study(
        _strategy_definition(signal_version="1.1", parameters=parameters)
    )
    session.commit()

    rows = ExperimentRunner(session, get_settings()).list()

    assert len(rows) == 1
    assert rows[0].signal_version == "1.1"


def test_the_multiple_testing_correction_reaches_the_database(session):
    """The correction is written back onto the stored row, not just the response.

    The payload and the row share one dict, so mutating the payload before
    reassigning the row makes the reassignment look unchanged and the correction
    silently never persists. This asserts the round trip through the database.
    """
    _candles(session, symbol="AAPL", step=0.4)
    _candles(session, symbol="MSFT", step=0.9)

    lab = _lab(session)
    outcomes = []
    for name, raw in (
        ("Trend following (moving average)", {"kind": TREND}),
        ("Trend following (breakout)", {"kind": TREND, "rule": RULE_BREAKOUT}),
        ("Mean reversion", {"kind": MEAN_REVERSION}),
    ):
        parameters = StrategyParameters(**raw)
        outcomes.append(
            lab.run_strategy_study(
                _strategy_definition(
                    name=name,
                    signal_version="1.1",
                    parameters={
                        "symbols": ["AAPL", "MSFT"],
                        "strategy": parameters.as_dict(),
                    },
                )
            )
        )

    lab._apply_multiple_testing(outcomes)
    session.commit()
    session.expire_all()

    measured = [
        outcome
        for outcome in outcomes
        if (outcome.payload.get("summary") or {})
        .get("tradeReturnSignificance", {})
        .get("pValue")
        is not None
    ]
    assert measured, "the fixture must produce at least one measurable rule"

    for outcome in measured:
        stored = session.get(IntelExperimentRow, outcome.experiment.id)
        assert stored is not None
        assert "multipleTesting" in stored.metrics
        assert stored.metrics["multipleTesting"]["tests"] == len(measured)
        assert isinstance(stored.metrics["multipleTesting"]["survives"], bool)
