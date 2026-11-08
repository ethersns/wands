"""The Performance Lab facade.

This module is the only place that turns stored evidence into the numbers a
dashboard shows. Every figure is derived from recorded signals and their
evaluations; nothing is estimated, and a metric with too few observations is
reported as such instead of being rendered as a zero.

Paper trading is not implemented in this build. Its metrics are returned with an
explicit ``not_implemented`` status rather than a placeholder balance, because a
fabricated equity figure is exactly the kind of number this module exists to
prevent.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from wands.db.models import (
    PerfEvaluationJobRow,
    PerfRecordedSignalRow,
    PerfSignalEvaluationRow,
    PerfStrategyVersionRow,
    utcnow,
)
from wands.intelligence.quant import (
    equity_curve,
    max_drawdown,
    multiple_testing_report,
    profit_factor,
    sharpe_ratio,
)
from wands.intelligence.validation import PriceProvider
from wands.performance.evaluation import SignalEvaluator
from wands.performance.evidence import EvidenceVault
from wands.performance.signals import SignalRecorder

# Below this many observations a statistic is reported but flagged, because a
# win rate over four trades is a description of four trades, not an edge.
LOW_SAMPLE = 20
ACTIONABLE = ("BUY", "SELL")


def _f(value: Decimal | float | int | None) -> float | None:
    if value is None:
        return None
    return float(value)


def _metric(
    value: float | int | None,
    *,
    sample: int,
    note: str = "",
    status: str | None = None,
) -> dict[str, Any]:
    if value is None or sample < 1:
        return {
            "value": None,
            "status": status or "insufficient_data",
            "sample": sample,
            "note": note or "No evaluated observations yet.",
        }
    resolved = status or ("low_sample" if sample < LOW_SAMPLE else "ok")
    if resolved == "low_sample" and not note:
        note = (
            f"{sample} observation{'s' if sample != 1 else ''}. Below {LOW_SAMPLE} "
            "this is a description of a small sample, not an estimate of an edge."
        )
    return {"value": value, "status": resolved, "sample": sample, "note": note}


def _unavailable(note: str) -> dict[str, Any]:
    return {"value": None, "status": "not_implemented", "sample": 0, "note": note}


class PerformanceLab:
    def __init__(
        self,
        session: Session,
        *,
        price_provider: PriceProvider | None = None,
        benchmark_symbol: str = "SPY",
        cost_bps: Decimal = Decimal("10"),
        actor: str = "system",
    ) -> None:
        self.session = session
        self.price_provider = price_provider
        self.benchmark_symbol = benchmark_symbol
        self.cost_bps = cost_bps
        self.actor = actor

    # -- collaborators -----------------------------------------------------

    @property
    def recorder(self) -> SignalRecorder:
        return SignalRecorder(self.session, actor=self.actor)

    @property
    def vault(self) -> EvidenceVault:
        return EvidenceVault(self.session, actor=self.actor)

    def evaluator(self, provider: PriceProvider | None = None) -> SignalEvaluator:
        source = provider or self.price_provider
        if source is None:
            raise ValueError(
                "A price provider is required to evaluate signals. The engine's "
                "candle store is the only supported source."
            )
        return SignalEvaluator(
            self.session,
            price_provider=source,
            benchmark_symbol=self.benchmark_symbol,
            cost_bps=self.cost_bps,
            actor=self.actor,
        )

    # -- reads -------------------------------------------------------------

    def _evaluated_rows(self) -> list[tuple[PerfSignalEvaluationRow, PerfRecordedSignalRow, PerfStrategyVersionRow]]:
        return list(
            self.session.execute(
                select(
                    PerfSignalEvaluationRow,
                    PerfRecordedSignalRow,
                    PerfStrategyVersionRow,
                )
                .join(
                    PerfRecordedSignalRow,
                    PerfSignalEvaluationRow.signal_id == PerfRecordedSignalRow.id,
                )
                .join(
                    PerfStrategyVersionRow,
                    PerfRecordedSignalRow.strategy_version_id == PerfStrategyVersionRow.id,
                )
                .where(PerfSignalEvaluationRow.status == "ok")
                .order_by(PerfSignalEvaluationRow.exit_at)
            ).all()
        )

    def overview(self, *, now: datetime | None = None) -> dict[str, Any]:
        moment = now or utcnow()

        total_signals = self.session.scalar(
            select(func.count()).select_from(PerfRecordedSignalRow)
        ) or 0
        first_signal_at = self.session.scalar(
            select(func.min(PerfRecordedSignalRow.generated_at))
        )
        pending_jobs = self.session.scalar(
            select(func.count())
            .select_from(PerfEvaluationJobRow)
            .where(PerfEvaluationJobRow.status.in_(("pending", "running")))
        ) or 0
        failed_jobs = self.session.scalar(
            select(func.count())
            .select_from(PerfEvaluationJobRow)
            .where(PerfEvaluationJobRow.status == "failed")
        ) or 0

        rows = self._evaluated_rows()
        actionable = [row for row in rows if row[1].direction in ACTIONABLE]
        evaluated_signal_ids = {row[0].signal_id for row in rows}

        net = [_f(row[0].net_return) for row in actionable]
        net = [value for value in net if value is not None]
        gross = [_f(row[0].gross_return) for row in actionable]
        gross = [value for value in gross if value is not None]
        benchmark = [_f(row[0].benchmark_return) for row in actionable]
        benchmark = [value for value in benchmark if value is not None]
        excess = [_f(row[0].excess_return) for row in actionable]
        excess = [value for value in excess if value is not None]

        sample = len(net)
        wins = [value for value in net if value > 0]
        losses = [value for value in net if value < 0]

        curve = equity_curve(net) if net else []
        exit_dates = [
            row[0].exit_at.isoformat()
            for row in actionable
            if row[0].exit_at is not None and row[0].net_return is not None
        ]
        # The curve starts at 1.0 before the first trade, so it carries one more
        # point than there are exits. Labelling the origin with the first exit
        # date keeps the x-axis monotonic without inventing a start date.
        equity_dates = ([exit_dates[0]] + exit_dates) if exit_dates else []
        drawdown = max_drawdown(curve) if len(curve) >= 2 else None
        sharpe = sharpe_ratio(net) if net else None

        total_return = (curve[-1] - 1.0) if curve else None
        benchmark_curve = equity_curve(benchmark) if benchmark else []
        benchmark_total = (benchmark_curve[-1] - 1.0) if benchmark_curve else None

        cost_drag = (
            (sum(gross) / len(gross)) - (sum(net) / len(net))
            if gross and net and len(gross) == len(net)
            else None
        )

        days_since_start = None
        if first_signal_at is not None:
            started = first_signal_at
            if started.tzinfo is None:
                started = started.replace(tzinfo=UTC)
            days_since_start = max((moment - started).days, 0)

        metrics = {
            "totalSignals": _metric(total_signals, sample=total_signals, status="ok"),
            "pendingEvaluations": _metric(pending_jobs, sample=1, status="ok"),
            "failedEvaluations": _metric(failed_jobs, sample=1, status="ok"),
            "evaluatedSignals": _metric(
                len(evaluated_signal_ids), sample=len(evaluated_signal_ids), status="ok"
            ),
            "daysSinceStart": _metric(
                days_since_start,
                sample=1 if days_since_start is not None else 0,
                status="ok" if days_since_start is not None else None,
                note="No signal has been recorded yet.",
            ),
            "winRate": _metric(
                (len(wins) / sample) if sample else None,
                sample=sample,
                note="Share of actionable evaluations with a positive net return.",
            ),
            "profitFactor": _metric(
                profit_factor(net) if net else None,
                sample=sample,
                note="Gross gains over gross losses. Undefined when there are no losses.",
            ),
            "averageGain": _metric(
                (sum(wins) / len(wins)) if wins else None,
                sample=len(wins),
                note="Mean net return of the winning evaluations.",
            ),
            "averageLoss": _metric(
                (sum(losses) / len(losses)) if losses else None,
                sample=len(losses),
                note="Mean net return of the losing evaluations.",
            ),
            "averageReturnPerTrade": _metric(
                (sum(net) / sample) if sample else None,
                sample=sample,
                note="Mean net return per actionable evaluation, after costs.",
            ),
            "totalReturn": _metric(
                total_return,
                sample=sample,
                note="Compounded net return of the evaluated signal series. Not a portfolio return.",
            ),
            "benchmarkReturn": _metric(
                benchmark_total,
                sample=len(benchmark),
                note=f"Compounded return of {self.benchmark_symbol} over the same windows.",
            ),
            "excessReturn": _metric(
                (sum(excess) / len(excess)) if excess else None,
                sample=len(excess),
                note="Mean net return minus the benchmark over the same window.",
            ),
            "maxDrawdown": _metric(
                drawdown.max_drawdown if drawdown else None,
                sample=sample,
                note="Peak-to-trough decline of the compounded signal series.",
            ),
            "sharpe": _metric(
                sharpe.value if sharpe else None,
                sample=sample,
                note=(
                    sharpe.note
                    if sharpe
                    else "At least two observations are needed."
                ),
            ),
            "costDrag": _metric(
                cost_drag,
                sample=sample,
                note=f"Mean gross minus mean net return at {self.cost_bps} bps round trip.",
            ),
            "startingCapital": _unavailable(
                "Paper trading is not implemented in this build, so there is no virtual capital."
            ),
            "currentEquity": _unavailable(
                "Paper trading is not implemented in this build, so there is no virtual equity."
            ),
            "realisedPnl": _unavailable("No paper portfolio exists to realise a profit or loss."),
            "unrealisedPnl": _unavailable("No paper position exists to mark to market."),
            "portfolioReturn": _unavailable(
                "A portfolio return requires a paper portfolio. The signal series above is "
                "an equal-weight, non-rebalanced research view, not a portfolio."
            ),
            "marketExposure": _unavailable(
                "Exposure requires a paper portfolio with dated positions."
            ),
            "paperTrades": _unavailable("No paper trade has been executed."),
        }

        return {
            "generatedAt": moment.isoformat(),
            "testingStartedAt": first_signal_at.isoformat() if first_signal_at else None,
            "benchmarkSymbol": self.benchmark_symbol,
            "costBps": float(self.cost_bps),
            "signals": {
                "total": total_signals,
                "evaluated": len(evaluated_signal_ids),
                "pendingEvaluations": pending_jobs,
                "failedEvaluations": failed_jobs,
            },
            "metrics": metrics,
            "equity": {
                "dates": equity_dates,
                "signal": curve,
                "benchmark": benchmark_curve,
                "note": (
                    "Compounded from evaluated net returns in exit order. The benchmark "
                    "curve compounds the same windows' benchmark returns."
                ),
            },
            "drawdown": {
                "maxDrawdown": drawdown.max_drawdown if drawdown else None,
                "peakIndex": drawdown.peak_index if drawdown else None,
                "troughIndex": drawdown.trough_index if drawdown else None,
                "note": drawdown.note if drawdown else "At least two points are needed.",
            },
            "monthly": self._monthly(actionable),
            "byStrategy": self._group(actionable, lambda row: row[2].name),
            "bySymbol": self._group(actionable, lambda row: row[1].symbol),
            "byDirection": self._group(actionable, lambda row: row[1].direction),
            "byHorizon": self._group(actionable, lambda row: row[0].horizon_label),
            "multipleTesting": self._multiple_testing(actionable),
            "paperTrading": {
                "status": "not_implemented",
                "note": (
                    "The paper trading engine is not part of this build. No virtual "
                    "portfolio, order or fill exists, and no figure on this page is a "
                    "portfolio result."
                ),
            },
            "limitations": [
                "Every figure is a research result computed from stored historical bars. "
                "None of it is realised account performance.",
                "Signals are evaluated independently. The compounded series is an "
                "equal-weight, non-rebalanced view, not a portfolio return.",
                "HOLD signals are scored on directional accuracy only and are excluded "
                "from return statistics, because a hold is not a trade.",
                "Intraday horizons are reported as unsupported: only daily bars are stored.",
                "The integrity hash on an evidence record is tamper-evidence, not a "
                "third-party audit.",
            ],
        }

    def _monthly(self, rows: list[tuple[PerfSignalEvaluationRow, PerfRecordedSignalRow, PerfStrategyVersionRow]]) -> list[dict[str, Any]]:
        buckets: dict[str, list[float]] = defaultdict(list)
        for evaluation, _signal, _version in rows:
            if evaluation.exit_at is None or evaluation.net_return is None:
                continue
            buckets[evaluation.exit_at.strftime("%Y-%m")].append(float(evaluation.net_return))
        out = []
        for month in sorted(buckets):
            values = buckets[month]
            curve = equity_curve(values)
            out.append(
                {
                    "month": month,
                    "sample": len(values),
                    "return": curve[-1] - 1.0,
                }
            )
        return out

    def _group(
        self,
        rows: list[tuple[PerfSignalEvaluationRow, PerfRecordedSignalRow, PerfStrategyVersionRow]],
        key,
    ) -> list[dict[str, Any]]:
        buckets: dict[str, list[tuple[PerfSignalEvaluationRow, PerfRecordedSignalRow, PerfStrategyVersionRow]]] = defaultdict(list)
        for row in rows:
            buckets[str(key(row))].append(row)

        out = []
        for label in sorted(buckets):
            group = buckets[label]
            net = [float(row[0].net_return) for row in group if row[0].net_return is not None]
            bench = [
                float(row[0].benchmark_return)
                for row in group
                if row[0].benchmark_return is not None
            ]
            wins = [value for value in net if value > 0]
            curve = equity_curve(net) if net else []
            out.append(
                {
                    "label": label,
                    "sample": len(net),
                    "winRate": (len(wins) / len(net)) if net else None,
                    "meanNetReturn": (sum(net) / len(net)) if net else None,
                    "compoundedReturn": (curve[-1] - 1.0) if curve else None,
                    "meanBenchmarkReturn": (sum(bench) / len(bench)) if bench else None,
                    "profitFactor": profit_factor(net) if net else None,
                }
            )
        return out

    def _multiple_testing(
        self,
        rows: list[tuple[PerfSignalEvaluationRow, PerfRecordedSignalRow, PerfStrategyVersionRow]],
    ) -> dict[str, Any]:
        """Report how many comparisons were made, so a raw winner is not over-read."""
        groups = {str(row[2].name) for row in rows}
        horizons = {row[0].horizon_label for row in rows}
        comparisons = len(groups) * len(horizons)
        if comparisons == 0:
            return {
                "comparisons": 0,
                "note": "No comparison has been made yet.",
                "bonferroniAlpha": None,
                "survivors": 0,
            }
        # A conservative placeholder p-value per comparison is not computed here:
        # the honest statement is the count and the corrected threshold.
        report = multiple_testing_report([1.0] * comparisons)
        return {
            "comparisons": comparisons,
            "bonferroniAlpha": report.bonferroni_alpha,
            "survivors": 0,
            "note": (
                f"{comparisons} strategy-by-horizon comparisons are in scope. At alpha "
                f"0.05 the Bonferroni threshold is {report.bonferroni_alpha:.4g}. No "
                "comparison is presented as a proven edge; a corrected result is a "
                "weaker claim than a reliable trading edge."
            ),
        }

    # -- signal tracker ----------------------------------------------------

    def signals(
        self,
        *,
        limit: int = 100,
        symbol: str | None = None,
        direction: str | None = None,
    ) -> list[dict[str, Any]]:
        query = (
            select(PerfRecordedSignalRow, PerfStrategyVersionRow)
            .join(
                PerfStrategyVersionRow,
                PerfRecordedSignalRow.strategy_version_id == PerfStrategyVersionRow.id,
            )
            .order_by(PerfRecordedSignalRow.generated_at.desc())
            .limit(limit)
        )
        if symbol:
            query = query.where(PerfRecordedSignalRow.symbol == symbol.strip().upper())
        if direction:
            query = query.where(PerfRecordedSignalRow.direction == direction.strip().upper())

        rows = self.session.execute(query).all()
        recorder = self.recorder
        out = []
        for signal, version in rows:
            evaluations = self.session.scalars(
                select(PerfSignalEvaluationRow)
                .where(PerfSignalEvaluationRow.signal_id == signal.id)
                .order_by(PerfSignalEvaluationRow.horizon_days)
            ).all()
            out.append(
                {
                    "id": str(signal.id),
                    "signalKey": signal.signal_key,
                    "symbol": signal.symbol,
                    "direction": signal.direction,
                    "assetClass": signal.asset_class,
                    "timeframe": signal.timeframe,
                    "generatedAt": signal.generated_at.isoformat(),
                    "observedAt": signal.observed_at.isoformat(),
                    "referencePrice": _f(signal.reference_price),
                    "confidence": _f(signal.confidence),
                    "dataSource": signal.data_source,
                    "dataFreshnessSeconds": signal.data_freshness_seconds,
                    "strategy": {
                        "key": version.strategy_key,
                        "name": version.name,
                        "version": version.version,
                        "signalVersion": version.signal_version,
                    },
                    "integrityVerified": recorder.verify(signal),
                    "evaluations": [
                        {
                            "horizon": evaluation.horizon_label,
                            "status": evaluation.status,
                            "netReturn": _f(evaluation.net_return),
                            "grossReturn": _f(evaluation.gross_return),
                            "benchmarkReturn": _f(evaluation.benchmark_return),
                            "excessReturn": _f(evaluation.excess_return),
                            "directionCorrect": evaluation.direction_correct,
                            "entryAt": evaluation.entry_at.isoformat() if evaluation.entry_at else None,
                            "exitAt": evaluation.exit_at.isoformat() if evaluation.exit_at else None,
                            "detail": evaluation.detail,
                        }
                        for evaluation in evaluations
                    ],
                }
            )
        return out

    def strategies(self) -> list[dict[str, Any]]:
        versions = self.session.scalars(
            select(PerfStrategyVersionRow).order_by(
                PerfStrategyVersionRow.strategy_key, PerfStrategyVersionRow.version
            )
        ).all()
        out = []
        for version in versions:
            signal_count = self.session.scalar(
                select(func.count())
                .select_from(PerfRecordedSignalRow)
                .where(PerfRecordedSignalRow.strategy_version_id == version.id)
            ) or 0
            out.append(
                {
                    "id": str(version.id),
                    "key": version.strategy_key,
                    "name": version.name,
                    "version": version.version,
                    "signalVersion": version.signal_version,
                    "parameters": version.parameters,
                    "definitionHash": version.definition_hash,
                    "frozen": version.frozen,
                    "signals": signal_count,
                    "createdAt": version.created_at.isoformat(),
                }
            )
        return out

    def audit_trail(self, *, limit: int = 100) -> list[dict[str, Any]]:
        from wands.db.models import PerfAuditEventRow

        rows = self.session.scalars(
            select(PerfAuditEventRow)
            .order_by(PerfAuditEventRow.occurred_at.desc())
            .limit(limit)
        ).all()
        return [
            {
                "id": str(row.id),
                "occurredAt": row.occurred_at.isoformat(),
                "actor": row.actor,
                "action": row.action,
                "subjectType": row.subject_type,
                "subjectId": row.subject_id,
                "detail": row.detail,
            }
            for row in rows
        ]
