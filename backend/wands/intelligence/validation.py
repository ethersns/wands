"""Signal validation: did the signal precede a move that could have been traded?

The question this module answers is narrow on purpose. Not "is this signal
interesting" but "if an observer had seen this signal at the moment it became
public, entered at the next price they could actually have got, and exited after
N sessions, what would have happened, after costs, relative to a benchmark".

Five rules make the answer trustworthy.

*Eligibility is availability, not the transaction date.* A Form 4 reports a trade
from last week and is published today. The signal exists today. Using the
transaction date would let a backtest buy at a price that was already history.

*Entry is the next observable price.* The entry is the open of the first session
that begins strictly after ``public_available_at``. A signal published at 10:00
cannot be filled at that morning's 09:30 open, so it waits for tomorrow.

*Costs are charged, not mentioned.* Spread, commission and slippage are deducted
from every simulated trade. A gross edge smaller than the round trip is a loss.

*Missing data is a recorded outcome.* A signal with no price series, or a series
that ends before the exit, produces a row with a status rather than disappearing
from the sample. Coverage is reported next to the result so a flattering mean
over eleven observations cannot be mistaken for a finding.

*In-sample and out-of-sample are separate.* The split is by availability time and
is reported for both halves. Nothing is fitted here, but the split is what makes
a later fitting step honest.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session

from wands.config import Settings
from wands.db.models import MarketCandleRow
from wands.intelligence import quant
from wands.logging import get_logger

logger = get_logger(__name__)

DAILY_INTERVAL = "1d"

# Trade outcomes. ``ok`` is the only one that contributes a return.
TRADE_OK = "ok"
TRADE_MISSING_PRICE = "missing_price"
TRADE_MISSING_BENCHMARK = "missing_benchmark"
TRADE_DELISTED = "delisted"

# Result-level statuses.
RESULT_COMPLETE = "complete"
RESULT_INSUFFICIENT = "insufficient_data"
RESULT_NO_PRICE_DATA = "no_price_data"


@dataclass(frozen=True)
class PricePoint:
    """One daily bar, reduced to what a simulation needs."""

    at: datetime
    open: float
    close: float


class PriceProvider(Protocol):
    """A source of daily bars.

    Implementations must return bars in ascending time order and must not
    interpolate. A missing session is missing.
    """

    def daily(self, symbol: str, start: datetime, end: datetime) -> list[PricePoint]: ...


class CandlePriceProvider:
    """Daily bars from the engine's own candle store.

    The candle series is also the trading calendar: a session exists because a
    bar exists. That is the honest reading — if there is no bar, there is no
    price we can claim to have traded at.
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

    def daily(self, symbol: str, start: datetime, end: datetime) -> list[PricePoint]:
        rows = self.session.scalars(
            select(MarketCandleRow)
            .where(
                MarketCandleRow.symbol == symbol.upper(),
                MarketCandleRow.interval == self.interval,
                MarketCandleRow.open_time >= start,
                MarketCandleRow.open_time <= end,
            )
            .order_by(MarketCandleRow.open_time, MarketCandleRow.provider)
        ).all()

        points: list[PricePoint] = []
        seen: set[datetime] = set()
        for row in rows:
            moment = _as_utc(row.open_time)
            if moment in seen:
                # Two providers, one session. The first by provider name wins so
                # the series is deterministic rather than insertion-ordered.
                continue
            seen.add(moment)
            points.append(
                PricePoint(
                    at=moment,
                    open=float(row.open),
                    close=float(row.close),
                )
            )
        return points


@dataclass(frozen=True)
class SignalObservation:
    """A signal as the validator sees it."""

    signal_id: str
    category: str
    symbol: str
    public_available_at: datetime
    score: float | None = None


@dataclass(frozen=True)
class SimulatedTrade:
    """One hypothetical round trip."""

    signal_id: str
    symbol: str
    horizon_days: int
    entry_at: datetime | None
    entry_price: float | None
    exit_at: datetime | None
    exit_price: float | None
    gross_return: float | None
    benchmark_return: float | None
    net_return: float | None
    cost_bps: float
    status: str
    notes: str = ""

    @property
    def excess_return(self) -> float | None:
        if self.net_return is None or self.benchmark_return is None:
            return None
        return self.net_return - self.benchmark_return

    def as_dict(self) -> dict[str, Any]:
        return {
            "signalId": self.signal_id,
            "symbol": self.symbol,
            "horizonDays": self.horizon_days,
            "entryAt": self.entry_at.isoformat() if self.entry_at else None,
            "entryPrice": self.entry_price,
            "exitAt": self.exit_at.isoformat() if self.exit_at else None,
            "exitPrice": self.exit_price,
            "grossReturn": self.gross_return,
            "benchmarkReturn": self.benchmark_return,
            "netReturn": self.net_return,
            "costBps": self.cost_bps,
            "status": self.status,
            "notes": self.notes,
        }


