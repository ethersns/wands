"""Market intelligence.

The research reads are read-only by construction: no GET in this module can
change a position, an order or a risk limit. Collection is triggered by the
scheduler or the CLI.

Intelligence 1.1 adds three administrative POSTs — a bounded backfill and
job pause/resume. They are admin-only, they are audited, and they can only
change research state: a backfill writes filings, and pause/resume writes a job
row. None of them can reach the order path, because the intelligence package
does not import it.

Every response is an envelope. When nothing is stored the payload is returned as
``unavailable`` with the reason attached, so an empty feed reads as "nothing has
been collected" rather than "nothing happened".
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from wands.api.deps import client_ip, request_id_of, require_role, require_scope
from wands.config import Settings, get_settings
from wands.db.session import get_session
from wands.envelope import envelope, unavailable
from wands.errors import BadRequest, NotFound
from wands.intelligence.member import MemberResearchService
from wands.intelligence.research import ResearchService
from wands.intelligence.schemas import (
    AssetResearchOut,
    InsiderFeedOut,
    InsiderSymbolSummaryOut,
    InstitutionChangesOut,
    InstitutionFeedOut,
    IntelBackfillOut,
    IntelBackfillRequest,
    IntelCoverageOut,
    IntelExperimentFeedOut,
    IntelExperimentOut,
    IntelJobFeedOut,
    IntelValidationOut,
    ResearchCoverageDisclosureOut,
    ResearchDashboardOut,
    ResearchSourceLinkOut,
    SignalFeedOut,
    SignalOut,
)
from wands.intelligence.service import INSIDER_CAVEATS, IntelligenceService
from wands.schemas import dump, dump_many
from wands.security.audit import record_for_principal
from wands.security.auth import Principal
from wands.security.rbac import Role

router = APIRouter(prefix="/intelligence", tags=["intelligence"])

# The member research surface is gated on a scope, not on a role. A credential
# issued for the member workspace carries ``research:read`` and nothing else, so
# it can read filings and signals without reaching orders, risk, connections or
# engine administration.
RESEARCH_SCOPE = "research:read"


def _service(session: Session, settings: Settings) -> IntelligenceService:
    return IntelligenceService(session, settings)


def _member(session: Session, settings: Settings) -> MemberResearchService:
    return MemberResearchService(session, settings)


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
    principal: Principal = Depends(require_scope(RESEARCH_SCOPE)),
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
    principal: Principal = Depends(require_scope(RESEARCH_SCOPE)),
) -> dict:
    """The member asset page: evidence, its sources, and how much it covers.

    ``sources`` and ``coverage`` are required by the member contract. An asset
    page that cannot say where its evidence came from, or how much of the window
    it covers, is not publishable.
    """
    summary: AssetResearchOut = _member(session, settings).asset(symbol, as_of=as_of)
    payload = dump(summary)
    has_evidence = bool(summary.signals) or summary.insider.purchase_count > 0
    if not has_evidence:
        return unavailable(
            payload,
            f"No research evidence is stored for {summary.symbol}. The summary is empty "
            "because nothing has been collected for this symbol.",
        )
    return envelope(payload, warnings=list(summary.caveats))


# --- research (intelligence 1.1) ------------------------------------------


def _research(session: Session, settings: Settings) -> ResearchService:
    return ResearchService(session, settings)


@router.get("/jobs")
def jobs(
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    principal: Principal = Depends(require_role(Role.VIEWER)),
) -> dict:
    feed: IntelJobFeedOut = _research(session, settings).jobs()
    payload = dump(feed)
    if not feed.items:
        return unavailable(
            payload,
            "No research job has run yet. The scheduler creates a row for each "
            "registered job the first time it starts.",
        )
    return envelope(payload, warnings=list(feed.caveats))


@router.get("/coverage")
def coverage(
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    principal: Principal = Depends(require_role(Role.VIEWER)),
) -> dict:
    result: IntelCoverageOut = _research(session, settings).coverage()
    payload = dump(result)
    if result.filings == 0 and result.signals == 0:
        return unavailable(
            payload,
            "Nothing has been collected yet, so coverage is empty. This is a collection "
            "state, not a statement that no filings exist.",
        )
    return envelope(payload, warnings=list(result.caveats))


@router.get("/experiments")
def experiments(
    limit: int = Query(default=50, ge=1, le=200),
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    principal: Principal = Depends(require_role(Role.VIEWER)),
) -> dict:
    feed: IntelExperimentFeedOut = _research(session, settings).experiments(limit=limit)
    payload = dump(feed)
    if not feed.items:
        return unavailable(
            payload,
            "No research experiment has been recorded. An experiment is created by "
            "running a validation over a defined period.",
        )
    return envelope(payload, warnings=list(feed.caveats))


@router.get("/experiments/{experiment_id}")
def experiment(
    experiment_id: str,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    principal: Principal = Depends(require_role(Role.VIEWER)),
) -> dict:
    try:
        uuid.UUID(experiment_id)
    except ValueError as exc:
        raise BadRequest(f"{experiment_id!r} is not an experiment identifier.") from exc

    result: IntelExperimentOut | None = _research(session, settings).experiment(
        experiment_id
    )
    if result is None:
        raise NotFound(f"No experiment with id {experiment_id} is stored.")
    warnings = list(result.flags)
    if result.status != "complete":
        return unavailable(
            dump(result),
            "This experiment did not produce a usable result. The status and flags say why.",
        )
    return envelope(dump(result), warnings=warnings)


@router.get("/signals/{signal_id}/validation")
def signal_validation(
    signal_id: str,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    principal: Principal = Depends(require_role(Role.VIEWER)),
) -> dict:
    try:
        uuid.UUID(signal_id)
    except ValueError as exc:
        raise BadRequest(f"{signal_id!r} is not a signal identifier.") from exc

    result: IntelValidationOut | None = _research(session, settings).signal_validation(
        signal_id
    )
    if result is None:
        raise NotFound(f"No signal with id {signal_id} is stored.")

    payload = dump(result)
    if result.status != "complete":
        return unavailable(
            payload,
            "This signal's category could not be measured over a usable sample. The "
            "status and flags say why, and no performance statistic is reported.",
        )
    return envelope(payload, warnings=list(result.flags))


@router.post("/backfill")
def backfill(
    payload: IntelBackfillRequest,
    request: Request,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    principal: Principal = Depends(require_role(Role.ADMIN)),
) -> dict:
    """Run a bounded historical backfill.

    Admin-only and audited. The request is bounded by ``maxFilings`` so an
    administrative call cannot hold a worker open indefinitely; a long crawl
    belongs to the scheduler.
    """
    result: IntelBackfillOut = _research(session, settings).run_backfill(payload)
    record_for_principal(
        session,
        principal,
        action="intelligence.backfill",
        target=",".join(payload.ciks) or "configured_issuers",
        outcome="success" if result.status in {"ok", "partial"} else "failure",
        detail={
            "formFamily": payload.form_family,
            "startDate": payload.start_date or "",
            "endDate": payload.end_date or "",
            "filingsNew": result.filings_new,
            "filingsUnavailable": result.filings_unavailable,
            "filingsMalformed": result.filings_malformed,
            "status": result.status,
        },
        request_id=request_id_of(request),
        ip=client_ip(request),
    )
    session.commit()

    body = dump(result)
    reasons = [error["message"] for error in result.errors]
    if result.status == "failed":
        return unavailable(
            body,
            "The backfill did not ingest any filing. "
            + (" ".join(reasons) if reasons else "No error detail was recorded."),
        )
    return envelope(body, warnings=reasons)


@router.post("/jobs/{name}/pause")
def pause_job(
    name: str,
    request: Request,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    principal: Principal = Depends(require_role(Role.ADMIN)),
) -> dict:
    changed = _research(session, settings).pause_job(name)
    if not changed:
        raise NotFound(f"No research job named {name!r} is registered.")
    record_for_principal(
        session,
        principal,
        action="intelligence.job.pause",
        target=name,
        request_id=request_id_of(request),
        ip=client_ip(request),
    )
    session.commit()
    return envelope({"job": name, "paused": True})


@router.post("/jobs/{name}/resume")
def resume_job(
    name: str,
    request: Request,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    principal: Principal = Depends(require_role(Role.ADMIN)),
) -> dict:
    changed = _research(session, settings).resume_job(name)
    if not changed:
        raise NotFound(f"No research job named {name!r} is registered.")
    record_for_principal(
        session,
        principal,
        action="intelligence.job.resume",
        target=name,
        request_id=request_id_of(request),
        ip=client_ip(request),
    )
    session.commit()
    return envelope({"job": name, "paused": False})


# --- member research (customer-safe) --------------------------------------
#
# Read-only, scope-gated, and assembled from stored rows. None of these can
# reach the order path, the portfolio, the risk engine or a connection
# credential, and none of them report collection machinery.


@router.get("/dashboard")
def dashboard(
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    principal: Principal = Depends(require_scope(RESEARCH_SCOPE)),
) -> dict:
    result: ResearchDashboardOut = _member(session, settings).dashboard()
    payload = dump(result)
    if result.counts.filings == 0 and result.counts.signals == 0:
        return unavailable(
            payload,
            "Nothing has been collected yet, so the dashboard is empty. This is a "
            "collection state, not a statement that no insider filed.",
        )
    return envelope(payload, warnings=list(result.caveats))


@router.get("/sources")
def sources(
    subject_type: Literal[
        "symbol", "insider_transaction", "institution", "signal"
    ] = Query(...),
    subject_id: str = Query(min_length=1, max_length=128),
    symbol: str | None = None,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    principal: Principal = Depends(require_scope(RESEARCH_SCOPE)),
) -> dict:
    items: list[ResearchSourceLinkOut] = _member(session, settings).sources(
        subject_type=subject_type, subject_id=subject_id, symbol=symbol
    )
    payload = dump_many(items)
    if not items:
        return unavailable(
            payload,
            "No resolvable SEC source is stored for this subject. A claim without a "
            "source link is not shown.",
        )
    return envelope(payload)


@router.get("/coverage/public")
def public_coverage(
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    principal: Principal = Depends(require_scope(RESEARCH_SCOPE)),
) -> dict:
    result: ResearchCoverageDisclosureOut = _member(session, settings).public_coverage()
    payload = dump(result)
    if result.status == "unavailable":
        return unavailable(
            payload,
            "Nothing has been collected yet, so coverage is empty. This is a collection "
            "state, not a statement that no filings exist.",
        )
    return envelope(payload, warnings=list(result.caveats))


@router.get("/insiders/transactions/{transaction_id}")
def insider_transaction(
    transaction_id: str,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    principal: Principal = Depends(require_scope(RESEARCH_SCOPE)),
) -> dict:
    """One transaction by its stable id, independent of feed pagination.

    A member who saved a filing must be able to reopen it after it has aged out
    of the published feed, so this reads the row directly rather than scanning a
    page of the feed.
    """
    try:
        uuid.UUID(transaction_id)
    except ValueError as exc:
        raise BadRequest(f"{transaction_id!r} is not a transaction identifier.") from exc

    result = _member(session, settings).insider_transaction(transaction_id)
    if result is None:
        raise NotFound(f"No insider transaction with id {transaction_id} is stored.")
    return envelope(dump(result))
