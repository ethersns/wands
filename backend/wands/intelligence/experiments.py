"""Research experiment tracking and fusion evaluation.

An experiment is a claim about the past, and a claim is only worth something if
it can be checked. So every run records what determined its answer — the signal
version, the data version, the period, the information cutoff, the parameters,
the benchmark, and the execution and cost assumptions — and hashes all of it.

Two consequences follow.

*Re-running the same definition returns the same experiment.* The hash is the
identity. A second run does not create a second row, and it does not overwrite
the first result either: it reports whether the data still produces the same
answer. A definition that quietly changed its own inputs would be worse than no
tracking at all.

*The fusion weights are not fitted here.* The composite is measured, its
components are measured separately, and the correlation between them is
reported. Nothing in this module writes to ``WEIGHTS``. Optimising seven weights
against one historical sample produces a number that describes that sample and
nothing else.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Sequence

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from wands.config import Settings
from wands.db.models import (
    IntelExperimentRow,
    IntelSignalOutcomeRow,
    IntelSignalRow,
    MarketCandleRow,
)
from wands.intelligence import quant
from wands.intelligence.base import SignalCategory
from wands.intelligence.fusion import WEIGHTS, SignalFusion
from wands.intelligence.validation import (
    RESULT_COMPLETE,
    SignalObservation,
    SignalValidator,
    ValidationResult,
)
from wands.logging import get_logger

logger = get_logger(__name__)

# The categories the validation engine knows how to measure. Market trend and
# volume anomaly are price-derived and are evaluated by the fusion comparison
# rather than as disclosure events.
DISCLOSURE_CATEGORIES: tuple[str, ...] = (
    SignalCategory.INSIDER_PURCHASE_CLUSTER.value,
    SignalCategory.INSIDER_PURCHASE_VALUE.value,
    SignalCategory.INSIDER_ACTIVITY_CHANGE.value,
    SignalCategory.INSIDER_SELLING_CLUSTER.value,
    SignalCategory.INSTITUTIONAL_POSITION_CHANGE.value,
)

FUSION_WEIGHT_CAVEAT = (
    "Fusion weights are an editorial choice and were not fitted to this sample. "
    "No weight was changed as a result of this evaluation."
)


def _canonical(payload: Any) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)


def _hash(payload: Any) -> str:
    return hashlib.sha256(_canonical(payload).encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class ExperimentDefinition:
    """Everything that determines an experiment's answer."""

    name: str
    period_start: datetime
    period_end: datetime
    information_cutoff: datetime
    signal_version: str = "1.0"
    data_version: str = ""
    benchmark: str = "SPY"
    categories: tuple[str, ...] = DISCLOSURE_CATEGORIES
    horizons: tuple[int, ...] = (1, 5, 10, 20, 60)
    parameters: dict[str, Any] = field(default_factory=dict)
    execution_assumptions: dict[str, Any] = field(default_factory=dict)
    cost_assumptions: dict[str, Any] = field(default_factory=dict)

    def identity(self) -> dict[str, Any]:
        """The part of the definition that determines the result.

        ``name`` is excluded on purpose: renaming an experiment must not create
        a second, apparently different, experiment.
        """
        return {
            "signalVersion": self.signal_version,
            "dataVersion": self.data_version,
            "periodStart": _iso(self.period_start),
            "periodEnd": _iso(self.period_end),
            "informationCutoff": _iso(self.information_cutoff),
            "benchmark": self.benchmark.upper(),
            "categories": sorted(self.categories),
            "horizons": sorted(self.horizons),
            "parameters": self.parameters,
            "executionAssumptions": self.execution_assumptions,
            "costAssumptions": self.cost_assumptions,
        }

    def definition_hash(self) -> str:
        return _hash(self.identity())

    def as_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "definitionHash": self.definition_hash(),
            **self.identity(),
        }


@dataclass
class ExperimentOutcome:
    """The result of a run, plus whether it reproduced."""

    experiment: IntelExperimentRow
    validation: ValidationResult | None
    reproduction: str
    note: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {
            "experiment": experiment_payload(self.experiment),
            "reproduction": self.reproduction,
            "note": self.note,
            "validation": self.validation.as_dict() if self.validation else None,
        }


