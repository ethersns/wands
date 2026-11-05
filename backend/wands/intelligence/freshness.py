"""Data freshness monitoring.

A research feed that has silently stopped collecting is worse than one that says
it is empty, because the screen still looks populated. Freshness is therefore
derived from the ingestion run log rather than from a heartbeat: the only
evidence that data is current is a run that actually finished.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from wands.config import Settings
from wands.db.models import IntelIngestRunRow

STATUS_FRESH = "fresh"
STATUS_STALE = "stale"
STATUS_NEVER = "never"
STATUS_FAILING = "failing"


@dataclass(frozen=True)
class SourceFreshness:
    source: str
    status: str
    last_attempt_at: datetime | None
    last_success_at: datetime | None
    age_seconds: int | None
    stale_after_seconds: int
    detail: str


class FreshnessMonitor:
    def __init__(self, session: Session, settings: Settings) -> None:
        self.session = session
        self.settings = settings

    @property
    def stale_after_seconds(self) -> int:
        # Two missed cycles is the point at which a collector is late rather
        # than merely between runs.
        return max(self.settings.intelligence_ingest_interval_seconds * 2, 3600)

    def sources(self, *, now: datetime | None = None) -> list[SourceFreshness]:
        moment = now or datetime.now(tz=UTC)
        names = sorted(
            {
                row
                for row in self.session.scalars(
                    select(IntelIngestRunRow.source).distinct()
                ).all()
                if row
            }
        )
        if not names:
            return [
                SourceFreshness(
                    source="sec_edgar",
                    status=STATUS_NEVER,
                    last_attempt_at=None,
                    last_success_at=None,
                    age_seconds=None,
                    stale_after_seconds=self.stale_after_seconds,
                    detail=(
                        "No ingestion has run. Insider and institutional data are empty "
                        "because nothing has been collected, not because nothing happened."
                    ),
                )
            ]
        return [self._for_source(name, moment) for name in names]

    def overall(self, *, now: datetime | None = None) -> str:
        statuses = {item.status for item in self.sources(now=now)}
        if statuses == {STATUS_FRESH}:
            return STATUS_FRESH
        if STATUS_NEVER in statuses:
            return STATUS_NEVER
        if STATUS_FAILING in statuses:
            return STATUS_FAILING
        return STATUS_STALE

    def _for_source(self, source: str, now: datetime) -> SourceFreshness:
        last_attempt = self.session.scalar(
            select(IntelIngestRunRow)
            .where(IntelIngestRunRow.source == source)
            .order_by(IntelIngestRunRow.started_at.desc())
            .limit(1)
        )
        last_success = self.session.scalar(
            select(IntelIngestRunRow)
            .where(
                IntelIngestRunRow.source == source,
                IntelIngestRunRow.status.in_(["ok", "partial"]),
            )
            .order_by(IntelIngestRunRow.started_at.desc())
            .limit(1)
        )

        if last_attempt is None:
            return SourceFreshness(
                source=source,
                status=STATUS_NEVER,
                last_attempt_at=None,
                last_success_at=None,
                age_seconds=None,
                stale_after_seconds=self.stale_after_seconds,
                detail="No ingestion has run for this source.",
            )

        reference = last_success.started_at if last_success is not None else None
        age = int((now - reference).total_seconds()) if reference is not None else None

        if last_attempt.status == "failed":
            status = STATUS_FAILING
            detail = (
                f"The most recent run failed: "
                f"{(last_attempt.errors or [{}])[0].get('message', 'no detail recorded')}"
            )
        elif age is None:
            status = STATUS_NEVER
            detail = "No run has completed successfully."
        elif age > self.stale_after_seconds:
            status = STATUS_STALE
            detail = (
                f"The last successful run was {age} seconds ago, beyond the "
                f"{self.stale_after_seconds}-second freshness window."
            )
        else:
            status = STATUS_FRESH
            detail = f"The last successful run was {age} seconds ago."

        return SourceFreshness(
            source=source,
            status=status,
            last_attempt_at=last_attempt.started_at,
            last_success_at=reference,
            age_seconds=age,
            stale_after_seconds=self.stale_after_seconds,
            detail=detail,
        )


__all__ = [
    "FreshnessMonitor",
    "SourceFreshness",
    "STATUS_FAILING",
    "STATUS_FRESH",
    "STATUS_NEVER",
    "STATUS_STALE",
]
