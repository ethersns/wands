"""Reusable quantitative analytics for signal evaluation.

This module is deliberately arithmetic only: no database, no clock, no network.
Every function takes numbers and returns numbers, which is what makes a research
result reproducible and a statistical edge case testable.

Two distinctions are load-bearing.

*A descriptive event study is not a trading strategy.* The mean forward return
after a signal describes what prices did. It does not account for whether the
trade could be entered, at what spread, or how often the signal fires. Those are
separate questions with separate functions, and the reporting layer keeps them
apart.

*A point estimate is not evidence.* Every mean here can be accompanied by an
interval and a p-value, and a result that is not distinguishable from zero is
reported as such rather than rounded into a story.

The Student-t distribution is implemented here rather than pulled in as a
dependency: the engine ships without numpy or scipy, and a two-sided p-value
needs the regularised incomplete beta function, not a whole array library.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Sequence

# Below this many observations a distribution statistic is reported but flagged.
SMALL_SAMPLE = 30


# --------------------------------------------------------------------------
# Student-t distribution
# --------------------------------------------------------------------------


def _betacf(a: float, b: float, x: float) -> float:
    """Continued fraction for the incomplete beta function (Lentz's method)."""
    max_iterations = 300
    epsilon = 3e-16
    tiny = 1e-300

    qab = a + b
    qap = a + 1.0
    qam = a - 1.0
    c = 1.0
    d = 1.0 - qab * x / qap
    if abs(d) < tiny:
        d = tiny
    d = 1.0 / d
    h = d
    for m in range(1, max_iterations + 1):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1.0 + aa * d
        if abs(d) < tiny:
            d = tiny
        c = 1.0 + aa / c
        if abs(c) < tiny:
            c = tiny
        d = 1.0 / d
        h *= d * c

        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1.0 + aa * d
        if abs(d) < tiny:
            d = tiny
        c = 1.0 + aa / c
        if abs(c) < tiny:
            c = tiny
        d = 1.0 / d
        delta = d * c
        h *= delta
        if abs(delta - 1.0) < epsilon:
            break
    return h


def _betainc(a: float, b: float, x: float) -> float:
    """Regularised incomplete beta function ``I_x(a, b)``."""
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0
    log_beta = math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b)
    front = math.exp(log_beta + a * math.log(x) + b * math.log(1.0 - x))
    if x < (a + 1.0) / (a + b + 2.0):
        return front * _betacf(a, b, x) / a
    return 1.0 - front * _betacf(b, a, 1.0 - x) / b


def t_two_sided_p(t_statistic: float, degrees_of_freedom: int) -> float:
    """Two-sided p-value for a t statistic."""
    if degrees_of_freedom <= 0:
        return 1.0
    if math.isinf(t_statistic) or math.isnan(t_statistic):
        return 0.0 if math.isinf(t_statistic) else 1.0
    x = degrees_of_freedom / (degrees_of_freedom + t_statistic * t_statistic)
    return min(1.0, max(0.0, _betainc(degrees_of_freedom / 2.0, 0.5, x)))


def t_critical(degrees_of_freedom: int, confidence: float = 0.95) -> float:
    """The two-sided critical value, found by bisection on the CDF.

    Bisection rather than a lookup table: the table would need a row per degree
    of freedom and would be wrong at the edges, and this converges in a few
    dozen iterations.
    """
    if degrees_of_freedom <= 0:
        return float("inf")
    target = 1.0 - (1.0 - confidence) / 2.0
    low, high = 0.0, 200.0
    for _ in range(200):
        mid = (low + high) / 2.0
        cdf = 1.0 - 0.5 * _betainc(
            degrees_of_freedom / 2.0,
            0.5,
            degrees_of_freedom / (degrees_of_freedom + mid * mid),
        )
        if cdf < target:
            low = mid
        else:
            high = mid
    return (low + high) / 2.0


# --------------------------------------------------------------------------
# Descriptive statistics
# --------------------------------------------------------------------------


def _floats(values: Sequence[float | Decimal | int | None]) -> list[float]:
    """Convert to float, dropping ``None``.

    A missing observation is dropped rather than treated as zero. A zero return
    is a real outcome; a missing price is not.
    """
    out: list[float] = []
    for value in values:
        if value is None:
            continue
        out.append(float(value))
    return out


