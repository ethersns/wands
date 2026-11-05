"""Strategy engine.

Nothing in this package may import ``wands.brokers``, ``wands.execution.gateway``
or ``wands.db``. A strategy's only output is a list of ``TradeIntent`` values,
which the execution gateway then subjects to the risk engine. The rule is
enforced by ``tests/test_strategy_isolation.py``.
"""

from wands.strategies.base import Strategy, StrategyContext, StrategyDefinition
from wands.strategies.registry import BUILTIN_STRATEGIES, get_strategy

__all__ = [
    "BUILTIN_STRATEGIES",
    "Strategy",
    "StrategyContext",
    "StrategyDefinition",
    "get_strategy",
]
