"""Versioned router assembly."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from wands.api.deps import deny_research_only
from wands.api.routes import (
    backtests,
    bots,
    connections,
    engine,
    intelligence,
    markets,
    orders,
    portfolio,
    risk,
    settings,
    strategies,
)

# Trading, risk, connection and settings surfaces are operator territory. A
# credential issued for the member research workspace must not reach them, so
# every router below rejects a research-only credential. The intelligence router
# is mounted without this guard because the member research endpoints live there
# and enforce their own `research:read` scope per route.
_operator_only = [Depends(deny_research_only())]

api_router = APIRouter(prefix="/v1")
api_router.include_router(engine.router, dependencies=_operator_only)
api_router.include_router(portfolio.router, dependencies=_operator_only)
api_router.include_router(markets.router, dependencies=_operator_only)
api_router.include_router(strategies.router, dependencies=_operator_only)
api_router.include_router(bots.router, dependencies=_operator_only)
api_router.include_router(backtests.router, dependencies=_operator_only)
api_router.include_router(orders.router, dependencies=_operator_only)
api_router.include_router(risk.router, dependencies=_operator_only)
api_router.include_router(connections.router, dependencies=_operator_only)
api_router.include_router(settings.router, dependencies=_operator_only)
api_router.include_router(intelligence.router)
