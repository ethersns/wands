"""Read-only forensic assessment of a recorded experiment.

An experiment records what it measured. It does not record whether the evidence
behind that measurement is trustworthy, and those are different questions. A
result can be arithmetically correct and still rest on a price series that stops
before the window ends, a benchmark that was never stored, or a single parameter
set that was never varied.

This module answers the second question from the stored record alone. It reads;
it never writes, never re-runs a strategy, and never consults a clock. The same
experiment produces the same report every time, which is what makes the report
itself auditable.

Four rules govern the findings.

*A missing check is not a pass.* A capability the stored data cannot evidence is
reported as ``cannot_assess``, never as ``verified``. The difference between "we
checked and it held" and "we could not check" is the entire value of the report.

*A declaration is not a demonstration.* A record can assert that a result was
held out, that its inputs are hashed, or that its study dates events by
publication. Those assertions are worth reporting, but they are not evidence that
the property holds. They are reported as ``declared``, which says exactly what
the record supports: the claim is on file, and nothing in the record corroborates
it. Collapsing that into ``verified`` is how a research product starts telling a
member a result was independently validated when all it did was label it.

*Every finding carries its evidence.* A status without the numbers behind it is
an opinion. Each finding names the stored fields it read.

*Every finding states its limit.* Where a check is partial — costs that fold
slippage into one figure, a survivorship bias that is disclosed but not
corrected — the limitation travels with the finding rather than being left for
the reader to infer.

The one thing this module will not do is invent a probability. There is no
"confidence score" here, because a number like that would be a fabricated metric
dressed as a measurement. The report counts what it verified and says what it
could not.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from wands.db.models import MarketCandleRow
from wands.intelligence import quant

# Finding statuses.
#
# ``verified`` means the stored record contains the evidence that directly
# establishes the claim as stated. ``declared`` means the record asserts the
# claim but contains nothing that corroborates it — a held-out label, a pair of
# hashes, a study name. ``cannot_assess`` is not a soft failure: it is the honest
# answer when the record does not contain the evidence a check needs at all.
VERIFIED = "verified"
DECLARED = "declared"
NOT_VERIFIED = "not_verified"
CANNOT_ASSESS = "cannot_assess"
NOT_APPLICABLE = "not_applicable"

# The assessment rules are versioned because the report is computed on read and
# never stored: without a version, a member who looked yesterday cannot tell that
# the rules behind the statuses changed underneath them. This is a constant, not
# a persistence system — nothing is written, and no migration is involved.
FORENSICS_VERSION = "1.0.1"

DAILY_INTERVAL = "1d"

STUDY_INSIDER = "insider_purchase_event_study"
STUDY_INSTITUTIONAL = "institutional_holdings_study"
STUDY_STRATEGY = "strategy_baseline"

EVALUATION_HELD_OUT = "held_out"

# A stored daily series legitimately ends on the last trading day on or before
# the window end, so a weekend or a holiday cluster must not read as staleness.
# A week of slack covers both without hiding a series that genuinely stops early.
STALENESS_TOLERANCE = timedelta(days=7)

REPORT_NOTE = (
    "This assessment reads the stored experiment and the stored price series. It "
    "does not re-run the strategy, does not modify the recorded result, and does "
    "not estimate a probability that the result is real. A check that could not be "
    "performed is reported as unassessable rather than passed, and a property the "
    "record only asserts is reported as declared rather than verified."
)


# --------------------------------------------------------------------------
# Findings
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Finding:
    """One forensic check, with the evidence it read and the limit it carries."""

    id: str
    title: str
    status: str
    explanation: str
    evidence: tuple[str, ...] = ()
    limitation: str | None = None
    next_step: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "status": self.status,
            "explanation": self.explanation,
            "evidence": list(self.evidence),
            "limitation": self.limitation,
            "nextStep": self.next_step,
        }


@dataclass(frozen=True)
class SymbolCoverage:
    """How much of a symbol's daily series falls inside the measured window."""

    symbol: str
    bars: int
    first_bar: datetime | None
    last_bar: datetime | None


class CoverageProbe(Protocol):
    """A source of per-symbol bar coverage over a window."""

    def coverage(
        self, symbols: Sequence[str], start: datetime, end: datetime
    ) -> list[SymbolCoverage]: ...


