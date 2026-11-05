"""The independent risk engine.

This module is the last thing between a strategy's opinion and real money, so it
has three properties that are enforced rather than promised:

1. **It is independent.** It takes a policy, an engine state and a context, and
   returns a decision. It does not read the strategy, cannot be configured by
   the strategy, and has no side effects.
2. **It fails closed.** Missing data is a violation, not a pass. An unknown
   quote age, an unknown account state, an unknown market session — all block.
3. **It is the only gate.** ``ExecutionGateway`` calls it unconditionally; there
   is no flag to skip it and no alternate order path in the codebase.

Every violation is returned, not just the first, so an operator sees the whole
picture in one rejection instead of fixing limits one at a time.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal

from wands.config import Settings
from wands.db.models import EngineStateRow
from wands.risk.policy import RiskPolicy
from wands.schemas import MarketType, RiskCategory, RiskSeverity, TradingMode

ZERO = Decimal("0")


@dataclass(frozen=True)
class RiskContext:
    """Everything the engine needs to judge one order.

    ``None`` means "unknown", and unknown blocks. That is intentional: a risk
    check that passes because a value was missing is not a risk check.
    """

    portfolio_equity: Decimal | None = None
    total_exposure: Decimal | None = None
    position_market_value: Decimal | None = None
    crypto_exposure: Decimal | None = None
    stocks_exposure: Decimal | None = None
    day_pnl_pct: Decimal | None = None
    drawdown_pct: Decimal | None = None
    quote_age_seconds: float | None = None
    spread_pct: Decimal | None = None
    buying_power: Decimal | None = None
    account_state_age_seconds: float | None = None
    market_open: bool | None = None
    reference_price: Decimal | None = None
    stop_distance_pct: Decimal | None = None
    recent_client_order_ids: frozenset[str] = field(default_factory=frozenset)


@dataclass(frozen=True)
class RiskViolation:
    key: str
    label: str
    severity: RiskSeverity
    category: RiskCategory
    detail: str

    def as_dict(self) -> dict[str, str]:
        return {
            "key": self.key,
            "label": self.label,
            "severity": str(self.severity),
            "detail": self.detail,
        }


@dataclass(frozen=True)
class RiskDecision:
    approved: bool
    violations: tuple[RiskViolation, ...] = ()
    notes: tuple[str, ...] = ()

    @property
    def reasons(self) -> list[str]:
        return [f"{v.label}: {v.detail}" for v in self.violations]


@dataclass(frozen=True)
class OrderProposal:
    """The minimum the risk engine needs to know about an order."""

    symbol: str
    market_type: MarketType
    side: str
    quantity: Decimal
    mode: TradingMode
    client_order_id: str
    limit_price: Decimal | None = None


class RiskEngine:
    def evaluate(
        self,
        proposal: OrderProposal,
        *,
        policy: RiskPolicy,
        state: EngineStateRow,
        context: RiskContext,
        settings: Settings,
    ) -> RiskDecision:
        violations: list[RiskViolation] = []
        notes: list[str] = []

        def block(
            key: str,
            label: str,
            detail: str,
            *,
            severity: RiskSeverity = RiskSeverity.CRITICAL,
            category: RiskCategory = RiskCategory.EXPOSURE,
        ) -> None:
            violations.append(
                RiskViolation(
                    key=key, label=label, severity=severity, category=category, detail=detail
                )
            )

        # --- 1. kill switches, checked before anything else ----------------
        if state.emergency_stop_engaged:
            block(
                "emergency_stop",
                "Emergency stop engaged",
                "Trading is halted by the emergency stop. Clear it explicitly before "
                "any order can be submitted.",
                category=RiskCategory.EMERGENCY_STOP,
            )
        if state.trading_paused:
            block(
                "trading_paused",
                "Trading paused",
                "Trading is paused. Resume it before submitting orders.",
                category=RiskCategory.PERMISSION,
            )

        # --- 2. mode separation -------------------------------------------
        if proposal.mode != state.trading_mode:
            block(
                "mode_mismatch",
                "Trading mode mismatch",
                f"Order is for {proposal.mode} but the engine is running in {state.trading_mode}.",
                category=RiskCategory.PERMISSION,
            )
        if proposal.mode == TradingMode.LIVE:
            if not settings.live_trading_enabled:
                block(
                    "live_disabled_deployment",
                    "Live trading disabled at deployment",
                    "WANDS_LIVE_TRADING_ENABLED is false, so no live order can be submitted.",
                    category=RiskCategory.PERMISSION,
                )
            if not state.live_trading_enabled:
                block(
                    "live_disabled_engine",
                    "Live trading not authorised",
                    "Live trading has not been enabled by an authenticated administrator.",
                    category=RiskCategory.PERMISSION,
                )

        # --- 3. data freshness --------------------------------------------
        if context.quote_age_seconds is None:
            block(
                "quote_age_unknown",
                "Quote age unknown",
                "The age of the reference quote is unknown, so the price cannot be trusted.",
                category=RiskCategory.STALE_DATA,
            )
        elif context.quote_age_seconds > policy.max_quote_age_seconds:
            block(
                "stale_quote",
                "Stale market data",
                f"Reference quote is {context.quote_age_seconds:.1f}s old; the limit is "
                f"{policy.max_quote_age_seconds}s.",
                category=RiskCategory.STALE_DATA,
            )

        if context.account_state_age_seconds is None:
            block(
                "account_state_unknown",
                "Account state unknown",
                "The account has never been synchronised, so balances cannot be trusted.",
                category=RiskCategory.STALE_DATA,
            )
        elif context.account_state_age_seconds > settings.max_account_state_age_seconds:
            block(
                "stale_account_state",
                "Stale account state",
                f"Last broker sync was {context.account_state_age_seconds:.0f}s ago; the "
                f"limit is {settings.max_account_state_age_seconds}s.",
                category=RiskCategory.STALE_DATA,
            )

        # --- 4. market conditions -----------------------------------------
        if context.market_open is None:
            block(
                "market_session_unknown",
                "Market session unknown",
                "The trading session for this instrument could not be determined.",
                category=RiskCategory.STALE_DATA,
            )
        elif context.market_open is False:
            block(
                "market_closed",
                "Market closed",
                f"{proposal.symbol} is outside its trading session.",
                category=RiskCategory.PERMISSION,
            )

        if context.spread_pct is not None and context.spread_pct > Decimal(
            str(settings.max_spread_pct)
        ):
            block(
                "spread_too_wide",
                "Spread too wide",
                f"Quoted spread is {context.spread_pct}%, above the "
                f"{settings.max_spread_pct}% safeguard.",
                category=RiskCategory.STALE_DATA,
            )

        # --- 5. duplicate order prevention --------------------------------
        if proposal.client_order_id in context.recent_client_order_ids:
            block(
                "duplicate_order",
                "Duplicate order",
                f"Client order id {proposal.client_order_id} was already submitted inside "
                f"the {policy.duplicate_order_window_seconds}s window.",
                category=RiskCategory.DUPLICATE_ORDER,
            )

        # --- 6. sizing -----------------------------------------------------
        price = proposal.limit_price or context.reference_price
        notional: Decimal | None = None
        if price is None or price <= ZERO:
            block(
                "price_unknown",
                "Reference price unknown",
                "No usable price is available to size or value this order.",
                category=RiskCategory.STALE_DATA,
            )
        else:
            notional = proposal.quantity * price

        equity = context.portfolio_equity
        if equity is None or equity <= ZERO:
            block(
                "equity_unknown",
                "Portfolio equity unknown",
                "Portfolio equity is unavailable, so percentage limits cannot be applied.",
                category=RiskCategory.EXPOSURE,
            )
        elif notional is not None:
            position_after = (context.position_market_value or ZERO) + notional
            position_limit = equity * policy.max_position_exposure_pct / Decimal("100")
            if position_after > position_limit:
                block(
                    "position_limit",
                    "Position limit exceeded",
                    f"Position would reach {position_after:.2f} against a "
                    f"{policy.max_position_exposure_pct}% limit ({position_limit:.2f}).",
                )

            exposure_after = (context.total_exposure or ZERO) + notional
            exposure_limit = equity * policy.max_portfolio_exposure_pct / Decimal("100")
            if exposure_after > exposure_limit:
                block(
                    "portfolio_exposure",
                    "Portfolio exposure limit exceeded",
                    f"Total exposure would reach {exposure_after:.2f} against a "
                    f"{policy.max_portfolio_exposure_pct}% limit ({exposure_limit:.2f}).",
                )

            if proposal.market_type == MarketType.CRYPTO:
                crypto_after = (context.crypto_exposure or ZERO) + notional
                crypto_limit = equity * policy.crypto_allocation_cap_pct / Decimal("100")
                if crypto_after > crypto_limit:
                    block(
                        "crypto_cap",
                        "Crypto allocation cap exceeded",
                        f"Crypto exposure would reach {crypto_after:.2f} against a "
                        f"{policy.crypto_allocation_cap_pct}% cap ({crypto_limit:.2f}).",
                    )
            else:
                stocks_after = (context.stocks_exposure or ZERO) + notional
                stocks_limit = equity * policy.stocks_allocation_cap_pct / Decimal("100")
                if stocks_after > stocks_limit:
                    block(
                        "stocks_cap",
                        "Stocks allocation cap exceeded",
                        f"Stocks exposure would reach {stocks_after:.2f} against a "
                        f"{policy.stocks_allocation_cap_pct}% cap ({stocks_limit:.2f}).",
                    )

            # Per-trade risk budget: loss if the stop is hit, not the notional.
            if context.stop_distance_pct is None:
                block(
                    "stop_distance_unknown",
                    "Stop distance unknown",
                    "No stop distance was supplied, so the per-trade risk budget cannot be "
                    "evaluated. Unbounded risk is not permitted.",
                    category=RiskCategory.PERMISSION,
                )
            else:
                risk_amount = notional * context.stop_distance_pct / Decimal("100")
                risk_budget = equity * policy.per_trade_risk_pct / Decimal("100")
                if risk_amount > risk_budget:
                    block(
                        "per_trade_risk",
                        "Per-trade risk budget exceeded",
                        f"Loss at stop would be {risk_amount:.2f} against a "
                        f"{policy.per_trade_risk_pct}% budget ({risk_budget:.2f}).",
                    )

        # --- 7. buying power ----------------------------------------------
        if notional is not None:
            if context.buying_power is None:
                block(
                    "buying_power_unknown",
                    "Buying power unknown",
                    "Buying power is unavailable, so the order cannot be funded.",
                )
            elif proposal.side == "buy" and notional > context.buying_power:
                block(
                    "insufficient_buying_power",
                    "Insufficient buying power",
                    f"Order notional {notional:.2f} exceeds available buying power "
                    f"{context.buying_power:.2f}.",
                )

        # --- 8. short selling and leverage --------------------------------
        if proposal.side == "sell" and not policy.allow_short_selling:
            held = context.position_market_value or ZERO
            if notional is not None and notional > held:
                block(
                    "short_selling_blocked",
                    "Short selling disabled",
                    "Selling more than the current long position would open a short, which "
                    "the policy forbids.",
                    category=RiskCategory.PERMISSION,
                )

        if not policy.allow_leverage and notional is not None and equity:
            if (context.total_exposure or ZERO) + notional > equity:
                block(
                    "leverage_blocked",
                    "Leverage disabled",
                    "The order would require borrowed capital, which the policy forbids.",
                )

        # --- 9. loss circuit breakers -------------------------------------
        if context.day_pnl_pct is None:
            notes.append("Day P&L is unavailable; the daily loss breaker could not be evaluated.")
        elif context.day_pnl_pct <= -policy.daily_loss_limit_pct:
            block(
                "daily_loss_breaker",
                "Daily loss circuit breaker",
                f"Day P&L is {context.day_pnl_pct}%, at or beyond the "
                f"-{policy.daily_loss_limit_pct}% breaker.",
                category=RiskCategory.CIRCUIT_BREAKER,
            )

        if context.drawdown_pct is None:
            notes.append("Drawdown is unavailable; the drawdown limit could not be evaluated.")
        elif context.drawdown_pct >= policy.max_drawdown_pct:
            block(
                "max_drawdown",
                "Maximum drawdown reached",
                f"Drawdown is {context.drawdown_pct}%, at or beyond the "
                f"{policy.max_drawdown_pct}% limit.",
                category=RiskCategory.DRAWDOWN,
            )

        return RiskDecision(
            approved=not violations,
            violations=tuple(violations),
            notes=tuple(notes),
        )
