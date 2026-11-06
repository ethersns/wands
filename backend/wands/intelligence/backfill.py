"""Historical SEC backfill.

The polling collector reads the recent-filings block, which is a few hundred
filings per issuer. That is enough to notice something happened this month and
nowhere near enough to measure whether it mattered. Backfill walks the archive
pages the SEC publishes for each issuer, which is the documented route to the
rest of the history.

Four properties make it safe to run for hours and resume after a crash.

*The cursor is the last filing fully persisted*, not the last one downloaded. A
crash between fetch and write replays one filing, and the accession uniqueness
constraint turns that replay into a no-op. The alternative — advancing the
cursor on download — loses a filing silently, which is the one failure mode a
research dataset cannot recover from.

*Concurrency is bounded and only covers the network.* Documents are fetched by a
small pool and persisted by the calling thread, so no database session is shared
across threads and the SEC sees a rate the token bucket allows.

*Every non-ingested filing is counted.* Skipped, unavailable and malformed are
separate numbers, because "we processed 4,000 filings" means something different
when 900 of them were 404s.

*Nothing is invented.* A filing that cannot be fetched is recorded as
unavailable. It is never back-filled from a neighbouring period, and a missing
price or a missing document stays missing.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from wands.config import Settings
from wands.db.models import IntelBackfillCheckpointRow
from wands.intelligence.base import (
    FilingRef,
    IntelError,
    SourceDataError,
    SourceNotConfigured,
    SourceRateLimited,
    SourceUnavailable,
)
from wands.intelligence.edgar import EdgarClient
from wands.intelligence.ingest import InsiderIngestor, build_client, ingest_disabled_reason
from wands.logging import get_logger

logger = get_logger(__name__)

OWNERSHIP = "ownership"
INSTITUTIONAL = "institutional"

# A stream is one issuer's crawl for one form family. It is the unit of
# checkpointing, so a failure on one issuer does not discard the others.
STREAM_PENDING = "pending"
STREAM_RUNNING = "running"
STREAM_COMPLETE = "complete"
STREAM_FAILED = "failed"
STREAM_PAUSED = "paused"


class LockedBucket:
    """A token bucket that is safe to share across fetch threads.

    The underlying bucket is a plain dataclass with no lock, which is correct
    for a single-threaded worker and wrong the moment two threads share it. The
    SEC limit is per client, so the lock has to live here rather than per thread.
    """

    def __init__(self, bucket: Any) -> None:
        self._bucket = bucket
        self._lock = threading.Lock()

    def try_acquire(self, now: float, cost: float = 1.0) -> bool:
        with self._lock:
            return self._bucket.try_acquire(now, cost)

    def retry_after(self, now: float, cost: float = 1.0) -> float:
        with self._lock:
            return self._bucket.retry_after(now, cost)


@dataclass
class StreamProgress:
    """The state of one issuer's crawl, as reported to an operator."""

    issuer_cik: str
    form_family: str
    status: str = STREAM_PENDING
    cursor: datetime | None = None
    window_start: datetime | None = None
    window_end: datetime | None = None
    filings_seen: int = 0
    filings_new: int = 0
    filings_skipped: int = 0
    filings_unavailable: int = 0
    filings_malformed: int = 0
    attempts: int = 0
    last_error: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {
            "issuerCik": self.issuer_cik,
            "formFamily": self.form_family,
            "status": self.status,
            "cursor": self.cursor.isoformat() if self.cursor else None,
            "windowStart": self.window_start.isoformat() if self.window_start else None,
            "windowEnd": self.window_end.isoformat() if self.window_end else None,
            "filingsSeen": self.filings_seen,
            "filingsNew": self.filings_new,
            "filingsSkipped": self.filings_skipped,
            "filingsUnavailable": self.filings_unavailable,
            "filingsMalformed": self.filings_malformed,
            "attempts": self.attempts,
            "lastError": self.last_error,
        }


