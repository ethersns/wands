"""Portfolio, positions and paper accounts.

Equity, cash and P&L come from the portfolio service, which values positions
against stored quotes and stored FX rates. When a price or a rate is missing the
figure is ``null`` and the envelope is ``unavailable`` — a zero balance and an
unknown balance look identical in a chart and only one of them is true.

Paper accounts are created here. There is no endpoint that promotes one to live.
"""

from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from wands.api.deps import admin_principal, client_ip, request_id_of, require_role
from wands.config import Settings, get_settings
from wands.db.session import get_session
from wands.envelope import envelope, isoformat, unavailable
from wands.errors import NotFound
from wands.portfolio.money import ZERO, money
from wands.portfolio.service import (
    AccountValuation,
    PortfolioService,
    PortfolioValuation,
    PositionValuation,
)
from wands.schemas import (
    AccessLevel,
    AllocationSlice,
    BrokerAccount,
    ConnectionStatus,
    EquityPoint,
    LedgerEntryOut,
    MarketBreakdown,
    PaperAccountCreate,
    PaperAccountOut,
    PaperAccountReset,
    PortfolioSummary,
    PortfolioVerificationOut,
    PositionOut,
    Provider,
    TradingMode,
    dump,
    dump_many,
)
from wands.security.auth import Principal
from wands.security.rbac import Role

router = APIRouter(tags=["portfolio"])


def _service(session: Session, settings: Settings) -> PortfolioService:
    return PortfolioService(session, settings=settings)


def _position(item: PositionValuation) -> PositionOut:
    return PositionOut(
        id=item.id,
        account_id=item.connection_id,
        symbol=item.symbol,
        name=item.symbol,
        market_type=item.market_type,
        quantity=item.quantity,
        average_entry_price=item.average_entry_price,
        last_price=item.last_price,
        market_value=item.market_value,
        unrealised_pnl=item.unrealised_pnl,
        unrealised_pnl_pct=item.unrealised_pnl_pct,
        realised_pnl=item.realised_pnl,
        fees_paid=item.fees_paid,
        opened_at=isoformat(item.opened_at) or "",
        strategy_id=item.strategy_id,
        bot_id=item.bot_id,
        source=item.source,
        price_quality=item.price_quality,
        price_as_of=isoformat(item.price_as_of) if item.price_as_of else None,
        price_age_seconds=item.price_age_seconds,
        price_stale=item.price_stale,
    )


def _account(item: AccountValuation) -> BrokerAccount:
    return BrokerAccount(
        id=item.connection_id,
        provider=Provider(item.provider),
        label=item.label,
        market_type=item.market_type,
        status=ConnectionStatus.CONNECTED if item.verified else ConnectionStatus.DEGRADED,
        access=AccessLevel(item.access),
        mode=TradingMode(item.mode),
        base_currency=item.base_currency,
        last_synced_at=isoformat(item.last_synced_at) if item.last_synced_at else None,
        equity=item.equity,
        cash=item.cash,
        buying_power=item.buying_power,
        permissions=item.permissions,
        error="; ".join(item.warnings) or None,
        source=item.source,
        verified=item.verified,
    )


def _reserved(valuation: PortfolioValuation) -> Decimal | None:
    values = [account.reserved for account in valuation.accounts]
    if not values or any(value is None for value in values):
        return None
    return money(sum((value or ZERO) for value in values))


def _summary(valuation: PortfolioValuation) -> PortfolioSummary:
    return PortfolioSummary(
        base_currency=valuation.base_currency,
        total_equity=valuation.total_equity,
        cash=valuation.cash,
        reserved=_reserved(valuation),
        buying_power=valuation.buying_power,
        verified=valuation.verified,
        day_pnl=valuation.day_pnl,
        day_pnl_pct=valuation.day_pnl_pct,
        realised_pnl=valuation.realised_pnl,
        unrealised_pnl=valuation.unrealised_pnl,
        fees_paid=valuation.fees_paid,
        open_positions=valuation.open_positions,
        equity_curve=[
            EquityPoint(t=isoformat(at) or "", equity=value, benchmark=None)
            for at, value in valuation.equity_curve
        ],
        allocation=[
            AllocationSlice(key=key, label=label, value=value, pct=pct)
            for key, label, value, pct in valuation.allocation
        ],
        by_market={
            market: MarketBreakdown(equity=equity, pct=pct)
            for market, (equity, pct) in valuation.by_market.items()
        },
        accounts=[_account(account) for account in valuation.accounts],
        positions=[_position(position) for position in valuation.positions],
    )


