"""Insider research signals.

These are measurements, not predictions. Each one states what was reported, over
what window, and what it does not tell you. There is no fitted model and no
claimed hit rate, because neither would be honest at this stage.

Two correctness rules are enforced here and tested:

*Point-in-time.* A signal is computed from transactions whose SEC acceptance
time is at or before ``as_of``. A transaction date is never used for this. A
signal therefore cannot be visible to a backtest before the filing that produced
it was public.

*Amendments.* For a given issuer, reporting person and period, only the most
recently accepted version available at ``as_of`` is used. Before an amendment
was accepted the original stands; after it, the amendment replaces it. Counting
both would double the reported activity.

The score is a bounded, parameter-free transform of the raw measurement. It
ranks signals against each other. It is not a probability of profit and the API
says so.
"""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from wands.config import Settings
from wands.db.models import IntelFilingRow, IntelInsiderTransactionRow, IntelSignalRow
from wands.intelligence.base import (
    IntelQuality,
    SignalCategory,
    SignalDraft,
    TransactionClass,
)

SCORE_SCALE = Decimal("100")
SCORE_QUANTUM = Decimal("0.001")

PURCHASE_CAVEAT = (
    "Open-market purchases are the most direct insider disclosure available, but "
    "insiders are not reliably predictive, position sizes vary by orders of "
    "magnitude, and a purchase may reflect portfolio rebalancing or a scheduled "
    "plan rather than a view on the price."
)
SELLING_CAVEAT = (
    "Sales are frequently driven by pre-arranged Rule 10b5-1 plans, diversification, "
    "tax obligations or compensation structure. A sale is not evidence of a negative "
    "view, and this signal must not be read as bearish."
)
AMENDMENT_CAVEAT = (
    "Only the most recently accepted version of each filing available at the "
    "calculation time is used. Earlier versions are retained in storage but are not "
    "counted."
)


def saturate(raw: Decimal, threshold: Decimal) -> Decimal:
    """Map a non-negative measurement onto 0-100.

    ``100 * (1 - exp(-raw / threshold))`` is monotonic, bounded and has no fitted
    parameters: at the threshold it reads 63, at twice the threshold 86. Two
    deployments with different thresholds still produce comparable rankings
    within their own configuration.
    """
    if threshold <= 0:
        return Decimal("0")
    if raw <= 0:
        return Decimal("0")
    value = 100.0 * (1.0 - math.exp(-float(raw) / float(threshold)))
    return Decimal(str(value)).quantize(SCORE_QUANTUM)


def signal_key(category: SignalCategory, symbol: str, event_ids: list[str]) -> str:
    """Deterministic identity of a signal.

    The key depends on the category, the symbol and the exact set of source
    events — not on when it was computed. Recomputing the same evidence is
    therefore idempotent, while a new filing produces a genuinely new signal.
    """
    material = "|".join(
        [category.value, symbol.upper(), ",".join(sorted(event_ids))]
    )
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class SignalParameters:
    window_days: int
    min_insiders: int
    value_threshold_usd: Decimal
    baseline_days: int


def parameters_from(settings: Settings) -> SignalParameters:
    return SignalParameters(
        window_days=settings.intelligence_cluster_window_days,
        min_insiders=settings.intelligence_cluster_min_insiders,
        value_threshold_usd=settings.intelligence_purchase_value_threshold_usd,
        baseline_days=settings.intelligence_activity_baseline_days,
    )


