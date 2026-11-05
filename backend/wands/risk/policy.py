"""Risk policy value object.

The defaults are deliberately conservative and are *illustrative*, not tuned:
5% per position, 0.5% risk budget per trade, 2% daily loss circuit breaker, no
leverage, no shorting. They are a starting point an operator must review, not a
recommendation.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from decimal import Decimal
from typing import Any

from wands.db.models import RiskPolicyRow


@dataclass(frozen=True)
class RiskPolicy:
    max_portfolio_exposure_pct: Decimal = Decimal("80")
    max_position_exposure_pct: Decimal = Decimal("5")
    per_trade_risk_pct: Decimal = Decimal("0.5")
    daily_loss_limit_pct: Decimal = Decimal("2")
    max_drawdown_pct: Decimal = Decimal("10")
    crypto_allocation_cap_pct: Decimal = Decimal("40")
    stocks_allocation_cap_pct: Decimal = Decimal("60")
    max_quote_age_seconds: int = 30
    duplicate_order_window_seconds: int = 60
    allow_short_selling: bool = False
    allow_leverage: bool = False

    @classmethod
    def from_row(cls, row: RiskPolicyRow) -> RiskPolicy:
        return cls(
            max_portfolio_exposure_pct=Decimal(row.max_portfolio_exposure_pct),
            max_position_exposure_pct=Decimal(row.max_position_exposure_pct),
            per_trade_risk_pct=Decimal(row.per_trade_risk_pct),
            daily_loss_limit_pct=Decimal(row.daily_loss_limit_pct),
            max_drawdown_pct=Decimal(row.max_drawdown_pct),
            crypto_allocation_cap_pct=Decimal(row.crypto_allocation_cap_pct),
            stocks_allocation_cap_pct=Decimal(row.stocks_allocation_cap_pct),
            max_quote_age_seconds=int(row.max_quote_age_seconds),
            duplicate_order_window_seconds=int(row.duplicate_order_window_seconds),
            allow_short_selling=bool(row.allow_short_selling),
            allow_leverage=bool(row.allow_leverage),
        )

    def apply(self, changes: dict[str, Any]) -> RiskPolicy:
        """Return a new policy with only the provided fields replaced."""
        clean = {k: v for k, v in changes.items() if v is not None}
        return replace(self, **clean)

    def to_row_kwargs(self) -> dict[str, Any]:
        return {
            "max_portfolio_exposure_pct": self.max_portfolio_exposure_pct,
            "max_position_exposure_pct": self.max_position_exposure_pct,
            "per_trade_risk_pct": self.per_trade_risk_pct,
            "daily_loss_limit_pct": self.daily_loss_limit_pct,
            "max_drawdown_pct": self.max_drawdown_pct,
            "crypto_allocation_cap_pct": self.crypto_allocation_cap_pct,
            "stocks_allocation_cap_pct": self.stocks_allocation_cap_pct,
            "max_quote_age_seconds": self.max_quote_age_seconds,
            "duplicate_order_window_seconds": self.duplicate_order_window_seconds,
            "allow_short_selling": self.allow_short_selling,
            "allow_leverage": self.allow_leverage,
        }


DEFAULT_POLICY = RiskPolicy()