class ExperimentRunner:
    """Creates, runs and reproduces research experiments."""

    def __init__(
        self,
        session: Session,
        settings: Settings,
        *,
        validator: SignalValidator | None = None,
    ) -> None:
        self.session = session
        self.settings = settings
        self.validator = validator or SignalValidator(session, settings)

    # -- reading -----------------------------------------------------------

    def load_signals(
        self,
        definition: ExperimentDefinition,
    ) -> list[SignalObservation]:
        """Signals that were public inside the window and before the cutoff.

        The cutoff is applied to ``public_available_at``, never to
        ``event_time``. A signal whose underlying transaction happened inside
        the window but was published after the cutoff was not knowable, so it is
        not in the sample.
        """
        statement = (
            select(IntelSignalRow)
            .where(
                IntelSignalRow.public_available_at >= definition.period_start,
                IntelSignalRow.public_available_at <= definition.period_end,
                IntelSignalRow.public_available_at <= definition.information_cutoff,
            )
            .order_by(IntelSignalRow.public_available_at)
        )
        if definition.categories:
            statement = statement.where(
                IntelSignalRow.category.in_(list(definition.categories))
            )
        rows = self.session.scalars(statement).all()
        return [
            SignalObservation(
                signal_id=str(row.id),
                category=row.category,
                symbol=row.symbol,
                public_available_at=row.public_available_at,
                score=float(row.score) if row.score is not None else None,
            )
            for row in rows
        ]

    def data_fingerprint(self, observations: Sequence[SignalObservation]) -> str:
        """A hash of the rows actually read.

        Two runs with the same definition but different data are not the same
        experiment, and this is what makes that visible.
        """
        return _hash(
            {
                "signals": [
                    [observation.signal_id, observation.symbol, _iso(observation.public_available_at)]
                    for observation in observations
                ],
                "candles": self._candle_fingerprint(),
            }
        )

    def _candle_fingerprint(self) -> dict[str, Any]:
        count = self.session.scalar(select(func.count()).select_from(MarketCandleRow)) or 0
        latest = self.session.scalar(select(func.max(MarketCandleRow.open_time)))
        return {"count": int(count), "latest": _iso(latest) if latest else None}

    # -- writing -----------------------------------------------------------

    def run(
        self, definition: ExperimentDefinition, *, persist: bool = True
    ) -> ExperimentOutcome:
        existing = self.session.scalar(
            select(IntelExperimentRow).where(
                IntelExperimentRow.definition_hash == definition.definition_hash()
            )
        )
        observations = self.load_signals(definition)
        fingerprint = self.data_fingerprint(observations)

        if existing is not None:
            # Same definition, so the stored result stands. Report whether the
            # data still agrees rather than overwriting a published number.
            if existing.data_fingerprint == fingerprint:
                return ExperimentOutcome(
                    experiment=existing,
                    validation=None,
                    reproduction="identical",
                    note=(
                        "This definition has already been run against the same data. "
                        "The stored result is returned unchanged."
                    ),
                )
            return ExperimentOutcome(
                experiment=existing,
                validation=None,
                reproduction="data_changed",
                note=(
                    "This definition has already been run, but the underlying data has "
                    "changed since. The stored result is preserved; re-run under a new "
                    "data version to measure the difference."
                ),
            )

        validation = self.validator.evaluate(
            observations,
            category=",".join(definition.categories),
            horizons=list(definition.horizons),
            benchmark=definition.benchmark,
            cost_bps=float(self.settings.validation_cost_bps),
        )

        row = IntelExperimentRow(
            name=definition.name,
            signal_version=definition.signal_version,
            data_version=definition.data_version or fingerprint[:16],
            period_start=definition.period_start,
            period_end=definition.period_end,
            information_cutoff=definition.information_cutoff,
            benchmark=definition.benchmark.upper(),
            parameters=dict(definition.parameters),
            execution_assumptions=dict(definition.execution_assumptions),
            cost_assumptions=dict(definition.cost_assumptions),
            sample_size=validation.sample_size,
            coverage=validation.coverage,
            metrics=_metrics_payload(validation),
            status=validation.status,
            flags=list(validation.flags),
            definition_hash=definition.definition_hash(),
            data_fingerprint=fingerprint,
            created_at=datetime.now(tz=UTC),
            completed_at=datetime.now(tz=UTC),
        )

        if persist:
            self.session.add(row)
            self.session.flush()
            self._persist_outcomes(row, validation)
            self.session.flush()

        logger.info(
            "research experiment recorded",
            extra={
                "event": "intelligence.experiment",
                "context": {
                    "definitionHash": row.definition_hash,
                    "status": row.status,
                    "sampleSize": row.sample_size,
                },
            },
        )
        return ExperimentOutcome(
            experiment=row,
            validation=validation,
            reproduction="new",
            note="A new experiment was recorded for this definition.",
        )

    def _persist_outcomes(
        self, experiment: IntelExperimentRow, validation: ValidationResult
    ) -> None:
        """Store one row per signal per horizon.

        Per-observation rows rather than only aggregates, so a result can be
        audited trade by trade and a missing price stays visible.
        """
        for horizon in validation.horizons:
            for trade in horizon.trades:
                signal_id = _as_uuid(trade.signal_id)
                if signal_id is None:
                    # A signal that is not a stored row cannot be linked to one.
                    continue
                self.session.add(
                    IntelSignalOutcomeRow(
                        experiment_id=experiment.id,
                        signal_id=signal_id,
                        symbol=trade.symbol,
                        horizon_days=trade.horizon_days,
                        entry_at=trade.entry_at,
                        entry_price=_decimal(trade.entry_price),
                        exit_at=trade.exit_at,
                        exit_price=_decimal(trade.exit_price),
                        gross_return=_decimal(trade.gross_return),
                        benchmark_return=_decimal(trade.benchmark_return),
                        net_return=_decimal(trade.net_return),
                        cost_bps=_decimal(trade.cost_bps) or 0,
                        status=trade.status,
                        notes=trade.notes,
                    )
                )

    # -- queries -----------------------------------------------------------

    def get(self, experiment_id: str) -> IntelExperimentRow | None:
        return self.session.scalar(
            select(IntelExperimentRow).where(IntelExperimentRow.id == experiment_id)
        )

    def list(self, *, limit: int = 50) -> list[IntelExperimentRow]:
        return list(
            self.session.scalars(
                select(IntelExperimentRow)
                .order_by(IntelExperimentRow.created_at.desc())
                .limit(limit)
            ).all()
        )

    def outcomes(self, experiment_id: str) -> list[IntelSignalOutcomeRow]:
        return list(
            self.session.scalars(
                select(IntelSignalOutcomeRow)
                .where(IntelSignalOutcomeRow.experiment_id == experiment_id)
                .order_by(
                    IntelSignalOutcomeRow.horizon_days, IntelSignalOutcomeRow.symbol
                )
            ).all()
        )