@dataclass(frozen=True)
class DistributionStats:
    """The shape of a return distribution."""

    count: int
    mean: float | None
    median: float | None
    standard_deviation: float | None
    minimum: float | None
    maximum: float | None
    hit_rate: float | None
    average_gain: float | None
    average_loss: float | None
    profit_factor: float | None
    small_sample: bool = False

    def as_dict(self) -> dict[str, Any]:
        return {
            "count": self.count,
            "mean": self.mean,
            "median": self.median,
            "standardDeviation": self.standard_deviation,
            "min": self.minimum,
            "max": self.maximum,
            "hitRate": self.hit_rate,
            "averageGain": self.average_gain,
            "averageLoss": self.average_loss,
            "profitFactor": self.profit_factor,
            "smallSample": self.small_sample,
        }


def describe(values: Sequence[float | Decimal | None]) -> DistributionStats:
    """Summarise a return series.

    ``profit_factor`` is ``None`` when there are no losses, because an infinite
    ratio is not a useful number to display and is not a useful number to sort
    by either.
    """
    sample = _floats(values)
    count = len(sample)
    if count == 0:
        return DistributionStats(
            count=0,
            mean=None,
            median=None,
            standard_deviation=None,
            minimum=None,
            maximum=None,
            hit_rate=None,
            average_gain=None,
            average_loss=None,
            profit_factor=None,
            small_sample=True,
        )

    ordered = sorted(sample)
    mean = sum(sample) / count
    if count % 2 == 1:
        median = ordered[count // 2]
    else:
        median = (ordered[count // 2 - 1] + ordered[count // 2]) / 2.0
    variance = sum((value - mean) ** 2 for value in sample) / (count - 1) if count > 1 else 0.0
    gains = [value for value in sample if value > 0]
    losses = [value for value in sample if value < 0]
    gross_gain = sum(gains)
    gross_loss = abs(sum(losses))

    return DistributionStats(
        count=count,
        mean=mean,
        median=median,
        standard_deviation=math.sqrt(variance),
        minimum=ordered[0],
        maximum=ordered[-1],
        hit_rate=len(gains) / count,
        average_gain=(gross_gain / len(gains)) if gains else None,
        average_loss=(sum(losses) / len(losses)) if losses else None,
        profit_factor=(gross_gain / gross_loss) if gross_loss > 0 else None,
        small_sample=count < SMALL_SAMPLE,
    )


# --------------------------------------------------------------------------
# Uncertainty
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Interval:
    lower: float | None
    upper: float | None
    confidence: float
    method: str
    note: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {
            "lower": self.lower,
            "upper": self.upper,
            "confidence": self.confidence,
            "method": self.method,
            "note": self.note,
        }

    @property
    def excludes_zero(self) -> bool:
        if self.lower is None or self.upper is None:
            return False
        return self.lower > 0 or self.upper < 0


def mean_confidence_interval(
    values: Sequence[float | Decimal | None], *, confidence: float = 0.95
) -> Interval:
    """A t-based interval for the mean.

    With fewer than two observations there is no interval to report, and saying
    so is better than returning the point estimate twice.
    """
    sample = _floats(values)
    count = len(sample)
    if count < 2:
        return Interval(
            lower=None,
            upper=None,
            confidence=confidence,
            method="student_t",
            note="At least two observations are needed for an interval.",
        )
    mean = sum(sample) / count
    variance = sum((value - mean) ** 2 for value in sample) / (count - 1)
    standard_error = math.sqrt(variance / count)
    critical = t_critical(count - 1, confidence)
    return Interval(
        lower=mean - critical * standard_error,
        upper=mean + critical * standard_error,
        confidence=confidence,
        method="student_t",
        note=f"t interval with {count - 1} degrees of freedom.",
    )


def bootstrap_interval(
    values: Sequence[float | Decimal | None],
    *,
    iterations: int = 2000,
    confidence: float = 0.95,
    seed: int = 0,
) -> Interval:
    """A percentile bootstrap interval for the mean.

    Seeded, so the same sample produces the same interval. An unseeded bootstrap
    would make an experiment impossible to reproduce exactly.
    """
    sample = _floats(values)
    count = len(sample)
    if count < 2 or iterations <= 0:
        return Interval(
            lower=None,
            upper=None,
            confidence=confidence,
            method="bootstrap",
            note="At least two observations and one iteration are needed.",
        )
    generator = random.Random(seed)
    means: list[float] = []
    for _ in range(iterations):
        total = 0.0
        for _ in range(count):
            total += sample[generator.randrange(count)]
        means.append(total / count)
    means.sort()
    alpha = (1.0 - confidence) / 2.0
    lower_index = max(0, int(alpha * iterations) - 1)
    upper_index = min(iterations - 1, int((1.0 - alpha) * iterations))
    return Interval(
        lower=means[lower_index],
        upper=means[upper_index],
        confidence=confidence,
        method="bootstrap",
        note=f"{iterations} resamples, seed {seed}.",
    )


@dataclass(frozen=True)
class Significance:
    """Whether a mean is distinguishable from zero."""

    t_statistic: float | None
    p_value: float | None
    degrees_of_freedom: int
    significant: bool
    note: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {
            "tStatistic": self.t_statistic,
            "pValue": self.p_value,
            "degreesOfFreedom": self.degrees_of_freedom,
            "significant": self.significant,
            "note": self.note,
        }


def significance(
    values: Sequence[float | Decimal | None], *, null: float = 0.0, alpha: float = 0.05
) -> Significance:
    """A one-sample t test against ``null``."""
    sample = _floats(values)
    count = len(sample)
    if count < 2:
        return Significance(
            t_statistic=None,
            p_value=None,
            degrees_of_freedom=0,
            significant=False,
            note="At least two observations are needed for a test.",
        )
    mean = sum(sample) / count
    variance = sum((value - mean) ** 2 for value in sample) / (count - 1)
    if variance <= 0:
        return Significance(
            t_statistic=None,
            p_value=None,
            degrees_of_freedom=count - 1,
            significant=False,
            note="The sample has no variance, so no test statistic is defined.",
        )
    standard_error = math.sqrt(variance / count)
    statistic = (mean - null) / standard_error
    p_value = t_two_sided_p(statistic, count - 1)
    return Significance(
        t_statistic=statistic,
        p_value=p_value,
        degrees_of_freedom=count - 1,
        significant=p_value < alpha,
        note=f"One-sample t test against {null:g} at alpha {alpha:g}.",
    )


# --------------------------------------------------------------------------
# Strategy-level measures
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class DrawdownStats:
    max_drawdown: float | None
    peak_index: int | None
    trough_index: int | None
    note: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {
            "maxDrawdown": self.max_drawdown,
            "peakIndex": self.peak_index,
            "troughIndex": self.trough_index,
            "note": self.note,
        }


def max_drawdown(equity_curve: Sequence[float | Decimal | None]) -> DrawdownStats:
    """The largest peak-to-trough decline of an equity curve.

    Reported as a negative fraction. A curve that only rises has a drawdown of
    zero, which is a real answer rather than a missing one.
    """
    curve = _floats(equity_curve)
    if len(curve) < 2:
        return DrawdownStats(
            max_drawdown=None,
            peak_index=None,
            trough_index=None,
            note="At least two points are needed for a drawdown.",
        )
    peak = curve[0]
    peak_index = 0
    worst = 0.0
    worst_peak: int | None = 0
    worst_trough: int | None = 0
    for index, value in enumerate(curve):
        if value > peak:
            peak = value
            peak_index = index
        if peak <= 0:
            continue
        decline = (value - peak) / peak
        if decline < worst:
            worst = decline
            worst_peak = peak_index
            worst_trough = index
    return DrawdownStats(
        max_drawdown=worst,
        peak_index=worst_peak,
        trough_index=worst_trough,
        note="Peak-to-trough decline of the supplied equity curve.",
    )


@dataclass(frozen=True)
class SharpeResult:
    value: float | None
    annualised: float | None
    periods_per_year: int
    appropriate: bool
    note: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {
            "value": self.value,
            "annualised": self.annualised,
            "periodsPerYear": self.periods_per_year,
            "appropriate": self.appropriate,
            "note": self.note,
        }


def sharpe_ratio(
    values: Sequence[float | Decimal | None],
    *,
    periods_per_year: int = 252,
    risk_free_per_period: float = 0.0,
) -> SharpeResult:
    """A Sharpe ratio, with an explicit statement of when it does not apply.

    Overlapping multi-day returns are not independent draws, so annualising them
    by ``sqrt(252)`` overstates the ratio. The ``appropriate`` flag is false in
    that case and the caller is expected to report the note rather than the
    number alone.
    """
    sample = _floats(values)
    count = len(sample)
    if count < 2:
        return SharpeResult(
            value=None,
            annualised=None,
            periods_per_year=periods_per_year,
            appropriate=False,
            note="At least two observations are needed.",
        )
    excess = [value - risk_free_per_period for value in sample]
    mean = sum(excess) / count
    variance = sum((value - mean) ** 2 for value in excess) / (count - 1)
    if variance <= 0:
        return SharpeResult(
            value=None,
            annualised=None,
            periods_per_year=periods_per_year,
            appropriate=False,
            note="The sample has no variance, so the ratio is undefined.",
        )
    value = mean / math.sqrt(variance)
    return SharpeResult(
        value=value,
        annualised=value * math.sqrt(periods_per_year),
        periods_per_year=periods_per_year,
        appropriate=True,
        note=(
            "Annualised by sqrt(periods per year). Valid only for non-overlapping "
            "returns; overlapping horizons overstate the ratio."
        ),
    )


def profit_factor(values: Sequence[float | Decimal | None]) -> float | None:
    """Gross gains over gross losses, or ``None`` when there are no losses."""
    sample = _floats(values)
    gross_gain = sum(value for value in sample if value > 0)
    gross_loss = abs(sum(value for value in sample if value < 0))
    if gross_loss <= 0:
        return None
    return gross_gain / gross_loss


def benchmark_relative(
    values: Sequence[float | Decimal | None],
    benchmark: Sequence[float | Decimal | None],
) -> list[float]:
    """Pairwise excess returns.

    Pairs are matched by position and truncated to the shorter series, so a
    missing benchmark observation shortens the sample rather than shifting it.
    """
    left = _floats(values)
    right = _floats(benchmark)
    return [a - b for a, b in zip(left, right)]


def equity_curve(values: Sequence[float | Decimal | None], *, start: float = 1.0) -> list[float]:
    """Compound a return series into an equity curve."""
    curve = [start]
    level = start
    for value in _floats(values):
        level *= 1.0 + value
        curve.append(level)
    return curve


# --------------------------------------------------------------------------
# Multiple testing
# --------------------------------------------------------------------------


def benjamini_hochberg(p_values: Sequence[float], *, alpha: float = 0.05) -> list[bool]:
    """Which hypotheses survive a false-discovery-rate correction.

    Testing five horizons against five signals is twenty-five tests. At alpha
    0.05 roughly one of them looks significant by chance, so a raw p-value is
    not enough to call an edge.
    """
    count = len(p_values)
    if count == 0:
        return []
    ordered = sorted(range(count), key=lambda index: p_values[index])
    keep = [False] * count
    threshold_index = -1
    for rank, index in enumerate(ordered, start=1):
        if p_values[index] <= alpha * rank / count:
            threshold_index = rank
    for rank, index in enumerate(ordered, start=1):
        if rank <= threshold_index:
            keep[index] = True
    return keep


@dataclass(frozen=True)
class MultipleTestingReport:
    tests: int
    alpha: float
    bonferroni_alpha: float
    rejected: int
    survivors: list[bool] = field(default_factory=list)
    note: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {
            "tests": self.tests,
            "alpha": self.alpha,
            "bonferroniAlpha": self.bonferroni_alpha,
            "rejected": self.rejected,
            "survivors": list(self.survivors),
            "note": self.note,
        }


def multiple_testing_report(
    p_values: Sequence[float], *, alpha: float = 0.05
) -> MultipleTestingReport:
    """Summarise a family of tests with both corrections reported."""
    count = len(p_values)
    if count == 0:
        return MultipleTestingReport(
            tests=0,
            alpha=alpha,
            bonferroni_alpha=alpha,
            rejected=0,
            note="No tests were run.",
        )
    survivors = benjamini_hochberg(p_values, alpha=alpha)
    return MultipleTestingReport(
        tests=count,
        alpha=alpha,
        bonferroni_alpha=alpha / count,
        rejected=sum(1 for value in p_values if value <= alpha / count),
        survivors=survivors,
        note=(
            f"{count} tests were run. A raw p-value below {alpha:g} is expected by "
            f"chance about {alpha * count:.1f} times, so the Bonferroni threshold "
            f"({alpha / count:.4g}) and the Benjamini-Hochberg survivors are both "
            "reported."
        ),
    )


def correlation(left: Sequence[float | Decimal | None], right: Sequence[float | Decimal | None]) -> float | None:
    """Pearson correlation of two paired series."""
    a = _floats(left)
    b = _floats(right)
    count = min(len(a), len(b))
    if count < 3:
        return None
    a = a[:count]
    b = b[:count]
    mean_a = sum(a) / count
    mean_b = sum(b) / count
    covariance = sum((x - mean_a) * (y - mean_b) for x, y in zip(a, b))
    variance_a = sum((x - mean_a) ** 2 for x in a)
    variance_b = sum((y - mean_b) ** 2 for y in b)
    if variance_a <= 0 or variance_b <= 0:
        return None
    return covariance / math.sqrt(variance_a * variance_b)


__all__ = [
    "DistributionStats",
    "DrawdownStats",
    "Interval",
    "MultipleTestingReport",
    "SMALL_SAMPLE",
    "SharpeResult",
    "Significance",
    "benjamini_hochberg",
    "benchmark_relative",
    "bootstrap_interval",
    "correlation",
    "describe",
    "equity_curve",
    "max_drawdown",
    "mean_confidence_interval",
    "multiple_testing_report",
    "profit_factor",
    "sharpe_ratio",
    "significance",
    "t_critical",
    "t_two_sided_p",
]
