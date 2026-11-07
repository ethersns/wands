"""Portfolio strategy simulation over daily bars.

``validation.py`` answers a disclosure question: given a signal that became
public at a known moment, what did the price do next. This module answers a
different one: given a rule that reads only the price series, what would a
portfolio have done if it had followed that rule.

The two have different failure modes, which is why they are separate. An event
study can leak the future through its eligibility date. A strategy can leak it
through its own indicator: a moving average that includes today's close, acted
on at today's open, is a time machine. So the timing rule here is fixed and
narrow.

*Indicators read bars up to and including the decision bar's close.* Nothing
later is visible to the rule.

*Orders fill at the next bar's open.* A decision made on a close cannot be
filled at that same close, and pretending otherwise is the most common way a
backtest invents an edge that does not exist.

*Costs are charged on both legs.* Entry and exit each pay the configured basis
points, so a rule that trades often has to earn its turnover rather than being
handed it.

*The benchmark is the same instrument, held.* Beating buy-and-hold on the same
symbol is the minimum claim a timing rule has to make. Comparing a long-only
equity rule against cash would flatter it into looking skilful.

*Parameters are not fitted here.* The defaults are stated, the split is by time,
and both halves are reported. A grid search over one sample produces a number
that describes that sample and nothing else.

This is a research baseline. It is not an automated trading instruction, and
nothing in this module places an order.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from wands.db.models import MarketCandleRow
from wands.intelligence import quant

TREND = "trend_following"
MEAN_REVERSION = "mean_reversion"
STRATEGY_KINDS: tuple[str, ...] = (TREND, MEAN_REVERSION)

RULE_MOVING_AVERAGE = "moving_average"
RULE_BREAKOUT = "breakout"

EXIT_SIGNAL = "signal"
EXIT_END_OF_DATA = "end_of_data"

STATUS_COMPLETE = "complete"
STATUS_INSUFFICIENT = "insufficient_data"
STATUS_NO_PRICE_DATA = "no_price_data"

TRADING_DAYS = 252
DAILY_INTERVAL = "1d"


# --------------------------------------------------------------------------
# Inputs
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Bar:
    """One daily bar, reduced to what a simulation needs."""

    at: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float = 0.0


class CandleBarProvider:
    """Daily bars from the engine's own candle store.

    The candle series is also the trading calendar: a session exists because a
    bar exists. If there is no bar there is no price we can claim to have
    traded at, so a gap stays a gap rather than being interpolated.
    """

    def __init__(
        self,
        session: Session,
        *,
        interval: str = DAILY_INTERVAL,
        market_type: str = "stocks",
    ) -> None:
        self.session = session
        self.interval = interval
        self.market_type = market_type

    def bars(
        self,
        symbol: str,
        start: datetime | None = None,
        end: datetime | None = None,
    ) -> list[Bar]:
        statement = select(MarketCandleRow).where(
            MarketCandleRow.symbol == symbol.upper(),
            MarketCandleRow.interval == self.interval,
        )
        if start is not None:
            statement = statement.where(MarketCandleRow.open_time >= start)
        if end is not None:
            statement = statement.where(MarketCandleRow.open_time <= end)
        rows = self.session.scalars(
            statement.order_by(MarketCandleRow.open_time, MarketCandleRow.provider)
        ).all()

        bars: list[Bar] = []
        seen: set[datetime] = set()
        for row in rows:
            moment = _as_utc(row.open_time)
            if moment in seen:
                # Two providers, one session. The first by provider name wins so
                # the series is deterministic rather than insertion-ordered.
                continue
            seen.add(moment)
            bars.append(
                Bar(
                    at=moment,
                    open=float(row.open),
                    high=float(row.high),
                    low=float(row.low),
                    close=float(row.close),
                    volume=float(row.volume or 0),
                )
            )
        return bars


@dataclass(frozen=True)
class StrategyParameters:
    """Everything that determines a strategy's answer."""

    kind: str = TREND
    rule: str = RULE_MOVING_AVERAGE
    # Trend following.
    fast_window: int = 20
    slow_window: int = 100
    breakout_window: int = 55
    # Mean reversion.
    lookback: int = 20
    entry_z: float = -2.0
    exit_z: float = 0.0
    volatility_window: int = 20
    max_volatility: float | None = None
    # Shared.
    position_fraction: float = 1.0
    cost_bps: float = 11.0

    def warmup(self) -> int:
        """Bars that must pass before the rule can produce a signal."""
        if self.kind == TREND:
            if self.rule == RULE_BREAKOUT:
                return max(self.breakout_window, 1)
            return max(self.slow_window, self.fast_window, 1)
        return max(self.lookback, self.volatility_window, 1)

    def validate(self) -> list[str]:
        problems: list[str] = []
        if self.kind not in STRATEGY_KINDS:
            problems.append(f"Unknown strategy kind {self.kind!r}.")
        if self.kind == TREND and self.rule not in (RULE_MOVING_AVERAGE, RULE_BREAKOUT):
            problems.append(f"Unknown trend rule {self.rule!r}.")
        if self.fast_window < 1 or self.slow_window < 1:
            problems.append("Moving-average windows must be at least one bar.")
        if self.fast_window >= self.slow_window:
            problems.append("The fast window must be shorter than the slow window.")
        if self.breakout_window < 1:
            problems.append("The breakout window must be at least one bar.")
        if self.lookback < 2:
            problems.append("The mean-reversion lookback must be at least two bars.")
        if self.volatility_window < 2:
            problems.append("The volatility window must be at least two bars.")
        if not 0.0 < self.position_fraction <= 1.0:
            problems.append("Position fraction must be in (0, 1].")
        if self.cost_bps < 0:
            problems.append("Costs cannot be negative.")
        return problems

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> StrategyParameters:
        """Rebuild from the camelCase form ``as_dict`` produces.

        The stored experiment parameters are camelCase because they are read by
        the API and the browser. Reconstructing the dataclass from them keeps one
        representation rather than two that can drift.
        """
        mapping = {
            "fastWindow": "fast_window",
            "slowWindow": "slow_window",
            "breakoutWindow": "breakout_window",
            "entryZ": "entry_z",
            "exitZ": "exit_z",
            "volatilityWindow": "volatility_window",
            "maxVolatility": "max_volatility",
            "positionFraction": "position_fraction",
            "costBps": "cost_bps",
        }
        kwargs: dict[str, Any] = {}
        for key, value in payload.items():
            name = mapping.get(key, key)
            if name in cls.__dataclass_fields__:
                kwargs[name] = value
        return cls(**kwargs)

    def as_dict(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "rule": self.rule,
            "fastWindow": self.fast_window,
            "slowWindow": self.slow_window,
            "breakoutWindow": self.breakout_window,
            "lookback": self.lookback,
            "entryZ": self.entry_z,
            "exitZ": self.exit_z,
            "volatilityWindow": self.volatility_window,
            "maxVolatility": self.max_volatility,
            "positionFraction": self.position_fraction,
            "costBps": self.cost_bps,
        }