@dataclass
class HorizonEvaluation:
    """Everything measured at one holding period."""

    horizon_days: int
    trades: list[SimulatedTrade] = field(default_factory=list)
    stats: quant.DistributionStats | None = None
    interval: quant.Interval | None = None
    significance: quant.Significance | None = None
    benchmark_stats: quant.DistributionStats | None = None
    excess_stats: quant.DistributionStats | None = None
    excess_interval: quant.Interval | None = None
    excess_significance: quant.Significance | None = None
    coverage: dict[str, Any] = field(default_factory=dict)

    @property
    def net_returns(self) -> list[float]:
        return [trade.net_return for trade in self.trades if trade.net_return is not None]

    @property
    def excess_returns(self) -> list[float]:
        return [
            value
            for value in (trade.excess_return for trade in self.trades)
            if value is not None
        ]

    def as_dict(self) -> dict[str, Any]:
        return {
            "horizonDays": self.horizon_days,
            "sampleSize": len(self.net_returns),
            "coverage": self.coverage,
            "descriptive": self.stats.as_dict() if self.stats else None,
            "meanInterval": self.interval.as_dict() if self.interval else None,
            "significance": self.significance.as_dict() if self.significance else None,
            "benchmark": self.benchmark_stats.as_dict() if self.benchmark_stats else None,
            "excess": self.excess_stats.as_dict() if self.excess_stats else None,
            "excessInterval": self.excess_interval.as_dict() if self.excess_interval else None,
            "excessSignificance": (
                self.excess_significance.as_dict() if self.excess_significance else None
            ),
        }


@dataclass
class SplitEvaluation:
    """One half of the in-sample / out-of-sample split."""

    label: str
    start: datetime | None
    end: datetime | None
    horizons: list[HorizonEvaluation] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "label": self.label,
            "start": self.start.isoformat() if self.start else None,
            "end": self.end.isoformat() if self.end else None,
            "horizons": [horizon.as_dict() for horizon in self.horizons],
        }


@dataclass
class ValidationResult:
    """The full answer for one signal category."""

    category: str
    status: str
    horizons: list[HorizonEvaluation] = field(default_factory=list)
    splits: list[SplitEvaluation] = field(default_factory=list)
    sample_size: int = 0
    coverage: dict[str, Any] = field(default_factory=dict)
    flags: list[str] = field(default_factory=list)
    multiple_testing: quant.MultipleTestingReport | None = None
    overlap: dict[str, Any] = field(default_factory=dict)
    benchmark: str = ""
    cost_bps: float = 0.0

    def as_dict(self) -> dict[str, Any]:
        return {
            "category": self.category,
            "status": self.status,
            "benchmark": self.benchmark,
            "costBps": self.cost_bps,
            "sampleSize": self.sample_size,
            "coverage": self.coverage,
            "flags": list(self.flags),
            "overlap": self.overlap,
            "multipleTesting": (
                self.multiple_testing.as_dict() if self.multiple_testing else None
            ),
            "horizons": [horizon.as_dict() for horizon in self.horizons],
            "splits": [split.as_dict() for split in self.splits],
        }


