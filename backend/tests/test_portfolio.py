"""Portfolio accounting: paper accounts, cash, reservations, valuation, FX.

All money is ``Decimal``. The tests assert exact values, not ranges, because a
portfolio that is "roughly right" is a portfolio that does not reconcile.
"""

from __future__ import annotations

import uuid
from datetime import timedelta
from decimal import Decimal

import pytest
from sqlalchemy import select

from wands.db.models import AccountBalanceRow, ConnectionRow, PositionRow
from wands.errors import BadRequest, Conflict
from wands.marketdata.service import MarketDataService
from wands.portfolio.service import PortfolioService
from wands.schemas import MarketType

from .conftest import settings
from .marketdata_fakes import FIXED_NOW, FakeProvider, make_quote


def new_connection(session, *, mode: str = "paper", provider: str = "kraken") -> str:
    """Create a connection on the test's own session.

    Using a second session here would deadlock SQLite against the fixture's open
    write transaction, so the row is added directly.
    """
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


class Clock:
    def __init__(self, now=FIXED_NOW) -> None:
        self.now = now

    def __call__(self):
        return self.now

    def advance(self, **kwargs) -> None:
        self.now = self.now + timedelta(**kwargs)


def portfolio_service(session, provider=None, *, clock=None) -> PortfolioService:
    clock = clock or Clock()
    providers = {provider.market_type: provider} if provider is not None else {}
    market = MarketDataService(
        session,
        providers=providers,
        settings=settings(),
        clock=clock,
        max_quote_age_seconds=30,
    )
    return PortfolioService(session, market_data=market, settings=settings(), clock=clock)


def paper_account(session, *, cash: str = "10000", provider=None, clock=None):
    account = new_connection(session, mode="paper")
    service = portfolio_service(session, provider, clock=clock)
    service.initialise_paper_account(account, starting_cash=Decimal(cash))
    return account, service


def add_position(session, account: str, **overrides) -> PositionRow:
    base = {
        "connection_id": uuid.UUID(account),
        "symbol": "BTC/USD",
        "market_type": "crypto",
        "quantity": Decimal("1"),
        "average_entry_price": Decimal("100"),
        "realised_pnl": Decimal("0"),
        "fees_paid": Decimal("0"),
        "source": "paper_simulated",
    }
    base.update(overrides)
    row = PositionRow(**base)
    session.add(row)
    session.flush()
    return row


# --- paper account lifecycle ---------------------------------------------


def test_paper_account_initialisation_sets_cash_and_ledger(session):
    account, service = paper_account(session, cash="10000")

    state = service.state(account)

    assert state.cash == Decimal("10000")
    assert state.equity == Decimal("10000")
    assert state.buying_power == Decimal("10000")
    assert state.reserved == Decimal("0")
    assert state.verified
    assert state.source == "paper_simulated"
    assert state.provenance == "live"

    kinds = [row.kind for row in service.ledger(account)]
    assert "initialisation" in kinds


def test_paper_account_requires_a_paper_connection(session):
    account = new_connection(session, mode="live")
    service = portfolio_service(session)

    with pytest.raises(BadRequest):
        service.initialise_paper_account(account, starting_cash=Decimal("1000"))


def test_paper_account_cannot_be_initialised_twice(session):
    account, service = paper_account(session)

    with pytest.raises(Conflict):
        service.initialise_paper_account(account, starting_cash=Decimal("1000"))


def test_reset_zeroes_positions_and_cash(session):
    account, service = paper_account(session, cash="10000")
    add_position(session, account)

    service.initialise_paper_account(account, starting_cash=Decimal("5000"), reset=True)
    state = service.state(account)

    assert state.cash == Decimal("5000")
    assert state.positions == []
    assert state.equity == Decimal("5000")