# --------------------------------------------------------------------------
# Outputs
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class StrategyTrade:
    """One hypothetical round trip."""

    entry_at: datetime
    entry_price: float
    exit_at: datetime
    exit_price: float
    gross_return: float
    net_return: float
    cost: float
    bars_held: int
    exit_reason: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "entryAt": self.entry_at.isoformat(),
            "entryPrice": self.entry_price,
            "exitAt": self.exit_at.isoformat(),
            "exitPrice": self.exit_price,
            "grossReturn": self.gross_return,
            "netReturn": self.net_return,
            "cost": self.cost,
            "barsHeld": self.bars_held,
            "exitReason": self.exit_reason,
        }


@dataclass
class StrategyResult:
    """The full answer for one strategy on one instrument."""

    symbol: str
    parameters: StrategyParameters
    status: str = STATUS_COMPLETE
    trades: list[StrategyTrade] = field(default_factory=list)
    equity_curve: list[float] = field(default_factory=list)
    # Buy-and-hold of the same instrument, marked at each close from the first
    # open. Plotted beside the strategy so the comparison is visible rather than
    # asserted in a footnote.
    benchmark_curve: list[float] = field(default_factory=list)
    # Buy-and-hold restricted to the bars this rule was actually invested. A
    # timing rule that is in the market 16% of the time cannot be judged against
    # a benchmark that is in the market 100% of the time, so this curve holds the
    # same instrument over the same windows and sits in cash elsewhere.
    matched_curve: list[float] = field(default_factory=list)
    curve_dates: list[datetime] = field(default_factory=list)
    metrics: dict[str, Any] = field(default_factory=dict)
    coverage: dict[str, Any] = field(default_factory=dict)
    flags: list[str] = field(default_factory=list)

    @property
    def net_returns(self) -> list[float]:
        return [trade.net_return for trade in self.trades]

    def as_dict(self) -> dict[str, Any]:
        return {
            "symbol": self.symbol,
            "status": self.status,
            "parameters": self.parameters.as_dict(),
            "metrics": self.metrics,
            "coverage": self.coverage,
            "flags": list(self.flags),
            "trades": [trade.as_dict() for trade in self.trades],
            "equityCurve": self.equity_curve,
            "benchmarkCurve": self.benchmark_curve,
            "matchedCurve": self.matched_curve,
            "curveDates": [moment.isoformat() for moment in self.curve_dates],
        }


