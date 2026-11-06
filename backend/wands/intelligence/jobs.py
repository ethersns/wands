"""Scheduled research collection.

The engine already runs one background thread for market data. Rather than add a
second scheduling framework, research jobs reuse the same shape: a daemon
thread, one database session per cycle, and a stop event. What they add is
*persistent* state, because a research crawl is long enough that "did it finish"
has to survive a restart.

The overlap guard is a lease, not a flag. A job may only start if it can
atomically claim a row whose lease has expired or was never taken, so two
processes pointed at the same database cannot both run the same crawl. A lease
that expires without a clean finish is evidence the previous run died, and the
next cycle records that as an interruption rather than pretending it completed.

Nothing here can reach a broker. The handlers are research collectors, the
registry is closed, and the module imports no execution, risk or broker code.
"""

from __future__ import annotations

import os
import socket
import threading
import time
import uuid
from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from wands.config import Settings
from wands.db.models import IntelJobFailureRow, IntelJobRow
from wands.db.session import session_scope
from wands.logging import get_logger

logger = get_logger(__name__)

SessionFactory = Callable[[], AbstractContextManager[Session]]
JobHandler = Callable[[Session, Settings], dict[str, Any]]

JOB_IDLE = "idle"
JOB_RUNNING = "running"
JOB_INTERRUPTED = "interrupted"
JOB_FAILED = "failed"
JOB_PAUSED = "paused"


@dataclass(frozen=True)
class JobSpec:
    """A registered research job.

    ``schedule_seconds`` is an interval rather than a cron expression on
    purpose: a crawl that takes forty minutes should not be scheduled every
    hour by a calendar that assumes it takes one.
    """

    name: str
    kind: str
    schedule_seconds: int
    handler: JobHandler
    parameters: dict[str, Any] = field(default_factory=dict)
    description: str = ""


class JobRegistry:
    """The closed set of jobs this process knows how to run."""

    def __init__(self) -> None:
        self._specs: dict[str, JobSpec] = {}

    def register(self, spec: JobSpec) -> JobSpec:
        self._specs[spec.name] = spec
        return spec

    def get(self, name: str) -> JobSpec | None:
        return self._specs.get(name)

    def all(self) -> list[JobSpec]:
        return sorted(self._specs.values(), key=lambda spec: spec.name)

    def __contains__(self, name: object) -> bool:
        return name in self._specs


def default_registry() -> JobRegistry:
    """The jobs a deployment runs.

    Both are collectors. Neither reads a credential, and neither can place an
    order: the intelligence package does not import the execution path.
    """
    from wands.intelligence.ingest import InsiderIngestor, InstitutionalIngestor

    registry = JobRegistry()

    def collect_insider(session: Session, settings: Settings) -> dict[str, Any]:
        result = InsiderIngestor(session, settings).run()
        return {
            "filingsSeen": result.filings_seen,
            "filingsNew": result.filings_new,
            "transactionsNew": result.transactions_new,
            "errors": len(result.errors),
        }

    def collect_institutional(session: Session, settings: Settings) -> dict[str, Any]:
        ciks = [
            item.strip()
            for item in settings.intelligence_institution_ciks.split(",")
            if item.strip()
        ]
        if not ciks:
            return {"skipped": True, "reason": "No institution CIKs configured."}
        result = InstitutionalIngestor(session, settings).run(ciks=ciks)
        return {
            "filingsSeen": result.filings_seen,
            "filingsNew": result.filings_new,
            "holdingsNew": result.transactions_new,
            "errors": len(result.errors),
        }

    registry.register(
        JobSpec(
            name="insider_ingest",
            kind="ingest",
            schedule_seconds=3600,
            handler=collect_insider,
            description="Poll recent SEC ownership filings for the configured issuers.",
        )
    )
    registry.register(
        JobSpec(
            name="institutional_ingest",
            kind="ingest",
            schedule_seconds=86400,
            handler=collect_institutional,
            description="Poll 13F-HR filings for the configured institutions.",
        )
    )
    return registry


