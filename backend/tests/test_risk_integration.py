"""Risk engine integration.

The engine is unchanged. What changes is the context it receives: verified
portfolio state and a live two-sided quote. These tests prove that a valid paper
order can now pass, and that every unsafe order still cannot.
"""

from __future__ import annotations

import uuid
from datetime import timedelta
from decimal import Decimal

import pytest

from wands.brokers.paper import PaperBrokerAdapter
from wands.db.models import ConnectionRow, PositionRow
from wands.errors import BadRequest, LiveTradingDisabled, RiskRejected
from wands.execution.gateway import ExecutionGateway
from wands.execution.intents import TradeIntent
from wands.marketdata.base import DataQuality
from wands.marketdata.service import MarketDataService
from wands.portfolio.service import PortfolioService
from wands.risk.context import build_risk_context
from wands.schemas import CandleInterval, MarketSessionState, MarketType, OrderSide, TradingMode
from wands.security.auth import SERVICE_PRINCIPAL
from wands.state import get_engine_state

from .conftest import paper_settings, settings
from .marketdata_fakes import FIXED_NOW, FakeProvider, make_candles, make_quote


def new_connection(session, *, mode: str = "paper", provider: str = "kraken") -> str:
    row = ConnectionRow(
        provider=provider,
        label="Test account",
        market_type="crypto" if provider == "kraken" else "stocks",
        status="connected",
        access="trading",
        mode=mode,
        key_hint="...abcd",
        permissions=["read", "trade"],
    )
    session.add(row)
    session.flush()
    return str(row.id)


def setup(
    session,
    *,
    cash: str = "10000",
    quote=None,
    candles=None,
    symbol: str = "BTC/USD",
    market_type: MarketType = MarketType.CRYPTO,
    provider_name: str = "kraken",
    now=FIXED_NOW,
    max_age: int = 30,
):
    account = new_connection(
        session, mode="paper", provider="kraken" if market_type is MarketType.CRYPTO else "alpaca"
    )
    provider = FakeProvider(
        name=provider_name,
        market_type=market_type,
        quotes={symbol: quote} if quote is not None else {},
        candles={(symbol, str(CandleInterval.H1)): candles or []},
    )
    market = MarketDataService(
        session,
        providers={market_type: provider},
        settings=settings(),
        clock=lambda: now,
        max_quote_age_seconds=max_age,
    )
    portfolio = PortfolioService(
        session, market_data=market, settings=settings(), clock=lambda: now
    )
    portfolio.initialise_paper_account(account, starting_cash=Decimal(cash))
    if quote is not None:
        market.refresh_quote(symbol, market_type)
    return account, market, portfolio


def gateway(session, market, portfolio, *, brokers=None, settings_override=None):
    resolved = settings_override or paper_settings()
    return ExecutionGateway(
        session,
        brokers=brokers,
        settings=resolved,
        context_provider=lambda intent: build_risk_context(
            session,
            intent,
            market_data=market,
            portfolio=portfolio,
            settings=resolved,
        ),
    )


def intent(
    account: str,
    *,
    symbol: str = "BTC/USD",
    market_type: MarketType = MarketType.CRYPTO,
    side: OrderSide = OrderSide.BUY,
    quantity: str = "1",
    stop: str = "2",
    mode: TradingMode = TradingMode.PAPER,
    client_order_id: str = "order-1",
) -> TradeIntent:
    return TradeIntent(
        symbol=symbol,
        market_type=market_type,
        side=side,
        quantity=Decimal(quantity),
        account_id=account,
        mode=mode,
        stop_loss_pct=Decimal(stop),
        client_order_id=client_order_id,
    )


def keys(excinfo) -> set[str]:
    return {detail["key"] for detail in excinfo.value.details}


# --- the happy path -------------------------------------------------------


def test_a_valid_paper_order_passes_risk_and_fills(session):
    account, market, portfolio = setup(
        session, quote=make_quote(bid="100", ask="100.2")
    )

    order = gateway(session, market, portfolio).submit(
        intent(account), SERVICE_PRINCIPAL
    )

    assert order.status == "filled"
    assert order.filled_quantity == Decimal("1")
    assert order.mode == "paper"

    state = portfolio.state(account)
    assert state.cash < Decimal("10000")
    assert state.verified


