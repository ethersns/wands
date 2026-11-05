"""Market data.

Every response carries the provenance of the data it contains. A quote that is
delayed, stale, one-sided or from a closed session is returned as
``unavailable`` with the reason attached — never as a live price.

Candles are served from the database. If none are stored the service asks the
provider once; if the provider cannot answer, the series is empty and the
envelope says so.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from wands.api.deps import require_role
from wands.config import Settings, get_settings
from wands.db.session import get_session
from wands.envelope import envelope, unavailable
from wands.errors import BadRequest, NotFound
from wands.marketdata.service import MarketDataService
from wands.marketdata.symbols import SymbolError, infer_market_type
from wands.schemas import (
    CandleInterval,
    MarketDataHealthOut,
    MarketRefreshOut,
    MarketType,
    dump,
    dump_many,
)
from wands.security.auth import Principal
from wands.security.rbac import Role
from wands.state import get_policy

router = APIRouter(prefix="/markets", tags=["markets"])


def _service(session: Session, settings: Settings) -> MarketDataService:
    policy = get_policy(session)
    return MarketDataService(
        session,
        settings=settings,
        max_quote_age_seconds=policy.max_quote_age_seconds,
    )


@router.get("/overview")
def overview(
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    principal: Principal = Depends(require_role(Role.VIEWER)),
) -> dict:
    service = _service(session, settings)
    result = service.overview()
    payload = dump(result.as_schema())

    if result.provenance == "live":
        return envelope(payload, warnings=result.warnings)

    reason = " ".join(result.warnings) or (
        "No live market data is available. Prices are unknown, not zero."
    )
    return unavailable(payload, reason)


@router.get("/health")
def health(
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    principal: Principal = Depends(require_role(Role.VIEWER)),
) -> dict:
    service = _service(session, settings)
    entries = [MarketDataHealthOut(**item.as_dict()) for item in service.health().values()]
    return envelope(dump_many(entries))


@router.post("/refresh")
def refresh(
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    principal: Principal = Depends(require_role(Role.OPERATOR)),
) -> dict:
    service = _service(session, settings)
    views = service.refresh_watchlist()
    warnings = [warning for view in views for warning in view.warnings]
    payload = MarketRefreshOut(
        refreshed=len(views),
        quotes=[view.as_schema() for view in views],
        warnings=warnings,
    )
    if not views:
        return unavailable(
            dump(payload),
            "No provider returned a quote. Check the market-data health endpoint.",
        )
    return envelope(dump(payload), warnings=warnings)


@router.get("/{symbol}/quote")
def quote(
    symbol: str,
    market_type: MarketType | None = None,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    principal: Principal = Depends(require_role(Role.VIEWER)),
) -> dict:
    market = market_type or infer_market_type(symbol)
    service = _service(session, settings)
    try:
        view = service.quote(symbol, market)
    except SymbolError as exc:
        raise BadRequest(str(exc)) from exc

    if view is None:
        raise NotFound(f"No quote is available for {symbol}.")

    payload = dump(view.as_schema())
    if view.strategy_eligible:
        return envelope(payload, warnings=list(view.warnings))
    return unavailable(
        payload,
        " ".join(view.warnings)
        or "This quote is not eligible for order pricing: it is not a live, fresh, "
        "two-sided quote in an open session.",
    )


@router.get("/{symbol}/candles")
def candles(
    symbol: str,
    interval: CandleInterval = CandleInterval.H1,
    market_type: MarketType | None = None,
    limit: int = Query(default=200, ge=1, le=1000),
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    principal: Principal = Depends(require_role(Role.VIEWER)),
) -> dict:
    service = _service(session, settings)
    try:
        series = service.candles(
            symbol, interval, market_type=market_type, limit=limit
        )
    except SymbolError as exc:
        raise BadRequest(str(exc)) from exc

    payload = dump(series)
    if not series.candles:
        return unavailable(
            payload,
            f"No candles are available for {symbol} ({interval}). The provider did not "
            "return history and none is stored.",
        )
    return envelope(payload)