def _paper_out(paper, state: AccountValuation) -> PaperAccountOut:
    return PaperAccountOut(
        id=str(paper.id),
        connection_id=str(paper.connection_id),
        base_currency=paper.base_currency,
        starting_cash=Decimal(paper.starting_cash),
        status=paper.status,
        provenance=paper.provenance,
        initialised_at=isoformat(paper.initialised_at) or "",
        initialised_by=paper.initialised_by,
        reset_at=isoformat(paper.reset_at) if paper.reset_at else None,
        reset_by=paper.reset_by,
        cash=state.cash,
        reserved=state.reserved,
        buying_power=state.buying_power,
        equity=state.equity,
        verified=state.verified,
    )


@router.get("/portfolio")
def portfolio(
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    principal: Principal = Depends(require_role(Role.VIEWER)),
) -> dict:
    valuation = _service(session, settings).aggregate()
    payload = dump(_summary(valuation))

    if valuation.provenance == "live":
        return envelope(payload, warnings=valuation.warnings)

    reason = " ".join(valuation.warnings) or (
        "Portfolio state is unavailable. Equity and P&L are unknown, not zero."
    )
    return unavailable(payload, reason)


@router.get("/positions")
def positions(
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    principal: Principal = Depends(require_role(Role.VIEWER)),
) -> dict:
    valuation = _service(session, settings).aggregate()
    payload = dump_many([_position(item) for item in valuation.positions])
    if not valuation.positions:
        return envelope(payload)
    if valuation.verified:
        return envelope(payload, warnings=valuation.warnings)
    return unavailable(
        payload,
        " ".join(valuation.warnings)
        or "At least one position has no trustworthy price, so its value is unknown.",
    )


@router.get("/paper/accounts")
def list_paper_accounts(
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    principal: Principal = Depends(require_role(Role.VIEWER)),
) -> dict:
    service = _service(session, settings)
    valuation = service.aggregate()
    accounts = []
    for account in valuation.accounts:
        paper = service.paper_account(account.connection_id)
        if paper is not None:
            accounts.append(_paper_out(paper, account))
    return envelope(dump_many(accounts))


@router.post("/paper/accounts")
def create_paper_account(
    payload: PaperAccountCreate,
    request: Request,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    principal: Principal = Depends(admin_principal),
) -> dict:
    service = _service(session, settings)
    paper = service.initialise_paper_account(
        payload.connection_id,
        starting_cash=payload.starting_cash,
        currency=payload.currency,
        principal=principal,
        reset=payload.reset,
        request_id=request_id_of(request),
        ip=client_ip(request),
    )
    state = service.state(payload.connection_id)
    return envelope(dump(_paper_out(paper, state)))


@router.get("/paper/accounts/{connection_id}")
def get_paper_account(
    connection_id: str,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    principal: Principal = Depends(require_role(Role.VIEWER)),
) -> dict:
    service = _service(session, settings)
    paper = service.paper_account(connection_id)
    if paper is None:
        raise NotFound("This connection has no paper account.")
    state = service.state(connection_id)
    return envelope(dump(_paper_out(paper, state)))


@router.post("/paper/accounts/{connection_id}/reset")
def reset_paper_account(
    connection_id: str,
    request: Request,
    payload: PaperAccountReset | None = None,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    principal: Principal = Depends(admin_principal),
) -> dict:
    service = _service(session, settings)
    paper = service.initialise_paper_account(
        connection_id,
        starting_cash=payload.starting_cash if payload else None,
        currency=payload.currency if payload else None,
        principal=principal,
        reset=True,
        request_id=request_id_of(request),
        ip=client_ip(request),
    )
    state = service.state(connection_id)
    return envelope(dump(_paper_out(paper, state)))


@router.get("/accounts/{connection_id}/verification")
def verification(
    connection_id: str,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    principal: Principal = Depends(require_role(Role.VIEWER)),
) -> dict:
    result = _service(session, settings).verify(connection_id)
    payload = PortfolioVerificationOut(
        connection_id=result.connection_id,
        ok=result.ok,
        expected_cash=result.expected_cash,
        stored_cash=result.stored_cash,
        difference=result.difference,
        checked_at=isoformat(result.checked_at) or "",
        detail=result.detail,
    )
    if result.ok:
        return envelope(dump(payload))
    return unavailable(dump(payload), result.detail)


@router.get("/accounts/{connection_id}/ledger")
def ledger(
    connection_id: str,
    limit: int = 200,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    principal: Principal = Depends(require_role(Role.VIEWER)),
) -> dict:
    rows = _service(session, settings).ledger(connection_id, limit=limit)
    entries = [
        LedgerEntryOut(
            id=str(row.id),
            at=isoformat(row.at) or "",
            kind=row.kind,
            amount=Decimal(row.amount),
            currency=row.currency,
            reference=row.reference,
            source=row.source,
            detail=row.detail or {},
        )
        for row in rows
    ]
    return envelope(dump_many(entries))