class CandleCoverageProbe:
    """Aggregate bar coverage per symbol, from the engine's own candle store.

    One grouped query rather than one per symbol: this runs while a member page
    is being rendered and must not turn into a scan of the price history.
    """

    def __init__(self, session: Session, *, interval: str = DAILY_INTERVAL) -> None:
        self.session = session
        self.interval = interval

    def coverage(
        self, symbols: Sequence[str], start: datetime, end: datetime
    ) -> list[SymbolCoverage]:
        wanted = sorted({symbol.upper() for symbol in symbols if symbol})
        if not wanted:
            return []

        rows = self.session.execute(
            select(
                MarketCandleRow.symbol,
                func.count(),
                func.min(MarketCandleRow.open_time),
                func.max(MarketCandleRow.open_time),
            )
            .where(
                MarketCandleRow.symbol.in_(wanted),
                MarketCandleRow.interval == self.interval,
                MarketCandleRow.open_time >= start,
                MarketCandleRow.open_time <= end,
            )
            .group_by(MarketCandleRow.symbol)
        ).all()

        found: dict[str, tuple[int, datetime | None, datetime | None]] = {}
        for symbol, count, first, last in rows:
            found[str(symbol).upper()] = (
                int(count),
                _as_utc(first) if first else None,
                _as_utc(last) if last else None,
            )

        return [
            SymbolCoverage(
                symbol=symbol,
                bars=found.get(symbol, (0, None, None))[0],
                first_bar=found.get(symbol, (0, None, None))[1],
                last_bar=found.get(symbol, (0, None, None))[2],
            )
            for symbol in wanted
        ]


# --------------------------------------------------------------------------
# The subject
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class ForensicSubject:
    """The stored facts a forensic assessment is allowed to read."""

    study: str
    status: str
    sample_size: int
    period_start: datetime | None
    period_end: datetime | None
    information_cutoff: datetime | None
    benchmark: str
    metrics: Mapping[str, Any]
    coverage: Mapping[str, Any]
    flags: tuple[str, ...]
    definition_hash: str
    data_fingerprint: str
    symbols: tuple[str, ...]
    execution_assumptions: Mapping[str, Any]
    cost_assumptions: Mapping[str, Any]
    parameters: Mapping[str, Any]

    @property
    def window_end(self) -> datetime | None:
        """The last moment the experiment claims to have measured.

        The declared period end clipped to the information cutoff: a run pinned
        to an earlier cutoff did not measure past it, whatever the period says.
        """
        candidates = [
            moment
            for moment in (self.period_end, self.information_cutoff)
            if moment is not None
        ]
        return min(candidates) if candidates else None

    @classmethod
    def from_row(cls, row: Any) -> ForensicSubject:
        metrics = _mapping(getattr(row, "metrics", None))
        parameters = _mapping(getattr(row, "parameters", None))
        return cls(
            study=str(metrics.get("study") or ""),
            status=str(getattr(row, "status", "") or ""),
            sample_size=int(getattr(row, "sample_size", 0) or 0),
            period_start=_as_utc(getattr(row, "period_start", None)),
            period_end=_as_utc(getattr(row, "period_end", None)),
            information_cutoff=_as_utc(getattr(row, "information_cutoff", None)),
            benchmark=str(getattr(row, "benchmark", "") or ""),
            metrics=metrics,
            coverage=_mapping(getattr(row, "coverage", None)),
            flags=tuple(str(flag) for flag in (getattr(row, "flags", None) or [])),
            definition_hash=str(getattr(row, "definition_hash", "") or ""),
            data_fingerprint=str(getattr(row, "data_fingerprint", "") or ""),
            symbols=_symbols(metrics, parameters),
            execution_assumptions=_mapping(getattr(row, "execution_assumptions", None)),
            cost_assumptions=_mapping(getattr(row, "cost_assumptions", None)),
            parameters=parameters,
        )


# --------------------------------------------------------------------------
# Individual checks
# --------------------------------------------------------------------------


def _recorded_temporal_boundary(subject: ForensicSubject) -> Finding:
    cutoff = subject.information_cutoff
    end = subject.period_end

    if cutoff is None or end is None:
        return Finding(
            id="recorded_temporal_boundary",
            title="Recorded temporal boundary",
            status=CANNOT_ASSESS,
            explanation=(
                "The record does not store both the period end and the information "
                "cutoff, so the boundary the run was pinned to cannot be checked."
            ),
            evidence=(
                f"Period end: {_stamp(end)}",
                f"Information cutoff: {_stamp(cutoff)}",
            ),
            next_step="Re-run with an explicit information cutoff and record it on the experiment.",
        )

    if end > cutoff:
        return Finding(
            id="recorded_temporal_boundary",
            title="Recorded temporal boundary",
            status=NOT_VERIFIED,
            explanation=(
                "The recorded window ends after the recorded information cutoff. "
                "Observations dated between the cutoff and the period end were not "
                "knowable when the run was made, so the run measured past the boundary "
                "it recorded."
            ),
            evidence=(
                f"Period end: {_stamp(end)}",
                f"Information cutoff: {_stamp(cutoff)}",
                f"Window extends past the cutoff by {_days(end - cutoff)} days",
            ),
            next_step="Re-run with the information cutoff set to the period end, or shorten the period.",
        )

    return Finding(
        id="recorded_temporal_boundary",
        title="Recorded temporal boundary",
        status=VERIFIED,
        explanation=(
            "The recorded window ends on or before the recorded information cutoff. "
            "This verifies the boundary as recorded. It does not establish that every "
            "underlying input — each price bar, each filing timestamp — was itself "
            "point-in-time eligible."
        ),
        evidence=(
            f"Period end: {_stamp(end)}",
            f"Information cutoff: {_stamp(cutoff)}",
        ),
        limitation=(
            "The check compares two recorded dates. An input that was revised after "
            "the cutoff but still carries an earlier timestamp would pass it."
        ),
    )


