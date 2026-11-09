"""Research read models for the intelligence API.

The route layer stays thin: this module assembles the payloads, and every one of
them is built from stored rows rather than from a live calculation that could
change between two requests.

Two habits are deliberate.

*Coverage is reported before results.* A validation result is only meaningful
next to how much of the data it could see, so the coverage endpoint answers
"what do we actually have" separately from "what did it show".

*An empty answer says why.* When there are no experiments, no jobs or no price
data, the payload carries the reason rather than a bare zero.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from wands.config import Settings
from wands.db.models import (
    IntelBackfillCheckpointRow,
    IntelFilingRow,
    IntelInsiderTransactionRow,
    IntelInstitutionalHoldingRow,
    IntelInstitutionRow,
    IntelJobRow,
    IntelSignalRow,
    MarketCandleRow,
)
from wands.intelligence.backfill import BackfillRunner
from wands.intelligence.experiments import (
    DISCLOSURE_CATEGORIES,
    ExperimentDefinition,
    ExperimentRunner,
    experiment_payload,
)
from wands.intelligence.forensics import report_for_row
from wands.intelligence.identifiers import IdentifierResolver
from wands.intelligence.jobs import JobScheduler, _job_payload
from wands.intelligence.schemas import (
    IntelBackfillOut,
    IntelBackfillRequest,
    IntelBackfillStreamOut,
    IntelCoverageOut,
    IntelExperimentFeedOut,
    IntelExperimentOut,
    IntelJobFeedOut,
    IntelJobOut,
    IntelValidationOut,
)
from wands.intelligence.validation import SignalObservation, SignalValidator
from wands.logging import get_logger

logger = get_logger(__name__)

COVERAGE_CAVEAT = (
    "Coverage describes what has been collected, not what exists. A low count means "
    "the collector has not reached that period, not that nothing was filed."
)

VALIDATION_CAVEAT = (
    "These are historical measurements, not a forecast and not a recommendation. A "
    "positive mean excess return over a small sample is not evidence of an edge."
)


class ResearchService:
    """Assembles the research endpoints from stored state."""

    def __init__(self, session: Session, settings: Settings) -> None:
        self.session = session
        self.settings = settings

    # -- jobs --------------------------------------------------------------

    def jobs(self) -> IntelJobFeedOut:
        rows = self.session.scalars(select(IntelJobRow).order_by(IntelJobRow.name)).all()
        items = [IntelJobOut(**_job_payload(row)) for row in rows]
        caveats: list[str] = []
        if not self.settings.intelligence_jobs_enabled:
            caveats.append(
                "The job scheduler is disabled (WANDS_INTELLIGENCE_JOBS_ENABLED=false). "
                "Rows below are the last known state and will not advance."
            )
        if not items:
            caveats.append(
                "No job has been registered yet. The scheduler creates a row for each "
                "registered job the first time it starts."
            )
        return IntelJobFeedOut(
            items=items,
            total=len(items),
            scheduler_enabled=self.settings.intelligence_jobs_enabled,
            caveats=caveats,
        )

    def pause_job(self, name: str) -> bool:
        return JobScheduler(self.settings).pause(name)

    def resume_job(self, name: str) -> bool:
        return JobScheduler(self.settings).resume(name)

    # -- coverage ----------------------------------------------------------

    def coverage(self) -> IntelCoverageOut:
        filings = self._count(IntelFilingRow)
        transactions = self._count(IntelInsiderTransactionRow)
        signals = self._count(IntelSignalRow)
        institutions = self._count(IntelInstitutionRow)
        holdings = self._count(IntelInstitutionalHoldingRow)

        earliest_filing = self.session.scalar(select(func.min(IntelFilingRow.accepted_at)))
        latest_filing = self.session.scalar(select(func.max(IntelFilingRow.accepted_at)))
        earliest_signal = self.session.scalar(
            select(func.min(IntelSignalRow.public_available_at))
        )
        latest_signal = self.session.scalar(
            select(func.max(IntelSignalRow.public_available_at))
        )

        symbols = sorted(
            {
                row
                for row in self.session.scalars(
                    select(IntelSignalRow.symbol).distinct()
                ).all()
                if row
            }
        )

        backfill_rows = self.session.scalars(
            select(IntelBackfillCheckpointRow).order_by(
                IntelBackfillCheckpointRow.issuer_cik
            )
        ).all()

        caveats = [COVERAGE_CAVEAT]
        if not backfill_rows:
            caveats.append(
                "No historical backfill has run. Only the recent-filings window has been "
                "collected, so any historical measurement covers a short period."
            )

        return IntelCoverageOut(
            filings=filings,
            transactions=transactions,
            signals=signals,
            institutions=institutions,
            holdings=holdings,
            earliest_filing_at=earliest_filing,
            latest_filing_at=latest_filing,
            earliest_signal_at=earliest_signal,
            latest_signal_at=latest_signal,
            symbols_covered=symbols,
            identifiers=IdentifierResolver(self.session).coverage(),
            backfill=[_stream_payload(row) for row in backfill_rows],
            price_coverage=self._price_coverage(symbols),
            caveats=caveats,
        )

    def _price_coverage(self, symbols: list[str]) -> dict[str, Any]:
        """Which signal symbols actually have daily bars to measure against.

        Reported separately from the signal count because a validation run over
        symbols with no prices produces no statistics at all, and that should be
        visible before the run rather than after it.
        """
        if not symbols:
            return {
                "symbolsWithSignals": 0,
                "symbolsWithDailyBars": 0,
                "missing": [],
                "note": "No signals are stored, so there is nothing to price.",
            }
        priced = set(
            self.session.scalars(
                select(MarketCandleRow.symbol)
                .where(
                    MarketCandleRow.symbol.in_(symbols),
                    MarketCandleRow.interval == "1d",
                )
                .distinct()
            ).all()
        )
        missing = sorted(set(symbols) - priced)
        return {
            "symbolsWithSignals": len(symbols),
            "symbolsWithDailyBars": len(priced),
            "missing": missing,
            "note": (
                "A symbol without daily bars cannot be validated. Its signals are counted "
                "in the sample but produce no return."
            ),
        }

    def _count(self, model: Any) -> int:
        return int(self.session.scalar(select(func.count()).select_from(model)) or 0)

    # -- experiments -------------------------------------------------------

    def experiments(self, *, limit: int = 50) -> IntelExperimentFeedOut:
        rows = ExperimentRunner(self.session, self.settings).list(limit=limit)
        items = [IntelExperimentOut(**experiment_payload(row)) for row in rows]
        caveats: list[str] = []
        if not items:
            caveats.append(
                "No experiment has been recorded. An experiment is created by running a "
                "validation over a defined period, not by reading this endpoint."
            )
        return IntelExperimentFeedOut(items=items, total=len(items), caveats=caveats)

    def experiment(self, experiment_id: str) -> IntelExperimentOut | None:
        key = _as_uuid(experiment_id)
        if key is None:
            return None
        row = ExperimentRunner(self.session, self.settings).get(key)
        if row is None:
            return None
        payload = experiment_payload(row)
        # The forensic report is computed on read, never stored: it is a statement
        # about the evidence behind a result, and writing it back would let a later
        # change to the checks silently rewrite what an old experiment claimed.
        payload["forensics"] = report_for_row(
            row,
            session=self.session,
            minimum_sample=int(self.settings.intelligence_validation_min_sample),
        )
        return IntelExperimentOut(**payload)

    # -- validation --------------------------------------------------------

    def signal_validation(self, signal_id: str) -> IntelValidationOut | None:
        """Validate the category a signal belongs to, and report that signal.

        A single signal cannot be validated on its own: one observation has no
        distribution. The category is measured over the stored history and the
        requested signal's own simulated trade is included in the horizon rows.
        """
        key = _as_uuid(signal_id)
        if key is None:
            return None
        target = self.session.scalar(
            select(IntelSignalRow).where(IntelSignalRow.id == key)
        )
        if target is None:
            return None

        rows = self.session.scalars(
            select(IntelSignalRow)
            .where(IntelSignalRow.category == target.category)
            .order_by(IntelSignalRow.public_available_at)
        ).all()

        observations = [
            SignalObservation(
                signal_id=str(row.id),
                category=row.category,
                symbol=row.symbol,
                public_available_at=row.public_available_at,
                score=float(row.score) if row.score is not None else None,
            )
            for row in rows
        ]

        result = SignalValidator(self.session, self.settings).evaluate(
            observations, category=target.category
        )
        payload = result.as_dict()
        return IntelValidationOut(
            signal_id=str(target.id),
            category=target.category,
            status=payload["status"],
            benchmark=payload["benchmark"],
            cost_bps=payload["costBps"],
            sample_size=payload["sampleSize"],
            coverage=payload["coverage"],
            flags=payload["flags"] + [VALIDATION_CAVEAT],
            overlap=payload["overlap"],
            multiple_testing=payload["multipleTesting"],
            horizons=payload["horizons"],
            splits=payload["splits"],
        )

    # -- backfill ----------------------------------------------------------

    def run_backfill(self, request: IntelBackfillRequest) -> IntelBackfillOut:
        """Run a bounded backfill synchronously.

        Bounded on purpose: an administrative request that could crawl for hours
        would hold a worker open and time out at the proxy. A long crawl belongs
        to the scheduler, and this endpoint is for a targeted catch-up.
        """

        start = _parse_date(request.start_date)
        end = _parse_date(request.end_date)
        runner = BackfillRunner(self.session, self.settings)
        result = runner.run(
            ciks=request.ciks or None,
            form_family=request.form_family,
            start=start,
            end=end,
            max_filings=request.max_filings,
        )
        payload = result.as_dict()
        return IntelBackfillOut(
            source=payload["source"],
            status=payload["status"],
            streams=payload["streams"],
            completed=payload["completed"],
            failed=payload["failed"],
            paused=payload["paused"],
            filings_seen=payload["filingsSeen"],
            filings_new=payload["filingsNew"],
            filings_skipped=payload["filingsSkipped"],
            filings_unavailable=payload["filingsUnavailable"],
            filings_malformed=payload["filingsMalformed"],
            stopped_early=payload["stoppedEarly"],
            errors=payload["errors"],
            progress=[IntelBackfillStreamOut(**item) for item in payload["progress"]],
        )

    def default_experiment_definition(self) -> ExperimentDefinition:
        """The definition used when a caller does not supply one.

        The period is the stored signal history and the cutoff is now, so the
        default experiment is "everything we have, as of today".
        """
        earliest = self.session.scalar(select(func.min(IntelSignalRow.public_available_at)))
        latest = self.session.scalar(select(func.max(IntelSignalRow.public_available_at)))
        now = datetime.now(tz=UTC)
        return ExperimentDefinition(
            name="default_disclosure_validation",
            period_start=earliest or now,
            period_end=latest or now,
            information_cutoff=now,
            signal_version=self.settings.intelligence_signal_engine_version,
            benchmark=self.settings.intelligence_validation_benchmark,
            categories=DISCLOSURE_CATEGORIES,
            horizons=tuple(self.settings.validation_horizons),
            cost_assumptions={
                "spreadBps": float(self.settings.intelligence_validation_spread_bps),
                "commissionBps": float(
                    self.settings.intelligence_validation_commission_bps
                ),
                "slippageBps": float(self.settings.intelligence_validation_slippage_bps),
                "totalBps": float(self.settings.validation_cost_bps),
            },
            execution_assumptions={
                "entry": "open of the first session strictly after public_available_at",
                "exit": "close of the session horizon_days - 1 after entry",
                "calendar": "the stored daily candle series",
            },
        )


def _stream_payload(row: IntelBackfillCheckpointRow) -> IntelBackfillStreamOut:
    return IntelBackfillStreamOut(
        issuer_cik=row.issuer_cik,
        form_family=row.form_family,
        status=row.status,
        cursor=row.cursor_accepted_at,
        window_start=row.window_start,
        window_end=row.window_end,
        filings_seen=row.filings_seen,
        filings_new=row.filings_new,
        filings_skipped=row.filings_skipped,
        filings_unavailable=row.filings_unavailable,
        filings_malformed=row.filings_malformed,
        attempts=row.attempts,
        last_error=row.last_error,
    )


def _parse_date(value: str | None):
    from datetime import date

    if not value:
        return None
    try:
        return date.fromisoformat(value.strip())
    except ValueError:
        return None


def _as_uuid(value: Any):
    """Coerce a path parameter to a UUID, or ``None`` if it is not one.

    The identifier columns are ``Uuid``, so comparing them to a raw string is a
    driver error rather than an empty result. Returning ``None`` lets the route
    answer 404 instead of 500.
    """
    import uuid as uuid_module

    if isinstance(value, uuid_module.UUID):
        return value
    try:
        return uuid_module.UUID(str(value))
    except (ValueError, AttributeError, TypeError):
        return None


__all__ = ["COVERAGE_CAVEAT", "ResearchService", "VALIDATION_CAVEAT"]
