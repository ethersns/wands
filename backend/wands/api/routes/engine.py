"""Engine status and the kill switches."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from wands.api.deps import (
    admin_principal,
    client_ip,
    request_id_of,
    require_role,
)
from wands.config import Settings, get_settings
from wands.db.models import AuditEvent, BotRow, ConnectionRow
from wands.db.session import get_session
from wands.envelope import envelope, isoformat
from wands.errors import BadRequest, Forbidden
from wands.marketdata.service import MarketDataService
from wands.runtime import uptime_seconds
from wands.schemas import (
    AuditEventOut,
    EngineState,
    EngineStatus,
    LiveTradingRequest,
    PauseRequest,
    TradingMode,
    dump,
    dump_many,
)
from wands.security.audit import record_for_principal
from wands.security.auth import Principal
from wands.security.rbac import Role
from wands.state import get_engine_state

router = APIRouter(prefix="/engine", tags=["engine"])

LIVE_CONFIRMATION = "ENABLE LIVE TRADING"


def _state_name(state) -> EngineState:
    if state.emergency_stop_engaged:
        return EngineState.HALTED
    if state.trading_paused:
        return EngineState.PAUSED
    return EngineState.OPERATIONAL


@router.get("/status")
def engine_status(
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    principal: Principal = Depends(require_role(Role.VIEWER)),
) -> dict:
    state = get_engine_state(session)
    active_bots = session.scalar(
        select(func.count()).select_from(BotRow).where(BotRow.state == "running")
    )
    connections = session.scalar(select(func.count()).select_from(ConnectionRow)) or 0

    notes: list[str] = []
    if connections == 0:
        notes.append(
            "No broker connection is configured, so portfolio and market data are "
            "unavailable. Add a connection to begin paper trading."
        )
    if state.emergency_stop_engaged:
        notes.append(
            f"Emergency stop engaged by {state.emergency_stop_actor or 'unknown'} at "
            f"{isoformat(state.emergency_stop_at)}."
        )
    if state.trading_paused:
        notes.append("Trading is paused. New orders are blocked.")
    if not settings.live_trading_enabled:
        notes.append("Live trading is disabled at deployment level.")

    market_data = MarketDataService(session, settings=settings)
    stalest = market_data.stalest_quote_age_seconds()
    if stalest is None:
        notes.append(
            "No market data has been ingested yet, so no quote is available to price an "
            "order."
        )
    elif stalest > 60:
        notes.append(f"The oldest stored quote is {stalest:.0f}s old.")

    status = EngineStatus(
        state=_state_name(state),
        mode=TradingMode(state.trading_mode),
        live_trading_enabled=bool(state.live_trading_enabled and settings.live_trading_enabled),
        version=settings.version,
        region=settings.region,
        uptime_seconds=uptime_seconds(),
        last_heartbeat=isoformat(),
        market_data_latency_ms=market_data.latency_ms(),
        stalest_quote_age_seconds=stalest,
        active_bots=int(active_bots or 0),
        queued_jobs=0,
        notes=notes,
    )
    return envelope(dump(status))


@router.post("/pause")
def pause(
    payload: PauseRequest,
    request: Request,
    session: Session = Depends(get_session),
    principal: Principal = Depends(require_role(Role.OPERATOR)),
) -> dict:
    state = get_engine_state(session)
    state.trading_paused = payload.paused
    state.version += 1
    record_for_principal(
        session,
        principal,
        action="engine.pause" if payload.paused else "engine.resume",
        target="engine",
        detail={"paused": payload.paused},
        request_id=request_id_of(request),
        ip=client_ip(request),
    )
    session.flush()
    return envelope({"tradingPaused": state.trading_paused})


@router.post("/emergency-stop")
def emergency_stop(
    request: Request,
    session: Session = Depends(get_session),
    principal: Principal = Depends(admin_principal),
) -> dict:
    state = get_engine_state(session)
    state.emergency_stop_engaged = True
    state.emergency_stop_at = datetime.now(tz=UTC)
    state.emergency_stop_actor = principal.subject
    state.trading_paused = True
    state.version += 1
    record_for_principal(
        session,
        principal,
        action="engine.emergency_stop",
        target="engine",
        detail={"engaged": True},
        request_id=request_id_of(request),
        ip=client_ip(request),
    )
    session.flush()
    return envelope({"acknowledged": True, "emergencyStopEngaged": True})


@router.post("/emergency-stop/clear")
def clear_emergency_stop(
    request: Request,
    session: Session = Depends(get_session),
    principal: Principal = Depends(admin_principal),
) -> dict:
    state = get_engine_state(session)
    if not state.emergency_stop_engaged:
        raise BadRequest("The emergency stop is not engaged.")
    state.emergency_stop_engaged = False
    state.emergency_stop_at = None
    state.emergency_stop_actor = None
    state.version += 1
    record_for_principal(
        session,
        principal,
        action="engine.emergency_stop.clear",
        target="engine",
        detail={"engaged": False},
        request_id=request_id_of(request),
        ip=client_ip(request),
    )
    session.flush()
    return envelope({"acknowledged": True, "emergencyStopEngaged": False})


@router.post("/live-trading")
def set_live_trading(
    payload: LiveTradingRequest,
    request: Request,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    principal: Principal = Depends(admin_principal),
) -> dict:
    """Enable or disable live trading.

    Three independent conditions must hold to enable: the deployment flag, an
    explicit confirmation string, and an authenticated admin with MFA. Disabling
    is always allowed and never requires the confirmation.
    """
    state = get_engine_state(session)

    if payload.enabled:
        if not settings.live_trading_enabled:
            raise Forbidden(
                "Live trading is disabled at deployment level. Set "
                "WANDS_LIVE_TRADING_ENABLED=true on the engine host first."
            )
        if payload.confirmation.strip() != LIVE_CONFIRMATION:
            raise BadRequest(f'Confirmation must be exactly "{LIVE_CONFIRMATION}".')
        if state.emergency_stop_engaged:
            raise BadRequest("Clear the emergency stop before enabling live trading.")

    state.live_trading_enabled = payload.enabled
    state.version += 1
    record_for_principal(
        session,
        principal,
        action="engine.live_trading.enable" if payload.enabled else "engine.live_trading.disable",
        target="engine",
        detail={"enabled": payload.enabled},
        request_id=request_id_of(request),
        ip=client_ip(request),
    )
    session.flush()
    return envelope({"liveTradingEnabled": state.live_trading_enabled})


@router.get("/audit")
def audit_log(
    limit: int = 100,
    session: Session = Depends(get_session),
    principal: Principal = Depends(require_role(Role.ADMIN)),
) -> dict:
    limit = max(1, min(limit, 500))
    rows = session.scalars(select(AuditEvent).order_by(AuditEvent.at.desc()).limit(limit)).all()
    events = [
        AuditEventOut(
            id=str(row.id),
            at=isoformat(row.at) or "",
            actor=row.actor,
            actor_type=row.actor_type,
            action=row.action,
            target=row.target,
            outcome=row.outcome,
            detail=row.detail or {},
            request_id=row.request_id,
            ip=row.ip,
        )
        for row in rows
    ]
    return envelope(dump_many(events))
