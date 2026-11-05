"""Versioned router assembly."""

from __future__ import annotations

from fastapi import APIRouter

from wands.api.routes import (
    backtests,
    bots,
    connections,
    engine,
    markets,
    orders,
    portfolio,
    risk,
    settings,
    strategies,
)

api_router = APIRouter(prefix="/v1")
api_router.include_router(engine.router)
api_router.include_router(portfolio.router)
api_router.include_router(markets.router)
api_router.include_router(strategies.router)
api_router.include_router(bots.router)
api_router.include_router(backtests.router)
api_router.include_router(orders.router)
api_router.include_router(risk.router)
api_router.include_router(connections.router)
api_router.include_router(settings.router)
