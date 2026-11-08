"""The three research studies that make up Quant Lab 1.0.

Each study answers one question with the data that actually exists, and each is
allowed to answer "not enough data". That is the point: a laboratory that can
only produce impressive numbers is not a laboratory.

*Insider purchases.* A Form 4 reports a trade from last week and is published
today. The study measures forward returns from the moment the filing became
readable, entering at the next session's open. With no insider rows collected
the honest answer is a count of zero, not a statistic.

*Institutional holdings.* A 13F is a quarterly snapshot filed up to 45 days
after the quarter ends. A reported increase is a change in a reported position,
never a real-time purchase, and the study says so in its own output.

*Baseline strategies.* Two transparent price rules, simulated with next-open
fills and costs charged on both legs, benchmarked against holding the same
instrument.

The studies share the experiment identity scheme in ``experiments.py`` so a
re-run of the same definition is recognised as the same experiment rather than
recorded twice.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Sequence
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from wands.config import Settings
from wands.db.models import (
    IntelExperimentRow,
    IntelFilingRow,
    IntelInsiderTransactionRow,
    IntelInstitutionalHoldingRow,
    IntelInstitutionRow,
    IntelSecurityIdentifierRow,
    MarketCandleRow,
)
from wands.intelligence import quant, strategies
from wands.intelligence.experiments import ExperimentDefinition
from wands.intelligence.validation import (
    RESULT_INSUFFICIENT,
    SignalObservation,
    SignalValidator,
)
from wands.logging import get_logger

logger = get_logger(__name__)

STUDY_INSIDER = "insider_purchase_event_study"
STUDY_INSTITUTIONAL = "institutional_holdings_study"
STUDY_STRATEGY = "strategy_baseline"

# Bumped when the *definition of a reported metric* changes, not when the data
# changes. The 1.0 strategy results averaged per-symbol returns and compared them
# against a full-period buy-and-hold, which is not a like-for-like comparison.
# Recording the corrected figures under a new signal version keeps the old result
# in the ledger with its own hash instead of silently overwriting it.
STRATEGY_SIGNAL_VERSION = "1.1"

# The five instruments the pilot covers. Expanding this before the pilot is
# validated would multiply the data-quality questions without answering any.
PILOT_SYMBOLS: tuple[str, ...] = ("AAPL", "MSFT", "NVDA", "AMD", "JPM")


@dataclass(frozen=True)
class ResearchUniverse:
    """A versioned statement of which instruments a study covers, and why.

    A bare symbol list is not a universe. Which instruments, chosen on what
    reference date, by what rule, from what source, over what range, and with
    what known bias is what makes a result reproducible and its limits legible.
    Recording it beside the result lets a later reader tell whether two runs
    covered the same thing.
    """

    identifier: str
    version: str
    symbols: tuple[str, ...]
    rationale: str
    membership_reference_date: str
    data_source: str
    date_range: tuple[str, str]
    eligibility: str
    survivorship_limitation: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "identifier": self.identifier,
            "version": self.version,
            "symbols": list(self.symbols),
            "rationale": self.rationale,
            "membershipReferenceDate": self.membership_reference_date,
            "dataSource": self.data_source,
            "dateRange": {"start": self.date_range[0], "end": self.date_range[1]},
            "eligibility": self.eligibility,
            "survivorshipLimitation": self.survivorship_limitation,
        }


PILOT_UNIVERSE = ResearchUniverse(
    identifier="pilot-large-cap-us",
    version="1.0",
    symbols=PILOT_SYMBOLS,
    rationale=(
        "Five large-capitalisation US listings chosen to exercise the pipeline "
        "across semiconductors, software and banking. They are not a "
        "representation of the market and were not selected by performance."
    ),
    membership_reference_date="2024-01-01",
    data_source="stored daily OHLCV bars from the configured historical provider",
    date_range=("2024-01-01", "2024-12-31"),
    eligibility=(
        "A symbol is measured only when its stored daily series covers the "
        "experiment period and is long enough for the rule's warmup."
    ),
    survivorship_limitation=(
        "Membership is a present-day list of companies that are still listed and "
        "still large. Delisted and acquired issuers are absent, so the sample "
        "carries survivorship bias that is not corrected here."
    ),
)

# How a result relates to the data that produced it. These are not
# interchangeable: only the last is independent evidence.
EVALUATION_IN_SAMPLE = "in_sample"
EVALUATION_RETROSPECTIVE = "retrospective_validation"
EVALUATION_HELD_OUT = "held_out"

# The three periods a properly staged evaluation would use, and what each one
# actually is for this pilot. The holdout is absent rather than empty: no
# untouched window exists in the stored history, and saying so is the honest
# alternative to presenting explored data as a test.
EVALUATION_PERIODS: tuple[dict[str, str], ...] = (
    {
        "period": "development",
        "status": "explored",
        "note": "The rules were written against this data.",
    },
    {
        "period": "validation",
        "status": "explored",
        "note": (
            "The same data was used to check the rules, so it is not an "
            "independent check."
        ),
    },
    {
        "period": "holdout",
        "status": "absent",
        "note": "No untouched window exists in the stored history.",
    },
)


def evaluation_status() -> dict[str, Any]:
    """Whether a result is in-sample, retrospective, or genuinely held out.

    The pilot symbols and the evaluation period were examined while the rules
    were being written, so no part of this data is untouched. Calling the result
    out-of-sample would be a claim the design cannot support, so it is labelled
    retrospective validation and the reason travels with it.
    """
    return {
        "status": EVALUATION_RETROSPECTIVE,
        "label": "Retrospective validation",
        "reason": (
            "The pilot symbols and the evaluation period were examined while the "
            "rules were being written, so this data has already influenced their "
            "design. No untouched holdout window exists in the stored history, so "
            "this is a retrospective result, not independent out-of-sample proof."
        ),
        "parametersFitted": False,
        "selectionMethod": "stated defaults, no grid search",
        "periods": [dict(item) for item in EVALUATION_PERIODS],
    }


INSIDER_PURCHASE = "insider_open_market_purchase"

INSTITUTIONAL_INCREASE = "institutional_increase"
INSTITUTIONAL_DECREASE = "institutional_decrease"
INSTITUTIONAL_NEW = "institutional_new_position"
INSTITUTIONAL_EXIT = "institutional_exit"

STATUS_COMPLETE = "complete"
STATUS_INSUFFICIENT = "insufficient_data"
STATUS_NO_DATA = "no_data"

INSIDER_LIMITATIONS = (
    "A Form 4 is published after the trade it reports. Eligibility is the "
    "filing's public availability time, never the transaction date.",
    "Entry is the open of the first session that begins after the filing became "
    "public, so a filing published during a session waits for the next one.",
    "Only open-market purchases are counted. Awards, option exercises, gifts and "
    "tax withholding are not discretionary purchases and are excluded.",
    "A small sample is reported as a small sample. No result here is a "
    "profitability claim.",
)

INSTITUTIONAL_LIMITATIONS = (
    "A 13F reports a position as of a quarter end and is filed up to 45 days "
    "later. A reported increase is a change in a reported position, not a "
    "real-time purchase, and the two are never treated as the same event.",
    "Amendments restate an earlier filing. Only the latest accepted filing for a "
    "given institution, security and quarter is used, so a restated position is "
    "not counted twice.",
    "The institutional universe here is a small set of filers, not the whole "
    "market. Coverage is reported next to every result.",
    "Security identity is joined on the eight-character CUSIP base because the "
    "identifier table stores the base while holdings store the full nine "
    "characters including the check digit. A mapping that does not match is "
    "reported as unmatched rather than guessed.",
)

STRATEGY_LIMITATIONS = (
    "Parameters are stated defaults, not fitted values. No grid search was run, "
    "so the result is not the best of many attempts.",
    "Indicators read bars up to the decision close and orders fill at the next "
    "open. A rule that could fill at the same close would be using information "
    "it did not have.",
    "Costs are charged on entry and exit. A rule that trades often must earn its "
    "turnover.",
    "The benchmark is buy-and-hold of the same instrument over the same bars. "
    "Beating it is the minimum claim a timing rule has to make.",
    "A timing rule is in the market only part of the time, so its total return is "
    "not directly comparable to a buy-and-hold return earned over the whole "
    "period. The exposure-matched benchmark holds the same instrument over the "
    "same invested bars and is the like-for-like comparison.",
    "The symbol set is five large-cap companies that are still listed and still "
    "large today. Their buy-and-hold returns contain the outcome of having "
    "survived, which no rule could have known in advance, so the benchmark is "
    "biased upward and any excess return biased downward. This is survivorship "
    "and selection bias, and it is not corrected here.",
    "Five symbols is a concentrated sample. One symbol can decide the portfolio "
    "mean, so the median is reported beside it.",
    "Prices are split-adjusted closes and opens. Dividends are not reinvested, so "
    "this is not a total-return comparison, and the buy-and-hold benchmark is "
    "understated by the dividends it did not receive.",
    "Corporate actions beyond splits are not reconstructed. A merger, spin-off or "
    "delisting inside the period would distort both the rule and the benchmark.",
    "The evaluation period is the same period the rules were written against. "
    "There is no held-out out-of-sample window, so these are retrospective "
    "results rather than independent out-of-sample proof.",
    "Three rules were evaluated on the same data. A per-rule p-value is not "
    "corrected for that search unless a multiple-testing adjustment is reported "
    "alongside it.",
    "Hypothetical research result. Not realised account P&L, and not an "
    "instruction to trade.",
)


def _canonical(payload: Any) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)


def _hash(payload: Any) -> str:
    return hashlib.sha256(_canonical(payload).encode("utf-8")).hexdigest()


def _as_utc(moment: datetime) -> datetime:
    if moment.tzinfo is None:
        return moment.replace(tzinfo=UTC)
    return moment.astimezone(UTC)


def _column(completed: Sequence[dict[str, Any]], key: str) -> list[float]:
    return [
        float(item["metrics"][key])
        for item in completed
        if (item.get("metrics") or {}).get(key) is not None
    ]


def _mean(values: Sequence[float]) -> float | None:
    return (sum(values) / len(values)) if values else None


def _median(values: Sequence[float]) -> float | None:
    return quant.describe(values).median if values else None


def portfolio_figures(completed: Sequence[dict[str, Any]]) -> dict[str, Any]:
    """Portfolio-level figures from per-symbol strategy results.

    Equal capital in each measured symbol, held without rebalancing, so the
    portfolio return is the *mean* of the per-symbol compounded returns. It is
    never a sum: adding five percentage returns together produces a number no
    account could have earned, and comparing that sum against a mean is the
    error this function exists to prevent.

    The median is reported beside the mean because five symbols is few enough
    for one of them to decide the average.
    """
    strategy_returns = _column(completed, "totalReturn")
    benchmark_returns = _column(completed, "benchmarkReturn")
    matched_returns = _column(completed, "matchedBenchmarkReturn")
    cost_drags = _column(completed, "costDrag")
    exposures = _column(completed, "exposure")

    portfolio_return = _mean(strategy_returns)
    portfolio_benchmark = _mean(benchmark_returns)
    portfolio_matched = _mean(matched_returns)

    return {
        "meanStrategyReturn": portfolio_return,
        "meanBenchmarkReturn": portfolio_benchmark,
        "meanExcessReturn": (
            portfolio_return - portfolio_benchmark
            if portfolio_return is not None and portfolio_benchmark is not None
            else None
        ),
        "meanMatchedBenchmarkReturn": portfolio_matched,
        "meanExcessVsMatched": (
            portfolio_return - portfolio_matched
            if portfolio_return is not None and portfolio_matched is not None
            else None
        ),
        "medianStrategyReturn": _median(strategy_returns),
        "medianBenchmarkReturn": _median(benchmark_returns),
        "meanExposure": _mean(exposures),
        "costDrag": _mean(cost_drags),
    }


@dataclass
class StudyOutcome:
    """One study run, plus whether it reproduced a stored result."""

    experiment: IntelExperimentRow
    payload: dict[str, Any]
    reproduction: str
    note: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {
            "experiment": experiment_payload(self.experiment),
            "reproduction": self.reproduction,
            "note": self.note,
            "result": self.payload,
        }


def experiment_payload(row: IntelExperimentRow) -> dict[str, Any]:
    """The customer-safe shape of a stored experiment."""
    return {
        "id": str(row.id),
        "name": row.name,
        "status": row.status,
        "signalVersion": row.signal_version,
        "dataVersion": row.data_version,
        "periodStart": row.period_start.isoformat() if row.period_start else None,
        "periodEnd": row.period_end.isoformat() if row.period_end else None,
        "informationCutoff": (
            row.information_cutoff.isoformat() if row.information_cutoff else None
        ),
        "benchmark": row.benchmark,
        "parameters": row.parameters,
        "executionAssumptions": row.execution_assumptions,
        "costAssumptions": row.cost_assumptions,
        "sampleSize": row.sample_size,
        "coverage": row.coverage,
        "metrics": row.metrics,
        "flags": list(row.flags or []),
        "definitionHash": row.definition_hash,
        "dataFingerprint": row.data_fingerprint,
        "createdAt": row.created_at.isoformat() if row.created_at else None,
        "completedAt": row.completed_at.isoformat() if row.completed_at else None,
    }


class QuantLab:
    """Runs the three studies and records them as reproducible experiments."""

    def __init__(
        self,
        session: Session,
        settings: Settings,
        *,
        validator: SignalValidator | None = None,
    ) -> None:
        self.session = session
        self.settings = settings
        self.validator = validator or SignalValidator(session, settings)

    # -- insider purchases -------------------------------------------------

    def insider_observations(
        self, definition: ExperimentDefinition
    ) -> tuple[list[SignalObservation], dict[str, Any]]:
        """Open-market purchases that were public inside the window.

        The filter is on ``accepted_at``, never ``transaction_date``. A purchase
        that happened inside the window but was published after the cutoff was
        not knowable, so it is not in the sample.
        """
        total_transactions = (
            self.session.scalar(
                select(func.count()).select_from(IntelInsiderTransactionRow)
            )
            or 0
        )
        total_filings = (
            self.session.scalar(select(func.count()).select_from(IntelFilingRow)) or 0
        )

        statement = (
            select(IntelInsiderTransactionRow)
            .where(
                IntelInsiderTransactionRow.is_open_market.is_(True),
                IntelInsiderTransactionRow.acquired_disposed == "A",
                IntelInsiderTransactionRow.is_amendment.is_(False),
                IntelInsiderTransactionRow.accepted_at >= definition.period_start,
                IntelInsiderTransactionRow.accepted_at <= definition.period_end,
                IntelInsiderTransactionRow.accepted_at <= definition.information_cutoff,
            )
            .order_by(IntelInsiderTransactionRow.accepted_at)
        )
        rows = self.session.scalars(statement).all()

        observations = [
            SignalObservation(
                signal_id=str(row.id),
                category=INSIDER_PURCHASE,
                symbol=row.symbol,
                public_available_at=_as_utc(row.accepted_at),
                score=float(row.value) if row.value is not None else None,
            )
            for row in rows
            if row.symbol
        ]

        availability = {
            "insiderTransactionsStored": int(total_transactions),
            "filingsStored": int(total_filings),
            "openMarketPurchasesInWindow": len(observations),
            "purchasesWithoutSymbol": len(rows) - len(observations),
        }
        return observations, availability

    def run_insider_study(self, definition: ExperimentDefinition) -> StudyOutcome:
        observations, availability = self.insider_observations(definition)
        fingerprint = _hash(
            {
                "signals": [
                    [item.signal_id, item.symbol, item.public_available_at.isoformat()]
                    for item in observations
                ],
                "availability": availability,
            }
        )

        existing = self._existing(definition)
        if existing is not None:
            return self._reproduced(existing, fingerprint)

        if not observations:
            payload = {
                "study": STUDY_INSIDER,
                "title": "Insider open-market purchases and forward returns",
                "status": STATUS_INSUFFICIENT,
                "sampleSize": 0,
                "dataAvailability": availability,
                "horizons": [],
                "coverage": {},
                "flags": [
                    "INSUFFICIENT DATA: no open-market insider purchases were public "
                    "inside this window, so no forward return can be measured.",
                    f"Exactly {availability['openMarketPurchasesInWindow']} qualifying "
                    "purchases were found. The study reports the count rather than a "
                    "statistic computed from nothing.",
                ],
                "limitations": list(INSIDER_LIMITATIONS),
            }
            row = self._record(
                definition,
                status=STATUS_INSUFFICIENT,
                sample_size=0,
                metrics=payload,
                coverage=availability,
                flags=payload["flags"],
                fingerprint=fingerprint,
            )
            return StudyOutcome(
                experiment=row,
                payload=payload,
                reproduction="new",
                note="No qualifying insider purchases exist, so the study is recorded as insufficient.",
            )

        validation = self.validator.evaluate(
            observations,
            category=INSIDER_PURCHASE,
            horizons=list(definition.horizons),
            benchmark=definition.benchmark,
            cost_bps=float(self.settings.validation_cost_bps),
        )

        payload = {
            "study": STUDY_INSIDER,
            "title": "Insider open-market purchases and forward returns",
            "status": validation.status,
            "sampleSize": validation.sample_size,
            "dataAvailability": availability,
            "benchmark": validation.benchmark,
            "costBps": validation.cost_bps,
            "horizons": [horizon.as_dict() for horizon in validation.horizons],
            "splits": [split.as_dict() for split in validation.splits],
            "coverage": validation.coverage,
            "overlap": validation.overlap,
            "multipleTesting": (
                validation.multiple_testing.as_dict()
                if validation.multiple_testing
                else None
            ),
            "flags": list(validation.flags),
            "limitations": list(INSIDER_LIMITATIONS),
        }

        row = self._record(
            definition,
            status=validation.status,
            sample_size=validation.sample_size,
            metrics=payload,
            coverage=validation.coverage,
            flags=validation.flags,
            fingerprint=fingerprint,
        )
        return StudyOutcome(
            experiment=row,
            payload=payload,
            reproduction="new",
            note="A new insider event study was recorded.",
        )

    # -- institutional holdings -------------------------------------------

    def _mapped_cusips(self, symbols: Sequence[str]) -> dict[str, str]:
        """Eight-character CUSIP base to symbol, for the requested symbols.

        The identifier table stores the eight-character base; holdings store the
        full nine characters with the check digit. Joining on the base is the
        only honest match available, and it is reported as such.
        """
        rows = self.session.execute(
            select(
                IntelSecurityIdentifierRow.cusip,
                IntelSecurityIdentifierRow.symbol,
            ).where(IntelSecurityIdentifierRow.symbol.in_(list(symbols)))
        ).all()
        return {row.cusip: row.symbol for row in rows}

    def _positions(
        self, symbols: Sequence[str]
    ) -> tuple[dict[tuple[str, str], dict[datetime, dict[str, Any]]], dict[str, Any]]:
        """Latest accepted position per institution, security and quarter."""
        base_to_symbol = self._mapped_cusips(symbols)
        if not base_to_symbol:
            return {}, {"mappedSecurities": 0, "holdingsRows": 0, "unmatchedCusips": []}

        base = func.substr(IntelInstitutionalHoldingRow.cusip, 1, 8)
        rows = self.session.scalars(
            select(IntelInstitutionalHoldingRow).where(base.in_(list(base_to_symbol)))
        ).all()

        # An amendment restates an earlier filing for the same quarter. Keeping
        # the latest accepted row per (institution, security, quarter) means a
        # restated position is counted once, at its final value.
        latest: dict[tuple[str, str, datetime], IntelInstitutionalHoldingRow] = {}
        for row in rows:
            key = (str(row.institution_id), row.cusip, _as_utc(row.period_of_report))
            current = latest.get(key)
            if current is None or _as_utc(row.accepted_at) > _as_utc(current.accepted_at):
                latest[key] = row

        positions: dict[tuple[str, str], dict[datetime, dict[str, Any]]] = {}
        for (institution_id, cusip, period), row in latest.items():
            symbol = base_to_symbol.get(cusip[:8], "")
            if not symbol:
                continue
            positions.setdefault((institution_id, symbol), {})[period] = {
                "shares": float(row.shares) if row.shares is not None else None,
                "value": float(row.value_usd) if row.value_usd is not None else None,
                "accepted_at": _as_utc(row.accepted_at),
                "is_amendment": bool(row.is_amendment),
            }

        coverage = {
            "mappedSecurities": len(base_to_symbol),
            "holdingsRows": len(rows),
            "deduplicatedPositions": len(latest),
            "institutions": len({key[0] for key in positions}),
            "quarters": len({period for series in positions.values() for period in series}),
        }
        return positions, coverage

    def institutional_events(
        self, symbols: Sequence[str]
    ) -> tuple[dict[str, list[SignalObservation]], dict[str, Any]]:
        """Position changes, each dated by when the later filing became public."""
        positions, coverage = self._positions(symbols)
        events: dict[str, list[SignalObservation]] = {
            INSTITUTIONAL_INCREASE: [],
            INSTITUTIONAL_DECREASE: [],
            INSTITUTIONAL_NEW: [],
            INSTITUTIONAL_EXIT: [],
        }

        for (institution_id, symbol), series in positions.items():
            periods = sorted(series)
            for previous, current in zip(periods, periods[1:], strict=False):
                before = series[previous]
                after = series[current]
                before_shares = before["shares"]
                after_shares = after["shares"]
                if before_shares is None or after_shares is None:
                    continue

                if before_shares <= 0 and after_shares > 0:
                    category = INSTITUTIONAL_NEW
                elif before_shares > 0 and after_shares <= 0:
                    category = INSTITUTIONAL_EXIT
                elif after_shares > before_shares:
                    category = INSTITUTIONAL_INCREASE
                elif after_shares < before_shares:
                    category = INSTITUTIONAL_DECREASE
                else:
                    continue

                events[category].append(
                    SignalObservation(
                        signal_id=f"{institution_id}:{symbol}:{current.date().isoformat()}",
                        category=category,
                        symbol=symbol,
                        # Availability is the later filing's acceptance, not the
                        # quarter end. The quarter end is history by then.
                        public_available_at=after["accepted_at"],
                        score=after_shares - before_shares,
                    )
                )

        coverage["events"] = {category: len(items) for category, items in events.items()}
        return events, coverage

    def _benchmark_available(self, symbol: str) -> bool:
        """Whether the benchmark has any stored bars at all.

        A missing benchmark is a data gap, not a zero. Checking it up front lets
        the study say so once instead of leaving the reader to infer it from a
        column of nulls.
        """
        if not symbol:
            return False
        count = self.session.scalar(
            select(func.count())
            .select_from(MarketCandleRow)
            .where(MarketCandleRow.symbol == symbol.upper())
        )
        return bool(count)

    def _concentration(self, symbols: Sequence[str]) -> dict[str, Any]:
        """How much of each filer's reported book sits in its largest position."""
        base = func.substr(IntelInstitutionalHoldingRow.cusip, 1, 8)
        base_to_symbol = self._mapped_cusips(symbols)
        if not base_to_symbol:
            return {"status": STATUS_NO_DATA, "note": "No mapped securities."}

        rows = self.session.execute(
            select(
                IntelInstitutionalHoldingRow.institution_id,
                IntelInstitutionalHoldingRow.period_of_report,
                func.sum(IntelInstitutionalHoldingRow.value_usd),
                func.max(IntelInstitutionalHoldingRow.value_usd),
                func.count(),
            )
            .where(base.in_(list(base_to_symbol)))
            .group_by(
                IntelInstitutionalHoldingRow.institution_id,
                IntelInstitutionalHoldingRow.period_of_report,
            )
        ).all()

        samples: list[dict[str, Any]] = []
        for institution_id, period, total, largest, count in rows:
            if not total or float(total) <= 0:
                continue
            samples.append(
                {
                    "institutionId": str(institution_id),
                    "period": _as_utc(period).date().isoformat(),
                    "positions": int(count),
                    "topWeight": float(largest) / float(total),
                }
            )

        if not samples:
            return {"status": STATUS_NO_DATA, "note": "No valued positions to measure."}

        weights = [sample["topWeight"] for sample in samples]
        return {
            "status": STATUS_COMPLETE,
            "samples": len(samples),
            "meanTopWeight": sum(weights) / len(weights),
            "maxTopWeight": max(weights),
            "minTopWeight": min(weights),
            "detail": samples,
            "note": (
                "Top-position weight is the largest reported position divided by the "
                "filer's total reported value for that quarter, restricted to the "
                "mapped pilot securities."
            ),
        }

    def run_institutional_study(self, definition: ExperimentDefinition) -> StudyOutcome:
        symbols = tuple(definition.parameters.get("symbols", PILOT_SYMBOLS))
        events, coverage = self.institutional_events(symbols)
        concentration = self._concentration(symbols)

        fingerprint = _hash(
            {
                "events": {
                    category: [
                        [item.signal_id, item.symbol, item.public_available_at.isoformat()]
                        for item in items
                    ]
                    for category, items in events.items()
                },
                "coverage": coverage,
            }
        )

        existing = self._existing(definition)
        if existing is not None:
            return self._reproduced(existing, fingerprint)

        total_events = sum(len(items) for items in events.values())
        categories: list[dict[str, Any]] = []
        for category, items in events.items():
            if not items:
                categories.append(
                    {
                        "category": category,
                        "sampleSize": 0,
                        "status": STATUS_INSUFFICIENT,
                        "note": "No position change of this kind was observed.",
                    }
                )
                continue
            result = self.validator.evaluate(
                items,
                category=category,
                horizons=list(definition.horizons),
                benchmark=definition.benchmark,
                cost_bps=float(self.settings.validation_cost_bps),
            )
            categories.append(
                {
                    "category": category,
                    "sampleSize": result.sample_size,
                    "status": result.status,
                    "horizons": [horizon.as_dict() for horizon in result.horizons],
                    "coverage": result.coverage,
                    "flags": list(result.flags),
                }
            )

        # A study is only complete when at least one category cleared the
        # validator's minimum sample. Reporting "complete" because events exist
        # would overstate what was measured.
        measured = [item for item in categories if item["sampleSize"] > 0]
        if not total_events:
            status = STATUS_INSUFFICIENT
        elif measured and all(item["status"] == RESULT_INSUFFICIENT for item in measured):
            status = STATUS_INSUFFICIENT
        else:
            status = STATUS_COMPLETE

        benchmark_available = self._benchmark_available(definition.benchmark)
        coverage["benchmark"] = definition.benchmark
        coverage["benchmarkAvailable"] = benchmark_available

        flags: list[str] = []
        if not total_events:
            flags.append(
                "INSUFFICIENT DATA: no institutional position changes were observed "
                "for the mapped pilot securities."
            )
        if not benchmark_available:
            flags.append(
                f"No {definition.benchmark} bars are stored, so no benchmark-adjusted "
                "return was computed. Raw forward returns are reported instead, and "
                "they are not excess returns."
            )
        if coverage.get("institutions", 0) < 10:
            flags.append(
                f"Only {coverage.get('institutions', 0)} filers are present. This is a "
                "sample of the institutional universe, not the universe itself."
            )
        if total_events and total_events < quant.SMALL_SAMPLE:
            flags.append(
                f"{total_events} position changes is a small sample. Forward returns "
                "over this many events are descriptive, not evidence."
            )

        payload = {
            "study": STUDY_INSTITUTIONAL,
            "title": "Institutional position changes and forward returns",
            "status": status,
            "sampleSize": total_events,
            "symbols": list(symbols),
            "benchmark": definition.benchmark,
            "costBps": float(self.settings.validation_cost_bps),
            "categories": categories,
            "concentration": concentration,
            "coverage": coverage,
            "flags": flags,
            "limitations": list(INSTITUTIONAL_LIMITATIONS),
        }

        row = self._record(
            definition,
            status=status,
            sample_size=total_events,
            metrics=payload,
            coverage=coverage,
            flags=flags,
            fingerprint=fingerprint,
        )
        return StudyOutcome(
            experiment=row,
            payload=payload,
            reproduction="new",
            note="A new institutional holdings study was recorded.",
        )

    # -- baseline strategies ----------------------------------------------

    def run_strategy_study(self, definition: ExperimentDefinition) -> StudyOutcome:
        symbols = tuple(definition.parameters.get("symbols", PILOT_UNIVERSE.symbols))
        # Record the universe that actually ran, not the default it was derived
        # from: a definition that narrowed the symbol list must not be described
        # by a universe that claims the wider one.
        universe = replace(PILOT_UNIVERSE, symbols=symbols)
        raw = definition.parameters.get("strategy", {})
        parameters = strategies.StrategyParameters.from_dict(raw)

        # The simulation is bounded by the period the experiment declares, and by
        # its information cutoff. Reading the whole stored series instead would
        # make the recorded period a label that does not describe the run, and
        # would let bars past the cutoff influence a result that claims not to
        # have used them.
        window_end = min(definition.period_end, definition.information_cutoff)

        provider = strategies.CandleBarProvider(self.session)
        per_symbol: list[dict[str, Any]] = []
        pooled: list[float] = []
        total_costs = 0.0
        bars_used = 0

        for symbol in symbols:
            bars = provider.bars(symbol, definition.period_start, window_end)
            if not bars:
                per_symbol.append(
                    {
                        "symbol": symbol,
                        "status": strategies.STATUS_NO_PRICE_DATA,
                        "note": (
                            "No daily bars are stored for this symbol inside the "
                            "experiment period."
                        ),
                    }
                )
                continue
            result = strategies.simulate(bars, parameters, symbol=symbol)
            bars_used += len(bars)
            total_costs += float(result.metrics.get("totalCosts") or 0.0)
            pooled.extend(result.net_returns)

            # The same rule with zero commission, so the cost of trading is
            # measured as a portfolio return difference rather than inferred from
            # a sum of per-trade fractions.
            gross = strategies.simulate(
                bars, replace(parameters, cost_bps=0.0), symbol=symbol
            )
            metrics = dict(result.metrics)
            gross_return = gross.metrics.get("totalReturn")
            net_return = metrics.get("totalReturn")
            metrics["grossReturn"] = gross_return
            metrics["costDrag"] = (
                gross_return - net_return
                if gross_return is not None and net_return is not None
                else None
            )

            per_symbol.append(
                {
                    "symbol": symbol,
                    "status": result.status,
                    "metrics": metrics,
                    "coverage": result.coverage,
                    "flags": list(result.flags),
                    "equityCurve": result.equity_curve,
                    "benchmarkCurve": result.benchmark_curve,
                    "matchedCurve": result.matched_curve,
                    "curveDates": [moment.isoformat() for moment in result.curve_dates],
                    "trades": [trade.as_dict() for trade in result.trades],
                }
            )

        fingerprint = _hash(
            {
                "symbols": list(symbols),
                "parameters": parameters.as_dict(),
                "bars": bars_used,
                "trades": len(pooled),
            }
        )

        existing = self._existing(definition)
        if existing is not None:
            return self._reproduced(existing, fingerprint)

        stats = quant.describe(pooled)
        interval = quant.mean_confidence_interval(pooled)
        test = quant.significance(pooled)

        completed = [item for item in per_symbol if item["status"] == strategies.STATUS_COMPLETE]
        status = STATUS_COMPLETE if completed else STATUS_INSUFFICIENT

        figures = portfolio_figures(completed)
        portfolio_return = figures["meanStrategyReturn"]
        portfolio_benchmark = figures["meanBenchmarkReturn"]
        portfolio_matched = figures["meanMatchedBenchmarkReturn"]
        mean_exposure = figures["meanExposure"]

        flags: list[str] = []
        if not completed:
            flags.append(
                "INSUFFICIENT DATA: no symbol had enough bars for this rule's warmup."
            )
        if pooled and len(pooled) < quant.SMALL_SAMPLE:
            flags.append(
                f"{len(pooled)} trades across {len(completed)} symbols is a small "
                "sample. The mean is reported but is not evidence of an edge."
            )
        if mean_exposure is not None and mean_exposure < 0.5:
            flags.append(
                f"The rule was invested on {mean_exposure:.1%} of bars. Its total "
                "return is not comparable to a buy-and-hold return earned over 100% "
                "of the same period, so the exposure-matched benchmark is the "
                "comparison that matters here."
            )
        if pooled and len(pooled) >= quant.SMALL_SAMPLE:
            flags.append(
                "The t test treats each round trip as an independent observation. "
                "Trades in the same symbol overlap in time and the five symbols are "
                "correlated, so the true standard error is wider than the reported "
                "one and the p-value is optimistic."
            )

        payload = {
            "study": STUDY_STRATEGY,
            "title": f"{parameters.kind.replace('_', ' ').title()} baseline",
            "status": status,
            "sampleSize": len(pooled),
            "symbols": list(symbols),
            "universe": universe.as_dict(),
            "evaluationStatus": evaluation_status(),
            "parameters": parameters.as_dict(),
            "benchmark": "BUY_AND_HOLD",
            "costBps": parameters.cost_bps,
            "summary": {
                "tradeCount": len(pooled),
                "meanTradeReturn": stats.mean,
                "medianTradeReturn": stats.median,
                "winRate": stats.hit_rate,
                "profitFactor": stats.profit_factor,
                "totalCosts": total_costs,
                "averageCostPerTrade": (total_costs / len(pooled)) if pooled else None,
                **figures,
                "symbolsMeasured": len(completed),
                "tradeReturnInterval": interval.as_dict(),
                "tradeReturnSignificance": test.as_dict(),
                "smallSample": stats.small_sample,
            },
            "definitions": {
                "meanStrategyReturn": (
                    "Portfolio return: equal capital in each measured symbol, held "
                    "without rebalancing, so it is the mean of the per-symbol "
                    "compounded returns. A mean, never a sum."
                ),
                "meanBenchmarkReturn": (
                    "Buy-and-hold of the same symbols over the same bars, equal "
                    "capital, no rebalancing. Mean of the per-symbol buy-and-hold "
                    "returns."
                ),
                "meanMatchedBenchmarkReturn": (
                    "Buy-and-hold of the same symbols restricted to the bars the "
                    "rule was invested, cash elsewhere. Same exposure as the rule, "
                    "so it isolates bar selection from time in market."
                ),
                "meanExcessVsMatched": (
                    "Portfolio return minus the exposure-matched benchmark. This is "
                    "the comparison that answers whether the timing rule added value."
                ),
                "meanExcessReturn": (
                    "Portfolio return minus full buy-and-hold. A rule that is in the "
                    "market part of the time is expected to trail a rising market "
                    "here; that gap is exposure, not skill."
                ),
                "meanTradeReturn": (
                    "Mean net return of one round trip, pooled across symbols. A "
                    "per-trade figure, not a portfolio figure."
                ),
                "costDrag": (
                    "Portfolio return at zero commission minus portfolio return with "
                    "commission. The cost of trading expressed as a return difference."
                ),
                "totalCosts": (
                    "Sum of per-trade cost fractions across every trade. Not a "
                    "portfolio cost and not comparable to a return."
                ),
            },
            "series": per_symbol,
            "coverage": {
                "symbols": len(symbols),
                "symbolsWithPrices": len(completed),
                "bars": bars_used,
                # The window actually simulated, which is the declared period
                # clipped to the information cutoff rather than the whole series.
                "windowStart": definition.period_start.isoformat(),
                "windowEnd": window_end.isoformat(),
            },
            "flags": flags,
            "limitations": list(STRATEGY_LIMITATIONS),
        }

        row = self._record(
            definition,
            status=status,
            sample_size=len(pooled),
            metrics=payload,
            coverage=payload["coverage"],
            flags=flags,
            fingerprint=fingerprint,
        )
        return StudyOutcome(
            experiment=row,
            payload=payload,
            reproduction="new",
            note="A new strategy baseline was recorded.",
        )

    # -- orchestration -----------------------------------------------------

    def run_all(
        self, *, period_start: datetime, period_end: datetime, cutoff: datetime
    ) -> list[StudyOutcome]:
        """Run the full lab: one insider study, one holdings study, three rules."""
        outcomes: list[StudyOutcome] = []

        outcomes.append(
            self.run_insider_study(
                ExperimentDefinition(
                    name="Insider open-market purchases",
                    period_start=period_start,
                    period_end=period_end,
                    information_cutoff=cutoff,
                    categories=(INSIDER_PURCHASE,),
                    horizons=(1, 5, 10, 20, 60),
                    parameters={"symbols": list(PILOT_SYMBOLS)},
                    execution_assumptions={
                        "entry": "next_session_open",
                        "exit": "close_after_horizon_sessions",
                    },
                    cost_assumptions={
                        "spreadBps": float(self.settings.intelligence_validation_spread_bps),
                        "commissionBps": float(
                            self.settings.intelligence_validation_commission_bps
                        ),
                        "slippageBps": float(
                            self.settings.intelligence_validation_slippage_bps
                        ),
                    },
                )
            )
        )

        outcomes.append(
            self.run_institutional_study(
                ExperimentDefinition(
                    name="Institutional position changes",
                    period_start=period_start,
                    period_end=period_end,
                    information_cutoff=cutoff,
                    categories=(
                        INSTITUTIONAL_INCREASE,
                        INSTITUTIONAL_DECREASE,
                        INSTITUTIONAL_NEW,
                        INSTITUTIONAL_EXIT,
                    ),
                    horizons=(5, 20, 60),
                    parameters={"symbols": list(PILOT_SYMBOLS)},
                    execution_assumptions={
                        "entry": "next_session_open_after_filing_acceptance",
                        "exit": "close_after_horizon_sessions",
                    },
                    cost_assumptions={
                        "spreadBps": float(self.settings.intelligence_validation_spread_bps),
                        "commissionBps": float(
                            self.settings.intelligence_validation_commission_bps
                        ),
                        "slippageBps": float(
                            self.settings.intelligence_validation_slippage_bps
                        ),
                    },
                )
            )
        )

        rules = (
            ("Trend following (moving average)", {"kind": strategies.TREND}),
            (
                "Trend following (breakout)",
                {"kind": strategies.TREND, "rule": strategies.RULE_BREAKOUT},
            ),
            ("Mean reversion", {"kind": strategies.MEAN_REVERSION}),
        )
        strategy_outcomes: list[StudyOutcome] = []
        for name, raw in rules:
            parameters = strategies.StrategyParameters(**raw)
            outcome = self.run_strategy_study(
                ExperimentDefinition(
                    name=name,
                    signal_version=STRATEGY_SIGNAL_VERSION,
                    period_start=period_start,
                    period_end=period_end,
                    information_cutoff=cutoff,
                    categories=(STUDY_STRATEGY,),
                    horizons=(),
                    benchmark="BUY_AND_HOLD",
                    parameters={
                        "symbols": list(PILOT_SYMBOLS),
                        "strategy": parameters.as_dict(),
                    },
                    execution_assumptions={
                        "entry": "next_session_open",
                        "exit": "next_session_open_after_signal",
                        "sizing": "fraction_of_equity",
                    },
                    cost_assumptions={"roundTripBps": parameters.cost_bps},
                )
            )
            strategy_outcomes.append(outcome)
            outcomes.append(outcome)

        self._apply_multiple_testing(strategy_outcomes)
        return outcomes

    def _apply_multiple_testing(self, outcomes: Sequence[StudyOutcome]) -> None:
        """Correct the family of rule p-values for having searched three rules.

        Three rules were run against the same five symbols over the same period.
        A raw p-value from any one of them ignores that search, so the family is
        corrected here and the correction is written back onto each stored result.
        """
        p_values: list[float] = []
        targets: list[StudyOutcome] = []
        for outcome in outcomes:
            summary = outcome.payload.get("summary") or {}
            significance = summary.get("tradeReturnSignificance") or {}
            p_value = significance.get("pValue")
            if p_value is None:
                continue
            p_values.append(float(p_value))
            targets.append(outcome)

        if not p_values:
            return

        report = quant.multiple_testing_report(p_values).as_dict()
        for index, outcome in enumerate(targets):
            block = {
                **report,
                "survives": bool(report["survivors"][index]),
                "rawPValue": p_values[index],
                "family": "the three baseline rules run over the same symbols and period",
            }
            row = outcome.experiment
            # Build the replacement from the stored value before touching the
            # payload. The payload and the row share one dict, so mutating the
            # payload first would make the reassignment look unchanged and the
            # correction would never reach the database.
            updated = {**row.metrics, "multipleTesting": block}
            row.metrics = updated
            outcome.payload = updated

    # -- storage -----------------------------------------------------------

    def _existing(self, definition: ExperimentDefinition) -> IntelExperimentRow | None:
        return self.session.scalar(
            select(IntelExperimentRow).where(
                IntelExperimentRow.definition_hash == definition.definition_hash()
            )
        )

    def _reproduced(
        self, row: IntelExperimentRow, fingerprint: str
    ) -> StudyOutcome:
        if row.data_fingerprint == fingerprint:
            return StudyOutcome(
                experiment=row,
                payload=row.metrics,
                reproduction="identical",
                note=(
                    "This definition has already been run against the same data. The "
                    "stored result is returned unchanged."
                ),
            )
        return StudyOutcome(
            experiment=row,
            payload=row.metrics,
            reproduction="data_changed",
            note=(
                "This definition has already been run, but the underlying data has "
                "changed. The stored result is preserved; re-run under a new data "
                "version to measure the difference."
            ),
        )

    def _record(
        self,
        definition: ExperimentDefinition,
        *,
        status: str,
        sample_size: int,
        metrics: dict[str, Any],
        coverage: dict[str, Any],
        flags: Sequence[str],
        fingerprint: str,
    ) -> IntelExperimentRow:
        now = datetime.now(tz=UTC)
        row = IntelExperimentRow(
            name=definition.name,
            signal_version=definition.signal_version,
            data_version=definition.data_version or fingerprint[:16],
            period_start=definition.period_start,
            period_end=definition.period_end,
            information_cutoff=definition.information_cutoff,
            benchmark=definition.benchmark.upper(),
            parameters=dict(definition.parameters),
            execution_assumptions=dict(definition.execution_assumptions),
            cost_assumptions=dict(definition.cost_assumptions),
            sample_size=sample_size,
            coverage=coverage,
            metrics=metrics,
            status=status,
            flags=list(flags),
            definition_hash=definition.definition_hash(),
            data_fingerprint=fingerprint,
            created_at=now,
            completed_at=now,
        )
        self.session.add(row)
        self.session.flush()

        logger.info(
            "quant lab experiment recorded",
            extra={
                "event": "intelligence.quant_lab",
                "context": {
                    "definitionHash": row.definition_hash,
                    "status": status,
                    "sampleSize": sample_size,
                },
            },
        )
        return row

    # -- reading -----------------------------------------------------------

    def list(self, *, limit: int = 50) -> list[IntelExperimentRow]:
        return list(
            self.session.scalars(
                select(IntelExperimentRow)
                .order_by(IntelExperimentRow.created_at.desc())
                .limit(limit)
            ).all()
        )

    def get(self, experiment_id: str) -> IntelExperimentRow | None:
        return self.session.scalar(
            select(IntelExperimentRow).where(IntelExperimentRow.id == experiment_id)
        )