# --------------------------------------------------------------------------
# Indicators
# --------------------------------------------------------------------------


def _sma(values: Sequence[float], window: int) -> list[float | None]:
    """Simple moving average, ``None`` until the window is full."""
    out: list[float | None] = [None] * len(values)
    if window < 1:
        return out
    running = 0.0
    for index, value in enumerate(values):
        running += value
        if index >= window:
            running -= values[index - window]
        if index >= window - 1:
            out[index] = running / window
    return out


def _rolling_std(values: Sequence[float], window: int) -> list[float | None]:
    """Sample standard deviation over a trailing window."""
    out: list[float | None] = [None] * len(values)
    if window < 2:
        return out
    for index in range(window - 1, len(values)):
        chunk = values[index - window + 1 : index + 1]
        mean = sum(chunk) / window
        variance = sum((value - mean) ** 2 for value in chunk) / (window - 1)
        out[index] = math.sqrt(variance)
    return out


def _rolling_volatility(closes: Sequence[float], window: int) -> list[float | None]:
    """Annualised realised volatility of daily returns."""
    returns = [0.0] + [
        (closes[index] / closes[index - 1] - 1.0) if closes[index - 1] > 0 else 0.0
        for index in range(1, len(closes))
    ]
    std = _rolling_std(returns, window)
    return [value * math.sqrt(TRADING_DAYS) if value is not None else None for value in std]


