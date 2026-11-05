"""Broker adapter interface.

Adapters are the only code that talks to an exchange. They are constructed by
the gateway and never handed to a strategy, which is why the isolation test can
assert that ``wands/strategies`` never imports this package.

``BrokerTimeout`` is deliberately distinct from ``BrokerError``: a timeout means
the outcome is *unknown*, and an unknown outcome must be reconciled before any
retry. Treating the two the same is how duplicate fills happen.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Protocol, runtime_checkable

from wands.schemas import OrderSide, OrderStatus, OrderType


class BrokerError(Exception):
    """The broker rejected the request. The outcome is known: nothing happened."""


class BrokerTimeout(Exception):
    """The outcome is unknown. Reconcile before retrying."""


@dataclass(frozen=True)
class BrokerOrderRequest:
    client_order_id: str
    symbol: str
    side: OrderSide
    quantity: Decimal
    type: OrderType = OrderType.MARKET
    limit_price: Decimal | None = None
    reference_price: Decimal | None = None


@dataclass(frozen=True)
class BrokerFill:
    quantity: Decimal
    price: Decimal
    fees: Decimal = Decimal("0")


@dataclass(frozen=True)
class BrokerOrderResult:
    status: OrderStatus
    filled_quantity: Decimal
    average_fill_price: Decimal | None = None
    fees: Decimal = Decimal("0")
    confirmation_id: str | None = None
    fills: tuple[BrokerFill, ...] = field(default_factory=tuple)
    reject_reason: str | None = None


@runtime_checkable
class BrokerAdapter(Protocol):
    provider: str
    supports_live: bool

    def submit_order(self, request: BrokerOrderRequest) -> BrokerOrderResult: ...

    def cancel_order(self, confirmation_id: str) -> bool: ...

    def get_order(self, confirmation_id: str) -> BrokerOrderResult | None: ...
