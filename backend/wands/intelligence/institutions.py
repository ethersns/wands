"""Institutional radar: SEC 13F quarterly holdings.

A 13F is a snapshot of what a manager reported holding at the end of a quarter,
published up to 45 days later. It is not a current position, and a change between
two snapshots is not evidence of buying or selling on any particular day. Every
figure this module produces carries that caveat, and the API repeats it.

The point-in-time rule is the same as for insider filings: a quarter's holdings
are visible only from the acceptance time of the filing that reported them, and
an amendment replaces the original only from the amendment's own acceptance
time.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from wands.config import Settings
from wands.db.models import IntelInstitutionalHoldingRow, IntelInstitutionRow
from wands.intelligence.base import IntelQuality, SignalCategory, SignalDraft
from wands.intelligence.signals import saturate, signal_key

DISCLOSURE_CAVEAT = (
    "A Form 13F is a quarterly snapshot filed up to 45 days after the quarter ends. "
    "It is not a current position, it does not show real-time buying or selling, and "
    "it excludes short positions, cash and most non-13(f) securities."
)

CHANGE_NEW = "new"
CHANGE_EXITED = "exited"
CHANGE_INCREASED = "increased"
CHANGE_DECREASED = "decreased"
CHANGE_UNCHANGED = "unchanged"


@dataclass(frozen=True)
class HoldingChange:
    cusip: str
    issuer_name: str
    class_title: str
    change_type: str
    current_shares: Decimal | None
    prior_shares: Decimal | None
    current_value_usd: Decimal | None
    prior_value_usd: Decimal | None
    share_change: Decimal | None
    share_change_pct: Decimal | None
    period_of_report: datetime
    prior_period_of_report: datetime | None
    public_available_at: datetime
    source_url: str


@dataclass(frozen=True)
class InstitutionSummary:
    cik: str
    name: str
    periods: list[datetime]
    latest_period: datetime | None
    latest_public_available_at: datetime | None
    reported_value_usd: Decimal | None
    position_count: int


class InstitutionalRadar:
    """Reads stored 13F holdings and derives quarter-over-quarter changes."""

    def __init__(self, session: Session, settings: Settings) -> None:
        self.session = session
        self.settings = settings

    # -- institutions ------------------------------------------------------

    def institutions(self) -> list[IntelInstitutionRow]:
        return list(
            self.session.scalars(
                select(IntelInstitutionRow).order_by(IntelInstitutionRow.name)
            ).all()
        )

    def institution(self, cik: str) -> IntelInstitutionRow | None:
        return self.session.scalar(
            select(IntelInstitutionRow).where(IntelInstitutionRow.cik == cik)
        )

    def summary(self, cik: str, *, as_of: datetime | None = None) -> InstitutionSummary | None:
        institution = self.institution(cik)
        if institution is None:
            return None

        moment = as_of or datetime.now(tz=UTC)
        periods = self.periods(cik, as_of=moment)
        latest = periods[-1] if periods else None
        holdings = self._holdings_for(cik, latest, moment) if latest else []
        aggregated = _by_cusip(holdings)

        return InstitutionSummary(
            cik=institution.cik,
            name=institution.name,
            periods=periods,
            latest_period=latest,
            latest_public_available_at=(
                max((row.accepted_at for row in holdings), default=None)
            ),
            reported_value_usd=(
                sum(
                    (item.value_usd for item in aggregated.values() if item.value_usd is not None),
                    Decimal("0"),
                )
                if aggregated
                else None
            ),
            position_count=len(aggregated),
        )

    def periods(self, cik: str, *, as_of: datetime | None = None) -> list[datetime]:
        moment = as_of or datetime.now(tz=UTC)
        institution = self.institution(cik)
        if institution is None:
            return []
        rows = self.session.scalars(
            select(IntelInstitutionalHoldingRow.period_of_report)
            .where(
                IntelInstitutionalHoldingRow.institution_id == institution.id,
                IntelInstitutionalHoldingRow.accepted_at <= moment,
            )
            .distinct()
        ).all()
        return sorted({row for row in rows if row is not None})

    # -- changes -----------------------------------------------------------

    def changes(
        self,
        cik: str,
        *,
        period: datetime | None = None,
        as_of: datetime | None = None,
    ) -> list[HoldingChange]:
        moment = as_of or datetime.now(tz=UTC)
        periods = self.periods(cik, as_of=moment)
        if not periods:
            return []

        current_period = period or periods[-1]
        if current_period not in periods:
            return []

        prior_period = None
        for candidate in periods:
            if candidate < current_period:
                prior_period = candidate

        if prior_period is None:
            # A change needs two snapshots. Reporting the first quarter's
            # positions as "new" would describe a starting position as activity.
            return []

        current = self._holdings_for(cik, current_period, moment)
        prior = self._holdings_for(cik, prior_period, moment)

        current_by_cusip = _by_cusip(current)
        prior_by_cusip = _by_cusip(prior)

        changes: list[HoldingChange] = []
        for cusip in sorted(set(current_by_cusip) | set(prior_by_cusip)):
            now_row = current_by_cusip.get(cusip)
            then_row = prior_by_cusip.get(cusip)
            changes.append(
                _change_for(cusip, now_row, then_row, current_period, prior_period)
            )
        return changes

    def signal_drafts(
        self,
        cik: str,
        *,
        period: datetime | None = None,
        as_of: datetime | None = None,
    ) -> list[SignalDraft]:
        """One signal per institution per quarter, describing reported change."""
        moment = as_of or datetime.now(tz=UTC)
        institution = self.institution(cik)
        if institution is None:
            return []

        changes = self.changes(cik, period=period, as_of=moment)
        if not changes:
            return []

        current_period = changes[0].period_of_report
        new_positions = [item for item in changes if item.change_type == CHANGE_NEW]
        exited = [item for item in changes if item.change_type == CHANGE_EXITED]
        increased = [item for item in changes if item.change_type == CHANGE_INCREASED]
        decreased = [item for item in changes if item.change_type == CHANGE_DECREASED]

        net_value = sum(
            (
                (item.current_value_usd or Decimal("0"))
                - (item.prior_value_usd or Decimal("0"))
                for item in changes
            ),
            Decimal("0"),
        )
        available_at = max(item.public_available_at for item in changes)
        event_ids = [
            f"{institution.cik}:{current_period.date().isoformat()}:{item.cusip}"
            for item in changes
        ]

        return [
            SignalDraft(
                category=SignalCategory.INSTITUTIONAL_POSITION_CHANGE,
                symbol="",
                source_event_ids=event_ids,
                event_time=current_period,
                public_available_at=available_at,
                raw_measurement=net_value,
                raw_unit="usd_reported_change",
                score=saturate(abs(net_value), Decimal("100000000")),
                explanation=(
                    f"{institution.name} reported {len(new_positions)} new, "
                    f"{len(exited)} exited, {len(increased)} increased and "
                    f"{len(decreased)} decreased positions for the quarter ending "
                    f"{current_period.date().isoformat()}. Reported value change "
                    f"${net_value:,.2f}."
                ),
                data_quality=IntelQuality.DERIVED,
                confidence_notes=(
                    f"{DISCLOSURE_CAVEAT} A change between two quarterly snapshots is not "
                    "evidence of a trade on any particular date, and reported values are "
                    "as of the quarter end, not the filing date."
                ),
                parameters={
                    "institutionCik": institution.cik,
                    "periodOfReport": current_period.isoformat(),
                    "newPositions": len(new_positions),
                    "exitedPositions": len(exited),
                    "increasedPositions": len(increased),
                    "decreasedPositions": len(decreased),
                    "asOf": moment.isoformat(),
                },
            )
        ]

    def persist_signals(
        self,
        ciks: list[str],
        *,
        as_of: datetime | None = None,
    ) -> int:
        from wands.db.models import IntelSignalRow

        created = 0
        for cik in ciks:
            for draft in self.signal_drafts(cik, as_of=as_of):
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
                        engine_version=self.settings.intelligence_signal_engine_version,
                    )
                )
                created += 1
        self.session.flush()
        return created

    # -- internals ---------------------------------------------------------

    def _holdings_for(
        self,
        cik: str,
        period: datetime | None,
        as_of: datetime,
    ) -> list[IntelInstitutionalHoldingRow]:
        """Holdings for one quarter, using only the latest version visible at ``as_of``."""
        if period is None:
            return []
        institution = self.institution(cik)
        if institution is None:
            return []

        rows = list(
            self.session.scalars(
                select(IntelInstitutionalHoldingRow).where(
                    IntelInstitutionalHoldingRow.institution_id == institution.id,
                    IntelInstitutionalHoldingRow.period_of_report == period,
                    IntelInstitutionalHoldingRow.accepted_at <= as_of,
                )
            ).all()
        )
        if not rows:
            return []

        latest = max(row.accepted_at for row in rows)
        return [row for row in rows if row.accepted_at == latest]


@dataclass(frozen=True)
class _Aggregate:
    """One CUSIP's reported position, summed across discretion categories."""

    cusip: str
    issuer_name: str
    class_title: str
    shares: Decimal | None
    value_usd: Decimal | None
    accepted_at: datetime
    source_url: str


