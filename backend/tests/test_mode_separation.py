"""Paper and live must never be interchangeable."""

from __future__ import annotations

from decimal import Decimal

import pytest

from wands.errors import BadRequest, LiveTradingDisabled
from wands.execution.gateway import ExecutionGateway
from wands.execution.intents import TradeIntent
from wands.schemas import MarketType, OrderSide, TradingMode
from wands.security.auth import SERVICE_PRINCIPAL

from .conftest import good_context, make_connection, paper_settings


def intent(account: str, mode: TradingMode, client_order_id: str) -> TradeIntent:
    return TradeIntent(
        symbol="BTCUSD",
        market_type=MarketType.CRYPTO,
        side=OrderSide.BUY,
        quantity=Decimal("1"),
        account_id=account,
        mode=mode,
        client_order_id=client_order_id,
        stop_loss_pct=Decimal("2"),
    )


def gateway(session, *, live_enabled: bool) -> ExecutionGateway:
    return ExecutionGateway(
        session,
        context_provider=lambda _: good_context(),
        settings=paper_settings(live_trading_enabled=live_enabled),
    )


def test_live_order_is_refused_when_deployment_flag_is_off(session):
    account = make_connection(mode="live")
    with pytest.raises(LiveTradingDisabled):
        gateway(session, live_enabled=False).submit(
            intent(account, TradingMode.LIVE, "live-1"), SERVICE_PRINCIPAL
        )


def test_paper_connection_cannot_be_used_for_live_orders(session):
    account = make_connection(mode="paper")
    with pytest.raises(LiveTradingDisabled):
        gateway(session, live_enabled=True).submit(
            intent(account, TradingMode.LIVE, "live-2"), SERVICE_PRINCIPAL
        )


def test_live_connection_cannot_be_used_for_paper_orders(session):
    account = make_connection(mode="live")
    with pytest.raises(BadRequest):
        gateway(session, live_enabled=True).submit(
            intent(account, TradingMode.PAPER, "paper-1"), SERVICE_PRINCIPAL
        )


def test_live_trading_cannot_be_enabled_without_the_deployment_flag(client):
    from .conftest import AUTH

    response = client.post(
        "/v1/engine/live-trading",
        headers=AUTH,
        json={"enabled": True, "confirmation": "ENABLE LIVE TRADING"},
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden"


def test_live_trading_requires_the_exact_confirmation(client, monkeypatch):
    from wands.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "live_trading_enabled", True)

    from .conftest import AUTH

    response = client.post(
        "/v1/engine/live-trading",
        headers=AUTH,
        json={"enabled": True, "confirmation": "yes"},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "bad_request"


def test_live_trading_can_always_be_disabled(client):
    from .conftest import AUTH

    response = client.post(
        "/v1/engine/live-trading",
        headers=AUTH,
        json={"enabled": False, "confirmation": ""},
    )
    assert response.status_code == 200
    assert response.json()["data"]["liveTradingEnabled"] is False
