"""User settings.

The service token has no user of its own, so it acts as the system operator
account. A per-user API key edits only its own settings.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from wands.api.deps import client_ip, request_id_of, require_role
from wands.bootstrap import ensure_system_user
from wands.config import Settings, get_settings
from wands.db.models import User, UserSettings
from wands.db.session import get_session
from wands.envelope import envelope, isoformat
from wands.schemas import (
    AuditSettings,
    EngineSettings,
    NotificationSettings,
    UserSettingsOut,
    UserSettingsPatch,
    dump,
)
from wands.security.audit import record_for_principal
from wands.security.auth import Principal
from wands.security.rbac import Role

router = APIRouter(prefix="/settings", tags=["settings"])

DEFAULT_NOTIFICATIONS = {
    "tradeFills": True,
    "riskBreaches": True,
    "engineOffline": True,
    "dailySummary": False,
}


def _resolve_user(session: Session, principal: Principal) -> User:
    if principal.user_id is not None:
        user = session.get(User, principal.user_id)
        if user is not None:
            return user
    return ensure_system_user(session)


def _settings_row(session: Session, user: User) -> UserSettings:
    row = session.scalar(select(UserSettings).where(UserSettings.user_id == user.id))
    if row is None:
        row = UserSettings(
            user_id=user.id,
            base_currency="USD",
            theme="dark",
            notifications=dict(DEFAULT_NOTIFICATIONS),
        )
        session.add(row)
        session.flush()
    return row


def _out(row: UserSettings, user: User, settings: Settings) -> UserSettingsOut:
    return UserSettingsOut(
        display_name=user.display_name,
        email=user.email,
        base_currency=row.base_currency,
        theme=row.theme,  # type: ignore[arg-type]
        two_factor_enabled=bool(user.mfa_enabled),
        notifications=NotificationSettings(**(row.notifications or DEFAULT_NOTIFICATIONS)),
        engine=EngineSettings(
            endpoint_configured=bool(settings.engine_token),
            region=settings.region,
            heartbeat_seconds=30,
        ),
        audit=AuditSettings(
            last_backup_at=isoformat(row.last_backup_at),
            retention_days=row.retention_days,
        ),
    )


@router.get("")
def get_settings_route(
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    principal: Principal = Depends(require_role(Role.VIEWER)),
) -> dict:
    user = _resolve_user(session, principal)
    row = _settings_row(session, user)
    return envelope(dump(_out(row, user, settings)))


@router.patch("")
def update_settings(
    payload: UserSettingsPatch,
    request: Request,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    principal: Principal = Depends(require_role(Role.VIEWER)),
) -> dict:
    user = _resolve_user(session, principal)
    row = _settings_row(session, user)

    if payload.display_name is not None:
        user.display_name = payload.display_name
    if payload.base_currency is not None:
        row.base_currency = payload.base_currency.upper()
    if payload.theme is not None:
        row.theme = payload.theme
    if payload.notifications is not None:
        row.notifications = dump(payload.notifications)

    record_for_principal(
        session,
        principal,
        action="settings.update",
        target=str(user.id),
        detail=payload.model_dump(exclude_none=True),
        request_id=request_id_of(request),
        ip=client_ip(request),
    )
    session.flush()
    return envelope(dump(_out(row, user, settings)))
