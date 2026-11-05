"""Build a risk context from verified portfolio and market data.

This is the bridge that lets a paper order pass risk validation *without*
weakening the engine. It does not decide anything: it assembles facts, and every
fact it cannot establish is left as ``None`` so the engine blocks.

The two rules that matter:

* **Equity and buying power come from a verified portfolio state.** If any
  position lacks a trustworthy price, the state is unverified and the order is
  blocked — not sized against a partial total.
* **The reference price is a live, two-sided quote.** A candle close is never
  substituted. If the venue is delayed, stale, closed or one-sided, the price is
  ``None`` and the engine refuses to size the order.
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy.orm import Session

from wands.config import Settings, get_settings
from wands.db.models import ConnectionRow
from wands.marketdata.calendar import session_for
from wands.marketdata.service import MarketDataService
from wands.portfolio.money import ZERO, money
from wands.portfolio.service import PortfolioService
from wands.risk.engine import RiskContext
from wands.schemas import MarketType

if TYPE_CHECKING:
    from wands.execution.intents import TradeIntent


def build_risk_context(
    session: Session,
    intent: TradeIntent,
    *,
    market_data: MarketDataService | None = None,
    portfolio: PortfolioService | None = None,
    settings: Settings | None = None,
    clock=lambda: datetime.now(tz=UTC),
) -> RiskContext:
    settings = settings or get_settings()
    now = clock()

    connection = _connection(session, intent.account_id)
    if connection is None:
        return RiskContext()

    market = MarketType(intent.market_type)
    market_data = market_data or MarketDataService(session, settings=settings, clock=clock)
    portfolio = portfolio or PortfolioService(
        session, market_data=market_data, settings=settings, clock=clock
    )

    state = portfolio.state(str(connection.id))
    quote = market_data.quote(intent.symbol, market, refresh_if_stale=True)
    window = session_for(market, now)

    verified = state.verified

    position_value: Decimal | None = ZERO
    existing = next(
        (item for item in state.positions if item.symbol == intent.symbol), None
    )
    if existing is not None:
        position_value = existing.market_value

    crypto_exposure, stocks_exposure = _exposures(state, verified)

    return RiskContext(
        portfolio_equity=state.equity if verified else None,
        total_exposure=state.positions_value if verified else None,
        position_market_value=position_value,
        crypto_exposure=crypto_exposure,
        stocks_exposure=stocks_exposure,
        day_pnl_pct=state.day_pnl_pct if verified else None,
        drawdown_pct=state.drawdown_pct if verified else None,
        quote_age_seconds=quote.age_seconds if quote is not None else None,
        spread_pct=quote.spread_pct if quote is not None else None,
        buying_power=state.buying_power if verified else None,
        account_state_age_seconds=state.account_state_age_seconds,
        market_open=window.is_open,
        reference_price=quote.executable_price if quote is not None else None,
        stop_distance_pct=intent.stop_loss_pct,
    )


def _connection(session: Session, account_id: str) -> ConnectionRow | None:
    import uuid

    try:
        parsed = uuid.UUID(str(account_id))
    except (ValueError, AttributeError):
        return None
    return session.get(ConnectionRow, parsed)


def _exposures(state, verified: bool) -> tuple[Decimal | None, Decimal | None]:
    """Asset-class exposure, or ``(None, None)`` when any position is unvalued."""
    if not verified:
        return None, None
    crypto = ZERO
    stocks = ZERO
    for item in state.positions:
        if item.market_value is None:
            return None, None
        if item.market_type is MarketType.CRYPTO:
            crypto += item.market_value
        else:
            stocks += item.market_value
    return money(crypto), money(stocks)
