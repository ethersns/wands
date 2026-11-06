"""Scheduled research jobs: leases, overlap, recovery and dead letters.

The overlap test is the important one. Two processes pointed at the same
database must not both run the same crawl, and the only way to guarantee that is
for the database to decide the winner rather than the application.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from wands.config import get_settings
from wands.db.models import IntelJobFailureRow, IntelJobRow
from wands.intelligence.jobs import (
    JOB_FAILED,
    JOB_IDLE,
    JOB_INTERRUPTED,
    JOB_PAUSED,
    JobRegistry,
    JobScheduler,
    JobSpec,
)

NOW = datetime(2026, 11, 5, 12, 0, tzinfo=UTC)


class Clock:
    """A movable clock, so a lease can expire without a test sleeping."""

    def __init__(self, moment: datetime = NOW) -> None:
        self.moment = moment

    def __call__(self) -> datetime:
        return self.moment

    def advance(self, **kwargs) -> None:
        self.moment = self.moment + timedelta(**kwargs)


def _registry(handler=None, *, name: str = "test_job", schedule: int = 3600) -> JobRegistry:
    registry = JobRegistry()
    registry.register(
        JobSpec(
            name=name,
            kind="ingest",
            schedule_seconds=schedule,
            handler=handler or (lambda session, settings: {"ok": True}),
        )
    )
    return registry


def _scheduler(clock: Clock, registry: JobRegistry, *, owner: str = "worker-a") -> JobScheduler:
    return JobScheduler(
        get_settings(),
        registry=registry,
        owner=owner,
        clock=clock,
        sleep=lambda seconds: None,
    )


def test_ensure_jobs_creates_one_row_per_registered_job(session):
    clock = Clock()
    scheduler = _scheduler(clock, _registry())
    scheduler.ensure_jobs()
    scheduler.ensure_jobs()

    rows = session.scalars(select(IntelJobRow)).all()
    assert len(rows) == 1
    assert rows[0].name == "test_job"
    assert rows[0].next_run_at == NOW


def test_a_lease_can_only_be_held_by_one_worker(session):
    clock = Clock()
    registry = _registry()
    first = _scheduler(clock, registry, owner="worker-a")
    second = _scheduler(clock, registry, owner="worker-b")
    first.ensure_jobs()

    assert first.acquire("test_job") is True
    # The second worker cannot claim a live lease, so the crawl cannot overlap.
    assert second.acquire("test_job") is False

    row = session.scalar(select(IntelJobRow))
    assert row.lease_owner == "worker-a"
    assert row.status == "running"


def test_an_expired_lease_can_be_reclaimed(session):
    clock = Clock()
    registry = _registry()
    first = _scheduler(clock, registry, owner="worker-a")
    second = _scheduler(clock, registry, owner="worker-b")
    first.ensure_jobs()
    first.acquire("test_job")

    clock.advance(seconds=get_settings().intelligence_job_lease_seconds + 1)

    assert second.acquire("test_job") is True
    row = session.scalar(select(IntelJobRow))
    assert row.lease_owner == "worker-b"


def test_release_schedules_the_next_run_and_clears_the_lease(session):
    clock = Clock()
    scheduler = _scheduler(clock, _registry(schedule=600))
    scheduler.ensure_jobs()
    scheduler.acquire("test_job")
    scheduler.release("test_job", status=JOB_IDLE, metrics={"filingsNew": 4})

    row = session.scalar(select(IntelJobRow))
    assert row.status == JOB_IDLE
    assert row.lease_owner is None
    assert row.next_run_at == NOW + timedelta(seconds=600)
    assert row.metrics == {"filingsNew": 4}
    assert row.total_runs == 1


def test_a_failed_run_backs_off_and_records_a_dead_letter(session):
    clock = Clock()
    scheduler = _scheduler(clock, _registry(schedule=600))
    scheduler.ensure_jobs()
    scheduler.acquire("test_job")
    scheduler.release("test_job", status=JOB_FAILED, error="SEC is down")

    row = session.scalar(select(IntelJobRow))
    assert row.consecutive_failures == 1
    assert row.next_run_at == NOW + timedelta(seconds=1200)
    failures = session.scalars(select(IntelJobFailureRow)).all()
    assert len(failures) == 1
    assert failures[0].message == "SEC is down"


def test_a_job_is_disabled_after_the_configured_failure_limit(session):
    clock = Clock()
    settings = get_settings()
    scheduler = _scheduler(clock, _registry(schedule=60))
    scheduler.ensure_jobs()

    for _ in range(settings.intelligence_job_max_failures):
        scheduler.acquire("test_job")
        scheduler.release("test_job", status=JOB_FAILED, error="still down")

    row = session.scalar(select(IntelJobRow))
    assert row.enabled is False
    assert row.consecutive_failures == settings.intelligence_job_max_failures
    assert "Disabled after" in row.last_error


def test_recover_marks_an_abandoned_run_as_interrupted(session):
    clock = Clock()
    scheduler = _scheduler(clock, _registry())
    scheduler.ensure_jobs()
    scheduler.acquire("test_job")

    clock.advance(seconds=get_settings().intelligence_job_lease_seconds + 1)
    recovered = scheduler.recover()

    assert recovered == ["test_job"]
    row = session.scalar(select(IntelJobRow))
    assert row.status == JOB_INTERRUPTED
    assert row.lease_owner is None
    # The gap is recorded rather than assumed away.
    failures = session.scalars(select(IntelJobFailureRow)).all()
    assert failures[0].error_type == "Interrupted"


def test_recover_leaves_a_live_lease_alone(session):
    clock = Clock()
    scheduler = _scheduler(clock, _registry())
    scheduler.ensure_jobs()
    scheduler.acquire("test_job")

    assert scheduler.recover() == []
    assert session.scalar(select(IntelJobRow)).status == "running"


def test_pause_and_resume_control_scheduling(session):
    clock = Clock()
    scheduler = _scheduler(clock, _registry())
    scheduler.ensure_jobs()

    assert scheduler.pause("test_job") is True
    # The scheduler writes through its own session, so the fixture's identity
    # map has to be expired before it can see the change.
    session.expire_all()
    row = session.scalar(select(IntelJobRow))
    assert row.paused is True
    assert row.status == JOB_PAUSED
    assert row.next_run_at is None
    assert scheduler.due() == []

    assert scheduler.resume("test_job") is True
    session.expire_all()
    row = session.scalar(select(IntelJobRow))
    assert row.paused is False
    assert row.next_run_at == NOW
    assert scheduler.due() == ["test_job"]


def test_pausing_an_unknown_job_reports_failure(session):
    scheduler = _scheduler(Clock(), _registry())
    assert scheduler.pause("nope") is False
    assert scheduler.resume("nope") is False


def test_run_job_is_idempotent_while_the_lease_is_held(session):
    clock = Clock()
    calls: list[str] = []

    def handler(db_session, settings):
        calls.append("ran")
        return {"ok": True}

    registry = _registry(handler)
    first = _scheduler(clock, registry, owner="worker-a")
    second = _scheduler(clock, registry, owner="worker-b")
    first.ensure_jobs()

    first.acquire("test_job")
    outcome = second.run_job("test_job")

    assert outcome["status"] == "skipped"
    assert calls == []


def test_run_job_records_metrics_and_clears_the_lease(session):
    clock = Clock()
    registry = _registry(lambda db_session, settings: {"filingsNew": 7})
    scheduler = _scheduler(clock, registry)
    scheduler.ensure_jobs()

    outcome = scheduler.run_job("test_job")

    assert outcome["status"] == JOB_IDLE
    assert outcome["metrics"]["filingsNew"] == 7
    row = session.scalar(select(IntelJobRow))
    assert row.lease_owner is None
    assert row.metrics["filingsNew"] == 7


def test_a_raising_handler_is_recorded_as_a_failure(session):
    def handler(db_session, settings):
        raise RuntimeError("collector exploded")

    clock = Clock()
    scheduler = _scheduler(clock, _registry(handler))
    scheduler.ensure_jobs()

    outcome = scheduler.run_job("test_job")

    assert outcome["status"] == JOB_FAILED
    row = session.scalar(select(IntelJobRow))
    assert row.consecutive_failures == 1
    assert "collector exploded" in row.last_error


def test_run_due_only_runs_jobs_that_are_due(session):
    clock = Clock()
    registry = _registry(schedule=3600)
    scheduler = _scheduler(clock, registry)
    scheduler.ensure_jobs()

    assert len(scheduler.run_due()) == 1
    # The next run is an hour away, so nothing is due now.
    assert scheduler.run_due() == []

    clock.advance(seconds=3601)
    assert len(scheduler.run_due()) == 1


def test_status_reports_every_job(session):
    clock = Clock()
    scheduler = _scheduler(clock, _registry())
    scheduler.ensure_jobs()

    payload = scheduler.status()
    assert len(payload) == 1
    assert payload[0]["name"] == "test_job"
    assert payload[0]["scheduleSeconds"] == 3600
    assert payload[0]["enabled"] is True


def test_the_default_registry_contains_only_collectors():
    from wands.intelligence.jobs import default_registry

    registry = default_registry()
    names = {spec.name for spec in registry.all()}
    assert names == {"insider_ingest", "institutional_ingest"}
    # No job may be able to reach the order path.
    for spec in registry.all():
        assert spec.kind == "ingest"
