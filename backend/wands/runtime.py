"""Process runtime facts."""

from __future__ import annotations

from datetime import UTC, datetime

STARTED_AT = datetime.now(tz=UTC)


def uptime_seconds() -> int:
    return int((datetime.now(tz=UTC) - STARTED_AT).total_seconds())