class FusionEvaluator:
    """Measures the composite score against its own components.

    The question is not "is the composite good" but "does the composite add
    anything the components do not already say". That is answered by measuring
    each component alone, the composite together, and the correlation between
    them.
    """

    def __init__(
        self,
        session: Session,
        settings: Settings,
        *,
        validator: SignalValidator | None = None,
    ) -> None:
        self.session = session
        self.settings = settings
        self.validator = validator or SignalValidator(session, settings)
        self.runner = ExperimentRunner(session, settings, validator=self.validator)

    def evaluate(self, definition: ExperimentDefinition) -> dict[str, Any]:
        observations = self.runner.load_signals(definition)
        if not observations:
            return {
                "status": "insufficient_data",
                "sampleSize": 0,
                "components": [],
                "composite": None,
                "redundancy": {},
                "flags": [
                    "No signals were public inside this window, so the composite could "
                    "not be measured."
                ],
                "caveats": [FUSION_WEIGHT_CAVEAT],
            }

        components: list[dict[str, Any]] = []
        component_returns: dict[str, list[float]] = {}
        for category in definition.categories:
            subset = [item for item in observations if item.category == category]
            if not subset:
                components.append(
                    {
                        "category": category,
                        "weight": float(WEIGHTS.get(category, 0)),
                        "sampleSize": 0,
                        "status": "no_observations",
                        "note": "No signal of this category was public in the window.",
                    }
                )
                continue
            result = self.validator.evaluate(
                subset,
                category=category,
                horizons=list(definition.horizons),
                benchmark=definition.benchmark,
            )
            components.append(
                {
                    "category": category,
                    "weight": float(WEIGHTS.get(category, 0)),
                    "sampleSize": result.sample_size,
                    "status": result.status,
                    "horizons": [horizon.as_dict() for horizon in result.horizons],
                    "coverage": result.coverage,
                }
            )
            longest = max(result.horizons, key=lambda item: item.horizon_days, default=None)
            if longest is not None:
                component_returns[category] = longest.excess_returns

        composite = self.validator.evaluate(
            observations,
            category="COMPOSITE",
            horizons=list(definition.horizons),
            benchmark=definition.benchmark,
        )

        return {
            "status": composite.status,
            "sampleSize": composite.sample_size,
            "components": components,
            "composite": composite.as_dict(),
            "scoreOrdering": self._score_ordering(observations, definition),
            "redundancy": self._redundancy(observations, definition),
            "coverage": composite.coverage,
            "flags": list(composite.flags),
            "caveats": [
                FUSION_WEIGHT_CAVEAT,
                (
                    "A component that looks strong alone and adds nothing to the composite "
                    "is redundant, not additive. The correlation table is the evidence for "
                    "that judgement."
                ),
            ],
        }

    def _score_ordering(
        self, observations: Sequence[SignalObservation], definition: ExperimentDefinition
    ) -> dict[str, Any]:
        """Do higher scores precede better outcomes?

        Signals are split into score terciles and each tercile is measured. A
        composite that does not order outcomes is not a ranking, whatever its
        mean return.
        """
        scored = [item for item in observations if item.score is not None]
        if len(scored) < 9:
            return {
                "status": "insufficient_data",
                "note": "At least nine scored signals are needed for terciles.",
            }
        ordered = sorted(scored, key=lambda item: item.score or 0.0)
        size = len(ordered) // 3
        buckets = {
            "low": ordered[:size],
            "mid": ordered[size : size * 2],
            "high": ordered[size * 2 :],
        }
        horizon = max(definition.horizons)
        payload: dict[str, Any] = {"horizonDays": horizon, "buckets": {}}
        for label, group in buckets.items():
            result = self.validator.evaluate(
                group,
                category=f"SCORE_{label.upper()}",
                horizons=[horizon],
                benchmark=definition.benchmark,
            )
            evaluation = result.horizons[0] if result.horizons else None
            payload["buckets"][label] = {
                "sampleSize": result.sample_size,
                "meanExcess": (
                    evaluation.excess_stats.mean
                    if evaluation and evaluation.excess_stats
                    else None
                ),
                "hitRate": (
                    evaluation.excess_stats.hit_rate
                    if evaluation and evaluation.excess_stats
                    else None
                ),
            }
        means = [
            bucket["meanExcess"]
            for bucket in payload["buckets"].values()
            if bucket["meanExcess"] is not None
        ]
        payload["monotonic"] = len(means) == 3 and means[0] < means[1] < means[2]
        payload["note"] = (
            "Terciles are ordered by the stored composite score. A monotonic increase "
            "from low to high is the minimum evidence that the score ranks outcomes."
        )
        return payload

    def _redundancy(
        self, observations: Sequence[SignalObservation], definition: ExperimentDefinition
    ) -> dict[str, Any]:
        """Pairwise correlation of component scores on shared symbols.

        Two components that always fire together are one component with two
        names, and the composite double-counts them.
        """
        by_symbol: dict[str, dict[str, float]] = {}
        for observation in observations:
            if observation.score is None:
                continue
            by_symbol.setdefault(observation.symbol, {})[observation.category] = observation.score

        categories = [category for category in definition.categories]
        matrix: dict[str, dict[str, float | None]] = {}
        for left in categories:
            row: dict[str, float | None] = {}
            for right in categories:
                if left == right:
                    row[right] = 1.0
                    continue
                pairs = [
                    (scores[left], scores[right])
                    for scores in by_symbol.values()
                    if left in scores and right in scores
                ]
                if len(pairs) < 3:
                    row[right] = None
                    continue
                row[right] = quant.correlation(
                    [pair[0] for pair in pairs], [pair[1] for pair in pairs]
                )
            matrix[left] = row

        high = [
            {"left": left, "right": right, "correlation": value}
            for left, row in matrix.items()
            for right, value in row.items()
            if left < right and value is not None and abs(value) >= 0.7
        ]
        return {
            "correlations": matrix,
            "highlyCorrelated": high,
            "note": (
                "Correlations are computed on symbols where both components are present. "
                "A pair above 0.7 in absolute value is reported as redundant."
            ),
        }