def _publication_versus_transaction(subject: ForensicSubject) -> Finding:
    if subject.study == STUDY_INSIDER:
        return Finding(
            id="publication_versus_transaction",
            title="Filing publication versus transaction time",
            status=DECLARED,
            explanation=(
                "The study is recorded as dating eligibility by the filing's acceptance "
                "time rather than the transaction date. That is a property of the study "
                "definition: the stored record carries horizon aggregates, not "
                "per-observation timestamps, so it cannot corroborate that each "
                "observation was in fact dated by publication."
            ),
            evidence=(
                "Recorded study: insider_purchase_event_study",
                "Declared sample filter: accepted_at inside the window and on or before the cutoff",
                "Per-observation timestamps: not stored",
            ),
            limitation=(
                "The acceptance timestamp is the SEC's, so a filing accepted after the "
                "close is treated as knowable that day even though it was readable "
                "only afterwards."
            ),
            next_step=(
                "Store the per-observation acceptance and transaction timestamps on the "
                "experiment so the dating can be checked rather than taken on trust."
            ),
        )

    if subject.study == STUDY_INSTITUTIONAL:
        return Finding(
            id="publication_versus_transaction",
            title="Filing publication versus transaction time",
            status=DECLARED,
            explanation=(
                "The study is recorded as dating eligibility by the filing's public "
                "availability time rather than the quarter end. That is a property of "
                "the study definition: the stored record carries horizon aggregates, "
                "not per-observation timestamps, so it cannot corroborate that each "
                "observation was in fact dated by publication."
            ),
            evidence=(
                "Recorded study: institutional_holdings_study",
                "Declared sample filter: public availability inside the window and on or before the cutoff",
                "Per-observation timestamps: not stored",
            ),
            limitation=(
                "A reported increase is a change in a quarterly position, not a "
                "real-time purchase. The 45-day filing lag is inside the data, not "
                "corrected by it."
            ),
            next_step=(
                "Store the per-observation availability and period-of-report timestamps "
                "on the experiment so the dating can be checked rather than taken on trust."
            ),
        )

    return Finding(
        id="publication_versus_transaction",
        title="Filing publication versus transaction time",
        status=NOT_APPLICABLE,
        explanation=(
            "This study is driven by price rules rather than disclosure filings, so "
            "there is no publication lag to separate from an event time. The "
            "equivalent question is the fill timing check below."
        ),
        evidence=(f"Study: {subject.study or 'unrecorded'}",),
    )


def _recorded_fill_convention(subject: ForensicSubject) -> Finding:
    entry = str(subject.execution_assumptions.get("entry") or "").strip()

    if not entry:
        return Finding(
            id="recorded_fill_convention",
            title="Recorded fill convention",
            status=CANNOT_ASSESS,
            explanation=(
                "The record does not state when an order was assumed to fill, so "
                "there is no way to tell whether the simulation used a price that "
                "was available at the moment of the decision."
            ),
            evidence=("Execution assumptions: not recorded",),
            next_step="Re-run with the fill convention recorded on the experiment definition.",
        )

    if "next_session_open" in entry:
        return Finding(
            id="recorded_fill_convention",
            title="Recorded fill convention",
            status=VERIFIED,
            explanation=(
                "The run is recorded as filling at the open of the session after the "
                "decision. This verifies the convention the run was configured with. "
                "The stored trades do not carry decision timestamps, so per-trade "
                "compliance with that convention is not separately evidenced."
            ),
            evidence=(f"Recorded entry convention: {entry}",),
            limitation=(
                "A next-open fill is the earliest defensible price, not a guaranteed "
                "one. A large order would move the open, and that impact is not "
                "modelled."
            ),
        )

    return Finding(
        id="recorded_fill_convention",
        title="Recorded fill convention",
        status=NOT_VERIFIED,
        explanation=(
            "The recorded fill convention is not a next-session open, so the "
            "simulation may have filled at a price that was not available when the "
            "decision was made."
        ),
        evidence=(f"Recorded entry convention: {entry}",),
        next_step="Re-run with next-session-open fills and compare the result.",
    )


