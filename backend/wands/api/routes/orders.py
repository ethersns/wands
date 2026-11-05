"""Orders and fills.

``POST /v1/orders`` is the only way an order enters the system, and it goes
through ``ExecutionGateway`` — which always calls the risk engine. There is no
route that reaches a broker directly.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from wands.api.deps import client_ip, request_id_of, require_role
from wands.db.models import ConnectionRow, FillRow, OrderRow, StrategyRow
from wands.db.session import get_session
from wands.envelope import envelope, isoformat
from wands.errors import NotFound, NotImplementedYet
from wands.execution.gateway import ExecutionGateway
from wands.execution.idempotency import new_client_order_id
from wands.execution.intents import TradeIntent
from wands.schemas import (
    FillOut,
    OrderOut,
    OrderSide,
    OrderStatus,
    OrderType,
    ReconciliationState,
    TradeIntentIn,
    dump,
    dump_many,
)
from wands.security.auth import Principal
from wands.security.rbac import Role

router = APIRouter(tags=["orders"])


def _order_out(
    row: OrderRow, connection: ConnectionRow | None, strategy: StrategyRow | None
) -> OrderOut:
    return OrderOut(
        id=str(row.id),
        client_order_id=row.client_order_id,
        account_id=str(row.connection_id) if row.connection_id else "",
        account_label=connection.label if connection else "unassigned",
        symbol=row.symbol,
        market_type=row.market_type,  # type: ignore[arg-type]
        side=OrderSide(row.side),
        type=OrderType(row.type),
        status=OrderStatus(row.status),
        quantity=Decimal(row.quantity),
        filled_quantity=Decimal(row.filled_quantity),
        limit_price=Decimal(row.limit_price) if row.limit_price is not None else None,
        average_fill_price=(
            Decimal(row.average_fill_price) if row.average_fill_price is not None else None
        ),
        fees=Decimal(row.fees) if row.fees is not None else None,
        mode=row.mode,  # type: ignore[arg-type]
        bot_id=str(row.bot_id) if row.bot_id else None,
        strategy_name=strategy.name if strategy else None,
        created_at=isoformat(row.created_at) or "",
        updated_at=isoformat(row.updated_at) or "",
        exchange_confirmation_id=row.exchange_confirmation_id,
        reconciliation=ReconciliationState(row.reconciliation),
        reject_reason=row.reject_reason,
    )


@router.get("/orders")
def list_orders(
    limit: int = 200,
    session: Session = Depends(get_session),
    principal: Principal = Depends(require_role(Role.VIEWER)),
) -> dict:
    limit = max(1, min(limit, 1000))
    rows = session.scalars(select(OrderRow).order_by(OrderRow.created_at.desc()).limit(limit)).all()
    connections = {row.id: row for row in session.scalars(select(ConnectionRow)).all()}
    strategies = {row.id: row for row in session.scalars(select(StrategyRow)).all()}
    return envelope(
        dump_many(
            [
                _order_out(row, connections.get(row.connection_id), strategies.get(row.strategy_id))
                for row in rows
            ]
        )
    )


@router.get("/fills")
def list_fills(
    limit: int = 200,
    session: Session = Depends(get_session),
    principal: Principal = Depends(require_role(Role.VIEWER)),
) -> dict:
    limit = max(1, min(limit, 1000))
    rows = session.scalars(select(FillRow).order_by(FillRow.at.desc()).limit(limit)).all()
    fills = [
        FillOut(
            id=str(row.id),
            order_id=str(row.order_id),
            symbol=row.symbol,
            side=OrderSide(row.side),
            quantity=Decimal(row.quantity),
            price=Decimal(row.price),
            fees=Decimal(row.fees),
            at=isoformat(row.at) or "",
        )
        for row in rows
    ]
    return envelope(dump_many(fills))


@router.post("/orders")
def submit_order(
    payload: TradeIntentIn,
    request: Request,
    session: Session = Depends(get_session),
    principal: Principal = Depends(require_role(Role.OPERATOR)),
) -> dict:
    intent = TradeIntent(
        symbol=payload.symbol.upper(),
        market_type=payload.market_type,
        side=payload.side,
        quantity=payload.quantity,
        account_id=payload.account_id,
        mode=payload.mode,
        type=payload.type,
        limit_price=payload.limit_price,
        stop_loss_pct=payload.stop_loss_pct,
        rationale=payload.rationale,
        client_order_id=payload.client_order_id or new_client_order_id(),
    )

    gateway = ExecutionGateway(session)
    order = gateway.submit(
        intent, principal, request_id=request_id_of(request), ip=client_ip(request)
    )

    connection = session.get(ConnectionRow, order.connection_id) if order.connection_id else None
    strategy = session.get(StrategyRow, order.strategy_id) if order.strategy_id else None
    return envelope(dump(_order_out(order, connection, strategy)))


@router.post("/orders/{order_id}/cancel")
def cancel_order(
    order_id: str,
    session: Session = Depends(get_session),
    principal: Principal = Depends(require_role(Role.OPERATOR)),
) -> dict:
    try:
        parsed = uuid.UUID(order_id)
    except ValueError as exc:
        raise NotFound("Unknown order.") from exc
    if session.get(OrderRow, parsed) is None:
        raise NotFound("Unknown order.")
    raise NotImplementedYet(
        "Cancellation requires broker reconciliation, which is not implemented in this "
        "build. The order state was not changed."
    )
