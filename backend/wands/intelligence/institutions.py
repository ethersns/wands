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

import uuid
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
        periods = self.periods(cik, as_of=moment, institution=institution)
        latest = periods[-1] if periods else None
        holdings = (
            self._holdings_for(cik, latest, moment, institution=institution)
            if latest
            else []
        )
        return _summary_from(institution, periods, holdings)

    def summaries(
        self, ciks: list[str], *, as_of: datetime | None = None
    ) -> dict[str, InstitutionSummary]:
        """Summaries for many filers in a fixed number of queries.

        The single-filer path costs five round-trips, and the feed called it once
        per filer, so latency grew with the number of filers rather than with the
        amount of data. This loads the same rows in three queries regardless of
        how many filers are asked for and derives identical figures in Python.

        The point-in-time rule is unchanged: a period is visible only from the
        acceptance time of the filing that reported it, and only the latest
        accepted version of a quarter is used.
        """
        if not ciks:
            return {}

        moment = as_of or datetime.now(tz=UTC)
        institutions = list(
            self.session.scalars(
                select(IntelInstitutionRow).where(IntelInstitutionRow.cik.in_(ciks))
            ).all()
        )
        if not institutions:
            return {}

        institution_ids = [row.id for row in institutions]

        period_rows = self.session.execute(
            select(
                IntelInstitutionalHoldingRow.institution_id,
                IntelInstitutionalHoldingRow.period_of_report,
            )
            .where(
                IntelInstitutionalHoldingRow.institution_id.in_(institution_ids),
                IntelInstitutionalHoldingRow.accepted_at <= moment,
            )
            .distinct()
        ).all()

        periods_by_institution: dict[uuid.UUID, list[datetime]] = {}
        for institution_id, period in period_rows:
            if period is None:
                continue
            periods_by_institution.setdefault(institution_id, []).append(period)
        for values in periods_by_institution.values():
            values.sort()

        latest_periods = {
            periods[-1] for periods in periods_by_institution.values() if periods
        }

        holdings_by_institution: dict[uuid.UUID, list[IntelInstitutionalHoldingRow]] = {}
        if latest_periods:
            for row in self.session.scalars(
                select(IntelInstitutionalHoldingRow).where(
                    IntelInstitutionalHoldingRow.institution_id.in_(institution_ids),
                    IntelInstitutionalHoldingRow.period_of_report.in_(latest_periods),
                    IntelInstitutionalHoldingRow.accepted_at <= moment,
                )
            ).all():
                holdings_by_institution.setdefault(row.institution_id, []).append(row)

        summaries: dict[str, InstitutionSummary] = {}
        for institution in institutions:
            periods = periods_by_institution.get(institution.id, [])
            latest = periods[-1] if periods else None
            rows = holdings_by_institution.get(institution.id, [])
            if latest is not None:
                rows = [row for row in rows if row.period_of_report == latest]
                if rows:
                    newest = max(row.accepted_at for row in rows)
                    rows = [row for row in rows if row.accepted_at == newest]
            else:
                rows = []
            summaries[institution.cik] = _summary_from(institution, periods, rows)
        return summaries

    def periods(
        self,
        cik: str,
        *,
        as_of: datetime | None = None,
        institution: IntelInstitutionRow | None = None,
    ) -> list[datetime]:
        moment = as_of or datetime.now(tz=UTC)
        resolved = institution or self.institution(cik)
        if resolved is None:
            return []
        rows = self.session.scalars(
            select(IntelInstitutionalHoldingRow.period_of_report)
            .where(
                IntelInstitutionalHoldingRow.institution_id == resolved.id,
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
        institution: IntelInstitutionRow | None = None,
    ) -> list[HoldingChange]:
        moment = as_of or datetime.now(tz=UTC)
        periods = self.periods(cik, as_of=moment, institution=institution)
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

        current = self._holdings_for(
            cik, current_period, moment, institution=institution
        )
        prior = self._holdings_for(cik, prior_period, moment, institution=institution)

        current_by_cusip = _by_cusip(current)
        prior_by_cusip = _by_cusip(prior)

        # An exit is only knowable from the filing that omitted the CUSIP, so the
        # current quarter's acceptance time and document are what support it. The
        # prior filing cannot: it reported the position as still held.
        current_accepted = max((row.accepted_at for row in current), default=None)
        current_source_url = next((row.source_url for row in current if row.source_url), "")

        changes: list[HoldingChange] = []
        for cusip in sorted(set(current_by_cusip) | set(prior_by_cusip)):
            now_row = current_by_cusip.get(cusip)
            then_row = prior_by_cusip.get(cusip)
            changes.append(
                _change_for(
                    cusip,
                    now_row,
                    then_row,
                    current_period,
                    prior_period,
                    current_accepted=current_accepted,
                    current_source_url=current_source_url,
                )
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

        changes = self.changes(cik, period=period, as_of=moment, institution=institution)
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
        *,
        institution: IntelInstitutionRow | None = None,
    ) -> list[IntelInstitutionalHoldingRow]:
        """Holdings for one quarter, using only the latest version visible at ``as_of``."""
        if period is None:
            return []
        resolved = institution or self.institution(cik)
        if resolved is None:
            return []

        rows = list(
            self.session.scalars(
                select(IntelInstitutionalHoldingRow).where(
                    IntelInstitutionalHoldingRow.institution_id == resolved.id,
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


def _summary_from(
    institution: IntelInstitutionRow,
    periods: list[datetime],
    holdings: list[IntelInstitutionalHoldingRow],
) -> InstitutionSummary:
    """Build one filer's summary from rows already loaded.

    Shared by the single-filer and batched paths so both report the same figures
    from the same inputs.
    """
    aggregated = _by_cusip(holdings)
    return InstitutionSummary(
        cik=institution.cik,
        name=institution.name,
        periods=periods,
        latest_period=periods[-1] if periods else None,
        latest_public_available_at=max((row.accepted_at for row in holdings), default=None),
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


def _change_for(
    cusip: str,
    now_row: _Aggregate | None,
    then_row: _Aggregate | None,
    current_period: datetime,
    prior_period: datetime | None,
    *,
    current_accepted: datetime | None = None,
    current_source_url: str = "",
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

    if now_row is not None:
        public_available_at = now_row.accepted_at
        source_url = now_row.source_url
    elif current_accepted is not None:
        # The CUSIP is absent from the current filing. That absence became public
        # when the current filing was accepted, not when the prior one was.
        public_available_at = current_accepted
        source_url = current_source_url or (then_row.source_url if then_row else "")
    elif then_row is not None:
        public_available_at = then_row.accepted_at
        source_url = then_row.source_url
    else:
        public_available_at = current_period
        source_url = ""

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
        public_available_at=public_available_at,
        source_url=source_url,
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
