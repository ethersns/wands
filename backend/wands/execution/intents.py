"""Trade intents.

A ``TradeIntent`` is a *proposal*, not an order. Strategies produce these and
nothing else; only ``ExecutionGateway`` can turn one into an order. Keeping the
type free of behaviour is what makes the isolation rule enforceable — there is
no method on it that could reach a broker.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal

from wands.schemas import MarketType, OrderSide, TradingMode


@dataclass(frozen=True)
class TradeIntent:
    symbol: str
    market_type: MarketType
    side: OrderSide
    quantity: Decimal
    account_id: str
    mode: TradingMode
    type: str = "market"
    limit_price: Decimal | None = None
    stop_loss_pct: Decimal | None = None
    rationale: str = ""
    client_order_id: str = ""
    strategy_id: uuid.UUID | None = None
    bot_id: uuid.UUID | None = None
    created_at: datetime = field(default_factory=lambda: datetime.now(tz=UTC))

    def __post_init__(self) -> None:
        if self.quantity <= 0:
            raise ValueError("Trade intent quantity must be positive.")
        if self.type == "limit" and self.limit_price is None:
            raise ValueError("A limit intent requires a limit price.")
