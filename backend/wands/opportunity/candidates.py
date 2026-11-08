"""Candidate generation, research sizing and cost estimation.

Two things in here are deliberately conservative.

The first is sizing. The research budget is a ceiling, not an override: the
stricter of the research budget and the engine's existing per-trade risk applies,
so a $2 research allowance cannot loosen a 0.5% per-trade limit. The exposure
ceiling is applied the same way.

The second is feasibility. With $100 of virtual capital and a 5% exposure
ceiling, a single share of a broad ETF costs more than the ceiling allows. That
is reported as a rejection with the reason attached, not quietly rounded up to
one share, because a test that could not have been opened is not evidence.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from typing import Protocol, Sequence

from wands.opportunity.strategy import (
    STRATEGY_KEY,
    STRATEGY_VERSION,
    BreakoutParameters,
    IntradayBreakout,
)
from wands.opportunity.watchlist import (
    DEFAULT_WATCHLIST,
    WatchlistEntry,
    in_session,
)
from wands.schemas import Candle, CandleInterval, CandleSeries, MarketType

# A stock test buys whole shares. Fractional equity trading exists, but assuming
# it would overstate what a $100 account can actually do.
MIN_STOCK_QUANTITY = Decimal(1)
CRYPTO_QUANTUM = Decimal("0.00000001")

# A bar older than this many intervals is treated as stale. Three intervals
# allows for one missed poll without calling a live series dead.
STALE_INTERVALS = 3


class CandleSource(Protocol):
    def candles(
        self,
        symbol: str,
        interval: CandleInterval | str,
        *,
        market_type: MarketType | str | None = None,
        limit: int = 200,
        refresh_if_empty: bool = True,
    ) -> CandleSeries: ...


@dataclass(frozen=True)
class ResearchBudget:
    """The private research workspace's stated limits.

    ``planned_risk_budget`` is the founder's research allowance. The engine's
    ``per_trade_risk_pct`` and ``max_exposure_pct`` are the existing defaults and
    are not changed here; whichever is stricter wins.
    """

    starting_capital: Decimal = Decimal("100")
    planned_risk_budget: Decimal = Decimal("2.00")
    per_trade_risk_pct: Decimal = Decimal("0.005")
    max_exposure_pct: Decimal = Decimal("0.05")
    max_holding_hours: int = 4

    @property
    def effective_risk_ceiling(self) -> Decimal:
        return min(
            self.planned_risk_budget,
            self.per_trade_risk_pct * self.starting_capital,
        )

    @property
    def exposure_ceiling(self) -> Decimal:
        return self.max_exposure_pct * self.starting_capital

    def as_dict(self) -> dict[str, object]:
        return {
            "startingCapital": str(self.starting_capital),
            "plannedRiskBudget": str(self.planned_risk_budget),
            "effectiveRiskCeiling": str(self.effective_risk_ceiling),
            "exposureCeiling": str(self.exposure_ceiling),
            "perTradeRiskPct": str(self.per_trade_risk_pct),
            "maxExposurePct": str(self.max_exposure_pct),
            "maxHoldingHours": self.max_holding_hours,
        }


@dataclass(frozen=True)
class Sizing:
    quantity: Decimal | None
    notional: Decimal | None
    risk_at_stop: Decimal | None
    binding_constraint: str
    rejected_reason: str | None = None

    @property
    def feasible(self) -> bool:
        return self.rejected_reason is None and self.quantity is not None


@dataclass(frozen=True)
class Costs:
    fee_per_leg: Decimal
    slippage_per_leg: Decimal
    round_trip: Decimal
    fee_bps: float
    slippage_bps: float


@dataclass(frozen=True)
class DataQuality:
    fresh: bool
    age_seconds: float | None
    warnings: tuple[str, ...] = ()


@dataclass(frozen=True)
class Candidate:
    symbol: str
    market_type: MarketType
    label: str
    strategy_key: str
    strategy_version: int
    observed_at: datetime
    reference_price: Decimal
    invalidation_price: Decimal
    target_price: Decimal
    range_high: Decimal
    volume_ratio: float
    breakout_margin: float
    why_qualified: str
    entry_condition: str
    invalidation_condition: str
    exit_condition: str
    max_holding_hours: int
    sizing: Sizing
    costs: Costs
    data_quality: DataQuality
    rank_reason: str


@dataclass(frozen=True)
class Skipped:
    symbol: str
    reason: str


@dataclass(frozen=True)
class CandidateReport:
    """The result of one scan.

    ``candidates`` is empty on a quiet scan. That is a real answer, not a
    failure, and the UI says so rather than filling the space.
    """

    generated_at: datetime
    interval: CandleInterval
    candidates: tuple[Candidate, ...] = ()
    skipped: tuple[Skipped, ...] = ()
    notes: tuple[str, ...] = ()

    @property
    def empty(self) -> bool:
        return not self.candidates


def estimate_costs(
    notional: Decimal, parameters: BreakoutParameters
) -> Costs:
    fee = notional * Decimal(str(parameters.fee_bps)) / Decimal(10000)
    slippage = notional * Decimal(str(parameters.slippage_bps)) / Decimal(10000)
    return Costs(
        fee_per_leg=fee,
        slippage_per_leg=slippage,
        round_trip=(fee + slippage) * 2,
        fee_bps=parameters.fee_bps,
        slippage_bps=parameters.slippage_bps,
    )


def size_position(
    *,
    entry: Decimal,
    invalidation: Decimal,
    market_type: MarketType,
    budget: ResearchBudget,
    available_cash: Decimal,
    parameters: BreakoutParameters,
) -> Sizing:
    """Quantity from the planned loss budget, then capped by the stricter limits.

    The planned loss ceiling is not a guaranteed maximum realised loss: a gap
    through the invalidation level loses more than the distance implies.
    """
    stop_distance = entry - invalidation
    if stop_distance <= 0:
        return Sizing(
            quantity=None,
            notional=None,
            risk_at_stop=None,
            binding_constraint="none",
            rejected_reason="The invalidation level is not below the reference price.",
        )

    risk_ceiling = budget.effective_risk_ceiling
    quantity_by_risk = risk_ceiling / stop_distance
    quantity_by_exposure = budget.exposure_ceiling / entry
    quantity_by_cash = available_cash / entry

    quantity, constraint = min(
        (
            (quantity_by_risk, "planned risk budget"),
            (quantity_by_exposure, "maximum position exposure"),
            (quantity_by_cash, "available hypothetical cash"),
        ),
        key=lambda pair: pair[0],
    )

    if market_type is MarketType.STOCKS:
        whole = quantity.to_integral_value(rounding="ROUND_FLOOR")
        if whole < MIN_STOCK_QUANTITY:
            return Sizing(
                quantity=None,
                notional=None,
                risk_at_stop=None,
                binding_constraint=constraint,
                rejected_reason=(
                    f"One share costs {entry:.2f}, above the "
                    f"{budget.exposure_ceiling:.2f} exposure ceiling, so no whole-share "
                    "position fits the research budget."
                ),
            )
        quantity = whole
    else:
        quantity = quantity.quantize(CRYPTO_QUANTUM, rounding="ROUND_FLOOR")
        if quantity <= 0:
            return Sizing(
                quantity=None,
                notional=None,
                risk_at_stop=None,
                binding_constraint=constraint,
                rejected_reason="The position rounds to zero at the venue's quantity precision.",
            )

    notional = quantity * entry
    return Sizing(
        quantity=quantity,
        notional=notional,
        risk_at_stop=quantity * stop_distance,
        binding_constraint=constraint,
    )


def _data_quality(
    candles: Sequence[Candle], interval: CandleInterval, now: datetime
) -> DataQuality:
    if not candles:
        return DataQuality(fresh=False, age_seconds=None, warnings=("No completed candles.",))
    last = datetime.fromtimestamp(candles[-1].time, tz=UTC)
    age = (now - last).total_seconds()
    interval_seconds = {
        CandleInterval.M1: 60,
        CandleInterval.M5: 300,
        CandleInterval.M15: 900,
        CandleInterval.H1: 3600,
        CandleInterval.H4: 14400,
        CandleInterval.D1: 86400,
    }[interval]
    fresh = age <= interval_seconds * STALE_INTERVALS
    warnings: list[str] = []
    if not fresh:
        warnings.append(
            f"The newest completed candle is {age / 60:.0f} minutes old, so this "
            "series is not suitable for a real-time entry."
        )
    return DataQuality(fresh=fresh, age_seconds=age, warnings=tuple(warnings))


class OpportunityDesk:
    """Scans the watchlist and returns the candidates that qualified.

    The desk reads completed candles and applies one stated rule. It has no
    order path and returns no executable instruction.
    """

    def __init__(
        self,
        source: CandleSource,
        *,
        watchlist: tuple[WatchlistEntry, ...] = DEFAULT_WATCHLIST,
        budget: ResearchBudget | None = None,
        parameters: BreakoutParameters | None = None,
        strategy: IntradayBreakout | None = None,
    ) -> None:
        self._source = source
        self._watchlist = watchlist
        self._budget = budget or ResearchBudget()
        self._parameters = parameters or BreakoutParameters()
        self._strategy = strategy or IntradayBreakout()

    @property
    def budget(self) -> ResearchBudget:
        return self._budget

    @property
    def parameters(self) -> BreakoutParameters:
        return self._parameters

    def scan(
        self,
        *,
        interval: CandleInterval = CandleInterval.M5,
        now: datetime | None = None,
        available_cash: Decimal | None = None,
    ) -> CandidateReport:
        moment = now or datetime.now(UTC)
        cash = available_cash if available_cash is not None else self._budget.starting_capital
        limit = max(self._parameters.required_candles + 5, 60)

        candidates: list[Candidate] = []
        skipped: list[Skipped] = []
        notes: list[str] = []

        for entry in self._watchlist:
            if not in_session(entry, moment):
                skipped.append(Skipped(entry.symbol, "The venue is closed."))
                continue
            try:
                series = self._source.candles(
                    entry.symbol,
                    interval,
                    market_type=entry.market_type,
                    limit=limit,
                )
            except Exception as exc:  # noqa: BLE001 - a provider failure is data, not a crash
                skipped.append(Skipped(entry.symbol, f"Market data unavailable: {exc}"))
                continue

            candles = list(series.candles)
            quality = _data_quality(candles, interval, moment)
            signal = self._strategy.evaluate(candles, self._parameters)
            if not signal.triggered:
                skipped.append(Skipped(entry.symbol, signal.reason))
                continue

            assert signal.reference_price is not None
            assert signal.invalidation_price is not None
            assert signal.target_price is not None
            assert signal.range_high is not None

            sizing = size_position(
                entry=signal.reference_price,
                invalidation=signal.invalidation_price,
                market_type=entry.market_type,
                budget=self._budget,
                available_cash=cash,
                parameters=self._parameters,
            )
            notional = sizing.notional or Decimal(0)
            costs = estimate_costs(notional, self._parameters)

            candidates.append(
                Candidate(
                    symbol=entry.symbol,
                    market_type=entry.market_type,
                    label=entry.label,
                    strategy_key=STRATEGY_KEY,
                    strategy_version=STRATEGY_VERSION,
                    observed_at=datetime.fromtimestamp(candles[-1].time, tz=UTC),
                    reference_price=signal.reference_price,
                    invalidation_price=signal.invalidation_price,
                    target_price=signal.target_price,
                    range_high=signal.range_high,
                    volume_ratio=signal.volume_ratio or 0.0,
                    breakout_margin=signal.breakout_margin or 0.0,
                    why_qualified=signal.reason,
                    entry_condition=(
                        "Enter at the open of the next completed 5-minute candle. "
                        "The triggering close is a reference price, not a fill."
                    ),
                    invalidation_condition=(
                        f"Exit if price trades at or below {signal.invalidation_price:.4f}, "
                        "the low of the triggering candle."
                    ),
                    exit_condition=(
                        f"Target {signal.target_price:.4f}, or exit at the "
                        f"{self._budget.max_holding_hours}-hour time stop, whichever comes first."
                    ),
                    max_holding_hours=self._budget.max_holding_hours,
                    sizing=sizing,
                    costs=costs,
                    data_quality=quality,
                    rank_reason=(
                        f"Volume {(signal.volume_ratio or 0.0):.2f}x its 20-candle average, "
                        f"close {((signal.breakout_margin or 0.0) * 100):.2f}% above the range high."
                    ),
                )
            )

        # Ordering is a stated pair of measurements, not a score: volume relative
        # to its own average first, then how far the close cleared the range.
        candidates.sort(key=lambda c: (c.volume_ratio, c.breakout_margin), reverse=True)

        if not candidates:
            notes.append("No qualifying opportunities found.")

        return CandidateReport(
            generated_at=moment,
            interval=interval,
            candidates=tuple(candidates),
            skipped=tuple(skipped),
            notes=tuple(notes),
        )