def _price_coverage(
    subject: ForensicSubject, price_coverage: Sequence[SymbolCoverage] | None
) -> Finding:
    window_end = subject.window_end

    if price_coverage is None:
        return Finding(
            id="price_coverage",
            title="Price series coverage",
            status=CANNOT_ASSESS,
            explanation=(
                "The stored price series was not read for this assessment, so there "
                "is no evidence about whether it reaches the end of the measured "
                "window."
            ),
            evidence=(f"Symbols in the experiment: {len(subject.symbols)}",),
            next_step=(
                "Read the stored daily series for the experiment's symbols and compare "
                "it to the window end."
            ),
        )

    if not price_coverage:
        return Finding(
            id="price_coverage",
            title="Price series coverage",
            status=CANNOT_ASSESS,
            explanation=(
                "The experiment does not record which symbols it covered, so there "
                "is no series to check against the window."
            ),
            evidence=("Symbols: not recorded",),
            next_step="Record the symbol set on the experiment definition.",
        )

    if window_end is None:
        return Finding(
            id="price_coverage",
            title="Price series coverage",
            status=CANNOT_ASSESS,
            explanation=(
                "The record does not store a window end, so there is nothing to "
                "compare the stored series against."
            ),
            evidence=(f"Symbols checked: {len(price_coverage)}",),
            next_step="Record the period end and information cutoff on the experiment.",
        )

    threshold = window_end - STALENESS_TOLERANCE
    empty = [item.symbol for item in price_coverage if item.bars == 0]
    stale = [
        item
        for item in price_coverage
        if item.bars > 0 and item.last_bar is not None and item.last_bar < threshold
    ]
    evidence = tuple(
        f"{item.symbol}: {item.bars} bars, last {_stamp(item.last_bar)}"
        for item in price_coverage
    )

    if empty or stale:
        parts: list[str] = []
        if empty:
            parts.append(f"{len(empty)} symbol(s) have no stored bar in the window")
        if stale:
            parts.append(
                f"{len(stale)} symbol(s) stop more than {STALENESS_TOLERANCE.days} days "
                "before the window end"
            )
        return Finding(
            id="price_coverage",
            title="Price series coverage",
            status=NOT_VERIFIED,
            explanation=(
                f"The stored series does not cover the measured window: "
                f"{' and '.join(parts)}. Any return computed past the last stored bar "
                "is not backed by a price."
            ),
            evidence=evidence,
            limitation=(
                "A series that stops early may reflect a delisting, a data outage or a "
                "provider gap. The stored record cannot distinguish them."
            ),
            next_step=(
                "Backfill the missing sessions, or shorten the period to the covered "
                "window and re-run."
            ),
        )

    return Finding(
        id="price_coverage",
        title="Price series coverage",
        status=VERIFIED,
        explanation=(
            "Every symbol in the experiment has stored daily bars reaching the end of "
            "the measured window, so the returns rest on prices that exist."
        ),
        evidence=evidence,
        limitation=(
            "Coverage is a count of bars, not a quality check. A bar that is present "
            "but wrong is not detected here."
        ),
    )


def _benchmark_coverage(subject: ForensicSubject) -> Finding:
    if subject.study == STUDY_STRATEGY:
        return Finding(
            id="benchmark_coverage",
            title="Benchmark coverage",
            status=VERIFIED,
            explanation=(
                "The benchmark is buy-and-hold of the same instrument over the same "
                "bars, so it is covered by construction: the comparison uses the same "
                "series the rule was run on."
            ),
            evidence=(
                f"Recorded benchmark: {subject.benchmark or 'BUY_AND_HOLD'}",
                "Exposure-matched benchmark uses the rule's own invested bars",
            ),
            limitation=(
                "A same-instrument benchmark cannot fail for lack of data, but it does "
                "inherit every gap in that instrument's series."
            ),
        )

    if subject.study == STUDY_INSTITUTIONAL:
        available = subject.coverage.get("benchmarkAvailable")
        if available is None:
            return Finding(
                id="benchmark_coverage",
                title="Benchmark coverage",
                status=CANNOT_ASSESS,
                explanation=(
                    "The record does not state whether benchmark bars were available "
                    "for the window, so excess returns cannot be confirmed as computed."
                ),
                evidence=(f"Recorded benchmark: {subject.benchmark or 'unrecorded'}",),
                next_step="Re-run with benchmark availability recorded in the coverage block.",
            )
        if not available:
            return Finding(
                id="benchmark_coverage",
                title="Benchmark coverage",
                status=NOT_VERIFIED,
                explanation=(
                    "No benchmark bars were stored for this window, so no "
                    "benchmark-adjusted return was computed. The reported forward "
                    "returns are raw, not excess."
                ),
                evidence=(
                    f"Recorded benchmark: {subject.benchmark or 'unrecorded'}",
                    "Benchmark availability: false",
                ),
                next_step="Backfill the benchmark series and re-run so the result is benchmark-adjusted.",
            )
        return Finding(
            id="benchmark_coverage",
            title="Benchmark coverage",
            status=VERIFIED,
            explanation=(
                "Benchmark bars were available for the window, so the reported returns "
                "are benchmark-adjusted rather than raw."
            ),
            evidence=(
                f"Recorded benchmark: {subject.benchmark or 'unrecorded'}",
                "Benchmark availability: true",
            ),
        )

    horizons = _sequence(subject.metrics.get("horizons"))
    if not horizons:
        return Finding(
            id="benchmark_coverage",
            title="Benchmark coverage",
            status=CANNOT_ASSESS,
            explanation=(
                "The record has no horizon rows, so there is no per-horizon benchmark "
                "coverage to read."
            ),
            evidence=(f"Recorded benchmark: {subject.benchmark or 'unrecorded'}",),
            next_step="Re-run so the horizon rows record benchmark coverage.",
        )

    missing = 0
    total = 0
    for horizon in horizons:
        coverage = _mapping(_mapping(horizon).get("coverage"))
        missing += int(coverage.get("missingBenchmark", 0) or 0)
        total += int(coverage.get("trades", 0) or 0)

    if missing:
        return Finding(
            id="benchmark_coverage",
            title="Benchmark coverage",
            status=NOT_VERIFIED,
            explanation=(
                f"{missing} of {total} simulated trades had no benchmark bar covering "
                "the holding window, so no excess return was computed for them. The "
                "excess statistics are measured on the remainder."
            ),
            evidence=(
                f"Recorded benchmark: {subject.benchmark or 'unrecorded'}",
                f"Trades without a benchmark bar: {missing} of {total}",
            ),
            next_step="Backfill the benchmark series over the holding windows and re-run.",
        )

    return Finding(
        id="benchmark_coverage",
        title="Benchmark coverage",
        status=VERIFIED,
        explanation=(
            "Every simulated trade had a benchmark bar covering the same two sessions, "
            "so each excess return is a like-for-like comparison."
        ),
        evidence=(
            f"Recorded benchmark: {subject.benchmark or 'unrecorded'}",
            f"Trades with a benchmark bar: {total} of {total}",
        ),
    )