def test_the_risk_context_uses_the_quote_mid(session):
    account, market, portfolio = setup(
        session, quote=make_quote(bid="100", ask="102")
    )

    context = build_risk_context(
        session,
        intent(account),
        market_data=market,
        portfolio=portfolio,
        settings=paper_settings(),
    )

    assert context.reference_price == Decimal("101")
    assert context.portfolio_equity == Decimal("10000")
    assert context.buying_power == Decimal("10000")
    assert context.market_open is True
    assert context.quote_age_seconds == 0
    assert context.spread_pct is not None


def test_a_partial_fill_does_not_double_count_cash(session):
    account, market, portfolio = setup(
        session, quote=make_quote(bid="100", ask="100.2")
    )
    brokers = {"paper": PaperBrokerAdapter(partial_fill_ratio=Decimal("0.5"))}

    order = gateway(session, market, portfolio, brokers=brokers).submit(
        intent(account, quantity="2"), SERVICE_PRINCIPAL
    )

    assert order.status == "partially_filled"
    assert order.filled_quantity == Decimal("1")

    state = portfolio.state(account)
    # One unit was paid for; the unfilled unit is reserved, not spent.
    assert state.cash > Decimal("9800")
    assert state.reserved > Decimal("0")
    assert state.buying_power == state.cash - state.reserved


# --- fail-closed paths ----------------------------------------------------


def test_an_order_without_a_paper_account_is_blocked(session):
    account = new_connection(session, mode="paper")
    provider = FakeProvider(quotes={"BTC/USD": make_quote()})
    market = MarketDataService(
        session,
        providers={MarketType.CRYPTO: provider},
        settings=settings(),
        clock=lambda: FIXED_NOW,
    )
    portfolio = PortfolioService(
        session, market_data=market, settings=settings(), clock=lambda: FIXED_NOW
    )
    market.refresh_quote("BTC/USD", MarketType.CRYPTO)

    with pytest.raises(RiskRejected) as excinfo:
        gateway(session, market, portfolio).submit(intent(account), SERVICE_PRINCIPAL)

    assert "equity_unknown" in keys(excinfo)


def test_a_stale_quote_blocks_the_order(session):
    account, market, portfolio = setup(
        session, quote=make_quote(at=FIXED_NOW - timedelta(seconds=600))
    )

    with pytest.raises(RiskRejected) as excinfo:
        gateway(session, market, portfolio).submit(intent(account), SERVICE_PRINCIPAL)

    assert "stale_quote" in keys(excinfo)


def test_a_delayed_quote_has_no_executable_price(session):
    account, market, portfolio = setup(
        session, quote=make_quote(quality=DataQuality.DELAYED)
    )

    with pytest.raises(RiskRejected) as excinfo:
        gateway(session, market, portfolio).submit(intent(account), SERVICE_PRINCIPAL)

    assert "price_unknown" in keys(excinfo)


def test_a_candle_close_is_not_an_executable_price(session):
    account, market, portfolio = setup(
        session,
        quote=None,
        candles=make_candles(count=3),
    )
    market.refresh_candles("BTC/USD", CandleInterval.H1)

    with pytest.raises(RiskRejected) as excinfo:
        gateway(session, market, portfolio).submit(intent(account), SERVICE_PRINCIPAL)

    assert "price_unknown" in keys(excinfo)


def test_a_closed_market_blocks_a_stock_order(session):
    quote = make_quote(
        symbol="AAPL",
        market_type=MarketType.STOCKS,
        session=MarketSessionState.CLOSED,
    )
    account, market, portfolio = setup(
        session,
        quote=quote,
        symbol="AAPL",
        market_type=MarketType.STOCKS,
        now=FIXED_NOW,  # 09:00 New York: pre-market
    )

    with pytest.raises(RiskRejected) as excinfo:
        gateway(session, market, portfolio).submit(
            intent(account, symbol="AAPL", market_type=MarketType.STOCKS),
            SERVICE_PRINCIPAL,
        )

    assert "market_closed" in keys(excinfo)


