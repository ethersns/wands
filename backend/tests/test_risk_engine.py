"""Risk engine behaviour.

Each test breaks exactly one input against an otherwise passing context, so a
failure identifies the rule that fired rather than a cascade.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from wands.db.models import EngineStateRow
from wands.risk.engine import OrderProposal, RiskEngine
from wands.risk.policy import DEFAULT_POLICY
from wands.schemas import MarketType, TradingMode

from .conftest import good_context, paper_settings

ENGINE = RiskEngine()


def state(**overrides) -> EngineStateRow:
    base = {
        "id": 1,
        "trading_mode": "paper",
        "live_trading_enabled": False,
        "trading_paused": False,
        "emergency_stop_engaged": False,
    }
    base.update(overrides)
    return EngineStateRow(**base)


def proposal(**overrides) -> OrderProposal:
    base = {
        "symbol": "BTCUSD",
        "market_type": MarketType.CRYPTO,
        "side": "buy",
        "quantity": Decimal("1"),
        "mode": TradingMode.PAPER,
        "client_order_id": "order-1",
        "limit_price": None,
    }
    base.update(overrides)
    return OrderProposal(**base)


def evaluate(context=None, *, proposal_overrides=None, state_overrides=None, settings=None):
    return ENGINE.evaluate(
        proposal(**(proposal_overrides or {})),
        policy=DEFAULT_POLICY,
        state=state(**(state_overrides or {})),
        context=context or good_context(),
        settings=settings or paper_settings(),
    )


def keys(decision) -> set[str]:
    return {violation.key for violation in decision.violations}


def test_baseline_order_is_approved():
    decision = evaluate()
    assert decision.approved, decision.reasons
    assert decision.violations == ()


def test_emergency_stop_blocks_everything():
    decision = evaluate(state_overrides={"emergency_stop_engaged": True})
    assert not decision.approved
    assert "emergency_stop" in keys(decision)


def test_pause_blocks_orders():
    decision = evaluate(state_overrides={"trading_paused": True})
    assert not decision.approved
    assert "trading_paused" in keys(decision)


def test_stale_quote_blocks_orders():
    decision = evaluate(good_context(quote_age_seconds=120.0))
    assert not decision.approved
    assert "stale_quote" in keys(decision)


def test_unknown_quote_age_blocks_orders():
    decision = evaluate(good_context(quote_age_seconds=None))
    assert not decision.approved
    assert "quote_age_unknown" in keys(decision)


def test_stale_account_state_blocks_orders():
    decision = evaluate(good_context(account_state_age_seconds=9999.0))
    assert not decision.approved
    assert "stale_account_state" in keys(decision)


def test_never_synced_account_blocks_orders():
    decision = evaluate(good_context(account_state_age_seconds=None))
    assert not decision.approved
    assert "account_state_unknown" in keys(decision)


def test_closed_market_blocks_orders():
    decision = evaluate(good_context(market_open=False))
    assert not decision.approved
    assert "market_closed" in keys(decision)


def test_wide_spread_blocks_orders():
    decision = evaluate(good_context(spread_pct=Decimal("5")))
    assert not decision.approved
    assert "spread_too_wide" in keys(decision)


def test_duplicate_client_order_id_blocks_orders():
    decision = evaluate(good_context(recent_client_order_ids=frozenset({"order-1"})))
    assert not decision.approved
    assert "duplicate_order" in keys(decision)


def test_position_limit_blocks_oversized_order():
    # 5% of 10,000 is 500; 10 units at 100 is 1,000.
    decision = evaluate(proposal_overrides={"quantity": Decimal("10")})
    assert not decision.approved
    assert "position_limit" in keys(decision)


def test_portfolio_exposure_limit_blocks_orders():
    # 80% of 10,000 is 8,000; 7,950 + 100 breaches it.
    decision = evaluate(good_context(total_exposure=Decimal("7950")))
    assert not decision.approved
    assert "portfolio_exposure" in keys(decision)


def test_crypto_cap_blocks_orders():
    decision = evaluate(good_context(crypto_exposure=Decimal("3990")))
    assert not decision.approved
    assert "crypto_cap" in keys(decision)


def test_per_trade_risk_budget_blocks_orders():
    # 1 unit at 100 with a 20% stop risks 20 against a 0.5% (50) budget? No:
    # 20 < 50, so widen the stop to 60% to exceed the budget.
    decision = evaluate(good_context(stop_distance_pct=Decimal("60")))
    assert not decision.approved
    assert "per_trade_risk" in keys(decision)


def test_missing_stop_distance_blocks_orders():
    decision = evaluate(good_context(stop_distance_pct=None))
    assert not decision.approved
    assert "stop_distance_unknown" in keys(decision)


def test_insufficient_buying_power_blocks_orders():
    decision = evaluate(good_context(buying_power=Decimal("10")))
    assert not decision.approved
    assert "insufficient_buying_power" in keys(decision)


def test_daily_loss_breaker_blocks_orders():
    decision = evaluate(good_context(day_pnl_pct=Decimal("-2.5")))
    assert not decision.approved
    assert "daily_loss_breaker" in keys(decision)


def test_max_drawdown_blocks_orders():
    decision = evaluate(good_context(drawdown_pct=Decimal("12")))
    assert not decision.approved
    assert "max_drawdown" in keys(decision)


def test_short_selling_is_blocked_by_default():
    decision = evaluate(
        proposal_overrides={"side": "sell", "quantity": Decimal("5")},
        context=good_context(position_market_value=Decimal("0")),
    )
    assert not decision.approved
    assert "short_selling_blocked" in keys(decision)


def test_live_order_is_blocked_when_deployment_flag_is_off():
    decision = evaluate(proposal_overrides={"mode": TradingMode.LIVE})
    assert not decision.approved
    assert "live_disabled_deployment" in keys(decision)


def test_live_order_is_blocked_when_engine_flag_is_off():
    decision = evaluate(
        proposal_overrides={"mode": TradingMode.LIVE},
        state_overrides={"trading_mode": "live"},
        settings=paper_settings(live_trading_enabled=True),
    )
    assert not decision.approved
    assert "live_disabled_engine" in keys(decision)


def test_mode_mismatch_is_blocked():
    decision = evaluate(proposal_overrides={"mode": TradingMode.BACKTEST})
    assert not decision.approved
    assert "mode_mismatch" in keys(decision)


def test_unknown_equity_blocks_orders():
    decision = evaluate(good_context(portfolio_equity=None))
    assert not decision.approved
    assert "equity_unknown" in keys(decision)


def test_all_violations_are_reported_together():
    decision = evaluate(
        good_context(quote_age_seconds=999.0, day_pnl_pct=Decimal("-9")),
        state_overrides={"emergency_stop_engaged": True},
    )
    assert {"emergency_stop", "stale_quote", "daily_loss_breaker"} <= keys(decision)


@pytest.mark.parametrize("severity_key", ["emergency_stop", "stale_quote"])
def test_violations_carry_a_category(severity_key):
    decision = evaluate(
        good_context(quote_age_seconds=999.0),
        state_overrides={"emergency_stop_engaged": True},
    )
    violation = next(v for v in decision.violations if v.key == severity_key)
    assert violation.category
    assert violation.detail