class SignalValidator:
    """Runs the event study and the cost-adjusted trade simulation."""

    def __init__(
        self,
        session: Session,
        settings: Settings,
        *,
        prices: PriceProvider | None = None,
    ) -> None:
        self.session = session
        self.settings = settings
        self.prices = prices or CandlePriceProvider(session)

    # -- public ------------------------------------------------------------

    def evaluate(
        self,
        observations: Sequence[SignalObservation],
        *,
        category: str = "",
        horizons: Sequence[int] | None = None,
        benchmark: str | None = None,
        cost_bps: float | None = None,
        split: bool = True,
    ) -> ValidationResult:
        periods = list(horizons or self.settings.validation_horizons)
        bench = (benchmark or self.settings.intelligence_validation_benchmark).upper()
        costs = (
            float(cost_bps)
            if cost_bps is not None
            else float(self.settings.validation_cost_bps)
        )

        result = ValidationResult(
            category=category or _common_category(observations),
            status=RESULT_COMPLETE,
            benchmark=bench,
            cost_bps=costs,
        )

        if not observations:
            result.status = RESULT_INSUFFICIENT
            result.flags.append("No signals were supplied, so nothing was measured.")
            return result

        ordered = sorted(observations, key=lambda item: item.public_available_at)
        result.sample_size = len(ordered)

        for horizon in periods:
            evaluation = self._evaluate_horizon(
                ordered, horizon=horizon, benchmark=bench, cost_bps=costs
            )
            result.horizons.append(evaluation)

        result.coverage = self._coverage(result.horizons, ordered)
        result.overlap = self._overlap(result.horizons)
        result.multiple_testing = quant.multiple_testing_report(
            [
                evaluation.excess_significance.p_value
                for evaluation in result.horizons
                if evaluation.excess_significance
                and evaluation.excess_significance.p_value is not None
            ]
        )

        if split:
            result.splits = self._split(ordered, periods, bench, costs)

        result.status = self._status(result)
        result.flags = self._flags(result)
        return result

    # -- internals ---------------------------------------------------------

    def _evaluate_horizon(
        self,
        observations: Sequence[SignalObservation],
        *,
        horizon: int,
        benchmark: str,
        cost_bps: float,
    ) -> HorizonEvaluation:
        trades = [
            self._simulate(observation, horizon=horizon, benchmark=benchmark, cost_bps=cost_bps)
            for observation in observations
        ]
        evaluation = HorizonEvaluation(horizon_days=horizon, trades=trades)

        net = evaluation.net_returns
        excess = evaluation.excess_returns
        benchmark_returns = [
            trade.benchmark_return for trade in trades if trade.benchmark_return is not None
        ]

        evaluation.stats = quant.describe(net)
        evaluation.interval = quant.mean_confidence_interval(net)
        evaluation.significance = quant.significance(net)
        evaluation.benchmark_stats = quant.describe(benchmark_returns)
        evaluation.excess_stats = quant.describe(excess)
        evaluation.excess_interval = quant.mean_confidence_interval(excess)
        evaluation.excess_significance = quant.significance(excess)
        evaluation.coverage = _trade_coverage(trades)
        return evaluation

    def _simulate(
        self,
        observation: SignalObservation,
        *,
        horizon: int,
        benchmark: str,
        cost_bps: float,
    ) -> SimulatedTrade:
        symbol = observation.symbol.upper()
        available = _as_utc(observation.public_available_at)

        if not symbol:
            return _unavailable(observation, horizon, cost_bps, TRADE_MISSING_PRICE, "No symbol.")

        # A generous forward window: enough sessions for the horizon plus slack
        # for holidays, so a legitimate exit is never cut off by the query.
        window_end = available + _forward_window(horizon)
        series = self.prices.daily(symbol, available, window_end)
        if not series:
            return _unavailable(
                observation,
                horizon,
                cost_bps,
                TRADE_MISSING_PRICE,
                "No daily price series covers this signal's availability date.",
            )

        entry_index = _first_session_after(series, available)
        if entry_index is None:
            return _unavailable(
                observation,
                horizon,
                cost_bps,
                TRADE_MISSING_PRICE,
                "No session begins after the signal became public within the window.",
            )

        exit_index = entry_index + horizon - 1
        if exit_index >= len(series):
            return _unavailable(
                observation,
                horizon,
                cost_bps,
                TRADE_DELISTED,
                (
                    "The price series ends before the exit session. The security may have "
                    "been delisted, or the data does not reach this far."
                ),
                entry=series[entry_index],
            )

        entry = series[entry_index]
        exit_point = series[exit_index]
        if entry.open <= 0:
            return _unavailable(
                observation,
                horizon,
                cost_bps,
                TRADE_MISSING_PRICE,
                "The entry price is not positive, so a return is undefined.",
            )

        gross = (exit_point.close - entry.open) / entry.open
        net = gross - cost_bps / 10_000.0

        benchmark_return = self._benchmark_return(
            benchmark, entry.at, exit_point.at
        )
        status = TRADE_OK if benchmark_return is not None else TRADE_MISSING_BENCHMARK

        return SimulatedTrade(
            signal_id=observation.signal_id,
            symbol=symbol,
            horizon_days=horizon,
            entry_at=entry.at,
            entry_price=entry.open,
            exit_at=exit_point.at,
            exit_price=exit_point.close,
            gross_return=gross,
            benchmark_return=benchmark_return,
            net_return=net,
            cost_bps=cost_bps,
            status=status,
            notes=(
                ""
                if status == TRADE_OK
                else f"No {benchmark} bar covers the holding window, so no excess return."
            ),
        )

    def _benchmark_return(
        self, benchmark: str, entry_at: datetime, exit_at: datetime
    ) -> float | None:
        """The benchmark's return over the same two sessions.

        Matched on the exact session timestamps rather than on a day count, so a
        holiday in one series cannot silently shift the comparison.
        """
        if not benchmark:
            return None
        series = self.prices.daily(benchmark, entry_at, exit_at)
        if not series:
            return None
        entry = next((point for point in series if point.at == entry_at), None)
        exit_point = next((point for point in series if point.at == exit_at), None)
        if entry is None or exit_point is None or entry.open <= 0:
            return None
        return (exit_point.close - entry.open) / entry.open

    def _split(
        self,
        observations: Sequence[SignalObservation],
        horizons: Sequence[int],
        benchmark: str,
        cost_bps: float,
    ) -> list[SplitEvaluation]:
        """Split chronologically, at a fraction of the ordered sample.

        The observations are ordered by availability time and cut at a fraction
        of the count, so the early signals are the ones an observer could have
        studied and the later ones are the ones they could not. The boundary is
        a position in the ordered sample rather than a calendar date, so adding
        one signal moves it: the split is reproducible for a given sample, not
        for a given period.
        """
        if len(observations) < 2:
            return []
        fraction = min(0.9, max(0.1, self.settings.intelligence_validation_train_fraction))
        cut = max(1, min(len(observations) - 1, int(len(observations) * fraction)))
        in_sample = observations[:cut]
        out_of_sample = observations[cut:]

        splits: list[SplitEvaluation] = []
        for label, group in (("in_sample", in_sample), ("out_of_sample", out_of_sample)):
            split = SplitEvaluation(
                label=label,
                start=group[0].public_available_at if group else None,
                end=group[-1].public_available_at if group else None,
            )
            for horizon in horizons:
                split.horizons.append(
                    self._evaluate_horizon(
                        group, horizon=horizon, benchmark=benchmark, cost_bps=cost_bps
                    )
                )
            splits.append(split)
        return splits

    def _coverage(
        self,
        horizons: Sequence[HorizonEvaluation],
        observations: Sequence[SignalObservation],
    ) -> dict[str, Any]:
        symbols = {observation.symbol.upper() for observation in observations if observation.symbol}
        priced: set[str] = set()
        for horizon in horizons:
            for trade in horizon.trades:
                if trade.entry_price is not None:
                    priced.add(trade.symbol)
        return {
            "signals": len(observations),
            "distinctSymbols": len(symbols),
            "symbolsWithPrices": len(priced),
            "symbolsWithoutPrices": sorted(symbols - priced),
            "missingPriceRatio": (
                round(1.0 - len(priced) / len(symbols), 4) if symbols else None
            ),
            "byHorizon": {
                str(horizon.horizon_days): horizon.coverage for horizon in horizons
            },
        }

    def _overlap(self, horizons: Sequence[HorizonEvaluation]) -> dict[str, Any]:
        """How much the sample double-counts the same move.

        Two signals on the same symbol whose holding windows overlap are not two
        independent observations. The ratio is reported so a reader can judge
        whether a sample of 200 is really 200.
        """
        if not horizons:
            return {}
        longest = max(horizons, key=lambda item: item.horizon_days)
        by_symbol: dict[str, list[SimulatedTrade]] = {}
        for trade in longest.trades:
            if trade.entry_at is None or trade.exit_at is None:
                continue
            by_symbol.setdefault(trade.symbol, []).append(trade)

        overlapping = 0
        total_pairs = 0
        for trades in by_symbol.values():
            ordered = sorted(trades, key=lambda item: item.entry_at)
            for index, left in enumerate(ordered):
                for right in ordered[index + 1 :]:
                    total_pairs += 1
                    if right.entry_at <= left.exit_at:
                        overlapping += 1
        return {
            "horizonDays": longest.horizon_days,
            "pairs": total_pairs,
            "overlappingPairs": overlapping,
            "overlapRatio": round(overlapping / total_pairs, 4) if total_pairs else 0.0,
            "note": (
                "Overlapping windows on the same symbol are not independent draws. "
                "A high ratio means the effective sample is smaller than the count."
            ),
        }

    def _status(self, result: ValidationResult) -> str:
        if not result.horizons:
            return RESULT_INSUFFICIENT
        usable = sum(len(horizon.net_returns) for horizon in result.horizons)
        if usable == 0:
            return RESULT_NO_PRICE_DATA
        minimum = self.settings.intelligence_validation_min_sample
        if any(len(horizon.net_returns) < minimum for horizon in result.horizons):
            return RESULT_INSUFFICIENT
        return RESULT_COMPLETE

    def _flags(self, result: ValidationResult) -> list[str]:
        flags: list[str] = []
        if result.status == RESULT_NO_PRICE_DATA:
            flags.append(
                "No historical price data covers these signals. The adapter, orchestration "
                "and result schema are in place, but no performance statistic is reported "
                "because none could be computed."
            )
        if result.status == RESULT_INSUFFICIENT:
            flags.append(
                f"At least one horizon has fewer than "
                f"{self.settings.intelligence_validation_min_sample} usable observations. "
                "Treat the point estimates as descriptive, not as evidence."
            )
        for horizon in result.horizons:
            if horizon.coverage.get("missingPrice", 0):
                flags.append(
                    f"{horizon.coverage['missingPrice']} of {horizon.coverage['trades']} "
                    f"observations at {horizon.horizon_days} days had no usable price and "
                    "were excluded from the return statistics."
                )
            if horizon.coverage.get("missingBenchmark", 0):
                flags.append(
                    f"{horizon.coverage['missingBenchmark']} observations at "
                    f"{horizon.horizon_days} days had no benchmark bar, so no excess return "
                    "was computed for them."
                )
        if result.overlap.get("overlapRatio", 0) > 0.25:
            flags.append(
                f"{result.overlap['overlappingPairs']} of {result.overlap['pairs']} signal "
                "pairs share an overlapping holding window. The effective sample is smaller "
                "than the observation count."
            )
        if result.multiple_testing and result.multiple_testing.tests > 1:
            flags.append(result.multiple_testing.note)
        return flags


