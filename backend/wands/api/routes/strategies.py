"""Strategy catalogue.

Reads come from the database, which is seeded from the code registry at boot.
Registering a strategy here records metadata only — it does not make the
strategy executable, and it cannot grant it access to a broker.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from pydantic import Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from wands.api.deps import admin_principal, client_ip, request_id_of, require_role
from wands.db.models import StrategyRow
from wands.db.session import get_session
from wands.envelope import envelope, isoformat
from wands.errors import Conflict
from wands.schemas import (
    CamelModel,
    Deployment,
    MarketType,
    StrategyCategory,
    StrategyOut,
    StrategyParameter,
    dump,
    dump_many,
)
from wands.security.audit import record_for_principal
from wands.security.auth import Principal
from wands.security.rbac import Role

router = APIRouter(prefix="/strategies", tags=["strategies"])


class StrategyCreate(CamelModel):
    slug: str = Field(min_length=2, max_length=64, pattern=r"^[a-z0-9][a-z0-9-]*$")
    name: str = Field(min_length=1, max_length=120)
    category: StrategyCategory
    description: str = Field(default="", max_length=2000)
    version: str = Field(default="0.1.0", max_length=16)
    supported_markets: list[MarketType]
    deployment: Deployment = Deployment.PAPER_ONLY
    parameters: list[StrategyParameter] = Field(default_factory=list)


def _out(row: StrategyRow) -> StrategyOut:
    return StrategyOut(
        id=str(row.id),
        name=row.name,
        category=StrategyCategory(row.category),
        description=row.description,
        supported_markets=[MarketType(market) for market in row.supported_markets or []],
        deployment=Deployment(row.deployment),
        parameters=[StrategyParameter(**param) for param in row.config_schema or []],
        updated_at=isoformat(row.updated_at) or "",
    )


@router.get("")
def list_strategies(
    session: Session = Depends(get_session),
    principal: Principal = Depends(require_role(Role.VIEWER)),
) -> dict:
    rows = session.scalars(select(StrategyRow).order_by(StrategyRow.name)).all()
    return envelope(dump_many([_out(row) for row in rows]))


@router.post("")
def create_strategy(
    payload: StrategyCreate,
    request: Request,
    session: Session = Depends(get_session),
    principal: Principal = Depends(admin_principal),
) -> dict:
    existing = session.scalar(select(StrategyRow).where(StrategyRow.slug == payload.slug))
    if existing is not None:
        raise Conflict(f"A strategy with slug {payload.slug!r} already exists.")

    row = StrategyRow(
        slug=payload.slug,
        name=payload.name,
        description=payload.description,
        category=str(payload.category),
        version=payload.version,
        supported_markets=[str(market) for market in payload.supported_markets],
        deployment=str(payload.deployment),
        config_schema=[dump(param) for param in payload.parameters],
    )
    session.add(row)
    session.flush()

    record_for_principal(
        session,
        principal,
        action="strategy.create",
        target=payload.slug,
        detail={"category": str(payload.category), "deployment": str(payload.deployment)},
        request_id=request_id_of(request),
        ip=client_ip(request),
    )
    return envelope({"id": str(row.id)})
