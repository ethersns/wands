"""The execution gateway.

The only code path in the system that can reach a broker. It is deliberately
boring and sequential, because every branch here is a way to lose money:

    mode guard -> idempotency -> risk engine -> broker -> persist -> audit

The risk engine is called unconditionally. There is no parameter, flag or
environment variable that skips it, and no other module imports a broker
adapter.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from wands.brokers.base import (
    BrokerAdapter,
    BrokerError,
    BrokerOrderRequest,
    BrokerOrderResult,
    BrokerTimeout,
)
from wands.brokers.paper import PaperBrokerAdapter
from wands.config import Settings, get_settings
from wands.db.models import ConnectionRow, FillRow, OrderRow, PositionRow, RiskEventRow
from wands.errors import (
    BadRequest,
    EngineError,
    LiveTradingDisabled,
    NotFound,
    RiskRejected,
)
from wands.execution.idempotency import find_existing_order, recent_client_order_ids
from wands.execution.intents import TradeIntent
from wands.logging import get_logger
from wands.portfolio.service import PortfolioService
from wands.risk.context import build_risk_context
from wands.risk.engine import OrderProposal, RiskContext, RiskEngine
from wands.schemas import (
    OrderStatus,
    OrderType,
    ReconciliationState,
    TradingMode,
)
from wands.security.audit import record_for_principal
from wands.security.auth import Principal
from wands.state import get_engine_state, get_policy

logger = get_logger(__name__)

ContextProvider = Callable[[TradeIntent], RiskContext]


class ExecutionOutcomeUnknown(EngineError):
    """The broker may or may not have accepted the order.

    The order is persisted as ``reconciliation = pending`` and must be resolved
    against the broker before any retry. Retrying an unknown outcome is how one
    intended position becomes two.
    """

    code = "conflict"
    status_code = 409


class ExecutionGateway:
    def __init__(
        self,
        session: Session,
        *,
        risk_engine: RiskEngine | None = None,
        brokers: dict[str, BrokerAdapter] | None = None,
        settings: Settings | None = None,
        context_provider: ContextProvider | None = None,
    ) -> None:
        self.session = session
        self.risk_engine = risk_engine or RiskEngine()
        self.settings = settings or get_settings()
        self.brokers: dict[str, BrokerAdapter] = brokers or {"paper": PaperBrokerAdapter()}
        self.context_provider = context_provider or self._default_context

    def _default_context(self, intent: TradeIntent) -> RiskContext:
        """Assemble a context from verified portfolio and market data.

        Every field the services cannot establish stays ``None``, so the risk
        engine blocks. There is no fallback that invents equity or a price.
        """
        return build_risk_context(self.session, intent, settings=self.settings)

    # -- public ------------------------------------------------------------

    def submit(
        self,
        intent: TradeIntent,
        principal: Principal,
        *,
        request_id: str | None = None,
        ip: str | None = None,
    ) -> OrderRow:
        connection = self._resolve_connection(intent.account_id)
        self._guard_mode(intent, connection)

        existing = find_existing_order(self.session, intent.client_order_id)
        if existing is not None:
            record_for_principal(
                self.session,
                principal,
                action="order.replay",
                target=str(existing.id),
                detail={"clientOrderId": intent.client_order_id},
                request_id=request_id,
                ip=ip,
            )
            return existing

        state = get_engine_state(self.session)
        policy = get_policy(self.session)

        context = self.context_provider(intent)
        context = RiskContext(
            **{
                **context.__dict__,
                "recent_client_order_ids": recent_client_order_ids(
                    self.session, window_seconds=policy.duplicate_order_window_seconds
                ),
            }
        )

        proposal = OrderProposal(
            symbol=intent.symbol,
            market_type=intent.market_type,
            side=str(intent.side),
            quantity=intent.quantity,
            mode=intent.mode,
            client_order_id=intent.client_order_id,
            limit_price=intent.limit_price,
        )

        decision = self.risk_engine.evaluate(
            proposal, policy=policy, state=state, context=context, settings=self.settings
        )

        if not decision.approved:
            self._persist_rejection(intent, connection, decision, principal, request_id, ip)
            raise RiskRejected(
                "The risk engine blocked this order.",
                details=[violation.as_dict() for violation in decision.violations],
            )

        return self._execute(intent, connection, principal, request_id, ip, context)

    # -- internals ---------------------------------------------------------

    def _resolve_connection(self, account_id: str) -> ConnectionRow:
        try:
            connection_id = uuid.UUID(account_id)
        except (ValueError, AttributeError) as exc:
            raise NotFound(f"Unknown account {account_id!r}.") from exc
        connection = self.session.get(ConnectionRow, connection_id)
        if connection is None:
            raise NotFound(f"Unknown account {account_id!r}.")
        return connection

    def _guard_mode(self, intent: TradeIntent, connection: ConnectionRow) -> None:
        if intent.mode == TradingMode.LIVE:
            if not self.settings.live_trading_enabled:
                raise LiveTradingDisabled(
                    "Live trading is disabled at deployment level "
                    "(WANDS_LIVE_TRADING_ENABLED is false)."
                )
            if connection.mode != TradingMode.LIVE:
                raise LiveTradingDisabled(
                    "This connection is not a live connection. Paper and live credentials "
                    "are never interchangeable."
                )
        elif connection.mode == TradingMode.LIVE:
            raise BadRequest(
                "A live connection cannot be used for a paper order. Create a separate "
                "paper connection."
            )

    def _persist_rejection(
        self,
        intent: TradeIntent,
        connection: ConnectionRow,
        decision,
        principal: Principal,
        request_id: str | None,
        ip: str | None,
    ) -> None:
        order = OrderRow(
            client_order_id=intent.client_order_id,
            connection_id=connection.id,
            symbol=intent.symbol,
            market_type=str(intent.market_type),
            side=str(intent.side),
            type=intent.type,
            status=OrderStatus.REJECTED,
            quantity=intent.quantity,
            filled_quantity=Decimal("0"),
            limit_price=intent.limit_price,
            mode=str(intent.mode),
            bot_id=intent.bot_id,
            strategy_id=intent.strategy_id,
            reconciliation=ReconciliationState.MATCHED,
            reject_reason="; ".join(decision.reasons)[:2000],
        )
        self.session.add(order)

        for violation in decision.violations:
            self.session.add(
                RiskEventRow(
                    severity=str(violation.severity),
                    category=str(violation.category),
                    title=violation.label,
                    detail=violation.detail,
                    actor=principal.subject,
                )
            )

        record_for_principal(
            self.session,
            principal,
            action="order.rejected",
            target=intent.client_order_id,
            outcome="denied",
            detail={
                "symbol": intent.symbol,
                "side": str(intent.side),
                "quantity": str(intent.quantity),
                "violations": [v.key for v in decision.violations],
            },
            request_id=request_id,
            ip=ip,
        )
        self.session.flush()

        logger.warning(
            "order rejected by risk engine",
            extra={
                "event": "order.rejected",
                "principal": principal.subject,
                "symbol": intent.symbol,
                "client_order_id": intent.client_order_id,
                "violations": [v.key for v in decision.violations],
                "request_id": request_id,
            },
        )

    def _execute(
        self,
        intent: TradeIntent,
        connection: ConnectionRow,
        principal: Principal,
        request_id: str | None,
        ip: str | None,
        context: RiskContext,
    ) -> OrderRow:
        adapter = self.brokers.get(connection.provider) or self.brokers.get("paper")
        if adapter is None:
            raise BadRequest(f"No adapter is available for provider {connection.provider}.")

        request = BrokerOrderRequest(
            client_order_id=intent.client_order_id,
            symbol=intent.symbol,
            side=intent.side,
            quantity=intent.quantity,
            type=OrderType(intent.type),
            limit_price=intent.limit_price,
            reference_price=context.reference_price,
        )

        order = OrderRow(
            client_order_id=intent.client_order_id,
            connection_id=connection.id,
            symbol=intent.symbol,
            market_type=str(intent.market_type),
            side=str(intent.side),
            type=intent.type,
            status=OrderStatus.OPEN,
            quantity=intent.quantity,
            filled_quantity=Decimal("0"),
            limit_price=intent.limit_price,
            mode=str(intent.mode),
            bot_id=intent.bot_id,
            strategy_id=intent.strategy_id,
            reconciliation=ReconciliationState.PENDING,
        )
        self.session.add(order)
        self.session.flush()

        try:
            result = adapter.submit_order(request)
        except BrokerTimeout as exc:
            order.reconciliation = ReconciliationState.PENDING
            record_for_principal(
                self.session,
                principal,
                action="order.outcome_unknown",
                target=str(order.id),
                outcome="error",
                detail={"clientOrderId": intent.client_order_id, "error": str(exc)},
                request_id=request_id,
                ip=ip,
            )
            self.session.flush()
            raise ExecutionOutcomeUnknown(
                "The broker did not confirm the order. The outcome is unknown; it will be "
                "reconciled before any retry."
            ) from exc
        except BrokerError as exc:
            order.status = OrderStatus.REJECTED
            order.reconciliation = ReconciliationState.MATCHED
            order.reject_reason = str(exc)[:2000]
            record_for_principal(
                self.session,
                principal,
                action="order.rejected_by_broker",
                target=str(order.id),
                outcome="error",
                detail={"clientOrderId": intent.client_order_id, "error": str(exc)},
                request_id=request_id,
                ip=ip,
            )
            self.session.flush()
            raise BadRequest(f"The broker rejected the order: {exc}") from exc

        self._apply_result(order, result, intent)
        record_for_principal(
            self.session,
            principal,
            action="order.submitted",
            target=str(order.id),
            detail={
                "clientOrderId": intent.client_order_id,
                "symbol": intent.symbol,
                "side": str(intent.side),
                "quantity": str(intent.quantity),
                "status": str(result.status),
                "mode": str(intent.mode),
            },
            request_id=request_id,
            ip=ip,
        )
        self.session.flush()
        return order

    def _apply_result(
        self, order: OrderRow, result: BrokerOrderResult, intent: TradeIntent
    ) -> None:
        order.status = result.status
        order.filled_quantity = result.filled_quantity
        order.average_fill_price = result.average_fill_price
        order.fees = result.fees
        order.exchange_confirmation_id = result.confirmation_id
        order.reconciliation = ReconciliationState.MATCHED
        order.updated_at = datetime.now(tz=UTC)

        portfolio = PortfolioService(self.session, settings=self.settings)
        for fill in result.fills:
            fill_row = FillRow(
                order_id=order.id,
                symbol=order.symbol,
                side=order.side,
                quantity=fill.quantity,
                price=fill.price,
                fees=fill.fees,
            )
            self.session.add(fill_row)
            self.session.flush()
            if order.connection_id is not None:
                # Keyed on the fill row id, so replaying a fill cannot debit the
                # account twice.
                portfolio.record_fill(
                    str(order.connection_id),
                    order_id=str(order.id),
                    symbol=order.symbol,
                    side=order.side,
                    quantity=fill.quantity,
                    price=fill.price,
                    fees=fill.fees,
                    reference=f"fill:{fill_row.id}",
                )

        if result.filled_quantity > 0 and result.average_fill_price is not None:
            self._apply_position(order, result, intent)

        if order.connection_id is not None:
            portfolio.sync_order_reservation(
                str(order.connection_id),
                order_id=str(order.id),
                side=order.side,
                unfilled_quantity=Decimal(order.quantity) - Decimal(order.filled_quantity),
                price=result.average_fill_price or order.limit_price,
            )

    def _apply_position(
        self, order: OrderRow, result: BrokerOrderResult, intent: TradeIntent
    ) -> None:
        position = self.session.scalar(
            select(PositionRow).where(
                PositionRow.connection_id == order.connection_id,
                PositionRow.symbol == order.symbol,
            )
        )
        price = result.average_fill_price or Decimal("0")
        quantity = result.filled_quantity

        if position is None:
            position = PositionRow(
                connection_id=order.connection_id,
                symbol=order.symbol,
                market_type=order.market_type,
                quantity=Decimal("0"),
                average_entry_price=Decimal("0"),
                realised_pnl=Decimal("0"),
                fees_paid=Decimal("0"),
                strategy_id=intent.strategy_id,
                bot_id=intent.bot_id,
            )
            self.session.add(position)

        position.fees_paid = (position.fees_paid or Decimal("0")) + result.fees

        if order.side == "buy":
            total_cost = position.average_entry_price * position.quantity + price * quantity
            new_quantity = position.quantity + quantity
            position.average_entry_price = (
                total_cost / new_quantity if new_quantity > 0 else Decimal("0")
            )
            position.quantity = new_quantity
        else:
            closed = min(quantity, position.quantity)
            position.realised_pnl = (position.realised_pnl or Decimal("0")) + (
                price - position.average_entry_price
            ) * closed
            position.quantity = position.quantity - closed
            if position.quantity <= 0:
                position.quantity = Decimal("0")
                position.average_entry_price = Decimal("0")
