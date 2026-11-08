"""Opportunity Desk endpoints.

Every route here is admin-only. The desk is a private research surface: it reads
completed candles, records what the rule saw, and stores what the founder decided
and what the price path subsequently did.

There is no order route, no fill route and no execution import. A candidate
cannot become a trade through this module, and the response bodies say so rather
than leaving it to be inferred.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, Query
from pydantic import Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from wands.api.deps import require_role
from wands.config import Settings, get_settings
from wands.db.models import OppCandidateRow, OppDecisionRow, OppPaperTestRow
from wands.db.session import get_session
from wands.envelope import envelope
from wands.errors import BadRequest, NotFound
from wands.marketdata.service import MarketDataService
from wands.opportunity import (
    CANDIDATE_REJECTED,
    CANDIDATE_WATCHED,
    OpportunityDesk,
    PaperTest,
    ResearchBudget,
    evaluate_test,
    holding_deadline,
)
from wands.opportunity.watchlist import entry_for
from wands.schemas import CandleInterval, CamelModel, MarketType
from wands.security.auth import Principal
from wands.security.rbac import Role
from wands.state import get_policy

router = APIRouter(prefix="/opportunity", tags=["opportunity"])

_admin = Depends(require_role(Role.ADMIN))

DISCLOSURE = (
    "Research only. A candidate is a hypothesis to look at, not a trade "
    "instruction, and no result here is a probability of profit."
)


class DecisionRequest(CamelModel):
    decision: str = Field(description="candidate_watched or candidate_rejected")
    note: str | None = None


class RecordTestRequest(CamelModel):
    quantity: str | None = Field(
        default=None,
        description="Override the sized quantity. Omit to use the candidate's sizing.",
    )


def _service(session: Session, settings: Settings) -> MarketDataService:
    policy = get_policy(session)
    return MarketDataService(
        session,
        settings=settings,
        max_quote_age_seconds=policy.max_quote_age_seconds,
    )


def _money(value: Decimal | None) -> str | None:
    return None if value is None else str(value)


def _candidate_payload(row: OppCandidateRow) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "symbol": row.symbol,
        "marketType": row.market_type,
        "strategyKey": row.strategy_key,
        "strategyVersion": row.strategy_version,
        "observedAt": row.observed_at.isoformat(),
        "referencePrice": _money(row.reference_price),
        "invalidationPrice": _money(row.invalidation_price),
        "targetPrice": _money(row.target_price),
        "rangeHigh": _money(row.range_high),
        "volumeRatio": float(row.volume_ratio),
        "breakoutMargin": float(row.breakout_margin),
        "whyQualified": row.why_qualified,
        "entryCondition": row.entry_condition,
        "invalidationCondition": row.invalidation_condition,
        "exitCondition": row.exit_condition,
        "maxHoldingHours": row.max_holding_hours,
        "sizing": {
            "quantity": _money(row.quantity),
            "notional": _money(row.notional),
            "riskAtStop": _money(row.risk_at_stop),
            "bindingConstraint": row.binding_constraint,
            "rejectedReason": row.rejected_reason,
            "feasible": row.rejected_reason is None and row.quantity is not None,
        },
        "costs": {
            "feeBps": float(row.fee_bps),
            "slippageBps": float(row.slippage_bps),
        },
        "dataQuality": {
            "fresh": row.data_fresh,
            "ageSeconds": None if row.data_age_seconds is None else float(row.data_age_seconds),
            "warnings": list(row.data_warnings or []),
        },
        "rankReason": row.rank_reason,
        "createdAt": row.created_at.isoformat(),
    }


def _test_payload(row: OppPaperTestRow) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "candidateId": str(row.candidate_id),
        "symbol": row.symbol,
        "marketType": row.market_type,
        "strategyKey": row.strategy_key,
        "strategyVersion": row.strategy_version,
        "referencePrice": _money(row.reference_price),
        "invalidationPrice": _money(row.invalidation_price),
        "targetPrice": _money(row.target_price),
        "quantity": _money(row.quantity),
        "openedAt": row.opened_at.isoformat(),
        "deadline": row.deadline.isoformat(),
        "status": row.status,
        "exitReason": row.exit_reason,
        "entryPrice": _money(row.entry_price),
        "exitPrice": _money(row.exit_price),
        "exitAt": None if row.exit_at is None else row.exit_at.isoformat(),
        "holdingSeconds": None if row.holding_seconds is None else float(row.holding_seconds),
        "grossReturn": _money(row.gross_return),
        "fees": _money(row.fees),
        "slippage": _money(row.slippage),
        "netReturn": _money(row.net_return),
        "drawdown": None if row.drawdown is None else float(row.drawdown),
        "notes": list(row.notes or []),
    }


def _decision_payload(row: OppDecisionRow) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "candidateId": str(row.candidate_id),
        "decision": row.decision,
        "note": row.note,
        "decidedAt": row.decided_at.isoformat(),
    }


@router.get("/budget")
def get_budget(principal: Principal = _admin) -> dict[str, Any]:
    """The research workspace's stated limits, including which one binds."""
    budget = ResearchBudget()
    return envelope(
        {
            **budget.as_dict(),
            "disclosure": DISCLOSURE,
            "note": (
                "The planned risk budget is a ceiling, not an override. The "
                "stricter of it and the engine's per-trade risk applies."
            ),
        }
    )


