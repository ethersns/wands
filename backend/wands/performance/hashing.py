"""Canonical hashing for tamper-evident records.

Two runs that produced the same evidence must hash the same, and a record edited
after the fact must hash differently. That needs a canonical serialisation:
sorted keys, no insignificant whitespace, and a stable rendering of datetimes
and decimals. ``Decimal("0.10")`` and ``Decimal("0.1")`` are the same number and
must produce the same hash, so trailing zeros are stripped rather than trusted.
"""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID


def _decimal_text(value: Decimal) -> str:
    text = format(value, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


def _default(value: Any) -> Any:
    if isinstance(value, Decimal):
        return _decimal_text(value)
    if isinstance(value, datetime):
        moment = value if value.tzinfo else value.replace(tzinfo=UTC)
        return moment.astimezone(UTC).isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, UUID):
        return str(value)
    raise TypeError(f"Cannot canonicalise {type(value).__name__} for hashing.")


def canonical_json(payload: Any) -> str:
    return json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        default=_default,
        ensure_ascii=False,
    )


def content_hash(payload: Any) -> str:
    return hashlib.sha256(canonical_json(payload).encode("utf-8")).hexdigest()
