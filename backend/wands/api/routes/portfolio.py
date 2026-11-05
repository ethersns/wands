"""Portfolio and positions.

Until the portfolio service (Phase 3) syncs balances from a broker, equity and
cash are genuinely unknown. They are returned as ``null`` with
``provenance: "unavailable"`` rather than as zeros, because a zero balance and
an unknown balance look identical in a chart and only one of them is true.
"""

from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from wands.api.deps import require_role
from wands.db.models import ConnectionRow, PositionRow
from wands.db.session import get_session
from wands.envelope import envelope, isoformat, unavailable
from wands.schemas import (
    AccessLevel,
    BrokerAccount,
    ConnectionStatus,
    MarketBreakdown,
    MarketType,
    PortfolioSummary,
    PositionOut,
    Provider,
    TradingMode,
    dump,
    dump_many,
)
from wands.security.auth import Principal
from wands.security.rbac import Role

router = APIRouter(tags=["portfolio"])

NO_BROKER = "No broker connection is configured. Balances, equity and P&L are unknown, not zero."


def _account(row: ConnectionRow) -> BrokerAccount:
    return BrokerAccount(
        id=str(row.id),
        provider=Provider(row.provider),
        label=row.label,
        market_type=MarketType(row.market_type),
        status=ConnectionStatus(row.status),
        access=AccessLevel(row.access),
        mode=TradingMode(row.mode),
        base_currency="USD",
        last_synced_at=isoformat(row.last_synced_at),
        equity=None,
        cash=None,
        buying_power=None,
        permissions=list(row.permissions or []),
        error=row.error,
    )


def _position(row: PositionRow) -> PositionOut:
    return PositionOut(
        id=str(row.id),
        account_id=str(row.connection_id) if row.connection_id else "",
        symbol=row.symbol,
        name=row.symbol,
        market_type=MarketType(row.market_type),
        quantity=Decimal(row.quantity),
        average_entry_price=Decimal(row.average_entry_price),
        last_price=None,
        market_value=None,
        unrealised_pnl=None,
        unrealised_pnl_pct=None,
        realised_pnl=Decimal(row.realised_pnl),
        fees_paid=Decimal(row.fees_paid),
        opened_at=isoformat(row.opened_at) or "",
        strategy_id=str(row.strategy_id) if row.strategy_id else None,
        bot_id=str(row.bot_id) if row.bot_id else None,
    )


@router.get("/portfolio")
def portfolio(
    session: Session = Depends(get_session),
    principal: Principal = Depends(require_role(Role.VIEWER)),
) -> dict:
    connections = session.scalars(select(ConnectionRow)).all()
    positions = session.scalars(select(PositionRow)).all()

    summary = PortfolioSummary(
        base_currency="USD",
        total_equity=None,
        cash=None,
        buying_power=None,
        day_pnl=None,
        day_pnl_pct=None,
        realised_pnl=None,
        unrealised_pnl=None,
        fees_paid=None,
        open_positions=len(positions),
        equity_curve=[],
        allocation=[],
        by_market={
            "crypto": MarketBreakdown(),
            "stocks": MarketBreakdown(),
        },
        accounts=[_account(row) for row in connections],
        positions=[_position(row) for row in positions],
    )

    if not connections:
        return unavailable(dump(summary), NO_BROKER)
    return unavailable(
        dump(summary),
        "Broker balances have not been synchronised yet. The portfolio service is not "
        "implemented in this build, so equity and P&L are unknown.",
    )


@router.get("/positions")
def positions(
    session: Session = Depends(get_session),
    principal: Principal = Depends(require_role(Role.VIEWER)),
) -> dict:
    rows = session.scalars(select(PositionRow)).all()
    return envelope(dump_many([_position(row) for row in rows]))