def target_states(bars: Sequence[Bar], parameters: StrategyParameters) -> list[int]:
    """The desired position at each bar's close: 1 long, 0 flat.

    ``state[i]`` is computed from ``bars[0..i]`` only. The simulation acts on it
    at ``bars[i + 1].open``, which is the earliest price an observer of that
    close could have got.
    """
    count = len(bars)
    state = [0] * count
    if count == 0:
        return state
    closes = [bar.close for bar in bars]

    if parameters.kind == TREND and parameters.rule == RULE_MOVING_AVERAGE:
        fast = _sma(closes, parameters.fast_window)
        slow = _sma(closes, parameters.slow_window)
        for index in range(count):
            if fast[index] is None or slow[index] is None:
                continue
            state[index] = 1 if fast[index] > slow[index] else 0
        return state

    if parameters.kind == TREND and parameters.rule == RULE_BREAKOUT:
        window = parameters.breakout_window
        for index in range(count):
            if index < window:
                continue
            prior_high = max(bar.high for bar in bars[index - window : index])
            prior_low = min(bar.low for bar in bars[index - window : index])
            if closes[index] > prior_high:
                state[index] = 1
            elif closes[index] < prior_low:
                state[index] = 0
            else:
                state[index] = state[index - 1]
        return state

    # Mean reversion: buy a stretched deviation, leave when it normalises.
    mean = _sma(closes, parameters.lookback)
    deviation = _rolling_std(closes, parameters.lookback)
    volatility = _rolling_volatility(closes, parameters.volatility_window)
    holding = 0
    for index in range(count):
        if mean[index] is None or deviation[index] is None or deviation[index] <= 0:
            state[index] = holding
            continue
        z_score = (closes[index] - mean[index]) / deviation[index]
        if holding == 0:
            too_wild = (
                parameters.max_volatility is not None
                and volatility[index] is not None
                and volatility[index] > parameters.max_volatility
            )
            if z_score <= parameters.entry_z and not too_wild:
                holding = 1
        elif z_score >= parameters.exit_z:
            holding = 0
        state[index] = holding
    return state


# --------------------------------------------------------------------------
# Simulation
# --------------------------------------------------------------------------


def simulate(
    bars: Sequence[Bar],
    parameters: StrategyParameters,
    *,
    symbol: str = "",
) -> StrategyResult:
    """Run one strategy over one instrument's daily bars."""
    problems = parameters.validate()
    if problems:
        raise ValueError("; ".join(problems))

    result = StrategyResult(symbol=symbol.upper(), parameters=parameters)

    if not bars:
        result.status = STATUS_NO_PRICE_DATA
        result.flags.append("No daily bars were supplied, so nothing was simulated.")
        return result

    warmup = parameters.warmup()
    if len(bars) <= warmup + 1:
        result.status = STATUS_INSUFFICIENT
        result.flags.append(
            f"{len(bars)} bars is not enough for a {warmup}-bar warmup plus one "
            "executable trade, so no result is reported."
        )
        result.coverage = _coverage(bars, 0)
        return result

    states = target_states(bars, parameters)
    cost_rate = parameters.cost_bps / 10_000.0

    cash = 1.0
    shares = 0.0
    entry_at: datetime | None = None
    entry_price: float | None = None
    entry_notional = 0.0
    entry_cost = 0.0
    entry_index = 0
    pending: str | None = None
    curve: list[float] = []
    dates: list[datetime] = []
    trades: list[StrategyTrade] = []
    total_costs = 0.0
    bars_in_market = 0
    held: list[bool] = []

    for index, bar in enumerate(bars):
        # Fill the order decided at the previous close, at this bar's open.
        if pending == "enter" and shares == 0.0 and bar.open > 0:
            notional = cash * parameters.position_fraction
            cost = notional * cost_rate
            shares = (notional - cost) / bar.open
            cash -= notional
            total_costs += cost
            entry_at = bar.at
            entry_price = bar.open
            entry_notional = notional
            entry_cost = cost
            entry_index = index
        elif pending == "exit" and shares > 0.0 and bar.open > 0:
            notional = shares * bar.open
            cost = notional * cost_rate
            cash += notional - cost
            total_costs += cost
            trades.append(
                _close_trade(
                    entry_at=entry_at,
                    entry_price=entry_price,
                    entry_notional=entry_notional,
                    entry_cost=entry_cost,
                    exit_at=bar.at,
                    exit_price=bar.open,
                    exit_cost=cost,
                    bars_held=index - entry_index,
                    reason=EXIT_SIGNAL,
                )
            )
            shares = 0.0
            entry_at = None
            entry_price = None
        pending = None

        if shares > 0.0:
            bars_in_market += 1
        held.append(shares > 0.0)
        curve.append(cash + shares * bar.close)
        dates.append(bar.at)

        # Decide at this close for the next open. The last bar has no next open.
        if index + 1 < len(bars):
            target = states[index]
            if target == 1 and shares == 0.0:
                pending = "enter"
            elif target == 0 and shares > 0.0:
                pending = "exit"

    # A position still open at the end is closed at the final close, and the
    # exit is labelled so it is not mistaken for a rule-generated exit.
    if shares > 0.0:
        last = bars[-1]
        notional = shares * last.close
        cost = notional * cost_rate
        cash += notional - cost
        total_costs += cost
        trades.append(
            _close_trade(
                entry_at=entry_at,
                entry_price=entry_price,
                entry_notional=entry_notional,
                entry_cost=entry_cost,
                exit_at=last.at,
                exit_price=last.close,
                exit_cost=cost,
                bars_held=len(bars) - 1 - entry_index,
                reason=EXIT_END_OF_DATA,
            )
        )
        shares = 0.0
        curve[-1] = cash

    result.trades = trades
    result.equity_curve = curve
    result.curve_dates = dates
    first_open = bars[0].open
    result.benchmark_curve = (
        [bar.close / first_open for bar in bars] if first_open > 0 else []
    )
    result.matched_curve = _matched_curve(bars, held)
    result.metrics = _metrics(
        bars=bars,
        curve=curve,
        trades=trades,
        total_costs=total_costs,
        bars_in_market=bars_in_market,
        parameters=parameters,
        matched_curve=result.matched_curve,
    )
    result.coverage = _coverage(bars, bars_in_market)
    result.flags = _flags(result, bars, warmup)
    return result


