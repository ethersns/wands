"""One deterministic intraday breakout rule.

The rule is stated in full here so it can be checked without reading the
implementation, and so a later change is visibly a new version rather than a
quiet edit.

    Name             intraday_breakout
    Version          1
    Direction        long only
    Timeframe        5-minute completed candles
    Range lookback   20 completed candles
    Volume lookback  20 completed candles
    Trigger          the last completed candle closes above the highest high of
                     the 20 candles before it, on volume at least 1.5x the
                     20-candle average
    Entry            the open of the next candle, never the triggering close
    Invalidation     the low of the triggering candle
    Target           2x the entry-to-invalidation distance
    Time stop        4 hours, capped at the session close for stocks
    Costs            fee_bps plus slippage_bps on entry and again on exit

Only completed candles are read. The trigger candle is the last one in the
series and the entry is the next candle's open, so a signal can never be filled
at a price that was already known when it fired.

The rule is not fitted to anything. The lookbacks and the volume multiple are
stated defaults, not the best of a search, and no parameter was chosen by
looking at how the rule performed.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Sequence

from wands.schemas import Candle

STRATEGY_KEY = "intraday_breakout"
STRATEGY_NAME = "Intraday breakout"
STRATEGY_VERSION = 1


@dataclass(frozen=True)
class BreakoutParameters:
    range_lookback: int = 20
    volume_lookback: int = 20
    volume_multiple: float = 1.5
    reward_multiple: float = 2.0
    max_holding_bars: int = 48
    fee_bps: float = 5.0
    slippage_bps: float = 10.0

    @property
    def required_candles(self) -> int:
        return max(self.range_lookback, self.volume_lookback) + 1

    def as_dict(self) -> dict[str, Any]:
        return {
            "rangeLookback": self.range_lookback,
            "volumeLookback": self.volume_lookback,
            "volumeMultiple": self.volume_multiple,
            "rewardMultiple": self.reward_multiple,
            "maxHoldingBars": self.max_holding_bars,
            "feeBps": self.fee_bps,
            "slippageBps": self.slippage_bps,
        }


@dataclass(frozen=True)
class BreakoutSignal:
    """What the rule saw on the last completed candle.

    ``reference_price`` is the triggering close. It is a reference for
    provisional sizing only: the entry is the next candle's open, which does not
    exist yet, so no entry price is claimed here.
    """

    triggered: bool
    reason: str
    reference_price: Decimal | None = None
    invalidation_price: Decimal | None = None
    target_price: Decimal | None = None
    range_high: Decimal | None = None
    volume_ratio: float | None = None
    breakout_margin: float | None = None
    trigger_time: int | None = None


class IntradayBreakout:
    """The rule described in this module's docstring, and nothing else."""

    def evaluate(
        self, candles: Sequence[Candle], parameters: BreakoutParameters
    ) -> BreakoutSignal:
        needed = parameters.required_candles
        if len(candles) < needed:
            return BreakoutSignal(
                triggered=False,
                reason=(
                    f"The rule needs {needed} completed candles and "
                    f"{len(candles)} are available."
                ),
            )

        trigger = candles[-1]
        history = candles[-1 - parameters.range_lookback : -1]
        volume_history = candles[-1 - parameters.volume_lookback : -1]

        range_high = max(candle.high for candle in history)
        average_volume = sum(
            (candle.volume for candle in volume_history), Decimal(0)
        ) / Decimal(len(volume_history))
        if average_volume <= 0:
            return BreakoutSignal(
                triggered=False,
                reason="Average volume is zero, so the volume filter cannot be applied.",
            )

        volume_ratio = float(trigger.volume / average_volume)
        if trigger.close <= range_high:
            return BreakoutSignal(
                triggered=False,
                reason="The last completed candle did not close above the prior range high.",
                range_high=range_high,
                volume_ratio=volume_ratio,
                trigger_time=trigger.time,
            )
        if volume_ratio < parameters.volume_multiple:
            return BreakoutSignal(
                triggered=False,
                reason=(
                    f"Volume was {volume_ratio:.2f}x the average, below the "
                    f"{parameters.volume_multiple:.2f}x filter."
                ),
                range_high=range_high,
                volume_ratio=volume_ratio,
                trigger_time=trigger.time,
            )

        invalidation = trigger.low
        stop_distance = trigger.close - invalidation
        if stop_distance <= 0:
            return BreakoutSignal(
                triggered=False,
                reason="The triggering candle has no range, so there is no invalidation level.",
                range_high=range_high,
                volume_ratio=volume_ratio,
                trigger_time=trigger.time,
            )

        target = trigger.close + stop_distance * Decimal(str(parameters.reward_multiple))
        margin = float(stop_distance / trigger.close) if trigger.close else 0.0

        return BreakoutSignal(
            triggered=True,
            reason=(
                f"Closed above the {parameters.range_lookback}-candle high on "
                f"{volume_ratio:.2f}x average volume."
            ),
            reference_price=trigger.close,
            invalidation_price=invalidation,
            target_price=target,
            range_high=range_high,
            volume_ratio=volume_ratio,
            breakout_margin=margin,
            trigger_time=trigger.time,
        )
