"""Risk policy and risk events.

The policy is writable only by an admin principal with MFA where enrolled. No
strategy, bot or AI path can reach these routes — they are HTTP endpoints behind
role checks, and the strategy package cannot import the database at all.
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from wands.api.deps import (
    admin_principal,
    client_ip,
    request_id_of,
    require_role,
)
from wands.config import Settings, get_settings
from wands.db.models import RiskEventRow
from wands.db.session import get_session
from wands.envelope import envelope, isoformat
from wands.errors import BadRequest
from wands.portfolio.money import ZERO, money, pct_of
from wands.portfolio.service import PortfolioService
from wands.risk.policy import RiskPolicy
from wands.schemas import (
    PauseRequest,
    RiskBreach,
    RiskCategory,
    RiskEventOut,
    RiskPolicyOut,
    RiskPolicyPatch,
    RiskSeverity,
    RiskSnapshot,
    RiskUtilisation,
    dump,
)
from wands.security.audit import record_for_principal
from wands.security.auth import Principal
from wands.security.rbac import Role
from wands.state import get_active_policy_row, get_engine_state

router = APIRouter(prefix="/risk", tags=["risk"])


def _policy_out(session: Session) -> RiskPolicyOut:
    row = get_active_policy_row(session)
    state = get_engine_state(session)
    policy = RiskPolicy.from_row(row)
    return RiskPolicyOut(
        max_portfolio_exposure_pct=policy.max_portfolio_exposure_pct,
        max_position_exposure_pct=policy.max_position_exposure_pct,
        per_trade_risk_pct=policy.per_trade_risk_pct,
        daily_loss_limit_pct=policy.daily_loss_limit_pct,
        max_drawdown_pct=policy.max_drawdown_pct,
        crypto_allocation_cap_pct=policy.crypto_allocation_cap_pct,
        stocks_allocation_cap_pct=policy.stocks_allocation_cap_pct,
        max_quote_age_seconds=policy.max_quote_age_seconds,
        duplicate_order_window_seconds=policy.duplicate_order_window_seconds,
        allow_short_selling=policy.allow_short_selling,
        allow_leverage=policy.allow_leverage,
        trading_paused=bool(state.trading_paused),
        emergency_stop_engaged=bool(state.emergency_stop_engaged),
        updated_at=isoformat(row.updated_at) or "",
    )


def _utilisation(session: Session, settings: Settings) -> RiskUtilisation:
    """Current utilisation of each limit, from the verified portfolio state.

    Every figure is ``None`` when equity is unknown: a utilisation of 0% against
    an unknown portfolio would read as "plenty of room" when the truth is "no
    idea".
    """
    valuation = PortfolioService(session, settings=settings).aggregate()
    equity = valuation.total_equity
    if equity is None or equity <= ZERO:
        return RiskUtilisation()

    valued = [item for item in valuation.positions if item.market_value is not None]
    exposure = money(sum((item.market_value or ZERO) for item in valued)) if valued else ZERO
    largest = max((item.market_value or ZERO for item in valued), default=ZERO)

    crypto = valuation.by_market.get("crypto", (None, None))[0]
    stocks = valuation.by_market.get("stocks", (None, None))[0]

    daily_loss = None
    if valuation.day_pnl_pct is not None:
        daily_loss = -valuation.day_pnl_pct if valuation.day_pnl_pct < ZERO else ZERO

    drawdowns = [
        account.drawdown_pct
        for account in valuation.accounts
        if account.drawdown_pct is not None
    ]

    return RiskUtilisation(
        portfolio_exposure_pct=pct_of(exposure, equity),
        largest_position_pct=pct_of(largest, equity),
        daily_loss_pct=daily_loss,
        drawdown_pct=max(drawdowns) if drawdowns else None,
        crypto_allocation_pct=pct_of(crypto, equity) if crypto is not None else None,
        stocks_allocation_pct=pct_of(stocks, equity) if stocks is not None else None,
    )


def _breaches(session: Session, settings: Settings) -> list[RiskBreach]:
    state = get_engine_state(session)
    breaches: list[RiskBreach] = []
    if state.emergency_stop_engaged:
        breaches.append(
            RiskBreach(
                key="emergency_stop",
                label="Emergency stop engaged",
                severity=RiskSeverity.CRITICAL,
                detail=(
                    f"Engaged by {state.emergency_stop_actor or 'unknown'} at "
                    f"{isoformat(state.emergency_stop_at)}. All new orders are blocked."
                ),
            )
        )
    if state.trading_paused:
        breaches.append(
            RiskBreach(
                key="trading_paused",
                label="Trading paused",
                severity=RiskSeverity.WARNING,
                detail="New orders are blocked until trading is resumed.",
            )
        )

    valuation = PortfolioService(session, settings=settings).aggregate()
    if valuation.accounts and not valuation.verified:
        breaches.append(
            RiskBreach(
                key="portfolio_unverified",
                label="Portfolio unverified",
                severity=RiskSeverity.WARNING,
                detail=(
                    "At least one position has no trustworthy price or FX rate, so the "
                    "risk engine cannot size an order against this portfolio."
                ),
            )
        )

    stale = sorted({item.symbol for item in valuation.positions if item.price_stale})
    if stale:
        breaches.append(
            RiskBreach(
                key="stale_market_data",
                label="Stale market data",
                severity=RiskSeverity.WARNING,
                detail=(
                    f"Quotes for {', '.join(stale)} are outside the freshness policy. "
                    "Orders in these instruments will be blocked."
                ),
            )
        )
    return breaches


@router.get("")
def snapshot(
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    principal: Principal = Depends(require_role(Role.VIEWER)),
) -> dict:
    rows = session.scalars(select(RiskEventRow).order_by(RiskEventRow.at.desc()).limit(50)).all()
    events = [
        RiskEventOut(
            id=str(row.id),
            at=isoformat(row.at) or "",
            severity=RiskSeverity(row.severity),
            category=RiskCategory(row.category),
            title=row.title,
            detail=row.detail,
            acknowledged=bool(row.acknowledged),
            actor=row.actor,
        )
        for row in rows
    ]

    payload = RiskSnapshot(
        policy=_policy_out(session),
        utilisation=_utilisation(session, settings),
        breaches=_breaches(session, settings),
        events=events,
    )
    return envelope(dump(payload))


def _apply_policy(
    session: Session,
    principal: Principal,
    request: Request,
    changes: dict,
) -> dict:
    row = get_active_policy_row(session)
    current = RiskPolicy.from_row(row)
    updated = current.apply(changes)

    if updated.max_position_exposure_pct > updated.max_portfolio_exposure_pct:
        raise BadRequest("The per-position limit cannot exceed the total portfolio exposure limit.")
    if updated.crypto_allocation_cap_pct + updated.stocks_allocation_cap_pct <= 0:
        raise BadRequest("At least one asset-class allocation cap must be positive.")

    for key, value in updated.to_row_kwargs().items():
        setattr(row, key, value)
    row.updated_by = principal.subject
    row.updated_at = datetime.now(tz=UTC)

    session.add(
        RiskEventRow(
            severity=str(RiskSeverity.INFO),
            category=str(RiskCategory.POLICY_CHANGE),
            title="Risk policy updated",
            detail=", ".join(
                f"{key}={value}" for key, value in changes.items() if value is not None
            ),
            actor=principal.subject,
        )
    )
    record_for_principal(
        session,
        principal,
        action="risk.policy.update",
        target=str(row.id),
        detail={key: str(value) for key, value in changes.items() if value is not None},
        request_id=request_id_of(request),
        ip=client_ip(request),
    )
    session.flush()
    return envelope(dump(_policy_out(session)))


@router.patch("/policy")
def patch_policy(
    payload: RiskPolicyPatch,
    request: Request,
    session: Session = Depends(get_session),
    principal: Principal = Depends(admin_principal),
) -> dict:
    return _apply_policy(session, principal, request, payload.model_dump(exclude_none=True))


@router.put("")
def replace_policy(
    payload: RiskPolicyPatch,
    request: Request,
    session: Session = Depends(get_session),
    principal: Principal = Depends(admin_principal),
) -> dict:
    return _apply_policy(session, principal, request, payload.model_dump(exclude_none=True))


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
        action="risk.pause" if payload.paused else "risk.resume",
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
    session.add(
        RiskEventRow(
            severity=str(RiskSeverity.CRITICAL),
            category=str(RiskCategory.EMERGENCY_STOP),
            title="Emergency stop engaged",
            detail="All new orders are blocked until the stop is cleared.",
            actor=principal.subject,
        )
    )
    record_for_principal(
        session,
        principal,
        action="risk.emergency_stop",
        target="engine",
        detail={"engaged": True},
        request_id=request_id_of(request),
        ip=client_ip(request),
    )
    session.flush()
    return envelope({"acknowledged": True, "emergencyStopEngaged": True})