@dataclass
class BackfillResult:
    source: str = "sec_edgar"
    streams: int = 0
    completed: int = 0
    failed: int = 0
    paused: int = 0
    filings_seen: int = 0
    filings_new: int = 0
    filings_skipped: int = 0
    filings_unavailable: int = 0
    filings_malformed: int = 0
    stopped_early: bool = False
    errors: list[dict[str, str]] = field(default_factory=list)
    progress: list[StreamProgress] = field(default_factory=list)

    @property
    def status(self) -> str:
        if self.stopped_early:
            return "paused"
        if self.errors and not self.filings_new:
            return "failed"
        # A run that ingested filings but could not fetch or parse some of them
        # is partial, not ok. The gap is the point.
        if self.errors or self.filings_unavailable or self.filings_malformed:
            return "partial"
        return "ok"

    def as_dict(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "status": self.status,
            "streams": self.streams,
            "completed": self.completed,
            "failed": self.failed,
            "paused": self.paused,
            "filingsSeen": self.filings_seen,
            "filingsNew": self.filings_new,
            "filingsSkipped": self.filings_skipped,
            "filingsUnavailable": self.filings_unavailable,
            "filingsMalformed": self.filings_malformed,
            "stoppedEarly": self.stopped_early,
            "errors": list(self.errors),
            "progress": [item.as_dict() for item in self.progress],
        }


