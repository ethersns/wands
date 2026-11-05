"""Deterministic paper broker.

Simulated execution with explicit, configurable costs. It is deterministic so
that tests assert on exact numbers rather than on a range, and it never claims
to be a real fill: the order it produces is tagged ``mode = paper`` by the
gateway.

Slippage is applied against the trader on both sides — buying fills higher,
selling fills lower. A simulator that fills at the mid price teaches a strategy
to over-trade.
"""

from __future__ import annotations

import uuid
from decimal import ROUND_DOWN, Decimal

from wands.brokers.base import (
    BrokerError,
    BrokerFill,
    BrokerOrderRequest,
    BrokerOrderResult,
)
from wands.schemas import OrderStatus, OrderType

BPS = Decimal("10000")


class PaperBrokerAdapter:
    provider = "paper"
    supports_live = False

    def __init__(
        self,
        *,
        fee_bps: Decimal = Decimal("10"),
        slippage_bps: Decimal = Decimal("5"),
        partial_fill_ratio: Decimal | None = None,
    ) -> None:
        self.fee_bps = fee_bps
        self.slippage_bps = slippage_bps
        # When set, only this fraction of the quantity fills, so partial-fill
        # handling can be exercised without a real venue.
        self.partial_fill_ratio = partial_fill_ratio
        self._orders: dict[str, BrokerOrderResult] = {}

    def _fill_price(self, request: BrokerOrderRequest) -> Decimal:
        if request.type == OrderType.LIMIT and request.limit_price is not None:
            return request.limit_price
        reference = request.reference_price
        if reference is None:
            raise BrokerError("A market order needs a reference price in paper mode.")
        drift = reference * self.slippage_bps / BPS
        return reference + drift if request.side == "buy" else reference - drift

    def submit_order(self, request: BrokerOrderRequest) -> BrokerOrderResult:
        price = self._fill_price(request)
        quantity = request.quantity
        if self.partial_fill_ratio is not None:
            quantity = (quantity * self.partial_fill_ratio).quantize(
                Decimal("0.00000001"), rounding=ROUND_DOWN
            )
        if quantity <= 0:
            raise BrokerError("Computed fill quantity is zero.")

        fees = (quantity * price * self.fee_bps / BPS).quantize(Decimal("0.00000001"))
        fill = BrokerFill(quantity=quantity, price=price, fees=fees)
        status = (
            OrderStatus.FILLED if quantity == request.quantity else OrderStatus.PARTIALLY_FILLED
        )

        result = BrokerOrderResult(
            status=status,
            filled_quantity=quantity,
            average_fill_price=price,
            fees=fees,
            confirmation_id=f"paper-{uuid.uuid4().hex[:16]}",
            fills=(fill,),
        )
        self._orders[result.confirmation_id or ""] = result
        return result

    def cancel_order(self, confirmation_id: str) -> bool:
        return self._orders.pop(confirmation_id, None) is not None

    def get_order(self, confirmation_id: str) -> BrokerOrderResult | None:
        return self._orders.get(confirmation_id)
