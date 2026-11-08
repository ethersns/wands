"""Performance Lab correctness.

These tests are written to fail if the system flatters itself. A losing strategy
must report a loss, a missing price must report a gap, a signal must not be
filled at a bar that did not exist when it was generated, and an empty dashboard
must say so instead of showing a zero.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal

import pytest

from wands.db.models import (
    PerfEvaluationJobRow,
    PerfRecordedSignalRow,
    PerfSignalEvaluationRow,
)
from wands.intelligence.validation import PricePoint
from wands.performance import PerformanceLab, SignalInput
from wands.performance.evidence import EvidenceVault
from wands.performance.horizons import Horizon

from .conftest import make_api_key

MONDAY = date(2024, 3, 4)
TUESDAY = date(2024, 3, 5)
WEDNESDAY = date(2024, 3, 6)
THURSDAY = date(2024, 3, 7)
FRIDAY = date(2024, 3, 8)


def _moment(day: date) -> datetime:
    return datetime.combine(day, time(21, 0), tzinfo=UTC)


class StubProvider:
    """A price source with exactly the bars a test declares."""

    def __init__(self, series: dict[str, list[tuple[date, float]]]) -> None:
        self.series = series

    def daily(self, symbol: str, start: datetime, end: datetime) -> list[PricePoint]:
        points = []
        for day, close in self.series.get(symbol, []):
            at = _moment(day)
            if start <= at <= end:
                points.append(PricePoint(at=at, open=close, close=close))
        return points


def _lab(session, series, *, cost_bps="10", benchmark="SPY") -> PerformanceLab:
    return PerformanceLab(
        session,
        price_provider=StubProvider(series),
        benchmark_symbol=benchmark,
        cost_bps=Decimal(cost_bps),
    )


def _record(
    lab: PerformanceLab,
    *,
    symbol: str = "AAPL",
    direction: str = "BUY",
    observed: datetime | None = None,
    generated: datetime | None = None,
    horizons: tuple[str, ...] = ("1d",),
    strategy_key: str = "trend",
    parameters: dict | None = None,
    conditions: dict | None = None,
):
    observed_at = observed or _moment(MONDAY)
    return lab.recorder.record(
        SignalInput(
            strategy_key=strategy_key,
            strategy_name="Trend Following",
            signal_version="1",
            parameters=parameters or {"fast": 10, "slow": 50},
            symbol=symbol,
            direction=direction,
            generated_at=generated or (observed_at + timedelta(minutes=5)),
            observed_at=observed_at,
            reference_price=Decimal("100"),
            reference_price_at=observed_at,
            data_source="fixture",
            conditions=conditions or {},
            horizons=horizons,
        )
    )


# --------------------------------------------------------------------------
# Look-ahead bias
# --------------------------------------------------------------------------


def test_entry_bar_is_strictly_after_the_observation(session):
    """A signal computed from Monday's close cannot be filled at Monday's close."""
    series = {"AAPL": [(MONDAY, 50.0), (TUESDAY, 100.0), (WEDNESDAY, 110.0)]}
    lab = _lab(session, series)
    outcome = _record(lab)

    result = lab.evaluator().evaluate(
        outcome.signal, Horizon("1d", 1), now=_moment(THURSDAY)
    )

    assert result.status == "ok"
    assert result.entry_at.date() == TUESDAY
    assert result.entry_price == Decimal("100")
    # A look-ahead bug would have entered at Monday's 50 and reported +120%.
    assert result.gross_return == pytest.approx(Decimal("0.10"))


def test_horizon_is_pending_until_it_elapses(session):
    series = {"AAPL": [(MONDAY, 100.0), (TUESDAY, 100.0), (WEDNESDAY, 110.0)]}
    lab = _lab(session, series)
    outcome = _record(lab)

    result = lab.evaluator().evaluate(
        outcome.signal, Horizon("1d", 1), now=_moment(MONDAY)
    )

    assert result.status == "pending"
    assert result.net_return is None
    assert lab.evaluator().persist(outcome.signal, result) is None


# --------------------------------------------------------------------------
# Returns, costs and direction
# --------------------------------------------------------------------------


def test_buy_return_is_net_of_round_trip_cost(session):
    series = {"AAPL": [(MONDAY, 100.0), (TUESDAY, 100.0), (WEDNESDAY, 110.0)]}
    lab = _lab(session, series, cost_bps="10")
    outcome = _record(lab)

    result = lab.evaluator().evaluate(
        outcome.signal, Horizon("1d", 1), now=_moment(THURSDAY)
    )

    assert result.gross_return == pytest.approx(Decimal("0.10"))
    assert result.net_return == pytest.approx(Decimal("0.099"))
    assert result.direction_correct is True


def test_sell_signal_profits_when_price_falls(session):
    series = {"AAPL": [(MONDAY, 100.0), (TUESDAY, 100.0), (WEDNESDAY, 90.0)]}
    lab = _lab(session, series)
    outcome = _record(lab, direction="SELL")

    result = lab.evaluator().evaluate(
        outcome.signal, Horizon("1d", 1), now=_moment(THURSDAY)
    )

    assert result.gross_return == pytest.approx(Decimal("0.10"))
    assert result.direction_correct is True


def test_direction_can_be_right_while_the_trade_loses(session):
    """A 5 bps move cannot pay a 10 bps round trip."""
    series = {"AAPL": [(MONDAY, 100.0), (TUESDAY, 100.0), (WEDNESDAY, 100.05)]}
    lab = _lab(session, series, cost_bps="10")
    outcome = _record(lab)

    result = lab.evaluator().evaluate(
        outcome.signal, Horizon("1d", 1), now=_moment(THURSDAY)
    )

    assert result.direction_correct is True
    assert result.net_return is not None and result.net_return < 0


def test_hold_is_scored_on_the_band_and_carries_no_cost(session):
    series = {"AAPL": [(MONDAY, 100.0), (TUESDAY, 100.0), (WEDNESDAY, 100.5)]}
    lab = _lab(session, series)
    outcome = _record(lab, direction="HOLD")

    result = lab.evaluator().evaluate(
        outcome.signal, Horizon("1d", 1), now=_moment(THURSDAY)
    )

    assert result.direction_correct is True
    assert result.gross_return == Decimal("0")
    assert result.net_return == Decimal("0")


# --------------------------------------------------------------------------
# Missing data and unsupported horizons
# --------------------------------------------------------------------------


def test_missing_price_is_reported_not_fabricated(session):
    lab = _lab(session, {})
    outcome = _record(lab)

    result = lab.evaluator().evaluate(
        outcome.signal, Horizon("1d", 1), now=_moment(THURSDAY)
    )

    assert result.status == "missing_price"
    assert result.net_return is None
    assert "No stored bars" in result.detail


def test_intraday_horizon_is_unsupported_with_daily_bars(session):
    series = {"AAPL": [(MONDAY, 100.0), (TUESDAY, 100.0), (WEDNESDAY, 110.0)]}
    lab = _lab(session, series)
    outcome = _record(lab, horizons=("1h",))

    result = lab.evaluator().evaluate(
        outcome.signal, Horizon("1h", 0, intraday=True), now=_moment(THURSDAY)
    )

    assert result.status == "unsupported_horizon"
    assert result.net_return is None


# --------------------------------------------------------------------------
# Benchmark
# --------------------------------------------------------------------------


def test_benchmark_and_excess_return(session):
    series = {
        "AAPL": [(MONDAY, 100.0), (TUESDAY, 100.0), (WEDNESDAY, 110.0)],
        "SPY": [(MONDAY, 100.0), (TUESDAY, 100.0), (WEDNESDAY, 105.0)],
    }
    lab = _lab(session, series)
    outcome = _record(lab)

    result = lab.evaluator().evaluate(
        outcome.signal, Horizon("1d", 1), now=_moment(THURSDAY)
    )

    assert result.benchmark_return == pytest.approx(Decimal("0.05"))
    assert result.excess_return == pytest.approx(Decimal("0.049"))


def test_buy_and_hold_can_outperform_the_signal(session):
    """The benchmark wins, and the report says so."""
    series = {
        "AAPL": [(MONDAY, 100.0), (TUESDAY, 100.0), (WEDNESDAY, 101.0)],
        "SPY": [(MONDAY, 100.0), (TUESDAY, 100.0), (WEDNESDAY, 110.0)],
    }
    lab = _lab(session, series)
    outcome = _record(lab)

    result = lab.evaluator().evaluate(
        outcome.signal, Horizon("1d", 1), now=_moment(THURSDAY)
    )

    assert result.excess_return is not None and result.excess_return < 0


def test_missing_benchmark_leaves_the_field_empty(session):
    series = {"AAPL": [(MONDAY, 100.0), (TUESDAY, 100.0), (WEDNESDAY, 110.0)]}
    lab = _lab(session, series)
    outcome = _record(lab)

    result = lab.evaluator().evaluate(
        outcome.signal, Horizon("1d", 1), now=_moment(THURSDAY)
    )

    assert result.status == "ok"
    assert result.benchmark_return is None
    assert result.excess_return is None
    assert "no usable bars" in result.detail


# --------------------------------------------------------------------------
# Immutability and versioning
# --------------------------------------------------------------------------


def test_recording_the_same_signal_twice_is_idempotent(session):
    series = {"AAPL": [(MONDAY, 100.0), (TUESDAY, 100.0), (WEDNESDAY, 110.0)]}
    lab = _lab(session, series)

    first = _record(lab)
    second = _record(lab)

    assert first.created is True
    assert second.created is False
    assert first.signal.id == second.signal.id
    assert session.query(PerfRecordedSignalRow).count() == 1


def test_a_conflicting_rewrite_is_refused(session):
    """Same identity, different content: the original must not be overwritten."""
    series = {"AAPL": [(MONDAY, 100.0), (TUESDAY, 100.0), (WEDNESDAY, 110.0)]}
    lab = _lab(session, series)
    _record(lab, conditions={"rsi": 28})

    with pytest.raises(ValueError, match="immutable"):
        _record(lab, conditions={"rsi": 71})


def test_a_changed_definition_mints_a_new_version(session):
    series = {"AAPL": [(MONDAY, 100.0), (TUESDAY, 100.0), (WEDNESDAY, 110.0)]}
    lab = _lab(session, series)

    first = _record(lab)
    same = _record(lab, observed=_moment(TUESDAY))
    changed = _record(lab, observed=_moment(WEDNESDAY), parameters={"fast": 5, "slow": 20})

    assert first.signal.strategy_version_id == same.signal.strategy_version_id
    assert changed.signal.strategy_version_id != first.signal.strategy_version_id
    versions = lab.strategies()
    assert [item["version"] for item in versions] == [1, 2]
    assert all(item["frozen"] for item in versions)


def test_signal_integrity_hash_detects_tampering(session):
    series = {"AAPL": [(MONDAY, 100.0), (TUESDAY, 100.0), (WEDNESDAY, 110.0)]}
    lab = _lab(session, series)
    outcome = _record(lab)

    assert lab.recorder.verify(outcome.signal) is True
    outcome.signal.direction = "SELL"
    assert lab.recorder.verify(outcome.signal) is False


# --------------------------------------------------------------------------
# Job runner
# --------------------------------------------------------------------------


def test_job_runner_writes_one_evaluation_and_is_repeatable(session):
    series = {"AAPL": [(MONDAY, 100.0), (TUESDAY, 100.0), (WEDNESDAY, 110.0)]}
    lab = _lab(session, series)
    _record(lab)

    first = lab.evaluator().run_due_jobs(now=_moment(THURSDAY))
    second = lab.evaluator().run_due_jobs(now=_moment(THURSDAY))

    assert first["completed"] == 1
    assert second["processed"] == 0
    assert session.query(PerfSignalEvaluationRow).count() == 1


def test_job_runner_records_a_failure_instead_of_hiding_it(session):
    series = {"AAPL": [(MONDAY, 100.0), (TUESDAY, 100.0), (WEDNESDAY, 110.0)]}
    lab = _lab(session, series)
    outcome = _record(lab)

    session.delete(outcome.signal)
    session.flush()

    counts = lab.evaluator().run_due_jobs(now=_moment(THURSDAY))

    assert counts["failed"] == 1
    job = session.query(PerfEvaluationJobRow).one()
    assert job.status == "failed"
    assert job.last_error


# --------------------------------------------------------------------------
# Evidence vault
# --------------------------------------------------------------------------


def test_live_verified_cannot_be_claimed(session):
    vault = EvidenceVault(session)
    with pytest.raises(ValueError, match="independently reconcilable"):
        vault.create(
            kind="live_verified",
            title="Live run",
            objective="Prove live performance",
            dataset={},
            assumptions={},
            results={},
            limitations=[],
        )


def test_evidence_integrity_hash_detects_tampering(session):
    vault = EvidenceVault(session)
    row = vault.create(
        kind="backtest",
        title="Trend study",
        objective="Measure the trend rule",
        dataset={"symbol": "AAPL"},
        assumptions={"costBps": 10},
        results={"netReturn": 0.04},
        limitations=["Single symbol."],
    )

    assert vault.verify(row.run_id) is True
    row.results = {"netReturn": 0.40}
    session.flush()
    assert vault.verify(row.run_id) is False


def test_evidence_finalises_once(session):
    vault = EvidenceVault(session)
    row = vault.create(
        kind="forward_paper",
        title="Forward run",
        objective="Observe forward behaviour",
        dataset={},
        assumptions={},
        results={},
        limitations=[],
    )

    vault.finalize(row.run_id, conclusion="Inconclusive at this sample size.")
    with pytest.raises(ValueError, match="already finalised"):
        vault.finalize(row.run_id, conclusion="A better story.")


# --------------------------------------------------------------------------
# Overview
# --------------------------------------------------------------------------


def test_empty_overview_reports_absence_not_zero(session):
    lab = _lab(session, {})
    overview = lab.overview()

    assert overview["signals"]["total"] == 0
    assert overview["metrics"]["winRate"]["value"] is None
    assert overview["metrics"]["winRate"]["status"] == "insufficient_data"
    assert overview["metrics"]["startingCapital"]["status"] == "not_implemented"
    assert overview["paperTrading"]["status"] == "not_implemented"
    assert overview["equity"]["signal"] == []


def test_overview_reports_a_losing_strategy_as_losing(session):
    series = {
        "AAPL": [(MONDAY, 100.0), (TUESDAY, 100.0), (WEDNESDAY, 90.0)],
        "SPY": [(MONDAY, 100.0), (TUESDAY, 100.0), (WEDNESDAY, 100.0)],
    }
    lab = _lab(session, series)
    _record(lab)
    lab.evaluator().run_due_jobs(now=_moment(THURSDAY))

    overview = lab.overview()

    assert overview["metrics"]["winRate"]["value"] == 0.0
    assert overview["metrics"]["averageReturnPerTrade"]["value"] < 0
    assert overview["metrics"]["totalReturn"]["value"] < 0
    assert overview["metrics"]["excessReturn"]["value"] < 0


def test_overview_compounds_rather_than_sums(session):
    """Two +10% trades compound to 21%, not 20%."""
    series = {
        "AAPL": [
            (MONDAY, 100.0),
            (TUESDAY, 100.0),
            (WEDNESDAY, 110.0),
            (THURSDAY, 110.0),
            (FRIDAY, 121.0),
        ]
    }
    lab = _lab(session, series, cost_bps="0")
    _record(lab, observed=_moment(MONDAY))
    _record(lab, observed=_moment(WEDNESDAY))
    lab.evaluator().run_due_jobs(now=_moment(FRIDAY) + timedelta(days=1))

    overview = lab.overview()

    assert overview["metrics"]["totalReturn"]["value"] == pytest.approx(0.21)


def test_overview_counts_comparisons_for_multiple_testing(session):
    series = {"AAPL": [(MONDAY, 100.0), (TUESDAY, 100.0), (WEDNESDAY, 110.0)]}
    lab = _lab(session, series)
    _record(lab, horizons=("1d", "5d"))
    lab.evaluator().run_due_jobs(now=_moment(THURSDAY))

    overview = lab.overview()

    assert overview["multipleTesting"]["comparisons"] >= 1
    assert overview["multipleTesting"]["bonferroniAlpha"] is not None
    assert "proven edge" in overview["multipleTesting"]["note"]


# --------------------------------------------------------------------------
# Authorization
# --------------------------------------------------------------------------


def test_performance_routes_reject_a_non_admin(client):
    key, _user, _secret = make_api_key("viewer")
    response = client.get(
        "/v1/performance/overview", headers={"authorization": f"Bearer {key}"}
    )
    assert response.status_code == 403


def test_performance_overview_is_available_to_an_admin(client):
    key, _user, _secret = make_api_key("admin")
    response = client.get(
        "/v1/performance/overview", headers={"authorization": f"Bearer {key}"}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["provenance"] == "live"
    assert body["data"]["paperTrading"]["status"] == "not_implemented"
