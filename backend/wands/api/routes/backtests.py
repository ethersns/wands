"""Backtests.

The backtester is Phase 6 and does not exist yet. ``POST /v1/backtests`` returns
``501`` rather than a plausible-looking result: a fabricated equity curve is
worse than no equity curve, because someone might act on it.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends
from pydantic import Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from wands.api.deps import require_role
from wands.db.models import BacktestRow, StrategyRow
from wands.db.session import get_session
from wands.envelope import envelope, isoformat
from wands.errors import NotFound, NotImplementedYet
from wands.schemas import (
    BacktestMetrics,
    BacktestResult,
    CamelModel,
    EquityPoint,
    WalkForward,
    dump,
    dump_many,
)
from wands.security.auth import Principal
from wands.security.rbac import Role

router = APIRouter(prefix="/backtests", tags=["backtests"])


class BacktestCreate(CamelModel):
    strategy_id: str
    symbols: list[str] = Field(min_length=1, max_length=20)
    timeframe: str = Field(default="1h", max_length=8)
    from_: datetime = Field(alias="from")
    to: datetime
    initial_capital: Decimal = Field(gt=0)


def _out(row: BacktestRow, strategy: StrategyRow | None) -> BacktestResult:
    metrics = BacktestMetrics(**(row.metrics or {}))
    walk_forward = WalkForward(**row.walk_forward) if row.walk_forward else None
    return BacktestResult(
        id=str(row.id),
        strategy_id=str(row.strategy_id) if row.strategy_id else "",
        strategy_name=strategy.name if strategy else "unknown",
        symbols=list(row.symbols or []),
        timeframe=row.timeframe,
        from_=isoformat(row.period_from) or "",
        to=isoformat(row.period_to) or "",
        initial_capital=Decimal(row.initial_capital),
        metrics=metrics,
        equity_curve=[EquityPoint(**point) for point in row.equity_curve or []],
        trades=[],
        created_at=isoformat(row.created_at) or "",
        walk_forward=walk_forward,
    )


@router.get("")
def list_backtests(
    session: Session = Depends(get_session),
    principal: Principal = Depends(require_role(Role.VIEWER)),
) -> dict:
    rows = session.scalars(select(BacktestRow).order_by(BacktestRow.created_at.desc())).all()
    strategies = {row.id: row for row in session.scalars(select(StrategyRow)).all()}
    return envelope(dump_many([_out(row, strategies.get(row.strategy_id)) for row in rows]))


@router.get("/{backtest_id}")
def get_backtest(
    backtest_id: str,
    session: Session = Depends(get_session),
    principal: Principal = Depends(require_role(Role.VIEWER)),
) -> dict:
    try:
        parsed = uuid.UUID(backtest_id)
    except ValueError as exc:
        raise NotFound("Unknown backtest.") from exc
    row = session.get(BacktestRow, parsed)
    if row is None:
        raise NotFound("Unknown backtest.")
    strategy = session.get(StrategyRow, row.strategy_id) if row.strategy_id else None
    return envelope(dump(_out(row, strategy)))


@router.post("")
def create_backtest(
    payload: BacktestCreate,
    principal: Principal = Depends(require_role(Role.OPERATOR)),
) -> dict:
    raise NotImplementedYet(
        "The event-driven backtester is not implemented in this build. No result was "
        "produced, and none will be fabricated."
    )
