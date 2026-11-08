"""Immutable signal capture.

A signal is written once, at generation time, with the data it was generated
from. Nothing in this module updates a stored signal: a correction is a new audit
event, and a re-evaluation is a new evaluation row. The content hash lets a later
reader tell whether a row still says what it said when it was written.

The dedupe key is derived from the signal's own identity rather than a random
UUID, so a retried write is idempotent. A retry that carries *different* content
under the same key is a conflict and raises, because silently keeping either
version would make the record untrustworthy.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from wands.db.models import (
    PerfAuditEventRow,
    PerfEvaluationJobRow,
    PerfRecordedSignalRow,
    PerfStrategyVersionRow,
    utcnow,
)
from wands.performance.hashing import content_hash
from wands.performance.horizons import Horizon, resolve_horizons

DIRECTIONS = ("BUY", "SELL", "HOLD")


def _aware(moment: datetime) -> datetime:
    return moment if moment.tzinfo else moment.replace(tzinfo=UTC)


@dataclass(frozen=True)
class SignalInput:
    """Everything a signal claimed at the moment it was generated."""

    strategy_key: str
    strategy_name: str
    signal_version: str
    parameters: dict[str, Any]
    symbol: str
    direction: str
    generated_at: datetime
    observed_at: datetime
    reference_price: Decimal | None = None
    reference_price_at: datetime | None = None
    timeframe: str = "1d"
    asset_class: str = "equity"
    confidence: Decimal | None = None
    data_source: str = ""
    data_freshness_seconds: int | None = None
    conditions: dict[str, Any] = field(default_factory=dict)
    risk_parameters: dict[str, Any] = field(default_factory=dict)
    payload: dict[str, Any] = field(default_factory=dict)
    model_metadata: dict[str, Any] = field(default_factory=dict)
    horizons: Sequence[str] = ()


@dataclass(frozen=True)
class RecordOutcome:
    signal: PerfRecordedSignalRow
    created: bool
    queued: int


def signal_content_payload(
    *,
    signal_key: str,
    strategy_version_id: Any,
    symbol: str,
    asset_class: str,
    direction: str,
    timeframe: str,
    generated_at: datetime,
    observed_at: datetime,
    reference_price: Decimal | None,
    reference_price_at: datetime | None,
    confidence: Decimal | None,
    data_source: str,
    data_freshness_seconds: int | None,
    conditions: dict[str, Any],
    risk_parameters: dict[str, Any],
    payload: dict[str, Any],
    model_metadata: dict[str, Any],
) -> dict[str, Any]:
    """The immutable part of a signal, in the shape that gets hashed."""
    return {
        "signalKey": signal_key,
        "strategyVersionId": strategy_version_id,
        "symbol": symbol,
        "assetClass": asset_class,
        "direction": direction,
        "timeframe": timeframe,
        "generatedAt": generated_at,
        "observedAt": observed_at,
        "referencePrice": reference_price,
        "referencePriceAt": reference_price_at,
        "confidence": confidence,
        "dataSource": data_source,
        "dataFreshnessSeconds": data_freshness_seconds,
        "conditions": conditions,
        "riskParameters": risk_parameters,
        "payload": payload,
        "modelMetadata": model_metadata,
    }


class SignalRecorder:
    """Writes signals and the strategy versions they belong to."""

    def __init__(self, session: Session, *, actor: str = "system") -> None:
        self.session = session
        self.actor = actor

    # -- strategy versions -------------------------------------------------

    def ensure_strategy_version(
        self,
        *,
        strategy_key: str,
        name: str,
        signal_version: str,
        parameters: dict[str, Any],
    ) -> PerfStrategyVersionRow:
        """Return the version for this exact definition, creating it if new.

        The same definition resolves to the same row, so a retry does not mint a
        version. A changed definition mints the next version, which is what makes
        "what changed between two versions" answerable later.
        """
        key = strategy_key.strip()
        if not key:
            raise ValueError("A strategy key is required.")

        definition_hash = content_hash(
            {
                "strategyKey": key,
                "name": name,
                "signalVersion": signal_version,
                "parameters": parameters,
            }
        )

        existing = self.session.scalars(
            select(PerfStrategyVersionRow).where(
                PerfStrategyVersionRow.strategy_key == key,
                PerfStrategyVersionRow.definition_hash == definition_hash,
            )
        ).first()
        if existing is not None:
            return existing

        latest = self.session.scalars(
            select(PerfStrategyVersionRow)
            .where(PerfStrategyVersionRow.strategy_key == key)
            .order_by(PerfStrategyVersionRow.version.desc())
        ).first()
        version = (latest.version + 1) if latest is not None else 1

        row = PerfStrategyVersionRow(
            strategy_key=key,
            version=version,
            name=name,
            signal_version=signal_version,
            parameters=parameters,
            definition_hash=definition_hash,
            frozen=False,
            created_at=utcnow(),
        )
        self.session.add(row)
        self.session.flush()
        self._audit(
            "strategy_version.created",
            "strategy_version",
            str(row.id),
            {"strategyKey": key, "version": version, "definitionHash": definition_hash},
        )
        return row

    # -- signals -----------------------------------------------------------

    def record(self, signal: SignalInput) -> RecordOutcome:
        direction = signal.direction.strip().upper()
        if direction not in DIRECTIONS:
            raise ValueError(
                f"Direction must be one of {', '.join(DIRECTIONS)}; got {signal.direction!r}."
            )
        symbol = signal.symbol.strip().upper()
        if not symbol:
            raise ValueError("A symbol is required.")

        generated_at = _aware(signal.generated_at)
        observed_at = _aware(signal.observed_at)
        if observed_at > generated_at:
            raise ValueError(
                "The data observation time cannot be later than the signal generation time."
            )

        version = self.ensure_strategy_version(
            strategy_key=signal.strategy_key,
            name=signal.strategy_name,
            signal_version=signal.signal_version,
            parameters=signal.parameters,
        )

        signal_key = (
            f"{version.strategy_key}:v{version.version}:{symbol}:{direction}:"
            f"{generated_at.isoformat()}"
        )

        payload = signal_content_payload(
            signal_key=signal_key,
            strategy_version_id=version.id,
            symbol=symbol,
            asset_class=signal.asset_class,
            direction=direction,
            timeframe=signal.timeframe,
            generated_at=generated_at,
            observed_at=observed_at,
            reference_price=signal.reference_price,
            reference_price_at=signal.reference_price_at,
            confidence=signal.confidence,
            data_source=signal.data_source,
            data_freshness_seconds=signal.data_freshness_seconds,
            conditions=signal.conditions,
            risk_parameters=signal.risk_parameters,
            payload=signal.payload,
            model_metadata=signal.model_metadata,
        )
        digest = content_hash(payload)

        existing = self.session.scalars(
            select(PerfRecordedSignalRow).where(
                PerfRecordedSignalRow.signal_key == signal_key
            )
        ).first()
        if existing is not None:
            if existing.content_hash != digest:
                raise ValueError(
                    "A signal with this key already exists with different content. "
                    "A recorded signal is immutable; record a new signal instead."
                )
            return RecordOutcome(signal=existing, created=False, queued=0)

        row = PerfRecordedSignalRow(
            signal_key=signal_key,
            strategy_version_id=version.id,
            symbol=symbol,
            asset_class=signal.asset_class,
            direction=direction,
            timeframe=signal.timeframe,
            generated_at=generated_at,
            observed_at=observed_at,
            reference_price=signal.reference_price,
            reference_price_at=signal.reference_price_at,
            confidence=signal.confidence,
            data_source=signal.data_source,
            data_freshness_seconds=signal.data_freshness_seconds,
            conditions=signal.conditions,
            risk_parameters=signal.risk_parameters,
            payload=signal.payload,
            model_metadata=signal.model_metadata,
            content_hash=digest,
            created_at=utcnow(),
        )
        self.session.add(row)
        self.session.flush()

        # A version that has produced a recorded signal is frozen: the evidence
        # must always point at the definition that actually ran.
        version.frozen = True

        queued = self._queue_horizons(row, resolve_horizons(signal.horizons))
        self._audit(
            "signal.recorded",
            "recorded_signal",
            str(row.id),
            {
                "signalKey": signal_key,
                "symbol": symbol,
                "direction": direction,
                "generatedAt": generated_at.isoformat(),
                "contentHash": digest,
                "queuedHorizons": queued,
            },
        )
        return RecordOutcome(signal=row, created=True, queued=queued)

    def _queue_horizons(
        self, signal: PerfRecordedSignalRow, horizons: Sequence[Horizon]
    ) -> int:
        queued = 0
        for horizon in horizons:
            due_at = signal.observed_at + timedelta(days=horizon.trading_days)
            exists = self.session.scalars(
                select(PerfEvaluationJobRow).where(
                    PerfEvaluationJobRow.signal_id == signal.id,
                    PerfEvaluationJobRow.horizon_label == horizon.label,
                )
            ).first()
            if exists is not None:
                continue
            self.session.add(
                PerfEvaluationJobRow(
                    signal_id=signal.id,
                    horizon_label=horizon.label,
                    due_at=due_at,
                    status="pending",
                    attempts=0,
                    created_at=utcnow(),
                )
            )
            queued += 1
        self.session.flush()
        return queued

    # -- integrity ---------------------------------------------------------

    def verify(self, row: PerfRecordedSignalRow) -> bool:
        """Whether the stored row still hashes to its recorded digest."""
        payload = signal_content_payload(
            signal_key=row.signal_key,
            strategy_version_id=row.strategy_version_id,
            symbol=row.symbol,
            asset_class=row.asset_class,
            direction=row.direction,
            timeframe=row.timeframe,
            generated_at=row.generated_at,
            observed_at=row.observed_at,
            reference_price=row.reference_price,
            reference_price_at=row.reference_price_at,
            confidence=row.confidence,
            data_source=row.data_source,
            data_freshness_seconds=row.data_freshness_seconds,
            conditions=row.conditions,
            risk_parameters=row.risk_parameters,
            payload=row.payload,
            model_metadata=row.model_metadata,
        )
        return content_hash(payload) == row.content_hash

    def _audit(
        self,
        action: str,
        subject_type: str,
        subject_id: str,
        detail: dict[str, Any],
    ) -> None:
        self.session.add(
            PerfAuditEventRow(
                occurred_at=utcnow(),
                actor=self.actor,
                action=action,
                subject_type=subject_type,
                subject_id=subject_id,
                detail=detail,
            )
        )
