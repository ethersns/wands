"""Strategy isolation.

This is the test that makes "a strategy cannot bypass the execution gateway" a
property of the build rather than a claim in a document. It parses the AST of
every module under ``wands/strategies`` and fails if one of them imports a
broker, the gateway, the database or the HTTP layer.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

STRATEGY_PACKAGE = Path(__file__).resolve().parents[1] / "wands" / "strategies"

FORBIDDEN = (
    "wands.brokers",
    "wands.execution.gateway",
    "wands.db",
    "wands.api",
    "wands.security",
    "sqlalchemy",
    "fastapi",
    "httpx",
    "requests",
)

ALLOWED = ("wands.execution.intents", "wands.schemas")


def _imports(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    modules: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            modules.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            modules.add(node.module)
    return modules


def _strategy_modules() -> list[Path]:
    return sorted(STRATEGY_PACKAGE.rglob("*.py"))


def test_strategy_package_exists():
    assert _strategy_modules(), "the strategy package must contain modules"


@pytest.mark.parametrize("path", _strategy_modules(), ids=lambda p: p.name)
def test_strategy_module_has_no_forbidden_imports(path: Path):
    for module in _imports(path):
        for forbidden in FORBIDDEN:
            assert not (module == forbidden or module.startswith(f"{forbidden}.")), (
                f"{path.name} imports {module!r}. Strategies may only produce trade "
                f"intents; they must not reach a broker, the gateway or the database."
            )


def test_strategy_package_may_import_intents():
    """The allowed dependency is explicit, so the rule is not accidentally total."""
    modules = set()
    for path in _strategy_modules():
        modules |= _imports(path)
    assert any(module in ALLOWED for module in modules)


def test_trade_intent_has_no_execution_methods():
    from wands.execution.intents import TradeIntent

    public = {name for name in dir(TradeIntent) if not name.startswith("_")}
    for forbidden in ("submit", "execute", "place", "send", "cancel"):
        assert forbidden not in public, (
            f"TradeIntent exposes {forbidden!r}; an intent must be inert data."
        )


def test_strategy_propose_returns_intents_only():
    from decimal import Decimal

    from wands.execution.intents import TradeIntent
    from wands.schemas import MarketType
    from wands.strategies.base import Candle, StrategyContext
    from wands.strategies.registry import get_strategy

    strategy = get_strategy("ma-crossover")
    assert strategy is not None

    # A clean uptrend that crosses the fast average above the slow one.
    candles = tuple(
        Candle(
            time=index,
            open=Decimal(100 + index),
            high=Decimal(101 + index),
            low=Decimal(99 + index),
            close=Decimal(100 + index),
            volume=Decimal("1"),
        )
        for index in range(60)
    )
    context = StrategyContext(
        symbol="BTCUSD",
        market_type=MarketType.CRYPTO,
        candles=candles,
        position_quantity=Decimal("0"),
        equity=Decimal("10000"),
        account_id="account",
        mode="paper",
        parameters={"fast_period": 5, "slow_period": 20, "stop_loss_pct": 2},
    )

    proposals = strategy.propose(context)
    assert all(isinstance(proposal, TradeIntent) for proposal in proposals)
