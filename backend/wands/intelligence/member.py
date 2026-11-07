"""The member research projection.

The operator surface (``research.py``) reports collection machinery: jobs,
leases, backfill cursors, retry counters, identifier-resolution internals and
raw upstream error strings. A member is not entitled to any of that, and none of
it helps them read a filing.

This module builds the member projection from the same stored rows. It adds the
two things the member contract requires and the operator surface does not carry:

* a **source link** for every claim, or the claim is not shown; and
* a **coverage disclosure** saying how much of the window the claim rests on.

Nothing here writes, and nothing here can reach the order path, the portfolio,
the risk engine or a broker credential — the module does not import them. That
is the whole reason it is a separate module rather than a flag on the operator
service.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from wands.config import Settings
from wands.db.models import (
    IntelFilingRow,
    IntelInsiderTransactionRow,
    IntelInstitutionalHoldingRow,
    IntelInstitutionRow,
    IntelSignalRow,
    MarketCandleRow,
    MarketPriceCoverageRow,
)
from wands.intelligence.base import TransactionClass
from wands.intelligence.freshness import STATUS_FRESH, FreshnessMonitor
from wands.intelligence.schemas import (
    AssetResearchOut,
    InsiderTransactionOut,
    PriceCoverageOut,
    ResearchCountsOut,
    ResearchCoverageDisclosureOut,
    ResearchCoverageGapOut,
    ResearchDashboardOut,
    ResearchSourceLinkOut,
)
from wands.intelligence.service import INSIDER_CAVEATS, IntelligenceService, _signal_out, _transaction_out

SOURCE_LIMIT = 50
TOP_SIGNAL_LIMIT = 5
RECENT_PURCHASE_LIMIT = 5

COVERAGE_CAVEAT = (
    "Coverage describes what has been collected, not what exists. A low count means "
    "the collector has not reached that period, not that nothing was filed."
)

COUNTS_CAVEAT = (
    "Counts are of stored records, not of events that happened. A zero means nothing "
    "has been collected, which is not the same as nothing occurring."
)

UNRESOLVED_SOURCE_CAVEAT = (
    "Some stored records carry no resolvable SEC source URL. They are omitted from the "
    "source list rather than shown without a link."
)

NO_UNIVERSE_CAVEAT = (
    "No issuer universe is configured, so coverage is measured against the symbols that "
    "were actually collected rather than against a stated target."
)


def _uuid_or_none(value: Any) -> uuid.UUID | None:
    """Coerce a path parameter to a UUID, or ``None`` if it is not one.

    The identifier columns are ``Uuid``, so comparing them to a raw string is a
    driver error rather than an empty result. Returning ``None`` lets the route
    answer 404 instead of 500.
    """
    if isinstance(value, uuid.UUID):
        return value
    try:
        return uuid.UUID(str(value))
    except (ValueError, AttributeError, TypeError):
        return None


def _filing_link(filing: IntelFilingRow, supports: str) -> ResearchSourceLinkOut | None:
    """A source link for one ownership filing, or ``None`` if it has no URL.

    A filing with no absolute https URL is dropped rather than rendered as a
    claim with a dead link. The caller reports the omission as a caveat.
    """
    url = (filing.source_url or "").strip()
    if not url.startswith("https://"):
        return None
    issuer = filing.issuer_name or filing.symbol or filing.issuer_cik or "unknown issuer"
    return ResearchSourceLinkOut(
        id=f"sec-filing:{filing.accession_number}",
        kind="sec_filing",
        label=f"{filing.form_type} — {issuer} ({filing.accepted_at.date().isoformat()})",
        url=url,
        accession_number=filing.accession_number,
        form_type=filing.form_type,
        public_available_at=filing.accepted_at,
        supports=supports,
        retrieved_at=filing.ingested_at,
    )


def _holding_link(
    holding: IntelInstitutionalHoldingRow, institution_name: str, supports: str
) -> ResearchSourceLinkOut | None:
    """A source link for one 13F disclosure.

    The form type is derived from the stored amendment flag rather than assumed,
    so an amendment is never presented as an original filing.
    """
    url = (holding.source_url or "").strip()
    if not url.startswith("https://"):
        return None
    form_type = "13F-HR/A" if holding.is_amendment else "13F-HR"
    filer = institution_name or holding.accession_number
    return ResearchSourceLinkOut(
        id=f"sec-filing:{holding.accession_number}",
        kind="sec_filing",
        label=f"{form_type} — {filer} ({holding.accepted_at.date().isoformat()})",
        url=url,
        accession_number=holding.accession_number,
        form_type=form_type,
        public_available_at=holding.accepted_at,
        supports=supports,
        retrieved_at=holding.ingested_at,
    )


def _gap(key: str, label: str, detail: str) -> ResearchCoverageGapOut:
    return ResearchCoverageGapOut(key=key, label=label, detail=detail)


class MemberResearchService:
    """Assembles the member research endpoints from stored rows."""

    def __init__(self, session: Session, settings: Settings) -> None:
        self.session = session
        self.settings = settings
        self.intel = IntelligenceService(session, settings)
        self.freshness = FreshnessMonitor(session, settings)

    # -- dashboard ---------------------------------------------------------

    def dashboard(self) -> ResearchDashboardOut:
        moment = datetime.now(tz=UTC)
        counts = ResearchCountsOut(
            filings=self._count(IntelFilingRow),
            transactions=self._count(IntelInsiderTransactionRow),
            signals=self._count(IntelSignalRow),
            institutions=self._count(IntelInstitutionRow),
            holdings=self._count(IntelInstitutionalHoldingRow),
            symbols=len(self._symbols()),
        )

        latest_filing = self.session.scalar(select(func.max(IntelFilingRow.accepted_at)))
        latest_signal = self.session.scalar(
            select(func.max(IntelSignalRow.public_available_at))
        )

        # ``coalesce`` rather than ``NULLS LAST``: a signal with no score is
        # still a signal, and it must sort below a scored one on every backend.
        top = self.session.scalars(
            select(IntelSignalRow)
            .order_by(
                func.coalesce(IntelSignalRow.score, -1).desc(),
                IntelSignalRow.public_available_at.desc(),
            )
            .limit(TOP_SIGNAL_LIMIT)
        ).all()

        purchases = self.session.scalars(
            select(IntelInsiderTransactionRow)
            .where(
                IntelInsiderTransactionRow.classification
                == TransactionClass.OPEN_MARKET_PURCHASE.value
            )
            .order_by(
                IntelInsiderTransactionRow.accepted_at.desc(),
                IntelInsiderTransactionRow.ordinal,
            )
            .limit(RECENT_PURCHASE_LIMIT)
        ).all()

        coverage = self.public_coverage()
        caveats = [COUNTS_CAVEAT, *INSIDER_CAVEATS, *coverage.caveats]
        if counts.filings == 0:
            caveats.insert(
                0,
                "No SEC filing is stored. The dashboard is empty because nothing has been "
                "collected, not because no insider filed.",
            )

        return ResearchDashboardOut(
            as_of=moment,
            freshness=self.freshness.overall(),
            counts=counts,
            latest_filing_at=latest_filing,
            latest_signal_at=latest_signal,
            top_signals=[_signal_out(row) for row in top],
            recent_purchases=[_transaction_out(row) for row in purchases],
            coverage=coverage,
            caveats=caveats,
        )

    # -- asset -------------------------------------------------------------

    def asset(self, symbol: str, *, as_of: datetime | None = None) -> AssetResearchOut:
        canonical = symbol.strip().upper()
        base = self.intel.symbol_summary(canonical, as_of=as_of)
        moment = base.as_of

        filings = self.session.scalars(
            select(IntelFilingRow)
            .where(
                IntelFilingRow.symbol == canonical,
                IntelFilingRow.accepted_at <= moment,
            )
            .order_by(IntelFilingRow.accepted_at.desc())
            .limit(SOURCE_LIMIT)
        ).all()

        sources = [
            link
            for link in (
                _filing_link(row, f"Ownership filing for {canonical}") for row in filings
            )
            if link is not None
        ]

        coverage = self._asset_coverage(
            canonical, filings=filings, signal_count=len(base.signals)
        )

        caveats = list(base.caveats)
        if filings and len(sources) < len(filings):
            caveats.append(UNRESOLVED_SOURCE_CAVEAT)
        if not filings:
            caveats.insert(
                0,
                f"No SEC ownership filing is stored for {canonical}, so this page has no "
                "source document to cite.",
            )

        issuer_name = base.insider.issuer_name or next(
            (row.issuer_name for row in filings if row.issuer_name), None
        )

        return AssetResearchOut(
            symbol=canonical,
            issuer_name=issuer_name or None,
            as_of=moment,
            freshness=base.freshness,
            insider=base.insider,
            signals=base.signals,
            fusion=base.fusion,
            sources=sources,
            coverage=coverage,
            price_coverage=self._price_coverage(canonical),
            caveats=caveats,
        )

    def _asset_coverage(
        self,
        symbol: str,
        *,
        filings: list[IntelFilingRow],
        signal_count: int,
    ) -> ResearchCoverageDisclosureOut:
        gaps: list[ResearchCoverageGapOut] = []
        if not filings:
            gaps.append(
                _gap(
                    "no_filings",
                    "No SEC filing stored",
                    f"No ownership filing for {symbol} has been collected, so no insider "
                    "claim on this page can be traced to a document.",
                )
            )
        if signal_count == 0:
            gaps.append(
                _gap(
                    "no_signals",
                    "No research signal",
                    f"No signal has been generated for {symbol}. Signals are only produced "
                    "when a configured threshold is met.",
                )
            )
        if self._symbols_without_prices([symbol]):
            gaps.append(
                _gap(
                    "no_price_series",
                    "No daily price series",
                    f"No daily bars are stored for {symbol}, so no performance claim can be "
                    "measured for it.",
                )
            )

        covered = 1 if (filings or signal_count) else 0
        if covered == 0:
            status = "unavailable"
        elif signal_count == 0:
            status = "insufficient"
        elif gaps:
            status = "partial"
        else:
            status = "complete"

        return ResearchCoverageDisclosureOut(
            status=status,
            window_start=min((row.accepted_at for row in filings), default=None),
            window_end=max((row.accepted_at for row in filings), default=None),
            symbols_covered=covered,
            symbols_requested=1,
            gaps=gaps,
            caveats=[COVERAGE_CAVEAT],
        )

    # -- coverage ----------------------------------------------------------

    def public_coverage(self) -> ResearchCoverageDisclosureOut:
        filings = self._count(IntelFilingRow)
        transactions = self._count(IntelInsiderTransactionRow)
        signals = self._count(IntelSignalRow)
        institutions = self._count(IntelInstitutionRow)

        covered = self._symbols()
        requested = self._requested_universe()

        gaps: list[ResearchCoverageGapOut] = []
        caveats: list[str] = [COVERAGE_CAVEAT]

        if filings == 0:
            gaps.append(
                _gap(
                    "no_filings",
                    "No SEC filing stored",
                    "No ownership filing has been collected, so no insider claim can be "
                    "traced to a document.",
                )
            )
        if transactions == 0:
            gaps.append(
                _gap(
                    "no_insider_transactions",
                    "No insider transaction stored",
                    "No reported transaction line has been parsed, so there is nothing to "
                    "aggregate.",
                )
            )
        if signals == 0:
            gaps.append(
                _gap(
                    "no_signals",
                    "No research signal",
                    "No signal has been generated. Signals are only produced when a "
                    "configured threshold is met, so this is expected for most symbols.",
                )
            )
        if institutions == 0:
            gaps.append(
                _gap(
                    "no_institutions",
                    "No 13F filer stored",
                    "No institutional manager has been collected, so no institutional "
                    "position change can be reported.",
                )
            )

        missing_prices = self._symbols_without_prices(covered)
        if missing_prices:
            shown = ", ".join(missing_prices[:10])
            gaps.append(
                _gap(
                    "no_price_series",
                    "Symbols without daily bars",
                    f"{len(missing_prices)} symbol(s) have no stored daily bars, so no "
                    f"performance claim can be measured for them: {shown}.",
                )
            )

        freshness = self.freshness.overall()
        if freshness != STATUS_FRESH:
            gaps.append(
                _gap(
                    "collector_not_current",
                    "Collector is not current",
                    f"The most recent ingestion state is {freshness!r}. Stored data may be "
                    "behind the SEC.",
                )
            )

        if requested:
            if len(covered) < requested:
                caveats.append(
                    f"{len(covered)} of {requested} configured symbol(s) have stored insider "
                    "activity. The remainder are configured but not yet collected."
                )
        else:
            caveats.append(NO_UNIVERSE_CAVEAT)

        if filings == 0 and signals == 0:
            status = "unavailable"
        elif signals == 0:
            status = "insufficient"
        elif gaps:
            status = "partial"
        else:
            status = "complete"

        return ResearchCoverageDisclosureOut(
            status=status,
            window_start=self.session.scalar(select(func.min(IntelFilingRow.accepted_at))),
            window_end=self.session.scalar(select(func.max(IntelFilingRow.accepted_at))),
            symbols_covered=len(covered),
            symbols_requested=requested or len(covered),
            gaps=gaps,
            caveats=caveats,
        )

    # -- sources -----------------------------------------------------------

    def sources(
        self, *, subject_type: str, subject_id: str, symbol: str | None = None
    ) -> list[ResearchSourceLinkOut]:
        if subject_type == "symbol":
            return self._symbol_sources(symbol or subject_id)
        if subject_type == "insider_transaction":
            return self._transaction_sources(subject_id)
        if subject_type == "institution":
            return self._institution_sources(subject_id)
        if subject_type == "signal":
            return self._signal_sources(subject_id)
        return []

    def _symbol_sources(self, symbol: str) -> list[ResearchSourceLinkOut]:
        canonical = (symbol or "").strip().upper()
        if not canonical:
            return []
        rows = self.session.scalars(
            select(IntelFilingRow)
            .where(IntelFilingRow.symbol == canonical)
            .order_by(IntelFilingRow.accepted_at.desc())
            .limit(SOURCE_LIMIT)
        ).all()
        return [
            link
            for link in (
                _filing_link(row, f"Ownership filing for {canonical}") for row in rows
            )
            if link is not None
        ]

    def _transaction_sources(self, transaction_id: str) -> list[ResearchSourceLinkOut]:
        identifier = _uuid_or_none(transaction_id)
        if identifier is None:
            return []
        row = self.session.get(IntelInsiderTransactionRow, identifier)
        if row is None:
            return []
        filing = self.session.get(IntelFilingRow, row.filing_id)
        if filing is None:
            return []
        when = row.transaction_date.date().isoformat() if row.transaction_date else "an unstated date"
        link = _filing_link(filing, f"Reported transaction on {when}")
        return [link] if link is not None else []

    def _institution_sources(self, cik: str) -> list[ResearchSourceLinkOut]:
        institution = self.session.scalar(
            select(IntelInstitutionRow).where(IntelInstitutionRow.cik == (cik or "").strip())
        )
        if institution is None:
            return []
        rows = self.session.scalars(
            select(IntelInstitutionalHoldingRow)
            .where(IntelInstitutionalHoldingRow.institution_id == institution.id)
            .order_by(IntelInstitutionalHoldingRow.accepted_at.desc())
            .limit(SOURCE_LIMIT)
        ).all()

        links: list[ResearchSourceLinkOut] = []
        seen: set[str] = set()
        for row in rows:
            if row.accession_number in seen:
                continue
            seen.add(row.accession_number)
            link = _holding_link(
                row, institution.name, f"13F disclosure for {institution.name}"
            )
            if link is not None:
                links.append(link)
        return links

    def _signal_sources(self, signal_id: str) -> list[ResearchSourceLinkOut]:
        identifier = _uuid_or_none(signal_id)
        if identifier is None:
            return []
        signal = self.session.get(IntelSignalRow, identifier)
        if signal is None:
            return []

        supports = f"Evidence for signal {signal.category}"
        links: list[ResearchSourceLinkOut] = []
        seen: set[str] = set()

        for event in signal.source_event_ids or []:
            link = self._link_for_event(str(event), supports)
            if link is not None and link.id not in seen:
                seen.add(link.id)
                links.append(link)
        return links

    def _link_for_event(
        self, event: str, supports: str
    ) -> ResearchSourceLinkOut | None:
        """Resolve one stored source-event id to a filing.

        Insider signals key their evidence by transaction id. Institutional
        signals key it as ``<accession>:<cusip>``. Both are resolved against
        stored rows; an id that resolves to nothing yields no link rather than a
        guessed one.
        """
        transaction_id = _uuid_or_none(event)
        if transaction_id is not None:
            row = self.session.get(IntelInsiderTransactionRow, transaction_id)
            if row is None:
                return None
            filing = self.session.get(IntelFilingRow, row.filing_id)
            return _filing_link(filing, supports) if filing is not None else None

        accession = event.split(":", 1)[0].strip()
        if not accession:
            return None
        holding = self.session.scalar(
            select(IntelInstitutionalHoldingRow)
            .where(IntelInstitutionalHoldingRow.accession_number == accession)
            .limit(1)
        )
        if holding is None:
            return None
        institution = self.session.get(IntelInstitutionRow, holding.institution_id)
        return _holding_link(
            holding, institution.name if institution is not None else "", supports
        )

    # -- one transaction ---------------------------------------------------

    def insider_transaction(self, transaction_id: str) -> InsiderTransactionOut | None:
        """One transaction by its stable id, independent of feed pagination."""
        identifier = _uuid_or_none(transaction_id)
        if identifier is None:
            return None
        row = self.session.get(IntelInsiderTransactionRow, identifier)
        if row is None:
            return None
        return _transaction_out(row)

    # -- internals ---------------------------------------------------------

    def _symbols(self) -> list[str]:
        return sorted(
            {
                row
                for row in self.session.scalars(
                    select(IntelInsiderTransactionRow.symbol).distinct()
                ).all()
                if row
            }
        )

    def _requested_universe(self) -> int:
        explicit = [
            item.strip()
            for item in self.settings.intelligence_insider_ciks.split(",")
            if item.strip()
        ]
        if explicit:
            return len(explicit)
        return len(self.settings.watchlist)

    def _price_coverage(self, symbol: str) -> PriceCoverageOut:
        """What daily bars exist for this symbol, and what the collector recorded.

        The bar count and range come from the stored candles; the expected and
        missing counts come from the coverage row the collector wrote. When no
        collection has run, the status says so rather than implying full history.
        """
        bars = int(
            self.session.scalar(
                select(func.count())
                .select_from(MarketCandleRow)
                .where(
                    MarketCandleRow.symbol == symbol,
                    MarketCandleRow.interval == "1d",
                )
            )
            or 0
        )
        if not bars:
            return PriceCoverageOut(
                status="unavailable",
                detail=(
                    f"No daily bars are stored for {symbol}. No performance claim can be "
                    "measured for it."
                ),
            )

        first_bar, last_bar = self.session.execute(
            select(
                func.min(MarketCandleRow.open_time),
                func.max(MarketCandleRow.open_time),
            ).where(
                MarketCandleRow.symbol == symbol,
                MarketCandleRow.interval == "1d",
            )
        ).one()
        latest = self.session.scalar(
            select(MarketCandleRow)
            .where(
                MarketCandleRow.symbol == symbol,
                MarketCandleRow.interval == "1d",
            )
            .order_by(MarketCandleRow.open_time.desc())
            .limit(1)
        )
        coverage = self.session.scalar(
            select(MarketPriceCoverageRow)
            .where(
                MarketPriceCoverageRow.symbol == symbol,
                MarketPriceCoverageRow.interval == "1d",
            )
            .order_by(MarketPriceCoverageRow.retrieved_at.desc())
            .limit(1)
        )

        return PriceCoverageOut(
            status=coverage.status if coverage is not None else "partial",
            provider=latest.provider if latest is not None else None,
            interval="1d",
            bars=bars,
            first_bar=first_bar.date() if first_bar else None,
            last_bar=last_bar.date() if last_bar else None,
            window_start=coverage.window_start.date() if coverage is not None else None,
            window_end=coverage.window_end.date() if coverage is not None else None,
            expected_days=coverage.expected_days if coverage is not None else 0,
            stored_days=coverage.stored_days if coverage is not None else bars,
            missing_days=coverage.missing_days if coverage is not None else 0,
            missing_dates=list(coverage.missing_dates or []) if coverage is not None else [],
            adjustment=latest.adjustment if latest is not None else None,
            retrieved_at=coverage.retrieved_at if coverage is not None else None,
            detail=coverage.detail if coverage is not None else None,
        )

    def _symbols_without_prices(self, symbols: list[str]) -> list[str]:
        if not symbols:
            return []
        priced = set(
            self.session.scalars(
                select(MarketCandleRow.symbol)
                .where(
                    MarketCandleRow.symbol.in_(symbols),
                    MarketCandleRow.interval == "1d",
                )
                .distinct()
            ).all()
        )
        return sorted(set(symbols) - priced)

    def _count(self, model: Any) -> int:
        return int(self.session.scalar(select(func.count()).select_from(model)) or 0)


__all__ = [
    "COUNTS_CAVEAT",
    "COVERAGE_CAVEAT",
    "MemberResearchService",
    "UNRESOLVED_SOURCE_CAVEAT",
]