def _close_trade(
    *,
    entry_at: datetime | None,
    entry_price: float | None,
    entry_notional: float,
    entry_cost: float,
    exit_at: datetime,
    exit_price: float,
    exit_cost: float,
    bars_held: int,
    reason: str,
) -> StrategyTrade:
    """Turn an open position into a round trip with both legs charged."""
    assert entry_at is not None and entry_price is not None
    shares = (entry_notional - entry_cost) / entry_price
    proceeds = shares * exit_price - exit_cost
    return StrategyTrade(
        entry_at=entry_at,
        entry_price=entry_price,
        exit_at=exit_at,
        exit_price=exit_price,
        gross_return=(exit_price - entry_price) / entry_price,
        net_return=(proceeds - entry_notional) / entry_notional,
        cost=entry_cost + exit_cost,
        bars_held=bars_held,
        exit_reason=reason,
    )


def _matched_curve(bars: Sequence[Bar], held: Sequence[bool]) -> list[float]:
    """Buy-and-hold of the same instrument, only on the bars the rule held it.

    Marked close to close, so an entry bar contributes the move from the prior
    close rather than from the fill price. That keeps the curve a pure statement
    about *which bars* the rule chose, with the fill mechanics left to the
    strategy's own equity curve.
    """
    if not bars:
        return []
    curve = [1.0]
    for index in range(1, len(bars)):
        previous = bars[index - 1].close
        current = bars[index].close
        step = (current / previous) if held[index] and previous > 0 else 1.0
        curve.append(curve[-1] * step)
    return curve