def _survivorship(subject: ForensicSubject) -> Finding:
    universe = _mapping(subject.metrics.get("universe"))
    disclosed = str(universe.get("survivorshipLimitation") or "").strip()
    if not disclosed:
        disclosed = next(
            (flag for flag in _limitations(subject) if "survivor" in flag.lower()),
            "",
        )

    return Finding(
        id="survivorship_bias",
        title="Survivorship bias",
        status=CANNOT_ASSESS,
        explanation=(
            "The instrument set is a present-day list of companies that are still "
            "listed. Delisted and acquired issuers are absent, so the sample carries "
            "survivorship bias that the stored data cannot remove."
        ),
        evidence=(
            f"Symbols: {', '.join(subject.symbols) if subject.symbols else 'not recorded'}",
            disclosed or "No survivorship statement is recorded on this experiment.",
        ),
        limitation=(
            "This is disclosed rather than corrected. A buy-and-hold benchmark built "
            "from survivors is biased upward, which biases any excess return downward."
        ),
        next_step=(
            "Re-run against a point-in-time membership list that includes issuers that "
            "were later delisted or acquired."
        ),
    )


def _trading_costs(subject: ForensicSubject) -> Finding:
    cost_bps = _cost_bps(subject.metrics, subject.cost_assumptions)

    if cost_bps is None:
        return Finding(
            id="trading_costs",
            title="Trading costs",
            status=CANNOT_ASSESS,
            explanation=(
                "The record does not state a cost assumption, so there is no way to "
                "tell whether the reported returns are gross or net."
            ),
            evidence=("Cost assumptions: not recorded",),
            next_step="Re-run with an explicit round-trip cost and record it on the experiment.",
        )

    if cost_bps <= 0:
        return Finding(
            id="trading_costs",
            title="Trading costs",
            status=NOT_VERIFIED,
            explanation=(
                "The recorded round-trip cost is zero, so the reported returns are "
                "gross. A rule that trades often would not have paid for its turnover."
            ),
            evidence=(f"Recorded round-trip cost: {cost_bps:g} bps",),
            next_step="Re-run with a realistic spread, commission and slippage assumption.",
        )

    evidence = [f"Recorded round-trip cost: {cost_bps:g} bps"]
    summary = _mapping(subject.metrics.get("summary"))
    drag = summary.get("costDrag")
    if isinstance(drag, (int, float)):
        evidence.append(f"Cost drag on the portfolio return: {float(drag):.4f}")

    return Finding(
        id="trading_costs",
        title="Trading costs",
        status=VERIFIED,
        explanation=(
            f"A round-trip cost of {cost_bps:g} bps is recorded for this run, so the "
            "reported returns are stated net of a cost assumption rather than gross."
        ),
        evidence=tuple(evidence),
        limitation=(
            "The record states the assumption and, where present, the resulting drag. "
            "It does not show the cost applied to each individual trade. Spread, "
            "commission and slippage are folded into one figure, and a single bps "
            "number cannot capture impact that grows with order size."
        ),
    )