@router.get("/scan")
def scan(
    interval: CandleInterval = Query(default=CandleInterval.M5),
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    principal: Principal = _admin,
) -> dict[str, Any]:
    """Run the rule over the watchlist and store what qualified.

    An empty result is a real answer. The envelope carries the reason each
    symbol was skipped so a quiet scan can be told apart from a broken one.
    """
    desk = OpportunityDesk(_service(session, settings))
    report = desk.scan(interval=interval)

    stored: list[OppCandidateRow] = []
    for candidate in report.candidates:
        row = OppCandidateRow(
            symbol=candidate.symbol,
            market_type=str(candidate.market_type),
            strategy_key=candidate.strategy_key,
            strategy_version=candidate.strategy_version,
            observed_at=candidate.observed_at,
            reference_price=candidate.reference_price,
            invalidation_price=candidate.invalidation_price,
            target_price=candidate.target_price,
            range_high=candidate.range_high,
            volume_ratio=Decimal(str(candidate.volume_ratio)),
            breakout_margin=Decimal(str(candidate.breakout_margin)),
            why_qualified=candidate.why_qualified,
            entry_condition=candidate.entry_condition,
            invalidation_condition=candidate.invalidation_condition,
            exit_condition=candidate.exit_condition,
            max_holding_hours=candidate.max_holding_hours,
            quantity=candidate.sizing.quantity,
            notional=candidate.sizing.notional,
            risk_at_stop=candidate.sizing.risk_at_stop,
            binding_constraint=candidate.sizing.binding_constraint,
            rejected_reason=candidate.sizing.rejected_reason,
            fee_bps=Decimal(str(candidate.costs.fee_bps)),
            slippage_bps=Decimal(str(candidate.costs.slippage_bps)),
            data_fresh=candidate.data_quality.fresh,
            data_age_seconds=(
                None
                if candidate.data_quality.age_seconds is None
                else Decimal(str(candidate.data_quality.age_seconds))
            ),
            data_warnings=list(candidate.data_quality.warnings),
            rank_reason=candidate.rank_reason,
        )
        session.add(row)
        stored.append(row)
    session.commit()

    warnings = [DISCLOSURE]
    for candidate in report.candidates:
        warnings.extend(candidate.data_quality.warnings)

    return envelope(
        {
            "generatedAt": report.generated_at.isoformat(),
            "interval": str(report.interval),
            "candidates": [_candidate_payload(row) for row in stored],
            "skipped": [
                {"symbol": item.symbol, "reason": item.reason} for item in report.skipped
            ],
            "notes": list(report.notes),
        },
        warnings=warnings,
    )


@router.get("/candidates")
def list_candidates(
    limit: int = Query(default=50, ge=1, le=200),
    session: Session = Depends(get_session),
    principal: Principal = _admin,
) -> dict[str, Any]:
    rows = session.scalars(
        select(OppCandidateRow)
        .order_by(OppCandidateRow.created_at.desc())
        .limit(limit)
    ).all()
    return envelope(
        {"candidates": [_candidate_payload(row) for row in rows]},
        warnings=[DISCLOSURE],
    )


@router.get("/decisions")
def list_decisions(
    limit: int = Query(default=200, ge=1, le=500),
    session: Session = Depends(get_session),
    principal: Principal = _admin,
) -> dict[str, Any]:
    """The recorded decisions, newest first.

    Decisions are append-only, so this is the journal rather than a current
    state. The member surface reads it to show what was already decided about a
    candidate instead of offering the same action twice.
    """
    rows = session.scalars(
        select(OppDecisionRow)
        .order_by(OppDecisionRow.decided_at.desc())
        .limit(limit)
    ).all()
    return envelope(
        {"decisions": [_decision_payload(row) for row in rows]},
        warnings=[DISCLOSURE],
    )


@router.post("/candidates/{candidate_id}/decision")
def record_decision(
    candidate_id: str,
    body: DecisionRequest,
    session: Session = Depends(get_session),
    principal: Principal = _admin,
) -> dict[str, Any]:
    if body.decision not in (CANDIDATE_WATCHED, CANDIDATE_REJECTED):
        raise BadRequest(
            f"Decision must be {CANDIDATE_WATCHED} or {CANDIDATE_REJECTED}."
        )
    try:
        parsed = uuid.UUID(candidate_id)
    except ValueError as exc:
        raise NotFound("That candidate does not exist.") from exc
    row = session.get(OppCandidateRow, parsed)
    if row is None:
        raise NotFound("That candidate does not exist.")

    decision = OppDecisionRow(
        candidate_id=row.id,
        decision=body.decision,
        note=body.note,
        decided_at=datetime.now(UTC),
    )
    session.add(decision)
    session.commit()
    return envelope(
        {
            "candidateId": str(row.id),
            "decision": decision.decision,
            "note": decision.note,
            "decidedAt": decision.decided_at.isoformat(),
        },
        warnings=[DISCLOSURE],
    )