def _metrics_payload(validation: ValidationResult) -> dict[str, Any]:
    return {
        "horizons": [horizon.as_dict() for horizon in validation.horizons],
        "splits": [split.as_dict() for split in validation.splits],
        "overlap": validation.overlap,
        "multipleTesting": (
            validation.multiple_testing.as_dict() if validation.multiple_testing else None
        ),
        "benchmark": validation.benchmark,
        "costBps": validation.cost_bps,
    }


def experiment_payload(row: IntelExperimentRow) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "name": row.name,
        "signalVersion": row.signal_version,
        "dataVersion": row.data_version,
        "periodStart": _iso(row.period_start),
        "periodEnd": _iso(row.period_end),
        "informationCutoff": _iso(row.information_cutoff),
        "benchmark": row.benchmark,
        "parameters": row.parameters,
        "executionAssumptions": row.execution_assumptions,
        "costAssumptions": row.cost_assumptions,
        "sampleSize": row.sample_size,
        "coverage": row.coverage,
        "metrics": row.metrics,
        "status": row.status,
        "flags": row.flags,
        "definitionHash": row.definition_hash,
        "dataFingerprint": row.data_fingerprint,
        "createdAt": _iso(row.created_at),
        "completedAt": _iso(row.completed_at),
    }


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(UTC).isoformat()


def _decimal(value: float | None):
    from decimal import Decimal

    if value is None:
        return None
    return Decimal(str(round(value, 10)))


def _as_uuid(value: Any):
    import uuid as uuid_module

    if isinstance(value, uuid_module.UUID):
        return value
    try:
        return uuid_module.UUID(str(value))
    except (ValueError, AttributeError, TypeError):
        return None


__all__ = [
    "DISCLOSURE_CATEGORIES",
    "ExperimentDefinition",
    "ExperimentOutcome",
    "ExperimentRunner",
    "FUSION_WEIGHT_CAVEAT",
    "FusionEvaluator",
    "experiment_payload",
]
