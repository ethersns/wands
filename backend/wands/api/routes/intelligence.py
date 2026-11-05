"""Market intelligence.

Read-only by construction: there is no POST, PUT, PATCH or DELETE in this module,
so no request to it can change a position, an order or a risk limit. Collection
is triggered by the scheduler or the CLI, never by an API call.

Every response is an envelope. When nothing is stored the payload is returned as
``unavailable`` with the reason attached, so an empty feed reads as "nothing has
been collected" rather than "nothing happened".
"""

from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from wands.api.deps import require_role
from wands.config import Settings, get_settings
from wands.db.session import get_session
from wands.envelope import envelope, unavailable
from wands.errors import BadRequest, NotFound
from wands.intelligence.schemas import (
    InsiderFeedOut,
    InsiderSymbolSummaryOut,
    InstitutionChangesOut,
    InstitutionFeedOut,
    SignalFeedOut,
    SignalOut,
    SymbolSummaryOut,
)
from wands.intelligence.service import INSIDER_CAVEATS, IntelligenceService
from wands.schemas import dump
from wands.security.auth import Principal
from wands.security.rbac import Role

router = APIRouter(prefix="/intelligence", tags=["intelligence"])


def _service(session: Session, settings: Settings) -> IntelligenceService:
    return IntelligenceService(session, settings)


@router.get("/status")
def status(
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    principal: Principal = Depends(require_role(Role.VIEWER)),
) -> dict:
    payload = dump(_service(session, settings).status())
    if not payload["enabled"]:
        return unavailable(
            payload,
            "Intelligence collection is disabled (WANDS_INTELLIGENCE_ENABLED=false). "
            "No research data is being collected.",
        )
    return envelope(payload, warnings=list(payload.get("caveats") or []))


@router.get("/insiders")
def insiders(
    symbol: str | None = None,
    classification: str | None = None,
    open_market_only: bool = False,
    since: datetime | None = None,
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=50, ge=1, le=200),
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    principal: Principal = Depends(require_role(Role.VIEWER)),
) -> dict:
    feed: InsiderFeedOut = _service(session, settings).insiders(
        symbol=symbol,
        classification=classification,
        open_market_only=open_market_only,
        since=since,
        page=page,
        limit=limit,
    )
    payload = dump(feed)
    if feed.total == 0:
        return unavailable(
            payload,
            "No insider transactions match this query. Nothing is stored for these "
            "filters, which is not the same as no insider activity occurring.",
        )
    return envelope(payload, warnings=list(INSIDER_CAVEATS))


@router.get("/insiders/{symbol}")
def insider_symbol(
    symbol: str,
    window_days: int | None = Query(default=None, ge=1, le=730),
    as_of: datetime | None = None,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    principal: Principal = Depends(require_role(Role.VIEWER)),
) -> dict:
    summary: InsiderSymbolSummaryOut = _service(session, settings).insider_summary(
        symbol, window_days=window_days, as_of=as_of
    )
    payload = dump(summary)
    if summary.purchase_count == 0 and summary.sale_count == 0:
        return unavailable(
            payload,
            f"No open-market insider purchases or sales are stored for {summary.symbol} "
            f"in the last {summary.window_days} days.",
        )
    return envelope(payload, warnings=list(summary.caveats))


@router.get("/institutions")
def institutions(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=50, ge=1, le=200),
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    principal: Principal = Depends(require_role(Role.VIEWER)),
) -> dict:
    feed: InstitutionFeedOut = _service(session, settings).institutions(
        page=page, limit=limit
    )
    payload = dump(feed)
    if feed.total == 0:
        return unavailable(
            payload,
            "No 13F filings are stored. Institutional data is empty because nothing has "
            "been collected.",
        )
    return envelope(payload)


@router.get("/institutions/{cik}/changes")
def institution_changes(
    cik: str,
    period: datetime | None = None,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    principal: Principal = Depends(require_role(Role.VIEWER)),
) -> dict:
    result: InstitutionChangesOut | None = _service(session, settings).institution_changes(
        cik, period=period
    )
    if result is None:
        raise NotFound(f"No institution with CIK {cik} is stored.")

    payload = dump(result)
    if not result.changes:
        return unavailable(
            payload,
            f"No 13F holdings are stored for {result.name}, so no quarter-over-quarter "
            "change can be calculated.",
        )
    return envelope(payload, warnings=list(result.caveats))


@router.get("/signals")
def signals(
    category: str | None = None,
    symbol: str | None = None,
    as_of: datetime | None = None,
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=50, ge=1, le=200),
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    principal: Principal = Depends(require_role(Role.VIEWER)),
) -> dict:
    feed: SignalFeedOut = _service(session, settings).signals(
        category=category, symbol=symbol, as_of=as_of, page=page, limit=limit
    )
    payload = dump(feed)
    if feed.total == 0:
        return unavailable(
            payload,
            "No research signal matches this query. Signals are only produced when a "
            "configured threshold is met, so an empty result is expected for most symbols.",
        )
    return envelope(payload)


@router.get("/signals/{signal_id}")
def signal(
    signal_id: str,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    principal: Principal = Depends(require_role(Role.VIEWER)),
) -> dict:
    try:
        uuid.UUID(signal_id)
    except ValueError as exc:
        raise BadRequest(f"{signal_id!r} is not a signal identifier.") from exc

    result: SignalOut | None = _service(session, settings).signal(signal_id)
    if result is None:
        raise NotFound(f"No signal with id {signal_id} is stored.")
    return envelope(dump(result))


@router.get("/symbols/{symbol}/summary")
def symbol_summary(
    symbol: str,
    as_of: datetime | None = None,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    principal: Principal = Depends(require_role(Role.VIEWER)),
) -> dict:
    summary: SymbolSummaryOut = _service(session, settings).symbol_summary(
        symbol, as_of=as_of
    )
    payload = dump(summary)
    has_evidence = bool(summary.signals) or summary.insider.purchase_count > 0
    if not has_evidence:
        return unavailable(
            payload,
            f"No research evidence is stored for {summary.symbol}. The summary is empty "
            "because nothing has been collected for this symbol.",
        )
    return envelope(payload, warnings=list(summary.caveats))
