"""Append-only audit trail.

Every privileged action writes a row here. There is no update or delete path in
the application, so "who enabled live trading" has an answer that does not
depend on the operator's memory.
"""

from __future__ import annotations

from collections import Counter
from threading import Lock
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from wands.db.models import AuditEvent
from wands.db.session import session_scope
from wands.logging import get_logger, redact
from wands.security.auth import Principal

logger = get_logger(__name__)

DENIAL_ACTION = "authorization.denied"

# Rejections are counted in memory rather than written to the audit table when
# the caller is unauthenticated: an anonymous client controls how often it
# retries, so persisting each attempt would let anyone flood the durable trail.
# The counter is exposed on the ops endpoint and the structured log line is what
# alerting keys on.
_denial_counts: Counter[str] = Counter()
_denial_lock = Lock()


def note_denial(kind: str) -> None:
    with _denial_lock:
        _denial_counts[kind] += 1


def denial_counts() -> dict[str, int]:
    with _denial_lock:
        return dict(_denial_counts)


def reset_denial_counts() -> None:
    with _denial_lock:
        _denial_counts.clear()


def record(
    session: Session,
    *,
    actor: str,
    actor_type: str,
    action: str,
    target: str | None = None,
    outcome: str = "success",
    detail: dict[str, Any] | None = None,
    request_id: str | None = None,
    ip: str | None = None,
) -> AuditEvent:
    event = AuditEvent(
        actor=actor,
        actor_type=actor_type,
        action=action,
        target=target,
        outcome=outcome,
        detail=redact(detail or {}),
        request_id=request_id,
        ip=ip,
    )
    session.add(event)
    session.flush()

    logger.info(
        "audit",
        extra={
            "event": "audit",
            "principal": actor,
            "actor_type": actor_type,
            "outcome": outcome,
            "request_id": request_id,
            "context": {"action": action, "target": target, "detail": detail or {}},
        },
    )
    return event


def record_for_principal(
    session: Session,
    principal: Principal,
    *,
    action: str,
    target: str | None = None,
    outcome: str = "success",
    detail: dict[str, Any] | None = None,
    request_id: str | None = None,
    ip: str | None = None,
) -> AuditEvent:
    return record(
        session,
        actor=principal.subject,
        actor_type="service" if principal.is_service else "user",
        action=action,
        target=target,
        outcome=outcome,
        detail=detail,
        request_id=request_id,
        ip=ip,
    )


def _denial_already_recorded(session: Session, request_id: str, target: str | None) -> bool:
    statement = select(AuditEvent.id).where(
        AuditEvent.request_id == request_id,
        AuditEvent.action == DENIAL_ACTION,
    )
    if target is not None:
        statement = statement.where(AuditEvent.target == target)
    return session.scalar(statement.limit(1)) is not None


def record_denial(
    *,
    actor: str,
    actor_type: str,
    target: str | None,
    detail: dict[str, Any] | None = None,
    request_id: str | None = None,
    ip: str | None = None,
) -> bool:
    """Persist a permission denial in its own transaction.

    The request's session is rolled back when the 403 propagates, so a denial
    written there would vanish along with the request that produced it. This
    commits separately and returns ``False`` when the audit store is
    unreachable; the caller must still deny the request, so authorisation stays
    fail-closed either way.
    """
    try:
        with session_scope() as session:
            if request_id and _denial_already_recorded(session, request_id, target):
                return True
            record(
                session,
                actor=actor,
                actor_type=actor_type,
                action=DENIAL_ACTION,
                target=target,
                outcome="denied",
                detail=detail,
                request_id=request_id,
                ip=ip,
            )
        return True
    except Exception:
        logger.exception(
            "audit denial write failed",
            extra={
                "event": "audit.denial_write_failed",
                "request_id": request_id,
                "context": {"actor": actor, "target": target},
            },
        )
        return False
