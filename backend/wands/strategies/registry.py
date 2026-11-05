"""Built-in strategy catalogue.

Only one strategy is implemented end to end in this phase — a moving-average
crossover — because it is the smallest thing that exercises the intent path
honestly. The rest are catalogued with their parameters and marked
``paper_only`` so the UI can show them without implying they are validated.

Market making and arbitrage are ``paper_only`` by policy: they are not safe to
run live until execution latency and inventory risk have been measured, and
nothing in this build measures them.
"""

from __future__ import annotations

from decimal import Decimal

from wands.execution.intents import TradeIntent
from wands.schemas import Deployment, MarketType, OrderSide, StrategyCategory
from wands.strategies.base import Strategy, StrategyContext, StrategyDefinition

MA_CROSSOVER = StrategyDefinition(
    slug="ma-crossover",
    name="Moving Average Crossover",
    category=StrategyCategory.TREND_FOLLOWING,
    description=(
        "Go long when the fast simple moving average crosses above the slow one, "
        "exit when it crosses back below. A trend-following baseline, not a "
        "recommendation."
    ),
    version="0.1.0",
    supported_markets=(MarketType.CRYPTO, MarketType.STOCKS),
    deployment=Deployment.PAPER_AND_LIVE,
    parameters=(
        {
            "key": "fast_period",
            "label": "Fast period",
            "type": "number",
            "value": 20,
            "min": 2,
            "max": 200,
            "step": 1,
            "help": "Bars in the fast moving average.",
        },
        {
            "key": "slow_period",
            "label": "Slow period",
            "type": "number",
            "value": 50,
            "min": 5,
            "max": 400,
            "step": 1,
            "help": "Bars in the slow moving average. Must exceed the fast period.",
        },
        {
            "key": "stop_loss_pct",
            "label": "Stop loss",
            "type": "percent",
            "value": 2,
            "min": 0.1,
            "max": 20,
            "step": 0.1,
            "help": "Distance to the protective stop, used for the risk budget.",
        },
    ),
)

MEAN_REVERSION = StrategyDefinition(
    slug="mean-reversion",
    name="Mean Reversion",
    category=StrategyCategory.MEAN_REVERSION,
    description=(
        "Fade moves that stretch beyond a z-score band and exit on reversion to the "
        "mean. Sensitive to regime change; validate out of sample before use."
    ),
    version="0.1.0",
    supported_markets=(MarketType.CRYPTO, MarketType.STOCKS),
    deployment=Deployment.PAPER_ONLY,
    parameters=(
        {
            "key": "lookback",
            "label": "Lookback",
            "type": "number",
            "value": 50,
            "min": 10,
            "max": 500,
            "step": 1,
            "help": "Bars used for the mean and standard deviation.",
        },
        {
            "key": "z_entry",
            "label": "Entry z-score",
            "type": "number",
            "value": 2,
            "min": 0.5,
            "max": 5,
            "step": 0.1,
            "help": "Deviation required to open a position.",
        },
    ),
)

MOMENTUM = StrategyDefinition(
    slug="momentum",
    name="Cross-Sectional Momentum",
    category=StrategyCategory.MOMENTUM,
    description=(
        "Rank a universe by trailing return and hold the leaders. Requires a "
        "survivorship-bias-free universe to be evaluated honestly."
    ),
    version="0.1.0",
    supported_markets=(MarketType.STOCKS,),
    deployment=Deployment.PAPER_ONLY,
    parameters=(
        {
            "key": "lookback_days",
            "label": "Lookback (days)",
            "type": "number",
            "value": 90,
            "min": 20,
            "max": 365,
            "step": 1,
            "help": "Trailing window used to rank the universe.",
        },
        {
            "key": "holdings",
            "label": "Holdings",
            "type": "number",
            "value": 10,
            "min": 1,
            "max": 50,
            "step": 1,
            "help": "Number of leaders held at once.",
        },
    ),
)

VOLATILITY_BREAKOUT = StrategyDefinition(
    slug="volatility-breakout",
    name="Volatility Breakout",
    category=StrategyCategory.TREND_FOLLOWING,
    description=(
        "Enter on a close beyond a volatility-scaled band. Breakouts fail often; "
        "expect a low win rate and rely on payoff asymmetry."
    ),
    version="0.1.0",
    supported_markets=(MarketType.CRYPTO, MarketType.STOCKS),
    deployment=Deployment.PAPER_ONLY,
    parameters=(
        {
            "key": "atr_period",
            "label": "ATR period",
            "type": "number",
            "value": 14,
            "min": 5,
            "max": 100,
            "step": 1,
            "help": "Bars in the average true range.",
        },
        {
            "key": "band_multiple",
            "label": "Band multiple",
            "type": "number",
            "value": 2,
            "min": 0.5,
            "max": 6,
            "step": 0.1,
            "help": "ATR multiples beyond the prior close required to trigger.",
        },
    ),
)