def _by_cusip(rows: list[IntelInstitutionalHoldingRow]) -> dict[str, _Aggregate]:
    """Collapse duplicate CUSIP lines into one reported position.

    A manager can report the same CUSIP under several discretion categories. The
    aggregate is what matters for a change calculation, so the values are summed
    rather than one line being picked arbitrarily. The rows themselves are left
    untouched: mutating a loaded ORM object here would mark it dirty and could
    write a derived total back over a reported figure.
    """
    grouped: dict[str, _Aggregate] = {}
    for row in rows:
        existing = grouped.get(row.cusip)
        if existing is None:
            grouped[row.cusip] = _Aggregate(
                cusip=row.cusip,
                issuer_name=row.issuer_name,
                class_title=row.class_title,
                shares=row.shares,
                value_usd=row.value_usd,
                accepted_at=row.accepted_at,
                source_url=row.source_url,
            )
            continue
        grouped[row.cusip] = _Aggregate(
            cusip=existing.cusip,
            issuer_name=existing.issuer_name or row.issuer_name,
            class_title=existing.class_title or row.class_title,
            shares=(existing.shares or Decimal("0")) + (row.shares or Decimal("0")),
            value_usd=(existing.value_usd or Decimal("0")) + (row.value_usd or Decimal("0")),
            accepted_at=max(existing.accepted_at, row.accepted_at),
            source_url=existing.source_url or row.source_url,
        )
    return grouped