def _sample_size(subject: ForensicSubject, minimum_sample: int) -> Finding:
    overlap = _mapping(subject.metrics.get("overlap"))
    ratio = overlap.get("overlapRatio")
    evidence = [
        f"Observations: {subject.sample_size}",
        f"Minimum for a distribution statistic: {minimum_sample}",
    ]
    if isinstance(ratio, (int, float)):
        evidence.append(f"Overlapping holding windows: {float(ratio):.1%} of pairs")

    if subject.sample_size < minimum_sample:
        return Finding(
            id="sample_size",
            title="Sample size",
            status=NOT_VERIFIED,
            explanation=(
                f"{subject.sample_size} observations is below the {minimum_sample} "
                "needed for a distribution statistic to mean anything. The point "
                "estimates are descriptive, not evidence of an edge."
            ),
            evidence=tuple(evidence),
            next_step="Widen the period or the instrument set until the sample clears the minimum.",
        )

    limitation = None
    if isinstance(ratio, float) and ratio > 0.25:
        limitation = (
            f"{ratio:.1%} of same-symbol signal pairs share an overlapping holding "
            "window, so the effective sample is smaller than the observation count."
        )

    return Finding(
        id="sample_size",
        title="Sample size",
        status=VERIFIED,
        explanation=(
            f"{subject.sample_size} observations clears the {minimum_sample} needed "
            "for a distribution statistic to be reported."
        ),
        evidence=tuple(evidence),
        limitation=limitation,
    )


def _parameter_sensitivity(subject: ForensicSubject) -> Finding:
    strategy = _mapping(subject.parameters.get("strategy"))
    recorded = strategy or subject.parameters
    keys = ", ".join(sorted(str(key) for key in recorded)) or "none recorded"
    selection = str(
        _mapping(subject.metrics.get("evaluationStatus")).get("selectionMethod") or ""
    ).strip()

    return Finding(
        id="parameter_sensitivity",
        title="Parameter sensitivity",
        status=CANNOT_ASSESS,
        explanation=(
            "The experiment records one parameter set and no sweep, so there is no "
            "evidence about whether the result survives a different choice of "
            "parameters. A single point on a surface says nothing about the surface."
        ),
        evidence=(
            f"Recorded parameters: {keys}",
            selection or "No selection method is recorded.",
        ),
        limitation=(
            "A result that only holds at one parameter setting is a fitted artefact, "
            "and this record cannot distinguish that from a robust effect."
        ),
        next_step=(
            "Re-run the same rule across a parameter grid and report the dispersion of "
            "results, not only the best cell."
        ),
    )


def _multiple_comparisons(subject: ForensicSubject) -> Finding:
    block = _mapping(subject.metrics.get("multipleTesting"))

    if not block:
        return Finding(
            id="multiple_comparisons",
            title="Multiple comparisons",
            status=CANNOT_ASSESS,
            explanation=(
                "No family-wise correction is recorded, so a per-rule p-value cannot "
                "be read as evidence: searching several rules and reporting the best "
                "one produces a small p-value by construction."
            ),
            evidence=("Multiple-testing block: not recorded",),
            next_step="Re-run the family together so the correction is recorded alongside each rule.",
        )

    tests = int(block.get("tests", 0) or 0)
    bonferroni = block.get("bonferroniAlpha")
    survives = block.get("survives")
    survivors = _sequence(block.get("survivors"))
    any_survivor = any(bool(item) for item in survivors)

    evidence = [f"Tests in the family: {tests}"]
    if isinstance(bonferroni, (int, float)):
        evidence.append(f"Bonferroni threshold: {float(bonferroni):.4g}")

    passed = bool(survives) if survives is not None else any_survivor

    if not passed:
        return Finding(
            id="multiple_comparisons",
            title="Multiple comparisons",
            status=NOT_VERIFIED,
            explanation=(
                f"{tests} rules were searched together and this result does not "
                "survive the correction for that search. Its raw p-value is what a "
                "search of this size would produce by chance."
            ),
            evidence=tuple(evidence),
            next_step=(
                "Treat the result as a candidate, not a finding, and test it on data "
                "not used to select it."
            ),
        )

    return Finding(
        id="multiple_comparisons",
        title="Multiple comparisons",
        status=VERIFIED,
        explanation=(
            f"This result survives the correction across the {tests} rules that were "
            "searched together, so it is not merely the best of several attempts."
        ),
        evidence=tuple(evidence),
        limitation=(
            "A correction controls the false-discovery rate across the rules that were "
            "declared. Rules that were tried and discarded are not in the family."
        ),
    )