def test_a_wide_spread_blocks_the_order(session):
    account, market, portfolio = setup(
        session, quote=make_quote(bid="100", ask="110")
    )

    with pytest.raises(RiskRejected) as excinfo:
        gateway(session, market, portfolio).submit(intent(account), SERVICE_PRINCIPAL)

    assert "spread_too_wide" in keys(excinfo)


def test_insufficient_buying_power_blocks_the_order(session):
    account, market, portfolio = setup(session, cash="50", quote=make_quote())

    with pytest.raises(RiskRejected) as excinfo:
        gateway(session, market, portfolio).submit(intent(account), SERVICE_PRINCIPAL)

    assert "insufficient_buying_power" in keys(excinfo)


def test_an_unverified_portfolio_blocks_the_order(session):
    account, market, portfolio = setup(session, quote=make_quote())
    session.add(
        PositionRow(
            connection_id=uuid.UUID(account),
            symbol="ETH/USD",
            market_type="crypto",
            quantity=Decimal("1"),
            average_entry_price=Decimal("100"),
            realised_pnl=Decimal("0"),
            fees_paid=Decimal("0"),
            source="paper_simulated",
        )
    )
    session.flush()

    with pytest.raises(RiskRejected) as excinfo:
        gateway(session, market, portfolio).submit(intent(account), SERVICE_PRINCIPAL)

    assert "equity_unknown" in keys(excinfo)


def test_emergency_stop_blocks_even_with_good_data(session):
    account, market, portfolio = setup(session, quote=make_quote())
    state = get_engine_state(session)
    state.emergency_stop_engaged = True
    session.flush()

    with pytest.raises(RiskRejected) as excinfo:
        gateway(session, market, portfolio).submit(intent(account), SERVICE_PRINCIPAL)

    assert "emergency_stop" in keys(excinfo)


def test_a_stop_beyond_the_per_trade_budget_blocks_the_order(session):
    account, market, portfolio = setup(session, quote=make_quote())

    with pytest.raises(RiskRejected) as excinfo:
        gateway(session, market, portfolio).submit(
            intent(account, stop="60"), SERVICE_PRINCIPAL
        )

    assert "per_trade_risk" in keys(excinfo)


# --- live trading stays impossible ---------------------------------------


def test_a_live_order_is_refused_before_risk_runs(session):
    account, market, portfolio = setup(session, quote=make_quote())

    with pytest.raises(LiveTradingDisabled):
        gateway(session, market, portfolio).submit(
            intent(account, mode=TradingMode.LIVE), SERVICE_PRINCIPAL
        )


def test_a_paper_order_cannot_use_a_live_connection(session):
    account = new_connection(session, mode="live")
    provider = FakeProvider(quotes={"BTC/USD": make_quote()})
    market = MarketDataService(
        session,
        providers={MarketType.CRYPTO: provider},
        settings=settings(),
        clock=lambda: FIXED_NOW,
    )
    portfolio = PortfolioService(
        session, market_data=market, settings=settings(), clock=lambda: FIXED_NOW
    )

    with pytest.raises(BadRequest):
        gateway(session, market, portfolio).submit(intent(account), SERVICE_PRINCIPAL)


def test_the_risk_context_is_unknown_without_any_data(session):
    account = new_connection(session, mode="paper")
    market = MarketDataService(
        session, providers={}, settings=settings(), clock=lambda: FIXED_NOW
    )
    portfolio = PortfolioService(
        session, market_data=market, settings=settings(), clock=lambda: FIXED_NOW
    )

    context = build_risk_context(
        session,
        intent(account),
        market_data=market,
        portfolio=portfolio,
        settings=paper_settings(),
    )

    assert context.portfolio_equity is None
    assert context.buying_power is None
    assert context.reference_price is None
    assert context.quote_age_seconds is None
    assert context.spread_pct is None