def _unavailable(
    observation: SignalObservation,
    horizon: int,
    cost_bps: float,
    status: str,
    note: str,
    *,
    entry: PricePoint | None = None,
) -> SimulatedTrade:
    return SimulatedTrade(
        signal_id=observation.signal_id,
        symbol=observation.symbol.upper(),
        horizon_days=horizon,
        entry_at=entry.at if entry else None,
        entry_price=entry.open if entry else None,
        exit_at=None,
        exit_price=None,
        gross_return=None,
        benchmark_return=None,
        net_return=None,
        cost_bps=cost_bps,
        status=status,
        notes=note,
    )


def _first_session_after(series: Sequence[PricePoint], moment: datetime) -> int | None:
    """Index of the first session that begins strictly after ``moment``.

    Strictly after, because a signal published during a session cannot be filled
    at that session's open. This single comparison is what keeps the backtest
    from buying at a price that had already printed.
    """
    for index, point in enumerate(series):
        if point.at > moment:
            return index
    return None


def _forward_window(horizon: int) -> Any:
    from datetime import timedelta

    # Sessions are weekdays, so a horizon of N needs at least N*1.5 calendar days
    # plus a fortnight of slack for holiday clusters.
    return timedelta(days=int(horizon * 1.6) + 14)


def _trade_coverage(trades: Sequence[SimulatedTrade]) -> dict[str, Any]:
    counts: dict[str, int] = {}
    for trade in trades:
        counts[trade.status] = counts.get(trade.status, 0) + 1
    return {
        "trades": len(trades),
        "usable": counts.get(TRADE_OK, 0),
        "missingPrice": counts.get(TRADE_MISSING_PRICE, 0),
        "missingBenchmark": counts.get(TRADE_MISSING_BENCHMARK, 0),
        "delisted": counts.get(TRADE_DELISTED, 0),
        "byStatus": counts,
    }


def _common_category(observations: Sequence[SignalObservation]) -> str:
    categories = {observation.category for observation in observations if observation.category}
    if len(categories) == 1:
        return next(iter(categories))
    return "MIXED" if categories else ""


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


__all__ = [
    "CandlePriceProvider",
    "HorizonEvaluation",
    "PricePoint",
    "PriceProvider",
    "RESULT_COMPLETE",
    "RESULT_INSUFFICIENT",
    "RESULT_NO_PRICE_DATA",
    "SignalObservation",
    "SignalValidator",
    "SimulatedTrade",
    "SplitEvaluation",
    "TRADE_DELISTED",
    "TRADE_MISSING_BENCHMARK",
    "TRADE_MISSING_PRICE",
    "TRADE_OK",
    "ValidationResult",
]
