"""Append-only audit trail.

Every privileged action writes a row here. There is no update or delete path in
the application, so "who enabled live trading" has an answer that does not
depend on the operator's memory.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from wands.db.models import AuditEvent
from wands.logging import get_logger, redact
from wands.security.auth import Principal

logger = get_logger(__name__)


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