class JobScheduler:
    """Runs registered jobs on their intervals, with leases and dead letters."""

    def __init__(
        self,
        settings: Settings,
        *,
        registry: JobRegistry | None = None,
        session_factory: SessionFactory = session_scope,
        owner: str | None = None,
        clock: Callable[[], datetime] = lambda: datetime.now(tz=UTC),
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.settings = settings
        self.registry = registry or default_registry()
        self._session_factory = session_factory
        self.owner = owner or _default_owner()
        self._clock = clock
        self._sleep = sleep
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    # -- lifecycle ---------------------------------------------------------

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._loop, name="wands-intel-jobs", daemon=True
        )
        self._thread.start()
        logger.info(
            "intelligence job scheduler started",
            extra={
                "event": "intelligence.jobs.start",
                "context": {"owner": self.owner, "jobs": [spec.name for spec in self.registry.all()]},
            },
        )

    def stop(self, timeout: float = 10.0) -> None:
        """Ask the loop to finish and wait for it.

        The stop event is checked between jobs rather than mid-crawl, so a
        shutdown leaves a checkpoint behind instead of a half-written filing.
        """
        self._stop.set()
        thread = self._thread
        if thread is not None:
            thread.join(timeout=timeout)
        self._thread = None

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                self.run_due()
            except Exception as exc:  # noqa: BLE001 - the loop must survive a bad cycle
                logger.warning(
                    "intelligence job cycle failed",
                    extra={
                        "event": "intelligence.jobs.error",
                        "context": {"error": type(exc).__name__, "detail": str(exc)},
                    },
                )
            self._stop.wait(max(5, self.settings.intelligence_job_poll_seconds))

    # -- state -------------------------------------------------------------

    def ensure_jobs(self) -> list[IntelJobRow]:
        """Create a row for every registered job that does not have one."""
        with self._session_factory() as session:
            existing = {
                row.name: row for row in session.scalars(select(IntelJobRow)).all()
            }
            created: list[IntelJobRow] = []
            for spec in self.registry.all():
                if spec.name in existing:
                    continue
                row = IntelJobRow(
                    name=spec.name,
                    kind=spec.kind,
                    schedule_seconds=spec.schedule_seconds,
                    enabled=True,
                    paused=False,
                    status=JOB_IDLE,
                    next_run_at=self._clock(),
                    parameters=dict(spec.parameters),
                    metrics={},
                    created_at=self._clock(),
                    updated_at=self._clock(),
                )
                session.add(row)
                created.append(row)
            session.flush()
            return created

    def recover(self) -> list[str]:
        """Reclaim jobs whose lease expired without a clean finish.

        A row still marked ``running`` with a dead lease means the process that
        held it stopped existing. It is marked ``interrupted`` and a failure
        record is written, so the gap is visible rather than assumed away.
        """
        now = self._clock()
        recovered: list[str] = []
        with self._session_factory() as session:
            rows = session.scalars(
                select(IntelJobRow).where(IntelJobRow.status == JOB_RUNNING)
            ).all()
            for row in rows:
                if row.lease_expires_at is not None and row.lease_expires_at > now:
                    continue
                row.status = JOB_INTERRUPTED
                row.last_status = JOB_INTERRUPTED
                row.last_error = (
                    "The previous run's lease expired without a clean finish. "
                    "It was interrupted, not completed."
                )
                row.lease_owner = None
                row.lease_expires_at = None
                row.next_run_at = now
                row.updated_at = now
                session.add(
                    IntelJobFailureRow(
                        job_name=row.name,
                        occurred_at=now,
                        attempt=row.consecutive_failures + 1,
                        error_type="Interrupted",
                        message=row.last_error,
                        context={"recoveredBy": self.owner},
                    )
                )
                recovered.append(row.name)
            session.flush()
        if recovered:
            logger.warning(
                "interrupted intelligence jobs recovered",
                extra={
                    "event": "intelligence.jobs.recovered",
                    "context": {"jobs": recovered},
                },
            )
        return recovered

    def due(self) -> list[str]:
        now = self._clock()
        with self._session_factory() as session:
            rows = session.scalars(
                select(IntelJobRow).where(
                    IntelJobRow.enabled.is_(True),
                    IntelJobRow.paused.is_(False),
                    IntelJobRow.status != JOB_RUNNING,
                )
            ).all()
            return [
                row.name
                for row in rows
                if row.next_run_at is None or row.next_run_at <= now
            ]

    # -- execution ---------------------------------------------------------

    def acquire(self, name: str) -> bool:
        """Atomically claim a job's lease.

        The claim is a single conditional UPDATE, so two processes racing for
        the same job cannot both win: the database decides, not the application.
        """
        now = self._clock()
        expires = now + timedelta(seconds=max(30, self.settings.intelligence_job_lease_seconds))
        with self._session_factory() as session:
            result = session.execute(
                update(IntelJobRow)
                .where(
                    IntelJobRow.name == name,
                    IntelJobRow.enabled.is_(True),
                    IntelJobRow.paused.is_(False),
                    (IntelJobRow.lease_expires_at.is_(None))
                    | (IntelJobRow.lease_expires_at < now),
                )
                .values(
                    lease_owner=self.owner,
                    lease_expires_at=expires,
                    status=JOB_RUNNING,
                    last_started_at=now,
                    updated_at=now,
                )
            )
            session.flush()
            return bool(result.rowcount)

    def release(
        self,
        name: str,
        *,
        status: str,
        metrics: dict[str, Any] | None = None,
        error: str = "",
    ) -> None:
        now = self._clock()
        with self._session_factory() as session:
            row = session.scalar(select(IntelJobRow).where(IntelJobRow.name == name))
            if row is None:
                return
            spec = self.registry.get(name)
            interval = spec.schedule_seconds if spec else row.schedule_seconds
            row.status = status
            row.last_status = status
            row.last_finished_at = now
            row.last_error = error
            row.lease_owner = None
            row.lease_expires_at = None
            row.total_runs += 1
            row.updated_at = now
            if metrics:
                row.metrics = dict(metrics)
            if status == JOB_FAILED:
                row.total_failures += 1
                row.consecutive_failures += 1
                # Back off rather than hammering a source that is failing.
                backoff = min(interval * (2**row.consecutive_failures), 86_400)
                row.next_run_at = now + timedelta(seconds=backoff)
                session.add(
                    IntelJobFailureRow(
                        job_name=name,
                        occurred_at=now,
                        attempt=row.consecutive_failures,
                        error_type="JobFailed",
                        message=error,
                        context={"metrics": metrics or {}},
                    )
                )
                if row.consecutive_failures >= self.settings.intelligence_job_max_failures:
                    row.enabled = False
                    row.last_error = (
                        f"{error} Disabled after {row.consecutive_failures} consecutive "
                        "failures. Re-enable it once the cause is understood."
                    )
            else:
                row.consecutive_failures = 0
                row.next_run_at = now + timedelta(seconds=interval)
            session.flush()

    def run_job(self, name: str) -> dict[str, Any]:
        """Run one job if its lease can be claimed."""
        spec = self.registry.get(name)
        if spec is None:
            return {"job": name, "status": "unknown", "reason": "No such job is registered."}
        if not self.acquire(name):
            return {
                "job": name,
                "status": "skipped",
                "reason": "Another process holds the lease, or the job is paused.",
            }

        started = time.perf_counter()
        try:
            with self._session_factory() as session:
                metrics = spec.handler(session, self.settings) or {}
                session.commit()
        except Exception as exc:  # noqa: BLE001 - recorded as a failure, not raised
            self.release(name, status=JOB_FAILED, error=f"{type(exc).__name__}: {exc}")
            logger.warning(
                "intelligence job failed",
                extra={
                    "event": "intelligence.jobs.failed",
                    "context": {"job": name, "error": type(exc).__name__, "detail": str(exc)},
                },
            )
            return {"job": name, "status": JOB_FAILED, "error": str(exc)}

        elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
        metrics = {**metrics, "durationMs": elapsed_ms}
        self.release(name, status=JOB_IDLE, metrics=metrics)
        return {"job": name, "status": JOB_IDLE, "metrics": metrics}

    def run_due(self) -> list[dict[str, Any]]:
        outcomes: list[dict[str, Any]] = []
        for name in self.due():
            if self._stop.is_set():
                break
            outcomes.append(self.run_job(name))
        return outcomes

    # -- administration ----------------------------------------------------

    def pause(self, name: str) -> bool:
        return self._set_flag(name, paused=True, status=JOB_PAUSED)

    def resume(self, name: str) -> bool:
        return self._set_flag(name, paused=False, status=JOB_IDLE, reset_failures=True)

    def _set_flag(
        self,
        name: str,
        *,
        paused: bool,
        status: str,
        reset_failures: bool = False,
    ) -> bool:
        now = self._clock()
        with self._session_factory() as session:
            row = session.scalar(select(IntelJobRow).where(IntelJobRow.name == name))
            if row is None:
                return False
            row.paused = paused
            row.status = status
            row.updated_at = now
            if paused:
                row.next_run_at = None
            else:
                row.next_run_at = now
                row.enabled = True
            if reset_failures:
                row.consecutive_failures = 0
            session.flush()
            return True

    def status(self) -> list[dict[str, Any]]:
        with self._session_factory() as session:
            rows = session.scalars(
                select(IntelJobRow).order_by(IntelJobRow.name)
            ).all()
            return [_job_payload(row) for row in rows]