def _out_of_sample(subject: ForensicSubject) -> Finding:
    block = _mapping(subject.metrics.get("evaluationStatus"))
    status = str(block.get("status") or "").strip()

    if not status:
        return Finding(
            id="out_of_sample_independence",
            title="Out-of-sample independence",
            status=CANNOT_ASSESS,
            explanation=(
                "The record does not state how the result relates to the data that "
                "produced it, so it cannot be read as out-of-sample evidence."
            ),
            evidence=("Evaluation status: not recorded",),
            next_step="Re-run with the evaluation status recorded on the result.",
        )

    evidence = [f"Recorded evaluation status: {status}"]
    label = str(block.get("label") or "").strip()
    if label:
        evidence.append(f"Label: {label}")
    if block.get("parametersFitted") is not None:
        evidence.append(
            f"Parameters fitted: {'yes' if block.get('parametersFitted') else 'no'}"
        )

    if status == EVALUATION_HELD_OUT:
        return Finding(
            id="out_of_sample_independence",
            title="Out-of-sample independence",
            status=DECLARED,
            explanation=(
                "The record designates this result as held out. That designation is a "
                "claim about how the run was conducted: the record contains no evidence "
                "that the evaluation window was kept out of the design, so independence "
                "is declared rather than demonstrated."
            ),
            evidence=tuple(evidence),
            limitation=(
                "A held-out label can be attached to a window that was in fact examined "
                "while the rule was being designed. Nothing in the stored record "
                "distinguishes the two cases."
            ),
            next_step=(
                "Record the design and evaluation windows separately, with the date each "
                "was first read, so the holdout can be evidenced rather than asserted."
            ),
        )

    reason = str(block.get("reason") or "").strip()
    return Finding(
        id="out_of_sample_independence",
        title="Out-of-sample independence",
        status=NOT_VERIFIED,
        explanation=(
            "The result is recorded as "
            f"{label or status.replace('_', ' ')}, not as held out. The data that "
            "produced it also informed the design, so it is a real measurement whose "
            "independence is limited."
        ),
        evidence=tuple(evidence + ([reason] if reason else [])),
        limitation=(
            "A retrospective result is not worthless, but it is not independent "
            "confirmation. Reading it as out-of-sample proof overstates what was done."
        ),
        next_step=(
            "Freeze the rule and measure it on a window that begins after the data used "
            "to design it."
        ),
    )


def _reproducibility_metadata(subject: ForensicSubject) -> Finding:
    missing = [
        name
        for name, value in (
            ("definition hash", subject.definition_hash),
            ("data fingerprint", subject.data_fingerprint),
        )
        if not value
    ]

    if missing:
        return Finding(
            id="reproducibility_metadata",
            title="Reproducibility metadata",
            status=NOT_VERIFIED,
            explanation=(
                f"The record is missing its {' and '.join(missing)}, so a later run "
                "could not even be identified as the same experiment, let alone "
                "compared against this one."
            ),
            evidence=tuple(f"Missing: {name}" for name in missing),
            next_step=(
                "Re-record the experiment so both the definition hash and the data "
                "fingerprint are stored."
            ),
        )

    return Finding(
        id="reproducibility_metadata",
        title="Reproducibility metadata",
        status=DECLARED,
        explanation=(
            "The definition hash and the data fingerprint are both recorded, so a "
            "later run can be identified as the same experiment and its inputs "
            "compared. No independent rerun comparison is stored, so the result is "
            "reproducible in principle, not reproduced in fact."
        ),
        evidence=(
            f"Definition hash: {subject.definition_hash[:16]}…",
            f"Data fingerprint: {subject.data_fingerprint[:16]}…",
            "Independent rerun comparison: not stored",
        ),
        limitation=(
            "The hashes identify the inputs. They do not show the arithmetic is "
            "correct, and a deterministic bug reproduces perfectly."
        ),
        next_step=(
            "Re-run the experiment from the recorded definition and store the "
            "comparison, so reproduction is evidenced rather than assumed."
        ),
    )