def test_reset_keeps_the_ledger_append_only(session):
    account, service = paper_account(session, cash="1000")
    service.initialise_paper_account(account, starting_cash=Decimal("2000"), reset=True)

    kinds = [row.kind for row in service.ledger(account)]
    assert kinds.count("initialisation") == 2


def test_paper_account_currency_is_explicit(session):
    account = new_connection(session, mode="paper")
    service = portfolio_service(session)
    service.initialise_paper_account(
        account, starting_cash=Decimal("1000"), currency="EUR"
    )

    assert service.state(account).base_currency == "EUR"


def test_paper_account_rejects_a_bad_currency(session):
    account = new_connection(session, mode="paper")
    service = portfolio_service(session)

    with pytest.raises(BadRequest):
        service.initialise_paper_account(account, currency="EURO")


def test_paper_account_rejects_non_positive_cash(session):
    account = new_connection(session, mode="paper")
    service = portfolio_service(session)

    with pytest.raises(BadRequest):
        service.initialise_paper_account(account, starting_cash=Decimal("0"))


# --- fills ----------------------------------------------------------------


def test_a_buy_fill_debits_cash_and_records_the_fee(session):
    account, service = paper_account(session, cash="10000")

    delta = service.record_fill(
        account,
        order_id="order-1",
        symbol="BTC/USD",
        side="buy",
        quantity=Decimal("1"),
        price=Decimal("100"),
        fees=Decimal("0.10"),
    )

    assert delta == Decimal("-100.10")
    assert service.state(account).cash == Decimal("9899.90")

    kinds = {row.kind for row in service.ledger(account)}
    assert {"fill", "fee"} <= kinds


def test_a_sell_fill_credits_cash(session):
    account, service = paper_account(session, cash="10000")

    delta = service.record_fill(
        account,
        order_id="order-2",
        symbol="BTC/USD",
        side="sell",
        quantity=Decimal("1"),
        price=Decimal("110"),
        fees=Decimal("0.10"),
    )

    assert delta == Decimal("109.90")
    assert service.state(account).cash == Decimal("10109.90")


def test_a_fill_is_idempotent_by_reference(session):
    account, service = paper_account(session, cash="10000")
    kwargs = {
        "order_id": "order-3",
        "symbol": "BTC/USD",
        "side": "buy",
        "quantity": Decimal("1"),
        "price": Decimal("100"),
        "fees": Decimal("0"),
        "reference": "fill:fixed",
    }

    assert service.record_fill(account, **kwargs) == Decimal("-100")
    assert service.record_fill(account, **kwargs) is None
    assert service.state(account).cash == Decimal("9900")


def test_a_fill_without_a_paper_account_does_not_move_cash(session):
    account = new_connection(session, mode="paper")
    service = portfolio_service(session)

    assert (
        service.record_fill(
            account,
            order_id="order-4",
            symbol="BTC/USD",
            side="buy",
            quantity=Decimal("1"),
            price=Decimal("100"),
            fees=Decimal("0"),
        )
        is None
    )


# --- reservations ---------------------------------------------------------


def test_reserved_capital_reduces_buying_power(session):
    account, service = paper_account(session, cash="10000")

    assert service.reserve(account, Decimal("2000"), reference="order:1")
    state = service.state(account)

    assert state.reserved == Decimal("2000")
    assert state.buying_power == Decimal("8000")


def test_a_reservation_cannot_exceed_cash(session):
    account, service = paper_account(session, cash="1000")

    assert not service.reserve(account, Decimal("2000"), reference="order:2")
    assert service.state(account).reserved == Decimal("0")


def test_releasing_a_reservation_restores_buying_power(session):
    account, service = paper_account(session, cash="10000")
    service.reserve(account, Decimal("2000"), reference="order:3")

    assert service.release(account, reference="order:3")
    assert service.state(account).reserved == Decimal("0")