def _metrics(
    *,
    bars: Sequence[Bar],
    curve: Sequence[float],
    trades: Sequence[StrategyTrade],
    total_costs: float,
    bars_in_market: int,
    parameters: StrategyParameters,
    matched_curve: Sequence[float] = (),
) -> dict[str, Any]:
    """Performance measures, each reported only when its prerequisites exist."""
    daily_returns = [
        (curve[index] / curve[index - 1] - 1.0) if curve[index - 1] > 0 else 0.0
        for index in range(1, len(curve))
    ]
    trade_returns = [trade.net_return for trade in trades]

    total_return = (curve[-1] / curve[0] - 1.0) if curve and curve[0] > 0 else None
    drawdown = quant.max_drawdown(curve)
    sharpe = quant.sharpe_ratio(daily_returns, periods_per_year=TRADING_DAYS)
    volatility = (
        math.sqrt(sum((value - sum(daily_returns) / len(daily_returns)) ** 2 for value in daily_returns) / (len(daily_returns) - 1))
        * math.sqrt(TRADING_DAYS)
        if len(daily_returns) > 1
        else None
    )

    # Buy and hold of the same instrument over the same bars: the minimum bar a
    # timing rule has to clear.
    first_open = bars[0].open
    last_close = bars[-1].close
    benchmark_return = (
        (last_close - first_open) / first_open if first_open > 0 else None
    )

    # The same instrument held only over the bars this rule was invested. This is
    # the comparison that isolates bar selection from time in market.
    matched_return = (
        (matched_curve[-1] - 1.0) if matched_curve and matched_curve[0] > 0 else None
    )

    stats = quant.describe(trade_returns)
    interval = quant.mean_confidence_interval(trade_returns)
    test = quant.significance(trade_returns)

    return {
        "totalReturn": total_return,
        "benchmarkReturn": benchmark_return,
        "excessReturn": (
            total_return - benchmark_return
            if total_return is not None and benchmark_return is not None
            else None
        ),
        "matchedBenchmarkReturn": matched_return,
        "excessVsMatched": (
            total_return - matched_return
            if total_return is not None and matched_return is not None
            else None
        ),
        "tradeCount": len(trades),
        "averageTradeReturn": stats.mean,
        "medianTradeReturn": stats.median,
        "winRate": stats.hit_rate,
        "profitFactor": stats.profit_factor,
        # Sum of per-trade cost fractions. It is not a portfolio cost and must not
        # be read as one: 75 trades each paying 0.3% of their own notional is not
        # a 22% loss on the account. Portfolio-level cost drag is measured in the
        # study by re-running the same rule at zero cost.
        "totalCosts": total_costs,
        "averageCostPerTrade": (total_costs / len(trades)) if trades else None,
        "maxDrawdown": drawdown.max_drawdown,
        "drawdownPeakIndex": drawdown.peak_index,
        "drawdownTroughIndex": drawdown.trough_index,
        "sharpe": sharpe.as_dict(),
        "volatility": volatility,
        "exposure": (bars_in_market / len(bars)) if bars else None,
        "tradeReturnInterval": interval.as_dict(),
        "tradeReturnSignificance": test.as_dict(),
        "smallSample": stats.small_sample,
        "positionFraction": parameters.position_fraction,
        "costBps": parameters.cost_bps,
    }


def _coverage(bars: Sequence[Bar], bars_in_market: int) -> dict[str, Any]:
    if not bars:
        return {"bars": 0, "start": None, "end": None, "barsInMarket": 0}
    return {
        "bars": len(bars),
        "start": bars[0].at.isoformat(),
        "end": bars[-1].at.isoformat(),
        "barsInMarket": bars_in_market,
        "exposure": round(bars_in_market / len(bars), 4),
    }


def _flags(
    result: StrategyResult, bars: Sequence[Bar], warmup: int
) -> list[str]:
    flags: list[str] = []
    if result.status == STATUS_INSUFFICIENT:
        return flags
    if not result.trades:
        flags.append(
            "The rule never opened a position over this window, so there is no "
            "trade to measure. That is a result, not a missing one."
        )
    if len(result.trades) < quant.SMALL_SAMPLE:
        flags.append(
            f"Only {len(result.trades)} trades were simulated. A mean over fewer "
            f"than {quant.SMALL_SAMPLE} trades is reported but is not evidence of an edge."
        )
    if warmup >= len(bars) // 2:
        flags.append(
            f"The {warmup}-bar warmup consumes most of the {len(bars)}-bar window, "
            "so the evaluated period is short."
        )
    flags.append(
        "Hypothetical research result. Not realised account P&L, and not an "
        "instruction to trade."
    )
    return flags


def _as_utc(moment: datetime) -> datetime:
    from datetime import UTC

    if moment.tzinfo is None:
        return moment.replace(tzinfo=UTC)
    return moment.astimezone(UTC)
