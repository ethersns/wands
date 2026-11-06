"""Experiment tracking and fusion evaluation.

The reproducibility tests are the point. An experiment that silently changes its
own inputs is worse than no tracking, so a re-run either reproduces the stored
result or says that the data moved.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import func, select

from wands.config import get_settings
from wands.db.models import IntelExperimentRow, IntelSignalOutcomeRow, IntelSignalRow
from wands.intelligence.base import SignalCategory
from wands.intelligence.experiments import (
    DISCLOSURE_CATEGORIES,
    ExperimentDefinition,
    ExperimentRunner,
    FusionEvaluator,
)
from wands.intelligence.fusion import WEIGHTS
from wands.intelligence.validation import SignalValidator

from .intelligence_fakes import FakePriceProvider, daily_series

MONDAY = datetime(2024, 3, 4, 9, 30, tzinfo=UTC)
START = datetime(2024, 3, 1, tzinfo=UTC)
END = datetime(2024, 12, 31, tzinfo=UTC)
CUTOFF = datetime(2025, 1, 1, tzinfo=UTC)


def _signal(
    session,
    *,
    index: int,
    symbol: str = "AAPL",
    category: str = SignalCategory.INSIDER_PURCHASE_CLUSTER.value,
    score: str = "70",
    available: datetime | None = None,
) -> IntelSignalRow:
    moment = available or (datetime(2024, 3, 4, 18, 0, tzinfo=UTC) + timedelta(days=index * 2))
    row = IntelSignalRow(
        signal_key=f"key-{category}-{symbol}-{index}",
        category=category,
        symbol=symbol,
        source_event_ids=[f"event-{index}"],
        event_time=moment - timedelta(days=1),
        public_available_at=moment,
        raw_measurement=Decimal("3"),
        raw_unit="count",
        score=Decimal(score),
        explanation="fixture",
        data_quality="derived",
        confidence_notes="",
        parameters={},
        engine_version="1.0",
    )
    session.add(row)
    return row


def _seed(session, *, count: int = 12, category: str | None = None) -> None:
    for index in range(count):
        _signal(
            session,
            index=index,
            category=category or SignalCategory.INSIDER_PURCHASE_CLUSTER.value,
        )
    session.flush()


def _provider(sessions: int = 400) -> FakePriceProvider:
    return FakePriceProvider(
        series={
            "AAPL": daily_series("AAPL", MONDAY, sessions, daily_return=0.002),
            "SPY": daily_series("SPY", MONDAY, sessions, start_price=500.0, daily_return=0.001),
        }
    )


def _definition(**overrides) -> ExperimentDefinition:
    base = {
        "name": "insider_purchase_cluster",
        "period_start": START,
        "period_end": END,
        "information_cutoff": CUTOFF,
        "benchmark": "SPY",
        "categories": (SignalCategory.INSIDER_PURCHASE_CLUSTER.value,),
        "horizons": (1, 5),
    }
    base.update(overrides)
    return ExperimentDefinition(**base)


def _runner(session) -> ExperimentRunner:
    settings = get_settings()
    return ExperimentRunner(
        session, settings, validator=SignalValidator(session, settings, prices=_provider())
    )


def test_the_definition_hash_ignores_the_name():
    left = _definition(name="one")
    right = _definition(name="two")
    assert left.definition_hash() == right.definition_hash()


def test_the_definition_hash_changes_with_the_period():
    left = _definition()
    right = _definition(period_end=datetime(2025, 6, 1, tzinfo=UTC))
    assert left.definition_hash() != right.definition_hash()


def test_the_definition_hash_changes_with_the_cost_assumptions():
    left = _definition()
    right = _definition(cost_assumptions={"totalBps": 25})
    assert left.definition_hash() != right.definition_hash()


def test_an_experiment_records_everything_needed_to_reproduce_it(session):
    _seed(session)
    outcome = _runner(session).run(_definition())

    row = outcome.experiment
    assert row.definition_hash
    assert row.data_fingerprint
    assert row.period_start == START
    assert row.information_cutoff == CUTOFF
    assert row.benchmark == "SPY"
    assert row.sample_size == 12
    assert row.metrics["horizons"]
    assert row.status in {"complete", "insufficient_data"}


def test_outcomes_are_stored_per_signal_and_horizon(session):
    _seed(session, count=4)
    outcome = _runner(session).run(_definition(horizons=(1, 5)))

    rows = session.scalars(select(IntelSignalOutcomeRow)).all()
    # Four signals, two horizons.
    assert len(rows) == 8
    assert {row.horizon_days for row in rows} == {1, 5}
    assert all(row.experiment_id == outcome.experiment.id for row in rows)


def test_rerunning_the_same_definition_reproduces_rather_than_duplicating(session):
    _seed(session)
    first = _runner(session).run(_definition())
    second = _runner(session).run(_definition())

    assert second.reproduction == "identical"
    assert second.experiment.id == first.experiment.id
    assert session.scalar(select(func.count()).select_from(IntelExperimentRow)) == 1


def test_a_changed_dataset_is_reported_as_data_changed(session):
    _seed(session, count=6)
    first = _runner(session).run(_definition())

    # A new signal arrives after the first run.
    _signal(session, index=99)
    session.flush()

    second = _runner(session).run(_definition())

    assert second.reproduction == "data_changed"
    # The published result is preserved, not overwritten.
    assert second.experiment.id == first.experiment.id
    assert second.experiment.sample_size == 6
    assert "preserved" in second.note


def test_signals_published_after_the_cutoff_are_excluded(session):
    _seed(session, count=3)
    _signal(session, index=50, available=datetime(2025, 6, 1, tzinfo=UTC))
    session.flush()

    outcome = _runner(session).run(_definition())
    assert outcome.experiment.sample_size == 3


def test_an_experiment_with_no_price_data_reports_no_statistic(session):
    _seed(session)
    settings = get_settings()
    runner = ExperimentRunner(
        session,
        settings,
        validator=SignalValidator(session, settings, prices=FakePriceProvider()),
    )

    outcome = runner.run(_definition())

    assert outcome.experiment.status == "no_price_data"
    assert any("No historical price data" in flag for flag in outcome.experiment.flags)
    # Nothing was invented to fill the gap.
    assert outcome.experiment.metrics["horizons"][0]["descriptive"]["count"] == 0


def test_the_experiment_list_is_newest_first(session):
    _seed(session)
    runner = _runner(session)
    runner.run(_definition(name="first"))
    runner.run(_definition(name="second", period_end=datetime(2025, 2, 1, tzinfo=UTC)))

    rows = runner.list()
    assert len(rows) == 2


def test_fusion_evaluation_measures_components_and_the_composite(session):
    _seed(session, count=6, category=SignalCategory.INSIDER_PURCHASE_CLUSTER.value)
    _seed(session, count=6, category=SignalCategory.INSIDER_PURCHASE_VALUE.value)

    evaluator = FusionEvaluator(
        session, get_settings(), validator=SignalValidator(session, get_settings(), prices=_provider())
    )
    result = evaluator.evaluate(
        _definition(
            categories=(
                SignalCategory.INSIDER_PURCHASE_CLUSTER.value,
                SignalCategory.INSIDER_PURCHASE_VALUE.value,
            )
        )
    )

    assert result["sampleSize"] == 12
    assert len(result["components"]) == 2
    assert result["composite"] is not None
    assert "redundancy" in result
    assert any("not fitted" in caveat for caveat in result["caveats"])


def test_fusion_evaluation_never_changes_the_weights(session):
    before = dict(WEIGHTS)
    _seed(session, count=6)
    FusionEvaluator(
        session, get_settings(), validator=SignalValidator(session, get_settings(), prices=_provider())
    ).evaluate(_definition())

    assert dict(WEIGHTS) == before


def test_fusion_evaluation_reports_a_missing_component_rather_than_skipping_it(session):
    _seed(session, count=6, category=SignalCategory.INSIDER_PURCHASE_CLUSTER.value)

    result = FusionEvaluator(
        session, get_settings(), validator=SignalValidator(session, get_settings(), prices=_provider())
    ).evaluate(
        _definition(
            categories=(
                SignalCategory.INSIDER_PURCHASE_CLUSTER.value,
                SignalCategory.INSIDER_SELLING_CLUSTER.value,
            )
        )
    )

    missing = [item for item in result["components"] if item["status"] == "no_observations"]
    assert len(missing) == 1
    assert missing[0]["category"] == SignalCategory.INSIDER_SELLING_CLUSTER.value


def test_fusion_evaluation_with_no_signals_is_explicit(session):
    result = FusionEvaluator(session, get_settings()).evaluate(_definition())
    assert result["status"] == "insufficient_data"
    assert result["sampleSize"] == 0
    assert result["flags"]


def test_the_default_categories_are_the_disclosure_ones():
    assert SignalCategory.INSIDER_PURCHASE_CLUSTER.value in DISCLOSURE_CATEGORIES
    assert SignalCategory.MARKET_TREND.value not in DISCLOSURE_CATEGORIES