class InsiderSignalEngine:
    """Computes insider signals from stored filings."""

    def __init__(
        self,
        session: Session,
        settings: Settings,
        *,
        parameters: SignalParameters | None = None,
    ) -> None:
        self.session = session
        self.settings = settings
        self.parameters = parameters or parameters_from(settings)
        self.version = settings.intelligence_signal_engine_version

    # -- public ------------------------------------------------------------

    def compute(
        self,
        *,
        symbols: list[str] | None = None,
        as_of: datetime | None = None,
    ) -> list[SignalDraft]:
        moment = as_of or datetime.now(tz=UTC)
        targets = symbols if symbols is not None else self._symbols(moment)

        drafts: list[SignalDraft] = []
        for symbol in targets:
            drafts.extend(self._for_symbol(symbol, moment))
        return drafts

    def persist(self, drafts: list[SignalDraft]) -> int:
        """Store drafts, skipping any whose evidence is already recorded."""
        created = 0
        for draft in drafts:
            key = signal_key(draft.category, draft.symbol, draft.source_event_ids)
            exists = self.session.scalar(
                select(IntelSignalRow.id).where(IntelSignalRow.signal_key == key)
            )
            if exists is not None:
                continue
            self.session.add(
                IntelSignalRow(
                    signal_key=key,
                    category=draft.category.value,
                    symbol=draft.symbol,
                    source_event_ids=list(draft.source_event_ids),
                    event_time=draft.event_time,
                    public_available_at=draft.public_available_at,
                    calculated_at=datetime.now(tz=UTC),
                    raw_measurement=draft.raw_measurement,
                    raw_unit=draft.raw_unit,
                    score=draft.score,
                    explanation=draft.explanation,
                    data_quality=draft.data_quality.value,
                    confidence_notes=draft.confidence_notes,
                    parameters=dict(draft.parameters),
                    engine_version=self.version,
                )
            )
            created += 1
        self.session.flush()
        return created

    def compute_and_persist(
        self, *, symbols: list[str] | None = None, as_of: datetime | None = None
    ) -> int:
        return self.persist(self.compute(symbols=symbols, as_of=as_of))

    # -- internals ---------------------------------------------------------

    def _symbols(self, as_of: datetime) -> list[str]:
        rows = self.session.scalars(
            select(IntelInsiderTransactionRow.symbol)
            .where(IntelInsiderTransactionRow.accepted_at <= as_of)
            .distinct()
        ).all()
        return sorted({row for row in rows if row})

    def _for_symbol(self, symbol: str, as_of: datetime) -> list[SignalDraft]:
        window_start = as_of - timedelta(days=self.parameters.window_days)
        baseline_start = window_start - timedelta(days=self.parameters.baseline_days)

        rows = self._point_in_time_rows(symbol, as_of, baseline_start)
        current = [row for row in rows if row.accepted_at >= window_start]
        baseline = [row for row in rows if row.accepted_at < window_start]

        drafts: list[SignalDraft] = []
        drafts.extend(self._purchase_cluster(symbol, current, window_start, as_of))
        drafts.extend(self._purchase_value(symbol, current, window_start, as_of))
        drafts.extend(self._activity_change(symbol, current, baseline, window_start, as_of))
        drafts.extend(self._selling_cluster(symbol, current, window_start, as_of))
        return drafts

    def _point_in_time_rows(
        self, symbol: str, as_of: datetime, since: datetime
    ) -> list[IntelInsiderTransactionRow]:
        """Transactions visible at ``as_of``, one version per filing group.

        The group is (issuer, reporting person, period of report). Within a
        group only the most recently accepted version at or before ``as_of``
        survives, which is how an amendment supersedes its original without
        erasing it from history.
        """
        statement = (
            select(IntelInsiderTransactionRow, IntelFilingRow.period_of_report)
            .join(IntelFilingRow, IntelFilingRow.id == IntelInsiderTransactionRow.filing_id)
            .where(
                IntelInsiderTransactionRow.symbol == symbol,
                IntelInsiderTransactionRow.accepted_at <= as_of,
                IntelInsiderTransactionRow.accepted_at >= since,
            )
        )
        pairs = self.session.execute(statement).all()

        latest: dict[tuple[str, str, datetime | None], datetime] = {}
        for row, period in pairs:
            group = (row.issuer_cik, row.reporting_person_cik, period)
            current = latest.get(group)
            if current is None or row.accepted_at > current:
                latest[group] = row.accepted_at

        return [
            row
            for row, period in pairs
            if latest[(row.issuer_cik, row.reporting_person_cik, period)] == row.accepted_at
        ]

    def _purchase_cluster(
        self,
        symbol: str,
        rows: list[IntelInsiderTransactionRow],
        window_start: datetime,
        as_of: datetime,
    ) -> list[SignalDraft]:
        purchases = [
            row
            for row in rows
            if row.classification == TransactionClass.OPEN_MARKET_PURCHASE.value
        ]
        insiders = {row.reporting_person_cik for row in purchases if row.reporting_person_cik}
        if len(insiders) < self.parameters.min_insiders:
            return []

        event_ids = [str(row.id) for row in purchases]
        names = sorted({row.reporting_person_name for row in purchases if row.reporting_person_name})
        raw = Decimal(len(insiders))
        score = saturate(raw, Decimal(self.parameters.min_insiders))

        return [
            SignalDraft(
                category=SignalCategory.INSIDER_PURCHASE_CLUSTER,
                symbol=symbol,
                source_event_ids=event_ids,
                event_time=self._event_time(purchases),
                public_available_at=self._available_at(purchases),
                raw_measurement=raw,
                raw_unit="distinct_insiders",
                score=score,
                explanation=(
                    f"{len(insiders)} distinct insiders reported open-market purchases of "
                    f"{symbol} between {window_start.date().isoformat()} and "
                    f"{as_of.date().isoformat()} ({len(purchases)} reported purchase lines). "
                    f"Reporting persons: {', '.join(names[:6])}"
                    f"{' and others' if len(names) > 6 else ''}."
                ),
                data_quality=IntelQuality.DERIVED,
                confidence_notes=(
                    f"{PURCHASE_CAVEAT} {AMENDMENT_CAVEAT} Affiliated filers may co-file, so "
                    "distinct reporting persons are not guaranteed to be independent "
                    "decision-makers."
                ),
                parameters={
                    "windowDays": self.parameters.window_days,
                    "minInsiders": self.parameters.min_insiders,
                    "windowStart": window_start.isoformat(),
                    "asOf": as_of.isoformat(),
                },
            )
        ]

    def _purchase_value(
        self,
        symbol: str,
        rows: list[IntelInsiderTransactionRow],
        window_start: datetime,
        as_of: datetime,
    ) -> list[SignalDraft]:
        purchases = [
            row
            for row in rows
            if row.classification == TransactionClass.OPEN_MARKET_PURCHASE.value
        ]
        priced = [row for row in purchases if row.value is not None]
        unpriced = len(purchases) - len(priced)
        if not priced:
            return []

        total = sum((Decimal(row.value) for row in priced), Decimal("0"))
        if total < self.parameters.value_threshold_usd:
            return []

        event_ids = [str(row.id) for row in priced]
        score = saturate(total, self.parameters.value_threshold_usd)
        quality = IntelQuality.DERIVED if unpriced == 0 else IntelQuality.INCOMPLETE

        note = (
            f"{PURCHASE_CAVEAT} Value is shares times the price reported on the filing; "
            "it is not a market value at any other time."
        )
        if unpriced:
            note += (
                f" {unpriced} reported purchase line(s) carried no transaction price and "
                "are excluded from the total rather than counted as zero."
            )

        return [
            SignalDraft(
                category=SignalCategory.INSIDER_PURCHASE_VALUE,
                symbol=symbol,
                source_event_ids=event_ids,
                event_time=self._event_time(priced),
                public_available_at=self._available_at(priced),
                raw_measurement=total,
                raw_unit="usd_reported",
                score=score,
                explanation=(
                    f"Reported open-market purchases of {symbol} totalled "
                    f"${total:,.2f} across {len(priced)} priced line(s) between "
                    f"{window_start.date().isoformat()} and {as_of.date().isoformat()}."
                ),
                data_quality=quality,
                confidence_notes=note,
                parameters={
                    "windowDays": self.parameters.window_days,
                    "thresholdUsd": str(self.parameters.value_threshold_usd),
                    "unpricedLines": unpriced,
                    "windowStart": window_start.isoformat(),
                    "asOf": as_of.isoformat(),
                },
            )
        ]

    def _activity_change(
        self,
        symbol: str,
        current: list[IntelInsiderTransactionRow],
        baseline: list[IntelInsiderTransactionRow],
        window_start: datetime,
        as_of: datetime,
    ) -> list[SignalDraft]:
        current_purchases = [
            row
            for row in current
            if row.classification == TransactionClass.OPEN_MARKET_PURCHASE.value
            and row.value is not None
        ]
        baseline_purchases = [
            row
            for row in baseline
            if row.classification == TransactionClass.OPEN_MARKET_PURCHASE.value
            and row.value is not None
        ]
        if not current_purchases or not baseline_purchases:
            return []

        current_total = sum((Decimal(row.value) for row in current_purchases), Decimal("0"))
        baseline_total = sum((Decimal(row.value) for row in baseline_purchases), Decimal("0"))
        if baseline_total <= 0:
            return []

        ratio = (current_total / baseline_total).quantize(Decimal("0.0001"))
        if ratio <= 1:
            return []

        event_ids = [str(row.id) for row in current_purchases + baseline_purchases]
        score = saturate(ratio - 1, Decimal("1"))

        return [
            SignalDraft(
                category=SignalCategory.INSIDER_ACTIVITY_CHANGE,
                symbol=symbol,
                source_event_ids=event_ids,
                event_time=self._event_time(current_purchases),
                public_available_at=self._available_at(current_purchases + baseline_purchases),
                raw_measurement=ratio,
                raw_unit="ratio_vs_baseline",
                score=score,
                explanation=(
                    f"Reported open-market purchase value for {symbol} in the "
                    f"{self.parameters.window_days}-day window ending "
                    f"{as_of.date().isoformat()} was ${current_total:,.2f}, "
                    f"{ratio}x the ${baseline_total:,.2f} reported over the preceding "
                    f"{self.parameters.baseline_days} days."
                ),
                data_quality=IntelQuality.DERIVED,
                confidence_notes=(
                    f"{PURCHASE_CAVEAT} The baseline is a single prior period, not a "
                    "distribution, so a ratio above one is a description of change rather "
                    "than a statistical anomaly."
                ),
                parameters={
                    "windowDays": self.parameters.window_days,
                    "baselineDays": self.parameters.baseline_days,
                    "currentUsd": str(current_total),
                    "baselineUsd": str(baseline_total),
                    "windowStart": window_start.isoformat(),
                    "asOf": as_of.isoformat(),
                },
            )
        ]

    def _selling_cluster(
        self,
        symbol: str,
        rows: list[IntelInsiderTransactionRow],
        window_start: datetime,
        as_of: datetime,
    ) -> list[SignalDraft]:
        sales = [
            row
            for row in rows
            if row.classification == TransactionClass.OPEN_MARKET_SALE.value
        ]
        insiders = {row.reporting_person_cik for row in sales if row.reporting_person_cik}
        if len(insiders) < self.parameters.min_insiders:
            return []

        event_ids = [str(row.id) for row in sales]
        raw = Decimal(len(insiders))
        score = saturate(raw, Decimal(self.parameters.min_insiders))

        return [
            SignalDraft(
                category=SignalCategory.INSIDER_SELLING_CLUSTER,
                symbol=symbol,
                source_event_ids=event_ids,
                event_time=self._event_time(sales),
                public_available_at=self._available_at(sales),
                raw_measurement=raw,
                raw_unit="distinct_insiders",
                score=score,
                explanation=(
                    f"{len(insiders)} distinct insiders reported open-market sales of "
                    f"{symbol} between {window_start.date().isoformat()} and "
                    f"{as_of.date().isoformat()} ({len(sales)} reported sale lines)."
                ),
                data_quality=IntelQuality.DERIVED,
                confidence_notes=f"{SELLING_CAVEAT} {AMENDMENT_CAVEAT}",
                parameters={
                    "windowDays": self.parameters.window_days,
                    "minInsiders": self.parameters.min_insiders,
                    "windowStart": window_start.isoformat(),
                    "asOf": as_of.isoformat(),
                },
            )
        ]

    @staticmethod
    def _event_time(rows: list[IntelInsiderTransactionRow]) -> datetime:
        dates = [row.transaction_date for row in rows if row.transaction_date is not None]
        if dates:
            return max(dates)
        return max(row.accepted_at for row in rows)

    @staticmethod
    def _available_at(rows: list[IntelInsiderTransactionRow]) -> datetime:
        return max(row.accepted_at for row in rows)


__all__ = [
    "InsiderSignalEngine",
    "SignalParameters",
    "parameters_from",
    "saturate",
    "signal_key",
]
