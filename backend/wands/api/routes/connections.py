"""Broker and exchange connections.

Credentials are encrypted before they touch the database and are never returned
in any response — only ``keyHint``, the last four characters. No adapter for a
real venue exists in this build, so a new connection is stored as
``not_configured`` and ``available: false`` rather than pretending to be live.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from wands.api.deps import admin_principal, client_ip, request_id_of, require_role
from wands.config import Settings, get_settings
from wands.db.models import ConnectionRow
from wands.db.session import get_session
from wands.envelope import envelope, isoformat
from wands.errors import BadRequest, NotFound
from wands.schemas import (
    AccessLevel,
    ConnectionCreate,
    ConnectionOut,
    ConnectionStatus,
    MarketType,
    Provider,
    TradingMode,
    dump_many,
)
from wands.security.audit import record_for_principal
from wands.security.auth import Principal
from wands.security.rbac import Role
from wands.security.secrets import SecretBox, key_hint

router = APIRouter(prefix="/connections", tags=["connections"])

PROVIDER_MARKET: dict[Provider, MarketType] = {
    Provider.KRAKEN: MarketType.CRYPTO,
    Provider.ALPACA: MarketType.STOCKS,
    Provider.INTERACTIVE_BROKERS: MarketType.STOCKS,
}

# Adapters that exist in this build. Only the paper simulator is implemented, so
# every real venue reports available: false.
AVAILABLE_PROVIDERS: frozenset[str] = frozenset()


def _out(row: ConnectionRow) -> ConnectionOut:
    return ConnectionOut(
        id=str(row.id),
        provider=Provider(row.provider),
        label=row.label,
        market_type=MarketType(row.market_type),
        status=ConnectionStatus(row.status),
        access=AccessLevel(row.access),
        mode=TradingMode(row.mode),
        key_hint=row.key_hint,
        permissions=list(row.permissions or []),
        last_synced_at=isoformat(row.last_synced_at),
        error=row.error,
        available=row.provider in AVAILABLE_PROVIDERS,
    )


@router.get("")
def list_connections(
    session: Session = Depends(get_session),
    principal: Principal = Depends(require_role(Role.VIEWER)),
) -> dict:
    rows = session.scalars(select(ConnectionRow).order_by(ConnectionRow.created_at)).all()
    return envelope(dump_many([_out(row) for row in rows]))


@router.post("")
def create_connection(
    payload: ConnectionCreate,
    request: Request,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    principal: Principal = Depends(admin_principal),
) -> dict:
    expected_market = PROVIDER_MARKET[payload.provider]
    if payload.market_type != expected_market:
        raise BadRequest(f"{payload.provider} trades {expected_market}, not {payload.market_type}.")

    if payload.mode == TradingMode.LIVE and payload.access != AccessLevel.TRADING:
        raise BadRequest("A live connection must be created with trading access.")

    box = SecretBox(settings.require_encryption_key())
    encrypted = box.encrypt(
        {
            "apiKey": payload.api_key,
            "apiSecret": payload.api_secret,
            # Withdrawal permission is never requested, so it is never stored.
            "permissions": ["read", "trade"] if payload.access == AccessLevel.TRADING else ["read"],
        }
    )

    row = ConnectionRow(
        provider=str(payload.provider),
        label=payload.label,
        market_type=str(payload.market_type),
        status=str(ConnectionStatus.NOT_CONFIGURED),
        access=str(payload.access),
        mode=str(payload.mode),
        key_hint=key_hint(payload.api_key),
        credentials_encrypted=encrypted,
        permissions=["read"] if payload.access == AccessLevel.READ_ONLY else ["read", "trade"],
        error=(
            "No adapter for this venue is implemented in this build. The credentials are "
            "stored encrypted but cannot be used to trade yet."
        ),
    )
    session.add(row)
    session.flush()

    record_for_principal(
        session,
        principal,
        action="connection.create",
        target=str(row.id),
        detail={
            "provider": str(payload.provider),
            "mode": str(payload.mode),
            "access": str(payload.access),
        },
        request_id=request_id_of(request),
        ip=client_ip(request),
    )
    return envelope({"id": str(row.id)})


@router.post("/{connection_id}/test")
def test_connection(
    connection_id: str,
    request: Request,
    session: Session = Depends(get_session),
    principal: Principal = Depends(admin_principal),
) -> dict:
    try:
        parsed = uuid.UUID(connection_id)
    except ValueError as exc:
        raise NotFound("Unknown connection.") from exc

    row = session.get(ConnectionRow, parsed)
    if row is None:
        raise NotFound("Unknown connection.")

    if row.provider not in AVAILABLE_PROVIDERS:
        row.status = str(ConnectionStatus.NOT_CONFIGURED)
        row.error = (
            f"No {row.provider} adapter is implemented in this build, so the connection "
            "cannot be tested. Nothing was sent to the venue."
        )
    else:
        row.status = str(ConnectionStatus.CONNECTED)
        row.error = None

    record_for_principal(
        session,
        principal,
        action="connection.test",
        target=str(row.id),
        detail={"status": row.status},
        request_id=request_id_of(request),
        ip=client_ip(request),
    )
    session.flush()
    return envelope({"status": row.status, "error": row.error})


@router.delete("/{connection_id}")
def delete_connection(
    connection_id: str,
    request: Request,
    session: Session = Depends(get_session),
    principal: Principal = Depends(admin_principal),
) -> dict:
    try:
        parsed = uuid.UUID(connection_id)
    except ValueError as exc:
        raise NotFound("Unknown connection.") from exc

    row = session.get(ConnectionRow, parsed)
    if row is None:
        raise NotFound("Unknown connection.")

    session.delete(row)
    record_for_principal(
        session,
        principal,
        action="connection.delete",
        target=connection_id,
        detail={"provider": row.provider},
        request_id=request_id_of(request),
        ip=client_ip(request),
    )
    session.flush()
    return envelope({"deleted": True})