def test_order_reservation_tracks_the_unfilled_remainder(session):
    account, service = paper_account(session, cash="10000")

    service.sync_order_reservation(
        account, order_id="o1", side="buy", unfilled_quantity=Decimal("2"), price=Decimal("100")
    )
    assert service.state(account).reserved == Decimal("200")

    service.sync_order_reservation(
        account, order_id="o1", side="buy", unfilled_quantity=Decimal("1"), price=Decimal("100")
    )
    assert service.state(account).reserved == Decimal("100")

    service.sync_order_reservation(
        account, order_id="o1", side="buy", unfilled_quantity=Decimal("0"), price=Decimal("100")
    )
    assert service.state(account).reserved == Decimal("0")


# --- cash movements and performance --------------------------------------


def test_a_deposit_is_not_profit(session):
    clock = Clock()
    account = new_connection(session, mode="paper")
    service = portfolio_service(session, clock=clock)
    service.initialise_paper_account(account, starting_cash=Decimal("10000"))
    service.snapshot_equity(account)

    clock.advance(hours=1)
    service.record_cash_movement(
        account, kind="deposit", amount=Decimal("500"), reference="dep:1"
    )
    state = service.state(account)

    assert state.cash == Decimal("10500")
    assert state.day_pnl == Decimal("0")


def test_a_withdrawal_is_not_a_loss(session):
    clock = Clock()
    account = new_connection(session, mode="paper")
    service = portfolio_service(session, clock=clock)
    service.initialise_paper_account(account, starting_cash=Decimal("10000"))
    service.snapshot_equity(account)

    clock.advance(hours=1)
    service.record_cash_movement(
        account, kind="withdrawal", amount=Decimal("1000"), reference="wd:1"
    )
    state = service.state(account)

    assert state.cash == Decimal("9000")
    assert state.day_pnl == Decimal("0")


def test_a_withdrawal_cannot_exceed_buying_power(session):
    account, service = paper_account(session, cash="1000")

    with pytest.raises(BadRequest):
        service.record_cash_movement(
            account, kind="withdrawal", amount=Decimal("2000"), reference="wd:2"
        )


def test_drawdown_is_measured_from_the_equity_peak(session):
    clock = Clock()
    account = new_connection(session, mode="paper")
    service = portfolio_service(session, clock=clock)
    service.initialise_paper_account(account, starting_cash=Decimal("10000"))
    service.snapshot_equity(account)

    clock.advance(hours=1)
    service.record_cash_movement(
        account, kind="withdrawal", amount=Decimal("1000"), reference="wd:3"
    )
    service.snapshot_equity(account)

    assert service.state(account).drawdown_pct == Decimal("10.000")


# --- verification ---------------------------------------------------------


def test_verification_matches_the_ledger(session):
    account, service = paper_account(session, cash="10000")
    service.record_fill(
        account,
        order_id="order-5",
        symbol="BTC/USD",
        side="buy",
        quantity=Decimal("1"),
        price=Decimal("100"),
        fees=Decimal("0.10"),
    )

    result = service.verify(account)

    assert result.ok
    assert result.difference == Decimal("0")


def test_verification_detects_a_mismatch(session):
    account, service = paper_account(session, cash="10000")
    balance = session.scalar(
        select(AccountBalanceRow).where(
            AccountBalanceRow.connection_id == uuid.UUID(account)
        )
    )
    assert balance is not None
    balance.cash = Decimal("9999")
    session.flush()

    result = service.verify(account)

    assert not result.ok
    assert result.difference == Decimal("1")


# --- valuation ------------------------------------------------------------


def test_a_position_is_valued_at_the_quote_mid(session):
    provider = FakeProvider(
        quotes={"BTC/USD": make_quote(bid="100", ask="102", last="101")}
    )
    account, service = paper_account(session, provider=provider)
    service.market_data.refresh_quote("BTC/USD", MarketType.CRYPTO)
    add_position(session, account, quantity=Decimal("2"), average_entry_price=Decimal("90"))

    state = service.state(account)
    position = state.positions[0]

    assert position.last_price == Decimal("101")
    assert position.market_value == Decimal("202")
    assert position.unrealised_pnl == Decimal("22")
    assert state.equity == Decimal("10202")
    assert state.verified


