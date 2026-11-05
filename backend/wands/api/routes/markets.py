"""Market data.

No feed is connected in this build, so the overview is explicitly
``unavailable`` and candles return ``501``. The frontend already handles both by
falling back to fixtures tagged ``provenance: "demo"`` with a visible warning —
which is the honest outcome, and better than a chart of invented prices.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from wands.api.deps import require_role
from wands.envelope import unavailable
from wands.errors import NotImplementedYet
from wands.schemas import CandleInterval, MarketOverview, dump
from wands.security.auth import Principal
from wands.security.rbac import Role

router = APIRouter(prefix="/markets", tags=["markets"])

NO_FEED = (
    "No market-data feed is connected. Prices are unknown, not zero. Market data "
    "ingestion is not implemented in this build."
)


@router.get("/overview")
def overview(principal: Principal = Depends(require_role(Role.VIEWER))) -> dict:
    payload = MarketOverview(quotes=[], watchlist=[], feed_updated_at=None, feed_healthy=False)
    return unavailable(dump(payload), NO_FEED)


@router.get("/{symbol}/candles")
def candles(
    symbol: str,
    interval: CandleInterval = CandleInterval.H1,
    principal: Principal = Depends(require_role(Role.VIEWER)),
) -> dict:
    raise NotImplementedYet(
        f"Historical candles for {symbol} ({interval}) are not available: the market-data "
        "service is not implemented in this build."
    )
