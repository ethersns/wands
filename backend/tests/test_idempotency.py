"""Duplicate order prevention."""

from __future__ import annotations

import uuid
from decimal import Decimal

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from wands.db.models import OrderRow, PositionRow
from wands.db.session import session_scope
from wands.errors import RiskRejected
from wands.execution.gateway import ExecutionGateway
from wands.execution.idempotency import derive_client_order_id
from wands.execution.intents import TradeIntent
from wands.schemas import MarketType, OrderSide, TradingMode
from wands.security.auth import SERVICE_PRINCIPAL

from .conftest import good_context, make_connection, paper_settings


def intent(account: str, client_order_id: str, **overrides) -> TradeIntent:
    base = {
        "symbol": "BTCUSD",
        "market_type": MarketType.CRYPTO,
        "side": OrderSide.BUY,
        "quantity": Decimal("1"),
        "account_id": account,
        "mode": TradingMode.PAPER,
        "client_order_id": client_order_id,
        "stop_loss_pct": Decimal("2"),
    }
    base.update(overrides)
    return TradeIntent(**base)


def gateway(session, **settings_overrides) -> ExecutionGateway:
    return ExecutionGateway(
        session,
        context_provider=lambda _: good_context(),
        settings=paper_settings(**settings_overrides),
    )


def test_derived_client_order_id_is_deterministic():
    first = derive_client_order_id(
        account_id="a", symbol="BTCUSD", side="buy", quantity="1", nonce="n1"
    )
    second = derive_client_order_id(
        account_id="a", symbol="BTCUSD", side="buy", quantity="1", nonce="n1"
    )
    assert first == second
    assert first.startswith("wands-")


def test_derived_client_order_id_changes_with_the_nonce():
    first = derive_client_order_id(
        account_id="a", symbol="BTCUSD", side="buy", quantity="1", nonce="n1"
    )
    second = derive_client_order_id(
        account_id="a", symbol="BTCUSD", side="buy", quantity="1", nonce="n2"
    )
    assert first != second


def test_replayed_client_order_id_returns_the_same_order(session):
    account = make_connection()
    gw = gateway(session)

    first = gw.submit(intent(account, "dup-1"), SERVICE_PRINCIPAL)
    second = gw.submit(intent(account, "dup-1"), SERVICE_PRINCIPAL)

    assert first.id == second.id
    assert session.scalar(select(func.count()).select_from(OrderRow)) == 1


def test_database_rejects_a_duplicate_client_order_id():
    account = make_connection()
    connection_id = uuid.UUID(account)

    def row() -> OrderRow:
        return OrderRow(
            client_order_id="dup-2",
            connection_id=connection_id,
            symbol="BTCUSD",
            market_type="crypto",
            side="buy",
            type="market",
            status="open",
            quantity=Decimal("1"),
            filled_quantity=Decimal("0"),
            mode="paper",
            reconciliation="matched",
        )

    with session_scope() as session:
        session.add(row())

    with pytest.raises(IntegrityError):
        with session_scope() as session:
            session.add(row())


def test_paper_order_fills_and_opens_a_position(session):
    account = make_connection()
    gw = gateway(session)

    order = gw.submit(intent(account, "fill-1"), SERVICE_PRINCIPAL)

    assert order.status == "filled"
    assert order.filled_quantity == Decimal("1")
    assert order.exchange_confirmation_id is not None

    position = session.scalar(select(PositionRow))
    assert position is not None
    assert position.quantity == Decimal("1")
    assert position.average_entry_price > 0


def test_gateway_fails_closed_without_portfolio_data(session):
    """No context provider means no trustworthy equity, so nothing is allowed."""
    account = make_connection()
    gw = ExecutionGateway(session, settings=paper_settings())

    with pytest.raises(RiskRejected) as excinfo:
        gw.submit(intent(account, "no-context"), SERVICE_PRINCIPAL)

    assert "equity_unknown" in {detail["key"] for detail in excinfo.value.details}
    assert session.scalar(select(func.count()).select_from(OrderRow)) == 1
    rejected = session.scalar(select(OrderRow))
    assert rejected.status == "rejected"