class BackfillRunner:
    """Walks SEC archive pages for a set of issuers, resumably."""

    def __init__(
        self,
        session: Session,
        settings: Settings,
        *,
        client: EdgarClient | None = None,
        ingestor: InsiderIngestor | None = None,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], datetime] = lambda: datetime.now(tz=UTC),
    ) -> None:
        self.session = session
        self.settings = settings
        self.client = client or build_client(settings)
        self.ingestor = ingestor or InsiderIngestor(session, settings, client=self.client)
        self._sleep = sleep
        self._clock = clock

    # -- public ------------------------------------------------------------

    def run(
        self,
        *,
        ciks: list[str] | None = None,
        form_family: str = OWNERSHIP,
        start: date | None = None,
        end: date | None = None,
        max_workers: int | None = None,
        stop_event: threading.Event | None = None,
        max_filings: int | None = None,
    ) -> BackfillResult:
        result = BackfillResult()
        reason = ingest_disabled_reason(self.settings)
        if reason is not None:
            result.errors.append({"stage": "config", "message": reason})
            return result
        if not self.client.is_configured():
            result.errors.append(
                {
                    "stage": "config",
                    "message": (
                        "WANDS_SEC_USER_AGENT is not set. The SEC requires a descriptive "
                        "User-Agent, so no backfill request is sent without one."
                    ),
                }
            )
            return result

        targets = ciks if ciks is not None else self._default_ciks()
        if not targets:
            result.errors.append(
                {
                    "stage": "discovery",
                    "message": (
                        "No issuer CIKs to backfill. Set WANDS_INTELLIGENCE_INSIDER_CIKS "
                        "or add equity symbols to WANDS_MARKET_WATCHLIST."
                    ),
                }
            )
            return result

        window_start = _start_of_day(start or self.settings.backfill_start)
        window_end = _end_of_day(end or self.settings.backfill_end)
        workers = max(1, max_workers or self.settings.intelligence_backfill_max_workers)

        for cik in targets:
            if stop_event is not None and stop_event.is_set():
                result.stopped_early = True
                break
            progress = self._run_stream(
                cik,
                form_family=form_family,
                window_start=window_start,
                window_end=window_end,
                max_workers=workers,
                stop_event=stop_event,
                max_filings=max_filings,
            )
            result.streams += 1
            result.progress.append(progress)
            result.filings_seen += progress.filings_seen
            result.filings_new += progress.filings_new
            result.filings_skipped += progress.filings_skipped
            result.filings_unavailable += progress.filings_unavailable
            result.filings_malformed += progress.filings_malformed
            if progress.status == STREAM_COMPLETE:
                result.completed += 1
            elif progress.status == STREAM_PAUSED:
                result.paused += 1
                result.stopped_early = True
            else:
                result.failed += 1
                result.errors.append(
                    {
                        "stage": "backfill",
                        "cik": cik,
                        "message": progress.last_error or "The stream did not complete.",
                    }
                )

        logger.info(
            "intelligence backfill finished",
            extra={"event": "intelligence.backfill", "context": result.as_dict()},
        )
        return result

    def progress(self, *, form_family: str | None = None) -> list[StreamProgress]:
        statement = select(IntelBackfillCheckpointRow).order_by(
            IntelBackfillCheckpointRow.issuer_cik
        )
        if form_family is not None:
            statement = statement.where(
                IntelBackfillCheckpointRow.form_family == form_family
            )
        rows = self.session.scalars(statement).all()
        return [_to_progress(row) for row in rows]

    # -- internals ---------------------------------------------------------

    def _default_ciks(self) -> list[str]:
        explicit = [
            item.strip()
            for item in self.settings.intelligence_insider_ciks.split(",")
            if item.strip()
        ]
        if explicit:
            return explicit
        ciks: list[str] = []
        for symbol in self.settings.watchlist:
            if "/" in symbol:
                continue
            cik = self.client.cik_for_ticker(symbol)
            if cik and cik not in ciks:
                ciks.append(cik)
        return ciks

    def _run_stream(
        self,
        cik: str,
        *,
        form_family: str,
        window_start: datetime,
        window_end: datetime | None,
        max_workers: int,
        stop_event: threading.Event | None,
        max_filings: int | None,
    ) -> StreamProgress:
        checkpoint = self._checkpoint(cik, form_family)
        checkpoint.status = STREAM_RUNNING
        checkpoint.attempts += 1
        checkpoint.started_at = checkpoint.started_at or self._clock()
        checkpoint.window_start = window_start
        checkpoint.window_end = window_end
        checkpoint.updated_at = self._clock()
        self.session.flush()

        # The checkpoint's counters are cumulative across every run of this
        # stream; the progress object reports this run only. Keeping them apart
        # is what stops a resumed run from claiming the previous run's filings.
        baseline = {
            "filings_seen": checkpoint.filings_seen,
            "filings_new": checkpoint.filings_new,
            "filings_skipped": checkpoint.filings_skipped,
            "filings_unavailable": checkpoint.filings_unavailable,
            "filings_malformed": checkpoint.filings_malformed,
        }
        progress = StreamProgress(
            issuer_cik=cik,
            form_family=form_family,
            status=STREAM_RUNNING,
            cursor=checkpoint.cursor_accepted_at,
            window_start=window_start,
            window_end=window_end,
            attempts=checkpoint.attempts,
        )
        resume_from = checkpoint.cursor_accepted_at

        try:
            refs = self.client.all_filings(
                cik,
                forms=_forms_for(form_family),
                since=resume_from or window_start,
                until=window_end,
                limit=max_filings or 10_000,
            )
        except SourceNotConfigured as exc:
            return self._fail(checkpoint, progress, str(exc))
        except IntelError as exc:
            return self._fail(checkpoint, progress, str(exc))

        # Newest first from the client; process oldest first so the cursor only
        # ever moves forward in time.
        refs = sorted(refs, key=lambda ref: (ref.accepted_at, ref.accession_number))
        if resume_from is not None:
            # Inclusive on purpose: replaying the cursor filing is a no-op thanks
            # to the accession constraint, whereas skipping it would lose data.
            refs = [ref for ref in refs if ref.accepted_at >= resume_from]

        batch_size = max(1, self.settings.intelligence_backfill_batch_size)
        for offset in range(0, len(refs), batch_size):
            if stop_event is not None and stop_event.is_set():
                checkpoint.status = STREAM_PAUSED
                checkpoint.updated_at = self._clock()
                self.session.flush()
                progress.status = STREAM_PAUSED
                return progress

            batch = refs[offset : offset + batch_size]
            documents = self._fetch_documents(batch, max_workers=max_workers)
            for ref in batch:
                self._persist_one(ref, documents.get(ref.accession_number), progress)
                checkpoint.cursor_accepted_at = ref.accepted_at
                checkpoint.cursor_accession = ref.accession_number

            checkpoint.filings_seen = baseline["filings_seen"] + progress.filings_seen
            checkpoint.filings_new = baseline["filings_new"] + progress.filings_new
            checkpoint.filings_skipped = baseline["filings_skipped"] + progress.filings_skipped
            checkpoint.filings_unavailable = (
                baseline["filings_unavailable"] + progress.filings_unavailable
            )
            checkpoint.filings_malformed = (
                baseline["filings_malformed"] + progress.filings_malformed
            )
            checkpoint.updated_at = self._clock()
            self.session.flush()

        checkpoint.status = STREAM_COMPLETE
        checkpoint.completed_at = self._clock()
        checkpoint.updated_at = self._clock()
        checkpoint.last_error = ""
        self.session.flush()
        progress.status = STREAM_COMPLETE
        progress.cursor = checkpoint.cursor_accepted_at
        return progress

    def _fetch_documents(
        self, batch: list[FilingRef], *, max_workers: int
    ) -> dict[str, bytes | Exception]:
        """Download a batch concurrently, returning per-accession outcomes.

        Only the network call is parallel. Persistence stays on the calling
        thread so a single session is never shared.
        """
        if not batch:
            return {}
        if max_workers <= 1 or len(batch) == 1:
            return {ref.accession_number: self._download(ref) for ref in batch}

        outcomes: dict[str, bytes | Exception] = {}
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            futures = {
                pool.submit(self._download, ref): ref.accession_number for ref in batch
            }
            for future, accession in futures.items():
                try:
                    outcomes[accession] = future.result()
                except Exception as exc:  # noqa: BLE001 - recorded, never raised
                    outcomes[accession] = exc
        return outcomes

    def _download(self, ref: FilingRef) -> bytes | Exception:
        try:
            return self.client.document(
                ref.issuer_cik, ref.accession_number, ref.primary_document
            )
        except (SourceUnavailable, SourceRateLimited, SourceDataError) as exc:
            return exc

    def _persist_one(
        self,
        ref: FilingRef,
        document: bytes | Exception | None,
        progress: StreamProgress,
    ) -> None:
        progress.filings_seen += 1

        if isinstance(document, (SourceUnavailable, SourceRateLimited)):
            progress.filings_unavailable += 1
            progress.last_error = f"{ref.accession_number}: {document}"
            return
        if isinstance(document, SourceDataError):
            # A 404 on a document the index named is a coverage gap, not a bug.
            progress.filings_unavailable += 1
            progress.last_error = f"{ref.accession_number}: {document}"
            return
        if isinstance(document, Exception):
            progress.filings_malformed += 1
            progress.last_error = f"{ref.accession_number}: {document}"
            return
        if document is None:
            progress.filings_unavailable += 1
            return

        try:
            created, _ = self.ingestor.ingest_filing(ref, document=document)
        except SourceDataError as exc:
            progress.filings_malformed += 1
            progress.last_error = f"{ref.accession_number}: {exc}"
            return
        except IntelError as exc:
            progress.filings_unavailable += 1
            progress.last_error = f"{ref.accession_number}: {exc}"
            return

        if created:
            progress.filings_new += 1
        else:
            progress.filings_skipped += 1

    def _checkpoint(self, cik: str, form_family: str) -> IntelBackfillCheckpointRow:
        row = self.session.scalar(
            select(IntelBackfillCheckpointRow).where(
                IntelBackfillCheckpointRow.source == "sec_edgar",
                IntelBackfillCheckpointRow.issuer_cik == cik,
                IntelBackfillCheckpointRow.form_family == form_family,
            )
        )
        if row is not None:
            return row
        row = IntelBackfillCheckpointRow(
            source="sec_edgar",
            issuer_cik=cik,
            form_family=form_family,
            status=STREAM_PENDING,
            updated_at=self._clock(),
        )
        self.session.add(row)
        self.session.flush()
        return row

    def _fail(
        self,
        checkpoint: IntelBackfillCheckpointRow,
        progress: StreamProgress,
        message: str,
    ) -> StreamProgress:
        checkpoint.status = STREAM_FAILED
        checkpoint.last_error = message
        checkpoint.updated_at = self._clock()
        self.session.flush()
        progress.status = STREAM_FAILED
        progress.last_error = message
        return progress


def _forms_for(form_family: str) -> frozenset[str]:
    from wands.intelligence.edgar import INSTITUTIONAL_FORMS, OWNERSHIP_FORMS

    return INSTITUTIONAL_FORMS if form_family == INSTITUTIONAL else OWNERSHIP_FORMS


def _start_of_day(value: date | datetime | None) -> datetime:
    if value is None:
        return datetime(2015, 1, 1, tzinfo=UTC)
    if isinstance(value, datetime):
        return value.astimezone(UTC)
    return datetime(value.year, value.month, value.day, tzinfo=UTC)


def _end_of_day(value: date | datetime | None) -> datetime | None:
    """The end of the window, or ``None`` for an open interval.

    ``None`` is carried through rather than replaced with "now": a resumed
    backfill that pinned its end to the day it started would skip everything
    filed since.
    """
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.astimezone(UTC)
    return datetime(value.year, value.month, value.day, tzinfo=UTC) + timedelta(days=1)


def _to_progress(row: IntelBackfillCheckpointRow) -> StreamProgress:
    return StreamProgress(
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


__all__ = [
    "BackfillResult",
    "BackfillRunner",
    "LockedBucket",
    "StreamProgress",
]
