"""Idempotency.

Two layers, because one is not enough:

* the ``orders.client_order_id`` unique constraint is the database-level
  guarantee — even two racing processes cannot both insert;
* ``recent_client_order_ids`` gives the risk engine a window in which a repeat
  is a *risk violation* rather than a silent duplicate.

A retry after an unknown outcome must reconcile with the broker first. Retrying
blindly is how a single intended position becomes two.
"""

from __future__ import annotations

import hashlib
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from wands.db.models import OrderRow


def derive_client_order_id(
    *,
    account_id: str,
    symbol: str,
    side: str,
    quantity: str,
    nonce: str | None = None,
) -> str:
    """Deterministic id for a caller that does not supply one.

    Deterministic on purpose: the same logical order submitted twice with the
    same nonce produces the same id, so the second attempt is caught as a
    duplicate instead of becoming a second position.
    """
    material = f"{account_id}|{symbol}|{side}|{quantity}|{nonce or ''}"
    digest = hashlib.sha256(material.encode()).hexdigest()[:24]
    return f"wands-{digest}"


def new_client_order_id() -> str:
    return f"wands-{uuid.uuid4().hex[:24]}"


def recent_client_order_ids(
    session: Session, *, window_seconds: int, now: datetime | None = None
) -> frozenset[str]:
    if window_seconds <= 0:
        return frozenset()
    cutoff = (now or datetime.now(tz=UTC)) - timedelta(seconds=window_seconds)
    rows = session.scalars(
        select(OrderRow.client_order_id).where(OrderRow.created_at >= cutoff)
    ).all()
    return frozenset(rows)


def find_existing_order(session: Session, client_order_id: str) -> OrderRow | None:
    return session.scalar(
        select(OrderRow).where(OrderRow.client_order_id == client_order_id).limit(1)
    )
