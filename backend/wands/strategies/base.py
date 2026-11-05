"""Strategy interface.

A strategy is a pure function of market state to intent. It has no database
handle, no broker handle and no clock it can use to place anything. That is the
structural guarantee behind "a strategy cannot bypass the execution gateway".
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from wands.execution.intents import TradeIntent
from wands.schemas import Deployment, MarketType, StrategyCategory


@dataclass(frozen=True)
class Candle:
    time: int
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: Decimal


@dataclass(frozen=True)
class StrategyContext:
    """Read-only market and account view handed to a strategy."""

    symbol: str
    market_type: MarketType
    candles: tuple[Candle, ...] = ()
    position_quantity: Decimal = Decimal("0")
    equity: Decimal = Decimal("0")
    account_id: str = ""
    mode: str = "paper"
    parameters: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class StrategyDefinition:
    """Catalogue metadata. Rendered by the UI, stored in ``strategies``."""

    slug: str
    name: str
    category: StrategyCategory
    description: str
    version: str
    supported_markets: tuple[MarketType, ...]
    deployment: Deployment
    parameters: tuple[dict[str, Any], ...] = ()


class Strategy(ABC):
    definition: StrategyDefinition

    @abstractmethod
    def propose(self, context: StrategyContext) -> list[TradeIntent]:
        """Return proposed trades. Never place them."""