def test_an_unpriced_position_makes_the_portfolio_unverified(session):
    account, service = paper_account(session, cash="10000")
    add_position(session, account)

    state = service.state(account)

    assert not state.verified
    assert state.equity is None
    assert state.provenance == "unavailable"
    assert state.warnings


def test_a_stale_price_is_flagged_on_the_position(session):
    provider = FakeProvider(
        quotes={"BTC/USD": make_quote(at=FIXED_NOW - timedelta(seconds=600))}
    )
    account, service = paper_account(session, provider=provider)
    service.market_data.refresh_quote("BTC/USD", MarketType.CRYPTO)
    add_position(session, account)

    position = service.state(account).positions[0]

    assert position.price_stale
    assert position.price_age_seconds is not None
    assert position.price_age_seconds > 30


def test_paper_and_broker_positions_are_labelled(session):
    account, service = paper_account(session, cash="10000")
    add_position(session, account, source="broker_confirmed")

    position = service.state(account).positions[0]

    assert position.source == "broker_confirmed"


# --- FX -------------------------------------------------------------------


def test_fx_conversion_uses_a_stored_rate(session):
    _, service = paper_account(session, cash="1000")
    service.fx.store("EUR", "USD", Decimal("1.10"))

    assert service.fx.convert(Decimal("100"), "EUR", "USD") == Decimal("110")


def test_a_missing_fx_rate_is_not_invented(session):
    _, service = paper_account(session, cash="1000")

    assert service.fx.convert(Decimal("100"), "GBP", "USD") is None


def test_a_stale_fx_rate_is_not_trusted(session):
    clock = Clock()
    account = new_connection(session, mode="paper")
    service = portfolio_service(session, clock=clock)
    service.initialise_paper_account(account, starting_cash=Decimal("1000"))
    service.fx.store("EUR", "USD", Decimal("1.10"))

    clock.advance(days=2)

    assert service.fx.rate("EUR", "USD") == Decimal("1.10")
    assert service.fx.trusted_rate("EUR", "USD") is None


def test_a_position_in_another_currency_is_converted(session):
    provider = FakeProvider(
        quotes={
            "BTC/EUR": make_quote(
                symbol="BTC/EUR", bid="100", ask="100", last="100"
            )
        }
    )
    account, service = paper_account(session, cash="1000", provider=provider)
    service.fx.store("EUR", "USD", Decimal("1.10"))
    service.market_data.refresh_quote("BTC/EUR", MarketType.CRYPTO)
    add_position(session, account, symbol="BTC/EUR", quantity=Decimal("1"))

    position = service.state(account).positions[0]

    assert position.market_value == Decimal("110")


# --- aggregation ----------------------------------------------------------


def test_aggregate_sums_every_account(session):
    first, service = paper_account(session, cash="10000")
    second = new_connection(session, mode="paper")
    service.initialise_paper_account(second, starting_cash=Decimal("5000"))

    valuation = service.aggregate()

    assert valuation.total_equity == Decimal("15000")
    assert valuation.cash == Decimal("15000")
    assert len(valuation.accounts) == 2
    assert valuation.verified
    assert valuation.provenance == "live"


def test_aggregate_is_unavailable_when_an_account_is_unverified(session):
    account, service = paper_account(session, cash="10000")
    add_position(session, account)

    valuation = service.aggregate()

    assert valuation.total_equity is None
    assert not valuation.verified
    assert valuation.provenance == "unavailable"


def test_aggregate_with_no_connections_is_unavailable(session):
    service = portfolio_service(session)

    valuation = service.aggregate()

    assert valuation.total_equity is None
    assert valuation.accounts == []
    assert valuation.warnings