GRID = StrategyDefinition(
    slug="grid",
    name="Grid",
    category=StrategyCategory.GRID,
    description=(
        "Place staggered orders around a reference price. Profitable in ranges, "
        "catastrophic in trends; the risk engine's exposure caps are what keep it "
        "survivable."
    ),
    version="0.1.0",
    supported_markets=(MarketType.CRYPTO,),
    deployment=Deployment.PAPER_ONLY,
    parameters=(
        {
            "key": "levels",
            "label": "Grid levels",
            "type": "number",
            "value": 8,
            "min": 2,
            "max": 50,
            "step": 1,
            "help": "Number of price levels in the grid.",
        },
        {
            "key": "spacing_pct",
            "label": "Spacing",
            "type": "percent",
            "value": 0.5,
            "min": 0.05,
            "max": 5,
            "step": 0.05,
            "help": "Distance between adjacent levels.",
        },
    ),
)

MARKET_MAKING = StrategyDefinition(
    slug="market-making",
    name="Market Making",
    category=StrategyCategory.MARKET_MAKING,
    description=(
        "Quote both sides and earn the spread. Simulation only: live quoting "
        "requires latency, inventory and adverse-selection measurement that this "
        "build does not perform."
    ),
    version="0.1.0",
    supported_markets=(MarketType.CRYPTO,),
    deployment=Deployment.PAPER_ONLY,
    parameters=(
        {
            "key": "spread_bps",
            "label": "Quoted spread (bps)",
            "type": "number",
            "value": 10,
            "min": 1,
            "max": 200,
            "step": 1,
            "help": "Half-spread quoted either side of the mid.",
        },
    ),
)

ARBITRAGE = StrategyDefinition(
    slug="arbitrage",
    name="Cross-Venue Arbitrage",
    category=StrategyCategory.ARBITRAGE,
    description=(
        "Exploit price differences between venues. Simulation only until transfer "
        "latency, fees and withdrawal constraints are modelled."
    ),
    version="0.1.0",
    supported_markets=(MarketType.CRYPTO,),
    deployment=Deployment.PAPER_ONLY,
    parameters=(
        {
            "key": "min_edge_bps",
            "label": "Minimum edge (bps)",
            "type": "number",
            "value": 15,
            "min": 1,
            "max": 500,
            "step": 1,
            "help": "Edge required after fees before a trade is considered.",
        },
    ),
)


class MovingAverageCrossover(Strategy):
    definition = MA_CROSSOVER

    def propose(self, context: StrategyContext) -> list[TradeIntent]:
        fast = int(context.parameters.get("fast_period", 20))
        slow = int(context.parameters.get("slow_period", 50))
        stop = Decimal(str(context.parameters.get("stop_loss_pct", 2)))

        if fast >= slow or len(context.candles) < slow + 1:
            return []

        closes = [candle.close for candle in context.candles]
        fast_now = sum(closes[-fast:]) / fast
        slow_now = sum(closes[-slow:]) / slow
        fast_prev = sum(closes[-fast - 1 : -1]) / fast
        slow_prev = sum(closes[-slow - 1 : -1]) / slow

        crossed_up = fast_prev <= slow_prev and fast_now > slow_now
        crossed_down = fast_prev >= slow_prev and fast_now < slow_now

        if crossed_up and context.position_quantity == 0 and context.equity > 0:
            price = closes[-1]
            budget = context.equity * Decimal("0.05")
            quantity = (budget / price).quantize(Decimal("0.00000001"))
            if quantity <= 0:
                return []
            return [
                TradeIntent(
                    symbol=context.symbol,
                    market_type=context.market_type,
                    side=OrderSide.BUY,
                    quantity=quantity,
                    account_id=context.account_id,
                    mode=context.mode,  # type: ignore[arg-type]
                    stop_loss_pct=stop,
                    rationale=f"Fast MA {fast_now:.4f} crossed above slow MA {slow_now:.4f}.",
                )
            ]

        if crossed_down and context.position_quantity > 0:
            return [
                TradeIntent(
                    symbol=context.symbol,
                    market_type=context.market_type,
                    side=OrderSide.SELL,
                    quantity=context.position_quantity,
                    account_id=context.account_id,
                    mode=context.mode,  # type: ignore[arg-type]
                    stop_loss_pct=stop,
                    rationale=f"Fast MA {fast_now:.4f} crossed below slow MA {slow_now:.4f}.",
                )
            ]

        return []


BUILTIN_STRATEGIES: tuple[StrategyDefinition, ...] = (
    MA_CROSSOVER,
    MEAN_REVERSION,
    MOMENTUM,
    VOLATILITY_BREAKOUT,
    GRID,
    MARKET_MAKING,
    ARBITRAGE,
)

_IMPLEMENTATIONS: dict[str, type[Strategy]] = {
    MA_CROSSOVER.slug: MovingAverageCrossover,
}


def get_strategy(slug: str) -> Strategy | None:
    implementation = _IMPLEMENTATIONS.get(slug)
    return implementation() if implementation else None