# --------------------------------------------------------------------------
# The report
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class ForensicReport:
    """Every check, plus a plain count of what it established."""

    findings: tuple[Finding, ...]

    def _count(self, status: str) -> int:
        return sum(1 for finding in self.findings if finding.status == status)

    @property
    def verdict(self) -> str:
        total = len(self.findings)
        verified = self._count(VERIFIED)
        declared = self._count(DECLARED)
        failed = self._count(NOT_VERIFIED)
        unknown = self._count(CANNOT_ASSESS)
        skipped = self._count(NOT_APPLICABLE)

        parts = [f"{verified} of {total} checks are verified by the stored record."]
        if declared:
            parts.append(
                f"{declared} {'is' if declared == 1 else 'are'} declared by it but not "
                "independently established."
            )
        if failed:
            parts.append(f"{failed} {'is' if failed == 1 else 'are'} not verified.")
        if unknown:
            parts.append(f"{unknown} could not be assessed from it.")
        if skipped:
            parts.append(
                f"{skipped} {'does' if skipped == 1 else 'do'} not apply to this study."
            )
        return " ".join(parts)

    @property
    def next_steps(self) -> tuple[str, ...]:
        """The most useful next validation steps, in the order the checks run.

        Only steps attached to a check that did not pass: a step for a verified
        check would be busywork dressed as rigour.
        """
        steps: list[str] = []
        for finding in self.findings:
            if finding.status == VERIFIED or not finding.next_step:
                continue
            if finding.next_step not in steps:
                steps.append(finding.next_step)
        return tuple(steps)

    def as_dict(self) -> dict[str, Any]:
        return {
            "version": FORENSICS_VERSION,
            "findings": [finding.as_dict() for finding in self.findings],
            "counts": {
                "total": len(self.findings),
                "verified": self._count(VERIFIED),
                "declared": self._count(DECLARED),
                "notVerified": self._count(NOT_VERIFIED),
                "cannotAssess": self._count(CANNOT_ASSESS),
                "notApplicable": self._count(NOT_APPLICABLE),
            },
            "verdict": self.verdict,
            "nextSteps": list(self.next_steps),
            "note": REPORT_NOTE,
        }


def assess(
    subject: ForensicSubject,
    *,
    price_coverage: Sequence[SymbolCoverage] | None = None,
    minimum_sample: int = quant.SMALL_SAMPLE,
) -> ForensicReport:
    """Assess one stored experiment. Pure: same subject, same report."""
    return ForensicReport(
        findings=(
            _recorded_temporal_boundary(subject),
            _publication_versus_transaction(subject),
            _recorded_fill_convention(subject),
            _price_coverage(subject, price_coverage),
            _benchmark_coverage(subject),
            _survivorship(subject),
            _trading_costs(subject),
            _sample_size(subject, minimum_sample),
            _parameter_sensitivity(subject),
            _multiple_comparisons(subject),
            _out_of_sample(subject),
            _reproducibility_metadata(subject),
        )
    )


def report_for_row(
    row: Any,
    *,
    session: Session | None = None,
    minimum_sample: int = quant.SMALL_SAMPLE,
) -> dict[str, Any]:
    """Assess a stored experiment row, reading price coverage when a session is given.

    Without a session the price-coverage check reports ``cannot_assess`` rather
    than guessing, which is the same answer it gives when the series is missing.
    """
    subject = ForensicSubject.from_row(row)
    coverage: list[SymbolCoverage] | None = None

    if session is not None and subject.symbols and subject.window_end is not None:
        start = subject.period_start or subject.window_end
        coverage = CandleCoverageProbe(session).coverage(
            subject.symbols, start, subject.window_end
        )

    return assess(
        subject, price_coverage=coverage, minimum_sample=minimum_sample
    ).as_dict()


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------


def _mapping(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, Mapping) else {}


def _sequence(value: Any) -> list[Any]:
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes)):
        return list(value)
    return []


def _limitations(subject: ForensicSubject) -> list[str]:
    return [str(item) for item in _sequence(subject.metrics.get("limitations"))]


def _symbols(metrics: Mapping[str, Any], parameters: Mapping[str, Any]) -> tuple[str, ...]:
    universe = _mapping(metrics.get("universe"))
    for source in (
        metrics.get("symbols"),
        universe.get("symbols"),
        parameters.get("symbols"),
    ):
        items = _sequence(source)
        if items:
            return tuple(str(item).upper() for item in items if item)
    return ()


def _cost_bps(metrics: Mapping[str, Any], cost_assumptions: Mapping[str, Any]) -> float | None:
    recorded = metrics.get("costBps")
    if isinstance(recorded, (int, float)):
        return float(recorded)

    round_trip = cost_assumptions.get("roundTripBps")
    if isinstance(round_trip, (int, float)):
        return float(round_trip)

    parts = [
        cost_assumptions.get(key)
        for key in ("spreadBps", "commissionBps", "slippageBps")
    ]
    numbers = [float(part) for part in parts if isinstance(part, (int, float))]
    return sum(numbers) if numbers else None


def _as_utc(value: Any) -> datetime | None:
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _stamp(value: datetime | None) -> str:
    return value.strftime("%Y-%m-%d %H:%M UTC") if value else "not recorded"


def _days(delta: timedelta) -> int:
    return max(0, int(delta.total_seconds() // 86_400))


__all__ = [
    "CANNOT_ASSESS",
    "CandleCoverageProbe",
    "CoverageProbe",
    "DECLARED",
    "FORENSICS_VERSION",
    "Finding",
    "ForensicReport",
    "ForensicSubject",
    "NOT_APPLICABLE",
    "NOT_VERIFIED",
    "REPORT_NOTE",
    "SymbolCoverage",
    "VERIFIED",
    "assess",
    "report_for_row",
]