@router.post("/candidates/{candidate_id}/tests")
def record_test(
    candidate_id: str,
    body: RecordTestRequest,
    session: Session = Depends(get_session),
    principal: Principal = _admin,
) -> dict[str, Any]:
    """Freeze the assumptions of a manual paper test.

    A candidate that could not be sized is refused here rather than recorded
    with an invented quantity, because a test that could not have been opened
    is not evidence.
    """
    try:
        parsed = uuid.UUID(candidate_id)
    except ValueError as exc:
        raise NotFound("That candidate does not exist.") from exc
    row = session.get(OppCandidateRow, parsed)
    if row is None:
        raise NotFound("That candidate does not exist.")
    if row.quantity is None:
        raise BadRequest(
            row.rejected_reason
            or "This candidate has no feasible position size, so it cannot be tested."
        )

    quantity = Decimal(body.quantity) if body.quantity else row.quantity
    if quantity <= 0:
        raise BadRequest("Quantity must be positive.")

    entry = entry_for(row.symbol)
    if entry is None:
        raise BadRequest("That symbol is no longer on the watchlist.")

    opened_at = datetime.now(UTC)
    test = OppPaperTestRow(
        candidate_id=row.id,
        symbol=row.symbol,
        market_type=row.market_type,
        strategy_key=row.strategy_key,
        strategy_version=row.strategy_version,
        reference_price=row.reference_price,
        invalidation_price=row.invalidation_price,
        target_price=row.target_price,
        quantity=quantity,
        fee_bps=row.fee_bps,
        slippage_bps=row.slippage_bps,
        opened_at=opened_at,
        deadline=holding_deadline(entry, opened_at, row.max_holding_hours),
        status="test_active",
        notes=[],
    )
    session.add(test)
    session.commit()
    return envelope(_test_payload(test), warnings=[DISCLOSURE])


@router.get("/tests")
def list_tests(
    limit: int = Query(default=50, ge=1, le=200),
    session: Session = Depends(get_session),
    principal: Principal = _admin,
) -> dict[str, Any]:
    rows = session.scalars(
        select(OppPaperTestRow)
        .order_by(OppPaperTestRow.opened_at.desc())
        .limit(limit)
    ).all()
    return envelope(
        {"tests": [_test_payload(row) for row in rows]},
        warnings=[DISCLOSURE],
    )


@router.post("/tests/{test_id}/evaluate")
def evaluate(
    test_id: str,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    principal: Principal = _admin,
) -> dict[str, Any]:
    """Evaluate a recorded test against the candles that followed it.

    This is a price-path evaluation, not a simulated fill. It reports what the
    quoted prices did and subtracts estimated costs; it does not claim an order
    would have been filled at those prices.
    """
    try:
        parsed = uuid.UUID(test_id)
    except ValueError as exc:
        raise NotFound("That test does not exist.") from exc
    row = session.get(OppPaperTestRow, parsed)
    if row is None:
        raise NotFound("That test does not exist.")

    entry = entry_for(row.symbol)
    if entry is None:
        raise BadRequest("That symbol is no longer on the watchlist.")

    series = _service(session, settings).candles(
        row.symbol,
        CandleInterval.M5,
        market_type=MarketType(row.market_type),
        limit=500,
    )
    opened_ts = int(row.opened_at.timestamp())
    following = [candle for candle in series.candles if candle.time > opened_ts]

    outcome = evaluate_test(
        PaperTest(
            symbol=row.symbol,
            market_type=MarketType(row.market_type),
            strategy_key=row.strategy_key,
            strategy_version=row.strategy_version,
            reference_price=row.reference_price,
            invalidation_price=row.invalidation_price,
            target_price=row.target_price,
            quantity=row.quantity,
            fee_bps=float(row.fee_bps),
            slippage_bps=float(row.slippage_bps),
            opened_at=row.opened_at,
            deadline=row.deadline,
        ),
        following,
    )

    row.status = outcome.status
    row.exit_reason = outcome.exit_reason
    row.entry_price = outcome.entry_price
    row.exit_price = outcome.exit_price
    row.exit_at = outcome.exit_at
    row.holding_seconds = (
        None if outcome.holding_seconds is None else Decimal(str(outcome.holding_seconds))
    )
    row.gross_return = outcome.gross_return
    row.fees = outcome.fees
    row.slippage = outcome.slippage
    row.net_return = outcome.net_return
    row.drawdown = outcome.drawdown
    row.notes = list(outcome.notes)
    session.commit()

    return envelope(
        _test_payload(row),
        warnings=[
            DISCLOSURE,
            "Evaluated against quoted prices, not against simulated fills.",
        ],
    )
