"""Performance Lab endpoints.

Every route here is admin-only. The module is a private research surface: it
records signals, evaluates them and stores evidence. It cannot place an order,
because the performance package does not import the order path.

Reads return an envelope. A metric that cannot be computed is returned with an
explicit status rather than a zero, so the dashboard can say "not yet
calculated" instead of showing a number that was never measured.
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from pydantic import Field
from sqlalchemy.orm import Session

from wands.api.deps import client_ip, request_id_of, require_role
from wands.config import Settings, get_settings
from wands.db.session import get_session
from wands.envelope import envelope
from wands.errors import BadRequest, NotFound
from wands.intelligence.validation import CandlePriceProvider
from wands.performance import PerformanceLab, SignalInput
from wands.schemas import CamelModel
from wands.security.audit import record_for_principal
from wands.security.auth import Principal
from wands.security.rbac import Role

router = APIRouter(prefix="/performance", tags=["performance"])


class RecordSignalRequest(CamelModel):
    strategy_key: str
    strategy_name: str
    signal_version: str = "1"
    parameters: dict[str, Any] = Field(default_factory=dict)
    symbol: str
    direction: str
    generated_at: datetime
    observed_at: datetime
    reference_price: Decimal | None = None
    reference_price_at: datetime | None = None
    timeframe: str = "1d"
    asset_class: str = "equity"
    confidence: Decimal | None = None
    data_source: str = ""
    data_freshness_seconds: int | None = None
    conditions: dict[str, Any] = Field(default_factory=dict)
    risk_parameters: dict[str, Any] = Field(default_factory=dict)
    payload: dict[str, Any] = Field(default_factory=dict)
    model_metadata: dict[str, Any] = Field(default_factory=dict)
    horizons: list[str] = Field(default_factory=list)


class RunEvaluationsRequest(CamelModel):
    now: datetime | None = None
    limit: int = 100


class CreateEvidenceRequest(CamelModel):
    kind: str
    title: str
    objective: str
    dataset: dict[str, Any] = Field(default_factory=dict)
    assumptions: dict[str, Any] = Field(default_factory=dict)
    results: dict[str, Any] = Field(default_factory=dict)
    limitations: list[str] = Field(default_factory=list)
    strategy_version_id: str | None = None
    conclusion: str | None = None


class FinalizeEvidenceRequest(CamelModel):
    conclusion: str


def _lab(session: Session, settings: Settings, principal: Principal) -> PerformanceLab:
    return PerformanceLab(
        session,
        price_provider=CandlePriceProvider(session),
        benchmark_symbol=settings.intelligence_validation_benchmark,
        actor=principal.subject,
    )


@router.get("/overview")
def overview(
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    principal: Principal = Depends(require_role(Role.ADMIN)),
) -> dict:
    payload = _lab(session, settings, principal).overview()
    return envelope(payload, warnings=list(payload.get("limitations") or []))


@router.get("/signals")
def signals(
    limit: int = Query(default=100, ge=1, le=500),
    symbol: str | None = None,
    direction: str | None = None,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    principal: Principal = Depends(require_role(Role.ADMIN)),
) -> dict:
    items = _lab(session, settings, principal).signals(
        limit=limit, symbol=symbol, direction=direction
    )
    return envelope({"items": items, "count": len(items)})


@router.get("/strategies")
def strategies(
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    principal: Principal = Depends(require_role(Role.ADMIN)),
) -> dict:
    items = _lab(session, settings, principal).strategies()
    return envelope({"items": items, "count": len(items)})


@router.get("/audit")
def audit(
    limit: int = Query(default=100, ge=1, le=500),
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    principal: Principal = Depends(require_role(Role.ADMIN)),
) -> dict:
    items = _lab(session, settings, principal).audit_trail(limit=limit)
    return envelope({"items": items, "count": len(items)})


@router.get("/evidence")
def evidence_list(
    limit: int = Query(default=100, ge=1, le=500),
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    principal: Principal = Depends(require_role(Role.ADMIN)),
) -> dict:
    vault = _lab(session, settings, principal).vault
    records = vault.list_records(limit=limit)
    items = [
        {
            "runId": row.run_id,
            "kind": row.kind,
            "title": row.title,
            "objective": row.objective,
            "createdAt": row.created_at.isoformat(),
            "finalizedAt": row.finalized_at.isoformat() if row.finalized_at else None,
            "integrityHash": row.integrity_hash,
            "integrityVerified": vault.verify(row.run_id),
            "limitations": row.limitations,
        }
        for row in records
    ]
    return envelope({"items": items, "count": len(items)})


@router.get("/evidence/{run_id}")
def evidence_detail(
    run_id: str,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    principal: Principal = Depends(require_role(Role.ADMIN)),
) -> dict:
    try:
        payload = _lab(session, settings, principal).vault.export(run_id)
    except LookupError as error:
        raise NotFound(str(error)) from error
    return envelope(payload)


@router.post("/signals")
def record_signal(
    payload: RecordSignalRequest,
    request: Request,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    principal: Principal = Depends(require_role(Role.ADMIN)),
) -> dict:
    """Record a signal at generation time.

    The write is idempotent on the signal's own identity. A retry that carries
    different content under the same key is rejected rather than overwriting the
    original, because a recorded signal is immutable.
    """
    lab = _lab(session, settings, principal)
    try:
        outcome = lab.recorder.record(
            SignalInput(
                strategy_key=payload.strategy_key,
                strategy_name=payload.strategy_name,
                signal_version=payload.signal_version,
                parameters=payload.parameters,
                symbol=payload.symbol,
                direction=payload.direction,
                generated_at=payload.generated_at,
                observed_at=payload.observed_at,
                reference_price=payload.reference_price,
                reference_price_at=payload.reference_price_at,
                timeframe=payload.timeframe,
                asset_class=payload.asset_class,
                confidence=payload.confidence,
                data_source=payload.data_source,
                data_freshness_seconds=payload.data_freshness_seconds,
                conditions=payload.conditions,
                risk_parameters=payload.risk_parameters,
                payload=payload.payload,
                model_metadata=payload.model_metadata,
                horizons=payload.horizons,
            )
        )
    except ValueError as error:
        raise BadRequest(str(error)) from error

    session.commit()
    record_for_principal(
        session,
        principal,
        action="performance.signal.record",
        target=str(outcome.signal.id),
        outcome="success",
        detail={
            "created": outcome.created,
            "queued": outcome.queued,
            "symbol": outcome.signal.symbol,
            "direction": outcome.signal.direction,
            "ip": client_ip(request),
            "requestId": request_id_of(request),
        },
    )
    session.commit()

    return envelope(
        {
            "id": str(outcome.signal.id),
            "signalKey": outcome.signal.signal_key,
            "created": outcome.created,
            "queuedHorizons": outcome.queued,
            "contentHash": outcome.signal.content_hash,
            "generatedAt": outcome.signal.generated_at.isoformat(),
            "observedAt": outcome.signal.observed_at.isoformat(),
        }
    )


@router.post("/evaluations/run")
def run_evaluations(
    payload: RunEvaluationsRequest,
    request: Request,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    principal: Principal = Depends(require_role(Role.ADMIN)),
) -> dict:
    """Process due evaluation jobs.

    Safe to call repeatedly: a job is leased, a final evaluation is written once,
    and a failure is stored on the job instead of being swallowed.
    """
    lab = _lab(session, settings, principal)
    moment = payload.now or datetime.now(tz=UTC)
    counts = lab.evaluator().run_due_jobs(now=moment, limit=payload.limit)
    session.commit()

    record_for_principal(
        session,
        principal,
        action="performance.evaluations.run",
        target="evaluation_jobs",
        outcome="success",
        detail={**counts, "ip": client_ip(request), "requestId": request_id_of(request)},
    )
    session.commit()

    warnings = []
    if counts["failed"]:
        warnings.append(
            f"{counts['failed']} evaluation job(s) failed. The failure is stored on the "
            "job and will be retried; no substitute data was written."
        )
    return envelope({"counts": counts, "ranAt": moment.isoformat()}, warnings=warnings)


@router.post("/evidence")
def create_evidence(
    payload: CreateEvidenceRequest,
    request: Request,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    principal: Principal = Depends(require_role(Role.ADMIN)),
) -> dict:
    lab = _lab(session, settings, principal)
    try:
        row = lab.vault.create(
            kind=payload.kind,
            title=payload.title,
            objective=payload.objective,
            dataset=payload.dataset,
            assumptions=payload.assumptions,
            results=payload.results,
            limitations=payload.limitations,
            strategy_version_id=payload.strategy_version_id,
            conclusion=payload.conclusion,
        )
    except ValueError as error:
        raise BadRequest(str(error)) from error

    session.commit()
    record_for_principal(
        session,
        principal,
        action="performance.evidence.create",
        target=row.run_id,
        outcome="success",
        detail={"kind": row.kind, "ip": client_ip(request), "requestId": request_id_of(request)},
    )
    session.commit()

    return envelope(
        {
            "runId": row.run_id,
            "kind": row.kind,
            "integrityHash": row.integrity_hash,
            "createdAt": row.created_at.isoformat(),
        }
    )


@router.post("/evidence/{run_id}/finalize")
def finalize_evidence(
    run_id: str,
    payload: FinalizeEvidenceRequest,
    request: Request,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    principal: Principal = Depends(require_role(Role.ADMIN)),
) -> dict:
    lab = _lab(session, settings, principal)
    try:
        row = lab.vault.finalize(run_id, conclusion=payload.conclusion)
    except LookupError as error:
        raise NotFound(str(error)) from error
    except ValueError as error:
        raise BadRequest(str(error)) from error

    session.commit()
    record_for_principal(
        session,
        principal,
        action="performance.evidence.finalize",
        target=run_id,
        outcome="success",
        detail={"ip": client_ip(request), "requestId": request_id_of(request)},
    )
    session.commit()

    return envelope(
        {
            "runId": row.run_id,
            "finalizedAt": row.finalized_at.isoformat() if row.finalized_at else None,
            "integrityHash": row.integrity_hash,
        }
    )
