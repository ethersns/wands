"""Envelope construction.

``Envelope<T>`` is the contract the Next.js frontend already consumes
(``lib/api/contracts.ts``). Building it in one place means provenance can never
be forgotten: a payload without an explicit provenance is a bug, not a default.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal

Provenance = Literal["live", "demo", "unavailable"]

SOURCE = "wands-engine"


def utcnow() -> datetime:
    return datetime.now(tz=UTC)


def isoformat(value: datetime | None = None) -> str:
    return (value or utcnow()).isoformat().replace("+00:00", "Z")


def envelope(
    data: Any,
    *,
    provenance: Provenance = "live",
    warnings: list[str] | None = None,
    source: str = SOURCE,
    generated_at: datetime | None = None,
) -> dict[str, Any]:
    return {
        "data": data,
        "provenance": provenance,
        "generatedAt": isoformat(generated_at),
        "source": source,
        "warnings": warnings or [],
    }


def unavailable(data: Any, reason: str) -> dict[str, Any]:
    """The engine is healthy but cannot produce this value.

    Used for portfolio and market data before a broker or feed is connected.
    The UI renders the reason instead of a zero balance, which is the whole
    point of the provenance field.
    """
    return envelope(data, provenance="unavailable", warnings=[reason])
