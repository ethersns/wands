"""Deterministic signal evaluation.

Every number here comes from stored bars and arithmetic. No model is consulted,
and no bar is used before the moment it would have been available: the entry bar
is the first session *strictly after* the signal's data observation, so a signal
computed from a close cannot be filled at that same close.

A directionally correct signal and a profitable trade are reported separately.
``direction_correct`` describes the raw price move; ``net_return`` is what an
executable trade would have kept after the configured round-trip cost. A signal
can be right about direction and still lose money.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from wands.db.models import (
    PerfAuditEventRow,
    PerfEvaluationJobRow,
    PerfRecordedSignalRow,
    PerfSignalEvaluationRow,
    utcnow,
)
from wands.intelligence.validation import PricePoint, PriceProvider
from wands.performance.hashing import content_hash
from wands.performance.horizons import Horizon, resolve_horizons

BPS = Decimal(10_000)
LEASE = timedelta(minutes=5)


def _aware(moment: datetime) -> datetime:
    return moment if moment.tzinfo else moment.replace(tzinfo=UTC)


@dataclass(frozen=True)
class HorizonResult:
    horizon_label: str
    horizon_days: int
    status: str
    eligible_at: datetime
    entry_at: datetime | None = None
    entry_price: Decimal | None = None
    exit_at: datetime | None = None
    exit_price: Decimal | None = None
    gross_return: Decimal | None = None
    net_return: Decimal | None = None
    benchmark_return: Decimal | None = None
    excess_return: Decimal | None = None
    direction_correct: bool | None = None
    cost_bps: Decimal = Decimal("0")
    detail: str = ""

    @property
    def final(self) -> bool:
        return self.status != "pending"


@dataclass(frozen=True)
class _Window:
    status: str
    entry: PricePoint | None = None
    exit: PricePoint | None = None
    detail: str = ""


def evaluation_content_payload(
    *,
    signal_id: Any,
    horizon_label: str,
    status: str,
    entry_at: datetime | None,
    entry_price: Decimal | None,
    exit_at: datetime | None,
    exit_price: Decimal | None,
    gross_return: Decimal | None,
    net_return: Decimal | None,
    benchmark_return: Decimal | None,
    excess_return: Decimal | None,
    direction_correct: bool | None,
    cost_bps: Decimal,
) -> dict[str, Any]:
    return {
        "signalId": signal_id,
        "horizonLabel": horizon_label,
        "status": status,
        "entryAt": entry_at,
        "entryPrice": entry_price,
        "exitAt": exit_at,
        "exitPrice": exit_price,
        "grossReturn": gross_return,
        "netReturn": net_return,
        "benchmarkReturn": benchmark_return,
        "excessReturn": excess_return,
        "directionCorrect": direction_correct,
        "costBps": cost_bps,
    }


class SignalEvaluator:
    """Evaluates recorded signals against subsequently observed bars."""

    def __init__(
        self,
        session: Session,
        *,
        price_provider: PriceProvider,
        benchmark_symbol: str = "SPY",
        cost_bps: Decimal = Decimal("10"),
        hold_band: Decimal = Decimal("0.02"),
        actor: str = "system",
    ) -> None:
        self.session = session
        self.provider = price_provider
        self.benchmark_symbol = benchmark_symbol.strip().upper()
        self.cost_bps = Decimal(cost_bps)
        self.hold_band = Decimal(hold_band)
        self.actor = actor

    # -- one horizon -------------------------------------------------------

    def evaluate(
        self,
        signal: PerfRecordedSignalRow,
        horizon: Horizon,
        *,
        now: datetime | None = None,
    ) -> HorizonResult:
        moment = _aware(now or utcnow())
        eligible_at = signal.observed_at + timedelta(days=horizon.trading_days)

        if horizon.intraday:
            return HorizonResult(
                horizon_label=horizon.label,
                horizon_days=horizon.trading_days,
                status="unsupported_horizon",
                eligible_at=eligible_at,
                detail=(
                    "Only daily bars are stored, so an intraday horizon cannot be "
                    "evaluated without intraday data. It is reported as unsupported "
                    "rather than approximated from a daily close."
                ),
            )

        if moment < eligible_at:
            return HorizonResult(
                horizon_label=horizon.label,
                horizon_days=horizon.trading_days,
                status="pending",
                eligible_at=eligible_at,
                detail=f"The horizon elapses at {eligible_at.isoformat()}.",
            )

        window = self._window(
            signal.symbol, signal.observed_at, horizon.trading_days, eligible_at, moment
        )
        if window.status != "ok" or window.entry is None or window.exit is None:
            return HorizonResult(
                horizon_label=horizon.label,
                horizon_days=horizon.trading_days,
                status=window.status,
                eligible_at=eligible_at,
                detail=window.detail,
            )

        entry_price = Decimal(str(window.entry.close))
        exit_price = Decimal(str(window.exit.close))
        if entry_price <= 0:
            return HorizonResult(
                horizon_label=horizon.label,
                horizon_days=horizon.trading_days,
                status="missing_price",
                eligible_at=eligible_at,
                detail=f"{signal.symbol} has a non-positive entry price on {window.entry.at.date()}.",
            )

        price_move = (exit_price - entry_price) / entry_price
        direction = signal.direction.upper()
        sign = {"BUY": Decimal(1), "SELL": Decimal(-1), "HOLD": Decimal(0)}[direction]

        cost = self.cost_bps / BPS
        if direction == "HOLD":
            # A hold is not a trade, so it carries no execution cost and no
            # return. It is scored on directional accuracy only.
            gross = Decimal(0)
            net = Decimal(0)
            correct = abs(price_move) <= self.hold_band
        else:
            gross = price_move * sign
            net = gross - cost
            correct = price_move > 0 if direction == "BUY" else price_move < 0

        benchmark_return = self._benchmark_return(
            signal.observed_at, horizon.trading_days, eligible_at, moment
        )
        excess = (
            net - benchmark_return
            if benchmark_return is not None and direction != "HOLD"
            else None
        )

        detail = (
            f"Entry {window.entry.at.date()} at {entry_price}, exit "
            f"{window.exit.at.date()} at {exit_price}. Round-trip cost "
            f"{self.cost_bps} bps."
        )
        if benchmark_return is None:
            detail += f" The benchmark {self.benchmark_symbol} had no usable bars for this window."

        return HorizonResult(
            horizon_label=horizon.label,
            horizon_days=horizon.trading_days,
            status="ok",
            eligible_at=eligible_at,
            entry_at=window.entry.at,
            entry_price=entry_price,
            exit_at=window.exit.at,
            exit_price=exit_price,
            gross_return=gross,
            net_return=net,
            benchmark_return=benchmark_return,
            excess_return=excess,
            direction_correct=correct,
            cost_bps=self.cost_bps,
            detail=detail,
        )

    def _window(
        self,
        symbol: str,
        observed_at: datetime,
        trading_days: int,
        eligible_at: datetime,
        now: datetime,
    ) -> _Window:
        bars = self.provider.daily(symbol, observed_at, now + timedelta(days=1))
        if not bars:
            return _Window(
                "missing_price",
                detail=f"No stored bars for {symbol} after {observed_at.date()}.",
            )

        entry_index = next(
            (index for index, bar in enumerate(bars) if bar.at.date() > observed_at.date()),
            None,
        )
        if entry_index is None:
            return _Window(
                "missing_price",
                detail=(
                    f"No session for {symbol} after the observation date "
                    f"{observed_at.date()}, so there is no defensible entry price."
                ),
            )

        exit_index = entry_index + trading_days
        if exit_index >= len(bars):
            last = bars[-1].at.date()
            if last < eligible_at.date():
                return _Window(
                    "pending",
                    detail=(
                        f"The horizon elapses on {eligible_at.date()} and stored bars "
                        f"for {symbol} end on {last}."
                    ),
                )
            return _Window(
                "missing_price",
                detail=(
                    f"{symbol} is missing a session inside the evaluation window "
                    f"(needed {trading_days} sessions from {bars[entry_index].at.date()})."
                ),
            )

        return _Window("ok", entry=bars[entry_index], exit=bars[exit_index])

    def _benchmark_return(
        self,
        observed_at: datetime,
        trading_days: int,
        eligible_at: datetime,
        now: datetime,
    ) -> Decimal | None:
        window = self._window(self.benchmark_symbol, observed_at, trading_days, eligible_at, now)
        if window.status != "ok" or window.entry is None or window.exit is None:
            return None
        entry = Decimal(str(window.entry.close))
        exit_price = Decimal(str(window.exit.close))
        if entry <= 0:
            return None
        return (exit_price - entry) / entry

    # -- persistence -------------------------------------------------------

    def persist(
        self, signal: PerfRecordedSignalRow, result: HorizonResult
    ) -> PerfSignalEvaluationRow | None:
        """Store a final evaluation. A pending result is not stored.

        Only final outcomes are written, which keeps the table append-only: a
        row that exists is a row that was decided, and it is never rewritten.
        """
        if not result.final:
            return None

        existing = self.session.scalars(
            select(PerfSignalEvaluationRow).where(
                PerfSignalEvaluationRow.signal_id == signal.id,
                PerfSignalEvaluationRow.horizon_label == result.horizon_label,
            )
        ).first()
        if existing is not None:
            return existing

        payload = evaluation_content_payload(
            signal_id=signal.id,
            horizon_label=result.horizon_label,
            status=result.status,
            entry_at=result.entry_at,
            entry_price=result.entry_price,
            exit_at=result.exit_at,
            exit_price=result.exit_price,
            gross_return=result.gross_return,
            net_return=result.net_return,
            benchmark_return=result.benchmark_return,
            excess_return=result.excess_return,
            direction_correct=result.direction_correct,
            cost_bps=result.cost_bps,
        )

        row = PerfSignalEvaluationRow(
            signal_id=signal.id,
            horizon_label=result.horizon_label,
            horizon_days=result.horizon_days,
            eligible_at=result.eligible_at,
            evaluated_at=utcnow(),
            status=result.status,
            entry_at=result.entry_at,
            entry_price=result.entry_price,
            exit_at=result.exit_at,
            exit_price=result.exit_price,
            gross_return=result.gross_return,
            net_return=result.net_return,
            benchmark_return=result.benchmark_return,
            excess_return=result.excess_return,
            direction_correct=result.direction_correct,
            cost_bps=result.cost_bps,
            detail=result.detail,
            content_hash=content_hash(payload),
            created_at=utcnow(),
        )
        self.session.add(row)
        self.session.flush()
        self.session.add(
            PerfAuditEventRow(
                occurred_at=utcnow(),
                actor=self.actor,
                action="signal.evaluated",
                subject_type="recorded_signal",
                subject_id=str(signal.id),
                detail={
                    "horizon": result.horizon_label,
                    "status": result.status,
                    "netReturn": (
                        str(result.net_return) if result.net_return is not None else None
                    ),
                },
            )
        )
        return row

    # -- job runner --------------------------------------------------------

    def run_due_jobs(
        self, *, now: datetime | None = None, limit: int = 100
    ) -> dict[str, int]:
        """Process due evaluation jobs with a lease, retries and visible failures."""
        moment = _aware(now or utcnow())
        jobs = self.session.scalars(
            select(PerfEvaluationJobRow)
            .where(
                PerfEvaluationJobRow.status.in_(("pending", "failed")),
                PerfEvaluationJobRow.due_at <= moment,
            )
            .order_by(PerfEvaluationJobRow.due_at)
            .limit(limit)
        ).all()

        counts = {"processed": 0, "completed": 0, "pending": 0, "failed": 0}
        for job in jobs:
            job.status = "running"
            job.attempts += 1
            job.lease_expires_at = moment + LEASE
            self.session.flush()
            counts["processed"] += 1

            try:
                signal = self.session.get(PerfRecordedSignalRow, job.signal_id)
                if signal is None:
                    job.status = "failed"
                    job.last_error = "The recorded signal no longer exists."
                    counts["failed"] += 1
                    continue

                horizon = resolve_horizons([job.horizon_label])[0]
                result = self.evaluate(signal, horizon, now=moment)
                if result.final:
                    self.persist(signal, result)
                    job.status = "done"
                    job.completed_at = moment
                    job.last_error = None
                    counts["completed"] += 1
                else:
                    job.status = "pending"
                    job.last_error = None
                    counts["pending"] += 1
            except Exception as error:  # noqa: BLE001 - the failure must be recorded, not swallowed
                job.status = "failed"
                job.last_error = f"{type(error).__name__}: {error}"
                counts["failed"] += 1
            finally:
                job.lease_expires_at = None
                self.session.flush()

        return counts