def _change_for(
    cusip: str,
    now_row: _Aggregate | None,
    then_row: _Aggregate | None,
    current_period: datetime,
    prior_period: datetime | None,
) -> HoldingChange:
    current_shares = now_row.shares if now_row else None
    prior_shares = then_row.shares if then_row else None

    if now_row is not None and then_row is None:
        change_type = CHANGE_NEW
    elif now_row is None and then_row is not None:
        change_type = CHANGE_EXITED
    elif current_shares is not None and prior_shares is not None:
        if current_shares > prior_shares:
            change_type = CHANGE_INCREASED
        elif current_shares < prior_shares:
            change_type = CHANGE_DECREASED
        else:
            change_type = CHANGE_UNCHANGED
    else:
        change_type = CHANGE_UNCHANGED

    share_change: Decimal | None = None
    share_change_pct: Decimal | None = None
    if current_shares is not None and prior_shares is not None:
        share_change = current_shares - prior_shares
        if prior_shares > 0:
            share_change_pct = (share_change / prior_shares * Decimal("100")).quantize(
                Decimal("0.0001")
            )

    source = now_row or then_row
    return HoldingChange(
        cusip=cusip,
        issuer_name=(now_row.issuer_name if now_row else then_row.issuer_name) if source else "",
        class_title=(now_row.class_title if now_row else then_row.class_title) if source else "",
        change_type=change_type,
        current_shares=current_shares,
        prior_shares=prior_shares,
        current_value_usd=now_row.value_usd if now_row else None,
        prior_value_usd=then_row.value_usd if then_row else None,
        share_change=share_change,
        share_change_pct=share_change_pct,
        period_of_report=current_period,
        prior_period_of_report=prior_period,
        public_available_at=source.accepted_at if source else current_period,
        source_url=source.source_url if source else "",
    )


__all__ = [
    "CHANGE_DECREASED",
    "CHANGE_EXITED",
    "CHANGE_INCREASED",
    "CHANGE_NEW",
    "CHANGE_UNCHANGED",
    "DISCLOSURE_CAVEAT",
    "HoldingChange",
    "InstitutionSummary",
    "InstitutionalRadar",
]
