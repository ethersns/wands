"""Trading bots.

A bot is a schedule plus a strategy plus a connection. Creating one does not
start it, and a bot can never be created in ``live`` mode unless live trading is
enabled at both the deployment and engine level.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, Request
from pydantic import Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from wands.api.deps import client_ip, request_id_of, require_role
from wands.config import Settings, get_settings
from wands.db.models import BotLogRow, BotRow, ConnectionRow, StrategyRow
from wands.db.session import get_session
from wands.envelope import envelope, isoformat
from wands.errors import BadRequest, Forbidden, NotFound
from wands.schemas import (
    BotLogEntry,
    BotState,
    BotStats,
    CamelModel,
    MarketType,
    TradingBotOut,
    TradingMode,
    dump_many,
)
from wands.security.audit import record_for_principal
from wands.security.auth import Principal
from wands.security.rbac import Role
from wands.state import get_engine_state

router = APIRouter(prefix="/bots", tags=["bots"])


class BotCreate(CamelModel):
    name: str = Field(min_length=1, max_length=120)
    market_type: MarketType
    account_id: str
    strategy_id: str
    symbols: list[str] = Field(min_length=1, max_length=20)
    timeframe: str = Field(default="1h", max_length=8)
    mode: TradingMode = TradingMode.PAPER
    allocated_capital: Decimal = Field(gt=0)
    position_size_pct: Decimal = Field(default=Decimal("1"), gt=0, le=100)
    stop_loss_pct: Decimal = Field(default=Decimal("2"), gt=0, le=50)
    take_profit_pct: Decimal = Field(default=Decimal("4"), gt=0, le=200)
    max_open_positions: int = Field(default=1, ge=1, le=50)
    daily_loss_limit_pct: Decimal = Field(default=Decimal("2"), gt=0, le=100)
    schedule: str = Field(default="*/15 * * * *", max_length=64)


def _out(
    bot: BotRow, connection: ConnectionRow | None, strategy: StrategyRow | None
) -> TradingBotOut:
    return TradingBotOut(
        id=str(bot.id),
        name=bot.name,
        market_type=MarketType(bot.market_type),
        account_id=str(bot.connection_id) if bot.connection_id else "",
        account_label=connection.label if connection else "unassigned",
        strategy_id=str(bot.strategy_id) if bot.strategy_id else "",
        strategy_name=strategy.name if strategy else "unknown",
        symbols=list(bot.symbols or []),
        timeframe=bot.timeframe,
        mode=TradingMode(bot.mode),
        state=BotState(bot.state),
        allocated_capital=Decimal(bot.allocated_capital),
        position_size_pct=Decimal(bot.position_size_pct),
        stop_loss_pct=Decimal(bot.stop_loss_pct),
        take_profit_pct=Decimal(bot.take_profit_pct),
        max_open_positions=bot.max_open_positions,
        daily_loss_limit_pct=Decimal(bot.daily_loss_limit_pct),
        schedule=bot.schedule,
        created_at=isoformat(bot.created_at) or "",
        last_run_at=isoformat(bot.last_run_at),
        stats=BotStats(),
        last_error=bot.last_error,
    )


@router.get("")
def list_bots(
    session: Session = Depends(get_session),
    principal: Principal = Depends(require_role(Role.VIEWER)),
) -> dict:
    bots = session.scalars(select(BotRow).order_by(BotRow.created_at.desc())).all()
    connections = {row.id: row for row in session.scalars(select(ConnectionRow)).all()}
    strategies = {row.id: row for row in session.scalars(select(StrategyRow)).all()}
    return envelope(
        dump_many(
            [
                _out(bot, connections.get(bot.connection_id), strategies.get(bot.strategy_id))
                for bot in bots
            ]
        )
    )


@router.get("/logs")
def list_logs(
    limit: int = 200,
    session: Session = Depends(get_session),
    principal: Principal = Depends(require_role(Role.VIEWER)),
) -> dict:
    limit = max(1, min(limit, 1000))
    rows = session.scalars(select(BotLogRow).order_by(BotLogRow.at.desc()).limit(limit)).all()
    entries = [
        BotLogEntry(
            id=str(row.id),
            bot_id=str(row.bot_id),
            at=isoformat(row.at) or "",
            level=row.level,  # type: ignore[arg-type]
            message=row.message,
        )
        for row in rows
    ]
    return envelope(dump_many(entries))


@router.post("")
def create_bot(
    payload: BotCreate,
    request: Request,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    principal: Principal = Depends(require_role(Role.OPERATOR)),
) -> dict:
    try:
        connection_id = uuid.UUID(payload.account_id)
        strategy_id = uuid.UUID(payload.strategy_id)
    except ValueError as exc:
        raise BadRequest("accountId and strategyId must be UUIDs.") from exc

    connection = session.get(ConnectionRow, connection_id)
    if connection is None:
        raise NotFound("Unknown account.")
    strategy = session.get(StrategyRow, strategy_id)
    if strategy is None:
        raise NotFound("Unknown strategy.")

    if connection.market_type != str(payload.market_type):
        raise BadRequest("The account and the bot must trade the same market type.")

    if payload.mode == TradingMode.LIVE:
        state = get_engine_state(session)
        if not settings.live_trading_enabled or not state.live_trading_enabled:
            raise Forbidden("Live trading is not enabled. Create the bot in paper mode instead.")
        if connection.mode != TradingMode.LIVE:
            raise Forbidden("A live bot requires a live connection.")

    if strategy.deployment == "paper_only" and payload.mode == TradingMode.LIVE:
        raise Forbidden(f"{strategy.name} is paper-only. It cannot be deployed with live capital.")

    bot = BotRow(
        name=payload.name,
        market_type=str(payload.market_type),
        connection_id=connection.id,
        strategy_id=strategy.id,
        symbols=payload.symbols,
        timeframe=payload.timeframe,
        mode=str(payload.mode),
        state=BotState.STOPPED,
        allocated_capital=payload.allocated_capital,
        position_size_pct=payload.position_size_pct,
        stop_loss_pct=payload.stop_loss_pct,
        take_profit_pct=payload.take_profit_pct,
        max_open_positions=payload.max_open_positions,
        daily_loss_limit_pct=payload.daily_loss_limit_pct,
        schedule=payload.schedule,
    )
    session.add(bot)
    session.flush()

    record_for_principal(
        session,
        principal,
        action="bot.create",
        target=str(bot.id),
        detail={"name": bot.name, "mode": str(payload.mode), "symbols": payload.symbols},
        request_id=request_id_of(request),
        ip=client_ip(request),
    )
    return envelope({"id": str(bot.id)})


def _transition(
    bot_id: str,
    new_state: BotState,
    request: Request,
    session: Session,
    principal: Principal,
) -> dict:
    try:
        parsed = uuid.UUID(bot_id)
    except ValueError as exc:
        raise NotFound("Unknown bot.") from exc

    bot = session.get(BotRow, parsed)
    if bot is None:
        raise NotFound("Unknown bot.")

    bot.state = str(new_state)
    record_for_principal(
        session,
        principal,
        action=f"bot.{new_state}",
        target=str(bot.id),
        detail={"state": str(new_state)},
        request_id=request_id_of(request),
        ip=client_ip(request),
    )
    session.flush()
    return envelope({"state": bot.state})


@router.post("/{bot_id}/pause")
def pause_bot(
    bot_id: str,
    request: Request,
    session: Session = Depends(get_session),
    principal: Principal = Depends(require_role(Role.OPERATOR)),
) -> dict:
    return _transition(bot_id, BotState.PAUSED, request, session, principal)


@router.post("/{bot_id}/resume")
def resume_bot(
    bot_id: str,
    request: Request,
    session: Session = Depends(get_session),
    principal: Principal = Depends(require_role(Role.OPERATOR)),
) -> dict:
    return _transition(bot_id, BotState.RUNNING, request, session, principal)


@router.post("/{bot_id}/stop")
def stop_bot(
    bot_id: str,
    request: Request,
    session: Session = Depends(get_session),
    principal: Principal = Depends(require_role(Role.OPERATOR)),
) -> dict:
    return _transition(bot_id, BotState.STOPPED, request, session, principal)