def _job_payload(row: IntelJobRow) -> dict[str, Any]:
    return {
        "name": row.name,
        "kind": row.kind,
        "scheduleSeconds": row.schedule_seconds,
        "enabled": row.enabled,
        "paused": row.paused,
        "status": row.status,
        "lastStatus": row.last_status,
        "lastStartedAt": row.last_started_at.isoformat() if row.last_started_at else None,
        "lastFinishedAt": row.last_finished_at.isoformat() if row.last_finished_at else None,
        "nextRunAt": row.next_run_at.isoformat() if row.next_run_at else None,
        "lastError": row.last_error,
        "consecutiveFailures": row.consecutive_failures,
        "totalRuns": row.total_runs,
        "totalFailures": row.total_failures,
        "leaseOwner": row.lease_owner,
        "leaseExpiresAt": row.lease_expires_at.isoformat() if row.lease_expires_at else None,
        "metrics": row.metrics,
    }


def _default_owner() -> str:
    """A stable identity for this process, used as the lease holder."""
    return f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:8]}"


__all__ = [
    "JOB_FAILED",
    "JOB_IDLE",
    "JOB_INTERRUPTED",
    "JOB_PAUSED",
    "JOB_RUNNING",
    "JobRegistry",
    "JobScheduler",
    "JobSpec",
    "default_registry",
]
