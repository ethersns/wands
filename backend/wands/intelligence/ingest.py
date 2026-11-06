"""Ingestion: discovery, parsing, deduplication and persistence.

Three rules shape this module.

*Deduplication is a database guarantee.* The accession number is unique, so
re-running a collector is a no-op rather than a way to double a backtest's event
count. A filing that is already stored is counted as seen and skipped.

*Provenance is stored, not reconstructed.* Every transaction row carries the
accession number, the source URL and the SEC acceptance time, so a figure on a
screen can always be traced back to the document that produced it.

*An amendment is a new fact with its own timestamp.* It is stored as its own
filing and linked to the original. A backtest that runs before the amendment was
accepted sees the original, which is what an observer at that moment would have
seen.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from wands.config import Settings
from wands.db.models import (
    IntelFilingRow,
    IntelIngestRunRow,
    IntelInsiderTransactionRow,
    IntelInstitutionalHoldingRow,
    IntelInstitutionRow,
)
from wands.intelligence.base import (
    FilingRef,
    IntelError,
    ParsedFiling,
    SourceDataError,
    SourceNotConfigured,
)
from wands.intelligence.classify import classify, is_open_market
from wands.intelligence.edgar import EdgarClient
from wands.intelligence.forms import parse_information_table, parse_ownership_document
from wands.logging import get_logger

logger = get_logger(__name__)


@dataclass
class IngestResult:
    source: str = "sec_edgar"
    filings_seen: int = 0
    filings_new: int = 0
    transactions_new: int = 0
    signals_new: int = 0
    errors: list[dict[str, str]] = field(default_factory=list)
    detail: dict[str, object] = field(default_factory=dict)

    @property
    def status(self) -> str:
        if self.errors and not self.filings_new:
            return "failed"
        if self.errors:
            return "partial"
        return "ok"


def build_client(settings: Settings) -> EdgarClient:
    return EdgarClient(
        user_agent=settings.sec_user_agent,
        base_url=settings.sec_base_url,
        data_base_url=settings.sec_data_base_url,
        timeout=settings.sec_timeout_seconds,
    )


def resolve_issuer_ciks(settings: Settings, client: EdgarClient) -> list[str]:
    """Which issuers to poll.

    An explicit list wins. Otherwise the equity portion of the market watchlist
    is mapped to CIKs, which keeps a small deployment useful without a
    configuration step.
    """
    explicit = [
        item.strip() for item in settings.intelligence_insider_ciks.split(",") if item.strip()
    ]
    if explicit:
        return explicit

    ciks: list[str] = []
    for symbol in settings.watchlist:
        if "/" in symbol:
            continue
        cik = client.cik_for_ticker(symbol)
        if cik and cik not in ciks:
            ciks.append(cik)
    return ciks


class InsiderIngestor:
    """Collects SEC ownership filings for a set of issuers."""

    def __init__(
        self,
        session: Session,
        settings: Settings,
        *,
        client: EdgarClient | None = None,
    ) -> None:
        self.session = session
        self.settings = settings
        self.client = client or build_client(settings)

    # -- public ------------------------------------------------------------

    def run(
        self,
        *,
        ciks: list[str] | None = None,
        since: datetime | None = None,
        limit_per_issuer: int = 50,
    ) -> IngestResult:
        result = IngestResult()
        run_row = IntelIngestRunRow(source="sec_edgar", started_at=datetime.now(tz=UTC))
        self.session.add(run_row)
        self.session.flush()

        if not self.settings.intelligence_enabled:
            result.errors.append(
                {"stage": "config", "message": "Intelligence collection is disabled."}
            )
            self._finish(run_row, result)
            return result

        try:
            targets = ciks if ciks is not None else resolve_issuer_ciks(self.settings, self.client)
        except IntelError as exc:
            result.errors.append({"stage": "discovery", "message": str(exc)})
            self._finish(run_row, result)
            return result

        if not targets:
            result.errors.append(
                {
                    "stage": "discovery",
                    "message": (
                        "No issuer CIKs to poll. Set WANDS_INTELLIGENCE_INSIDER_CIKS or add "
                        "equity symbols to WANDS_MARKET_WATCHLIST."
                    ),
                }
            )
            self._finish(run_row, result)
            return result

        window_start = since or (
            datetime.now(tz=UTC)
            - timedelta(days=self.settings.intelligence_insider_lookback_days)
        )

        for cik in targets:
            try:
                refs = self.client.recent_filings(
                    cik, since=window_start, limit=limit_per_issuer
                )
            except IntelError as exc:
                result.errors.append({"stage": "discovery", "cik": cik, "message": str(exc)})
                continue

            for ref in refs:
                result.filings_seen += 1
                try:
                    created, transactions = self.ingest_filing(ref)
                except IntelError as exc:
                    result.errors.append(
                        {
                            "stage": "ingest",
                            "cik": cik,
                            "accession": ref.accession_number,
                            "message": str(exc),
                        }
                    )
                    continue
                if created:
                    result.filings_new += 1
                    result.transactions_new += transactions

        result.detail["issuers"] = len(targets)
        result.detail["windowStart"] = window_start.isoformat()
        self._finish(run_row, result)
        return result

    def ingest_filing(
        self, ref: FilingRef, *, document: bytes | None = None
    ) -> tuple[bool, int]:
        """Store one filing. Returns ``(created, transaction_rows)``.

        A filing already in the database is skipped without re-fetching, which
        is what makes a repeated run cheap and idempotent.

        ``document`` lets a caller that already downloaded the bytes — a
        concurrent backfill — hand them over instead of paying for a second
        request against the SEC's rate limit.
        """
        existing = self.session.scalar(
            select(IntelFilingRow).where(
                IntelFilingRow.accession_number == ref.accession_number
            )
        )
        if existing is not None:
            return False, 0

        if document is None:
            document = self.client.document(
                ref.issuer_cik, ref.accession_number, ref.primary_document
            )
        parsed = parse_ownership_document(
            document,
            accession_number=ref.accession_number,
            accepted_at=ref.accepted_at,
            source_url=ref.source_url,
            form_type_hint=ref.form_type,
            filed_date=ref.filed_date,
        )
        return True, self.persist(parsed)

    def persist(self, parsed: ParsedFiling) -> int:
        """Write a parsed filing and its transaction lines."""
        filing = IntelFilingRow(
            accession_number=parsed.accession_number,
            form_type=parsed.form_type,
            document_type=parsed.document_type,
            issuer_cik=parsed.issuer_cik,
            issuer_name=parsed.issuer_name,
            symbol=parsed.symbol,
            period_of_report=parsed.period_of_report,
            filed_date=parsed.filed_date,
            accepted_at=parsed.accepted_at,
            source_url=parsed.source_url,
            source="sec_edgar",
            is_amendment=parsed.is_amendment,
            original_submission_date=parsed.original_submission_date,
            raw_sha256=parsed.raw_sha256,
        )
        if parsed.is_amendment:
            filing.amends_accession = self._find_original(parsed)

        self.session.add(filing)
        self.session.flush()

        rows = 0
        for owner in parsed.owners:
            for transaction in parsed.transactions:
                classification = classify(transaction)
                self.session.add(
                    IntelInsiderTransactionRow(
                        filing_id=filing.id,
                        accession_number=parsed.accession_number,
                        symbol=parsed.symbol,
                        issuer_cik=parsed.issuer_cik,
                        issuer_name=parsed.issuer_name,
                        reporting_person_cik=owner.cik,
                        reporting_person_name=owner.name,
                        is_director=owner.is_director,
                        is_officer=owner.is_officer,
                        is_ten_percent_owner=owner.is_ten_percent_owner,
                        officer_title=owner.officer_title,
                        table_kind=transaction.table_kind,
                        ordinal=transaction.ordinal,
                        security_title=transaction.security_title,
                        transaction_date=transaction.transaction_date,
                        transaction_code=transaction.transaction_code,
                        acquired_disposed=transaction.acquired_disposed,
                        shares=transaction.shares,
                        price_per_share=transaction.price_per_share,
                        value=transaction.value,
                        shares_owned_after=transaction.shares_owned_after,
                        direct_or_indirect=transaction.direct_or_indirect,
                        nature_of_ownership=transaction.nature_of_ownership,
                        classification=classification.value,
                        is_open_market=is_open_market(classification),
                        is_derivative=transaction.is_derivative,
                        footnote_ids=list(transaction.footnote_ids),
                        accepted_at=parsed.accepted_at,
                        is_amendment=parsed.is_amendment,
                        source_url=parsed.source_url,
                    )
                )
                rows += 1
        self.session.flush()
        return rows

    # -- internals ---------------------------------------------------------

    def _find_original(self, parsed: ParsedFiling) -> str | None:
        """Link an amendment to the filing it amends.

        The ownership XML does not carry the original accession number, so the
        link is made on issuer, reporting person and period of report. When more
        than one candidate exists the most recently accepted non-amendment wins,
        which is the one an observer would have been looking at.
        """
        if not parsed.owners:
            return None
        owner_cik = parsed.owners[0].cik
        statement = (
            select(IntelFilingRow.accession_number)
            .join(
                IntelInsiderTransactionRow,
                IntelInsiderTransactionRow.filing_id == IntelFilingRow.id,
            )
            .where(
                IntelFilingRow.issuer_cik == parsed.issuer_cik,
                IntelFilingRow.is_amendment.is_(False),
                IntelInsiderTransactionRow.reporting_person_cik == owner_cik,
            )
        )
        if parsed.period_of_report is not None:
            statement = statement.where(
                IntelFilingRow.period_of_report == parsed.period_of_report
            )
        statement = statement.order_by(IntelFilingRow.accepted_at.desc()).limit(1)
        return self.session.scalar(statement)

    def _finish(self, run_row: IntelIngestRunRow, result: IngestResult) -> None:
        run_row.finished_at = datetime.now(tz=UTC)
        run_row.status = result.status
        run_row.filings_seen = result.filings_seen
        run_row.filings_new = result.filings_new
        run_row.transactions_new = result.transactions_new
        run_row.signals_new = result.signals_new
        run_row.errors = list(result.errors)
        run_row.detail = dict(result.detail)
        self.session.flush()
        logger.info(
            "intelligence ingest finished",
            extra={
                "event": "intelligence.ingest",
                "context": {
                    "status": result.status,
                    "filingsSeen": result.filings_seen,
                    "filingsNew": result.filings_new,
                    "transactionsNew": result.transactions_new,
                    "errors": len(result.errors),
                },
            },
        )


class InstitutionalIngestor:
    """Collects 13F-HR filings for a set of institutions.

    This is the smallest useful working version: quarterly holdings, the
    institution that reported them, and the date the world could read them.
    Nothing here claims to know a current position.
    """

    def __init__(
        self,
        session: Session,
        settings: Settings,
        *,
        client: EdgarClient | None = None,
    ) -> None:
        self.session = session
        self.settings = settings
        self.client = client or build_client(settings)

    def run(
        self,
        *,
        ciks: list[str],
        since: datetime | None = None,
        limit_per_institution: int = 4,
    ) -> IngestResult:
        result = IngestResult(source="sec_edgar_13f")
        run_row = IntelIngestRunRow(
            source="sec_edgar_13f", started_at=datetime.now(tz=UTC)
        )
        self.session.add(run_row)
        self.session.flush()

        if not self.settings.intelligence_enabled:
            result.errors.append(
                {"stage": "config", "message": "Intelligence collection is disabled."}
            )
            self._finish(run_row, result)
            return result

        if not ciks:
            result.errors.append(
                {"stage": "discovery", "message": "No institution CIKs were supplied."}
            )
            self._finish(run_row, result)
            return result

        for cik in ciks:
            try:
                refs = self.client.institutional_filings(
                    cik, since=since, limit=limit_per_institution
                )
            except IntelError as exc:
                result.errors.append({"stage": "discovery", "cik": cik, "message": str(exc)})
                continue

            for ref in refs:
                result.filings_seen += 1
                try:
                    created, holdings = self.ingest_filing(ref)
                except IntelError as exc:
                    result.errors.append(
                        {
                            "stage": "ingest",
                            "cik": cik,
                            "accession": ref.accession_number,
                            "message": str(exc),
                        }
                    )
                    continue
                if created:
                    result.filings_new += 1
                    result.transactions_new += holdings

        self._finish(run_row, result)
        return result

    def ingest_filing(self, ref: FilingRef) -> tuple[bool, int]:
        existing = self.session.scalar(
            select(IntelInstitutionalHoldingRow.id).where(
                IntelInstitutionalHoldingRow.accession_number == ref.accession_number
            )
        )
        if existing is not None:
            return False, 0

        if ref.period_of_report is None:
            raise SourceDataError(
                f"13F filing {ref.accession_number} has no period of report, so its "
                "holdings cannot be placed in a quarter."
            )

        filename, document = self.client.information_table(
            ref.issuer_cik, ref.accession_number
        )
        parsed = parse_information_table(
            document,
            accession_number=ref.accession_number,
            cik=ref.issuer_cik,
            institution_name=ref.issuer_name,
            period_of_report=ref.period_of_report,
            filed_date=ref.filed_date,
            accepted_at=ref.accepted_at,
            source_url=self.client.document_url(
                ref.issuer_cik, ref.accession_number, filename
            ),
            is_amendment=ref.is_amendment,
        )

        institution = self.session.scalar(
            select(IntelInstitutionRow).where(IntelInstitutionRow.cik == parsed.cik)
        )
        if institution is None:
            institution = IntelInstitutionRow(cik=parsed.cik, name=parsed.institution_name)
            self.session.add(institution)
            self.session.flush()

        for holding in parsed.holdings:
            self.session.add(
                IntelInstitutionalHoldingRow(
                    institution_id=institution.id,
                    accession_number=parsed.accession_number,
                    ordinal=holding.ordinal,
                    period_of_report=parsed.period_of_report,
                    filed_date=parsed.filed_date,
                    accepted_at=parsed.accepted_at,
                    cusip=holding.cusip,
                    issuer_name=holding.issuer_name,
                    class_title=holding.class_title,
                    value_usd=holding.value_usd,
                    shares=holding.shares,
                    share_type=holding.share_type,
                    put_call=holding.put_call,
                    investment_discretion=holding.investment_discretion,
                    voting_sole=holding.voting_sole,
                    voting_shared=holding.voting_shared,
                    voting_none=holding.voting_none,
                    is_amendment=parsed.is_amendment,
                    source_url=parsed.source_url,
                )
            )
        self.session.flush()
        return True, len(parsed.holdings)

    def _finish(self, run_row: IntelIngestRunRow, result: IngestResult) -> None:
        run_row.finished_at = datetime.now(tz=UTC)
        run_row.status = result.status
        run_row.filings_seen = result.filings_seen
        run_row.filings_new = result.filings_new
        run_row.transactions_new = result.transactions_new
        run_row.errors = list(result.errors)
        run_row.detail = dict(result.detail)
        self.session.flush()


__all__ = [
    "IngestResult",
    "InsiderIngestor",
    "InstitutionalIngestor",
    "SourceNotConfigured",
    "build_client",
    "resolve_issuer_ciks",
]
