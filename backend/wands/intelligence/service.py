"""Read-side intelligence service.

Every method here reads stored rows and returns them. Nothing is estimated,
interpolated or filled in. When there is no data the result is an empty
collection with a stated reason, which the API turns into an ``unavailable``
envelope rather than a screen full of zeros.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from wands.config import Settings
from wands.db.models import (
    IntelFilingRow,
    IntelInsiderTransactionRow,
    IntelInstitutionalHoldingRow,
    IntelInstitutionRow,
    IntelSignalRow,
)
from wands.intelligence.base import IntelQuality, TransactionClass
from wands.intelligence.classify import CODE_MEANINGS, describe
from wands.intelligence.freshness import FreshnessMonitor
from wands.intelligence.fusion import FUSION_CAVEAT, SignalFusion
from wands.intelligence.institutions import DISCLOSURE_CAVEAT, InstitutionalRadar
from wands.intelligence.schemas import (
    FusionComponentOut,
    FusionOut,
    InsiderFeedOut,
    InsiderSymbolSummaryOut,
    InsiderTransactionOut,
    InstitutionalHoldingChangeOut,
    InstitutionChangesOut,
    InstitutionFeedOut,
    InstitutionOut,
    IntelSourceStatusOut,
    IntelStatusOut,
    SignalFeedOut,
    SignalOut,
    SymbolSummaryOut,
)
from wands.intelligence.signals import PURCHASE_CAVEAT, SELLING_CAVEAT

INSIDER_CAVEATS = [
    "Insider filings are reported by the filer and are not audited by Wands. "
    "Amendments are stored separately and supersede the original only from their own "
    "acceptance time.",
    PURCHASE_CAVEAT,
    SELLING_CAVEAT,
]


def _role_label(row: IntelInsiderTransactionRow) -> str:
    parts: list[str] = []
    if row.is_director:
        parts.append("Director")
    if row.is_officer:
        parts.append(f"Officer ({row.officer_title})" if row.officer_title else "Officer")
    if row.is_ten_percent_owner:
        parts.append("10% owner")
    return " and ".join(parts) if parts else "Reporting person"


def _transaction_quality(row: IntelInsiderTransactionRow) -> str:
    """A purchase or sale with no reported price is incomplete, not zero."""
    if row.is_open_market and row.value is None:
        return IntelQuality.INCOMPLETE.value
    return IntelQuality.REPORTED.value


def _transaction_out(row: IntelInsiderTransactionRow) -> InsiderTransactionOut:
    from wands.intelligence.base import ParsedTransaction

    proxy = ParsedTransaction(
        table_kind=row.table_kind,
        ordinal=row.ordinal,
        security_title=row.security_title,
        transaction_date=row.transaction_date,
        transaction_code=row.transaction_code,
        acquired_disposed=row.acquired_disposed,
        shares=row.shares,
        price_per_share=row.price_per_share,
        shares_owned_after=row.shares_owned_after,
        direct_or_indirect=row.direct_or_indirect,
        nature_of_ownership=row.nature_of_ownership,
    )
    classification = TransactionClass(row.classification)
    return InsiderTransactionOut(
        id=str(row.id),
        accession_number=row.accession_number,
        symbol=row.symbol,
        issuer_name=row.issuer_name,
        reporting_person_name=row.reporting_person_name,
        reporting_person_cik=row.reporting_person_cik,
        role=_role_label(row),
        transaction_date=row.transaction_date,
        transaction_code=row.transaction_code,
        classification=row.classification,
        is_open_market=row.is_open_market,
        security_title=row.security_title,
        shares=row.shares,
        price_per_share=row.price_per_share,
        value=row.value,
        shares_owned_after=row.shares_owned_after,
        direct_or_indirect=row.direct_or_indirect,
        accepted_at=row.accepted_at,
        is_amendment=row.is_amendment,
        source_url=row.source_url,
        description=describe(proxy, classification),
        data_quality=_transaction_quality(row),
    )


def _signal_out(row: IntelSignalRow) -> SignalOut:
    return SignalOut(
        id=str(row.id),
        category=row.category,
        symbol=row.symbol,
        source_event_ids=list(row.source_event_ids or []),
        event_time=row.event_time,
        public_available_at=row.public_available_at,
        calculated_at=row.calculated_at,
        raw_measurement=Decimal(row.raw_measurement),
        raw_unit=row.raw_unit,
        score=Decimal(row.score) if row.score is not None else None,
        explanation=row.explanation,
        data_quality=row.data_quality,
        confidence_notes=row.confidence_notes,
        parameters=dict(row.parameters or {}),
        engine_version=row.engine_version,
    )


class IntelligenceService:
    def __init__(self, session: Session, settings: Settings) -> None:
        self.session = session
        self.settings = settings
        self.freshness = FreshnessMonitor(session, settings)
        self.radar = InstitutionalRadar(session, settings)
        self.fusion = SignalFusion(session, settings)

    # -- status ------------------------------------------------------------

    def status(self) -> IntelStatusOut:
        filings = self._count(IntelFilingRow)
        transactions = self._count(IntelInsiderTransactionRow)
        signals = self._count(IntelSignalRow)
        institutions = self._count(IntelInstitutionRow)
        holdings = self._count(IntelInstitutionalHoldingRow)

        symbols = sorted(
            {
                row
                for row in self.session.scalars(
                    select(IntelInsiderTransactionRow.symbol).distinct()
                ).all()
                if row
            }
        )

        latest_filing = self.session.scalar(
            select(func.max(IntelFilingRow.accepted_at))
        )
        latest_signal = self.session.scalar(
            select(func.max(IntelSignalRow.public_available_at))
        )

        caveats = list(INSIDER_CAVEATS)
        if filings == 0:
            caveats.insert(
                0,
                "No SEC filings are stored. The feed is empty because nothing has been "
                "collected, not because no insider activity occurred.",
            )

        return IntelStatusOut(
            enabled=self.settings.intelligence_enabled,
            freshness=self.freshness.overall(),
            sources=[
                IntelSourceStatusOut(
                    source=item.source,
                    status=item.status,
                    last_attempt_at=item.last_attempt_at,
                    last_success_at=item.last_success_at,
                    age_seconds=item.age_seconds,
                    stale_after_seconds=item.stale_after_seconds,
                    detail=item.detail,
                )
                for item in self.freshness.sources()
            ],
            filings=filings,
            transactions=transactions,
            signals=signals,
            institutions=institutions,
            holdings=holdings,
            symbols_covered=symbols,
            latest_filing_at=latest_filing,
            latest_signal_at=latest_signal,
            signal_engine_version=self.settings.intelligence_signal_engine_version,
            caveats=caveats,
        )

    # -- insiders ----------------------------------------------------------

    def insiders(
        self,
        *,
        symbol: str | None = None,
        classification: str | None = None,
        open_market_only: bool = False,
        since: datetime | None = None,
        page: int = 1,
        limit: int = 50,
    ) -> InsiderFeedOut:
        statement = select(IntelInsiderTransactionRow)
        count_statement = select(func.count()).select_from(IntelInsiderTransactionRow)

        filters = []
        if symbol:
            filters.append(IntelInsiderTransactionRow.symbol == symbol.upper())
        if classification:
            filters.append(IntelInsiderTransactionRow.classification == classification)
        if open_market_only:
            filters.append(IntelInsiderTransactionRow.is_open_market.is_(True))
        if since is not None:
            filters.append(IntelInsiderTransactionRow.accepted_at >= since)

        for condition in filters:
            statement = statement.where(condition)
            count_statement = count_statement.where(condition)

        total = int(self.session.scalar(count_statement) or 0)
        rows = self.session.scalars(
            statement.order_by(
                IntelInsiderTransactionRow.accepted_at.desc(),
                IntelInsiderTransactionRow.ordinal,
            )
            .offset((page - 1) * limit)
            .limit(limit)
        ).all()

        return InsiderFeedOut(
            items=[_transaction_out(row) for row in rows],
            total=total,
            page=page,
            limit=limit,
            has_more=page * limit < total,
        )

    def insider_summary(
        self, symbol: str, *, window_days: int | None = None, as_of: datetime | None = None
    ) -> InsiderSymbolSummaryOut:
        moment = as_of or datetime.now(tz=UTC)
        days = window_days or self.settings.intelligence_cluster_window_days
        since = moment - timedelta(days=days)

        rows = list(
            self.session.scalars(
                select(IntelInsiderTransactionRow).where(
                    IntelInsiderTransactionRow.symbol == symbol.upper(),
                    IntelInsiderTransactionRow.accepted_at <= moment,
                    IntelInsiderTransactionRow.accepted_at >= since,
                )
            ).all()
        )

        purchases = [
            row
            for row in rows
            if row.classification == TransactionClass.OPEN_MARKET_PURCHASE.value
        ]
        sales = [
            row for row in rows if row.classification == TransactionClass.OPEN_MARKET_SALE.value
        ]
        priced = [row for row in purchases if row.value is not None]
        unpriced = len(purchases) - len(priced)

        issuer_name = next((row.issuer_name for row in rows if row.issuer_name), "")
        latest_filing = max((row.accepted_at for row in rows), default=None)
        latest_transaction = max(
            (row.transaction_date for row in rows if row.transaction_date is not None),
            default=None,
        )

        caveats = list(INSIDER_CAVEATS)
        if unpriced:
            caveats.append(
                f"{unpriced} reported purchase line(s) carried no transaction price and are "
                "excluded from the aggregate value rather than counted as zero."
            )
        if not rows:
            caveats.insert(
                0,
                f"No insider filings are stored for {symbol.upper()} in the last {days} days.",
            )

        return InsiderSymbolSummaryOut(
            symbol=symbol.upper(),
            issuer_name=issuer_name,
            window_days=days,
            purchase_count=len(purchases),
            sale_count=len(sales),
            distinct_purchasers=len(
                {row.reporting_person_cik for row in purchases if row.reporting_person_cik}
            ),
            distinct_sellers=len(
                {row.reporting_person_cik for row in sales if row.reporting_person_cik}
            ),
            purchase_value_usd=(
                sum((Decimal(row.value) for row in priced), Decimal("0")) if priced else None
            ),
            unpriced_purchase_lines=unpriced,
            latest_filing_at=latest_filing,
            latest_transaction_date=latest_transaction,
            caveats=caveats,
        )

    # -- signals -----------------------------------------------------------

    def signals(
        self,
        *,
        category: str | None = None,
        symbol: str | None = None,
        as_of: datetime | None = None,
        page: int = 1,
        limit: int = 50,
    ) -> SignalFeedOut:
        statement = select(IntelSignalRow)
        count_statement = select(func.count()).select_from(IntelSignalRow)

        filters = []
        if category:
            filters.append(IntelSignalRow.category == category)
        if symbol:
            filters.append(IntelSignalRow.symbol == symbol.upper())
        if as_of is not None:
            filters.append(IntelSignalRow.public_available_at <= as_of)

        for condition in filters:
            statement = statement.where(condition)
            count_statement = count_statement.where(condition)

        total = int(self.session.scalar(count_statement) or 0)
        rows = self.session.scalars(
            statement.order_by(
                IntelSignalRow.public_available_at.desc(), IntelSignalRow.category
            )
            .offset((page - 1) * limit)
            .limit(limit)
        ).all()

        return SignalFeedOut(
            items=[_signal_out(row) for row in rows],
            total=total,
            page=page,
            limit=limit,
            has_more=page * limit < total,
        )

    def signal(self, signal_id: str) -> SignalOut | None:
        try:
            identifier = uuid.UUID(signal_id)
        except ValueError:
            return None
        row = self.session.get(IntelSignalRow, identifier)
        if row is None:
            return None
        return _signal_out(row)

    # -- institutions ------------------------------------------------------

    def institutions(self, *, page: int = 1, limit: int = 50) -> InstitutionFeedOut:
        total = self._count(IntelInstitutionRow)
        rows = self.session.scalars(
            select(IntelInstitutionRow)
            .order_by(IntelInstitutionRow.name)
            .offset((page - 1) * limit)
            .limit(limit)
        ).all()

        summaries = self.radar.summaries([row.cik for row in rows])

        items: list[InstitutionOut] = []
        for row in rows:
            summary = summaries.get(row.cik)
            if summary is None:
                continue
            items.append(
                InstitutionOut(
                    cik=summary.cik,
                    name=summary.name,
                    periods=summary.periods,
                    latest_period=summary.latest_period,
                    latest_public_available_at=summary.latest_public_available_at,
                    reported_value_usd=summary.reported_value_usd,
                    position_count=summary.position_count,
                    caveats=[DISCLOSURE_CAVEAT],
                )
            )

        return InstitutionFeedOut(
            items=items, total=total, page=page, limit=limit, has_more=page * limit < total
        )

    def institution_changes(
        self, cik: str, *, period: datetime | None = None
    ) -> InstitutionChangesOut | None:
        institution = self.radar.institution(cik)
        if institution is None:
            return None

        changes = self.radar.changes(cik, period=period, institution=institution)
        return InstitutionChangesOut(
            cik=institution.cik,
            name=institution.name,
            period_of_report=changes[0].period_of_report if changes else None,
            prior_period_of_report=changes[0].prior_period_of_report if changes else None,
            changes=[
                InstitutionalHoldingChangeOut(
                    cusip=item.cusip,
                    issuer_name=item.issuer_name,
                    class_title=item.class_title,
                    change_type=item.change_type,
                    current_shares=item.current_shares,
                    prior_shares=item.prior_shares,
                    current_value_usd=item.current_value_usd,
                    prior_value_usd=item.prior_value_usd,
                    share_change=item.share_change,
                    share_change_pct=item.share_change_pct,
                    period_of_report=item.period_of_report,
                    prior_period_of_report=item.prior_period_of_report,
                    public_available_at=item.public_available_at,
                    source_url=item.source_url,
                )
                for item in changes
            ],
            caveats=[DISCLOSURE_CAVEAT],
        )

    # -- symbol summary ----------------------------------------------------

    def symbol_summary(
        self, symbol: str, *, as_of: datetime | None = None
    ) -> SymbolSummaryOut:
        moment = as_of or datetime.now(tz=UTC)
        canonical = symbol.upper()

        insider = self.insider_summary(canonical, as_of=moment)
        signal_rows = self.session.scalars(
            select(IntelSignalRow)
            .where(
                IntelSignalRow.symbol == canonical,
                IntelSignalRow.public_available_at <= moment,
            )
            .order_by(IntelSignalRow.public_available_at.desc())
            .limit(20)
        ).all()

        ranking = self.fusion.rank([canonical], as_of=moment)[0]

        caveats = list(INSIDER_CAVEATS)
        caveats.append(FUSION_CAVEAT)
        if not signal_rows:
            caveats.insert(
                0,
                f"No research signal has been generated for {canonical}. Signals are only "
                "produced when a configured threshold is met.",
            )

        return SymbolSummaryOut(
            symbol=canonical,
            as_of=moment,
            insider=insider,
            signals=[_signal_out(row) for row in signal_rows],
            fusion=FusionOut(
                symbol=ranking.symbol,
                as_of=ranking.as_of,
                components=[
                    FusionComponentOut(
                        name=item.name,
                        category=item.category,
                        measurement=item.measurement,
                        unit=item.unit,
                        score=item.score,
                        public_available_at=item.public_available_at,
                        explanation=item.explanation,
                        data_quality=item.data_quality,
                        source=item.source,
                    )
                    for item in ranking.components
                ],
                composite_score=ranking.composite_score,
                coverage=ranking.coverage,
                explanation=ranking.explanation,
                data_quality=ranking.data_quality,
                caveats=ranking.caveats,
            ),
            freshness=self.freshness.overall(),
            caveats=caveats,
        )

    # -- internals ---------------------------------------------------------

    def _count(self, model) -> int:
        return int(self.session.scalar(select(func.count()).select_from(model)) or 0)


__all__ = ["CODE_MEANINGS", "INSIDER_CAVEATS", "IntelligenceService"]
