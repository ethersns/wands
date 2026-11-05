"""Deterministic SEC fixtures.

No test in this suite may reach the SEC. These builders produce documents in the
real ownership and information-table shapes, and the fake client records every
call so a test can assert on request counts as well as parsed output.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from wands.intelligence.base import (
    FilingRef,
    SourceDataError,
    SourceRateLimited,
    SourceUnavailable,
)

FIXED_NOW = datetime(2026, 11, 5, 14, 0, 0, tzinfo=UTC)


def _owner_xml(owner: dict[str, Any]) -> str:
    return f"""
    <reportingOwner>
      <reportingOwnerId>
        <rptOwnerCik>{owner.get("cik", "0001214156")}</rptOwnerCik>
        <rptOwnerName>{owner.get("name", "COOK TIMOTHY D")}</rptOwnerName>
      </reportingOwnerId>
      <reportingOwnerRelationship>
        <isDirector>{1 if owner.get("is_director") else 0}</isDirector>
        <isOfficer>{1 if owner.get("is_officer") else 0}</isOfficer>
        <isTenPercentOwner>{1 if owner.get("is_ten_percent_owner") else 0}</isTenPercentOwner>
        <officerTitle>{owner.get("officer_title", "")}</officerTitle>
      </reportingOwnerRelationship>
    </reportingOwner>"""


def _transaction_xml(transaction: dict[str, Any]) -> str:
    table = transaction.get("table", "non_derivative")
    holding = transaction.get("holding", False)
    if holding:
        element = (
            "nonDerivativeHolding" if table == "non_derivative" else "derivativeHolding"
        )
    else:
        element = (
            "nonDerivativeTransaction" if table == "non_derivative" else "derivativeTransaction"
        )

    price = transaction.get("price")
    price_xml = (
        f"<transactionPricePerShare><value>{price}</value></transactionPricePerShare>"
        if price is not None
        else "<transactionPricePerShare/>"
    )
    code = transaction.get("code", "")
    coding = (
        f"""<transactionCoding>
          <transactionFormType>4</transactionFormType>
          <transactionCode>{code}</transactionCode>
        </transactionCoding>"""
        if code
        else ""
    )
    date = transaction.get("date")
    date_xml = f"<transactionDate><value>{date}</value></transactionDate>" if date else ""
    footnotes = "".join(
        f'<footnoteId id="{identifier}"/>' for identifier in transaction.get("footnotes", [])
    )

    title = transaction.get("security_title", "Common Stock")
    shares = transaction.get("shares", 0)
    acquired = transaction.get("acquired_disposed", "A")
    owned_after = transaction.get("owned_after", 0)
    direct = transaction.get("direct", "D")
    nature = transaction.get("nature", "")

    return f"""
      <{element}>
        <securityTitle><value>{title}</value></securityTitle>
        {date_xml}
        {coding}
        <transactionAmounts>
          <transactionShares><value>{shares}</value></transactionShares>
          {price_xml}
          <transactionAcquiredDisposedCode><value>{acquired}</value></transactionAcquiredDisposedCode>
        </transactionAmounts>
        <postTransactionAmounts>
          <sharesOwnedFollowingTransaction><value>{owned_after}</value></sharesOwnedFollowingTransaction>
        </postTransactionAmounts>
        <ownershipNature>
          <directOrIndirectOwnership><value>{direct}</value></directOrIndirectOwnership>
          <natureOfOwnership><value>{nature}</value></natureOfOwnership>
        </ownershipNature>
        {footnotes}
      </{element}>"""


def form4_xml(
    *,
    document_type: str = "4",
    period: str = "2024-01-15",
    issuer_cik: str = "0000320193",
    issuer_name: str = "Apple Inc.",
    symbol: str = "AAPL",
    owners: list[dict[str, Any]] | None = None,
    transactions: list[dict[str, Any]] | None = None,
    original_submission: str | None = None,
) -> bytes:
    owner_list = owners or [{"cik": "0001214156", "name": "COOK TIMOTHY D", "is_officer": True}]
    transaction_list = transactions or [
        {"code": "P", "date": "2024-01-10", "shares": 1000, "price": "185.50"}
    ]

    non_derivative = "".join(
        _transaction_xml(item)
        for item in transaction_list
        if item.get("table", "non_derivative") == "non_derivative"
    )
    derivative = "".join(
        _transaction_xml(item)
        for item in transaction_list
        if item.get("table") == "derivative"
    )
    original = (
        f"<dateOfOriginalSubmission>{original_submission}</dateOfOriginalSubmission>"
        if original_submission
        else ""
    )

    return f"""<?xml version="1.0"?>
<ownershipDocument>
  <schemaVersion>X0608</schemaVersion>
  <documentType>{document_type}</documentType>
  <periodOfReport>{period}</periodOfReport>
  {original}
  <issuer>
    <issuerCik>{issuer_cik}</issuerCik>
    <issuerName>{issuer_name}</issuerName>
    <issuerTradingSymbol>{symbol}</issuerTradingSymbol>
  </issuer>
  {"".join(_owner_xml(owner) for owner in owner_list)}
  <nonDerivativeTable>{non_derivative}</nonDerivativeTable>
  <derivativeTable>{derivative}</derivativeTable>
</ownershipDocument>""".encode()


def information_table_xml(holdings: list[dict[str, Any]]) -> bytes:
    rows = "".join(
        f"""
  <infoTable>
    <nameOfIssuer>{item.get("issuer_name", "APPLE INC")}</nameOfIssuer>
    <titleOfClass>{item.get("class_title", "COM")}</titleOfClass>
    <cusip>{item.get("cusip", "037833100")}</cusip>
    <value>{item.get("value", 1000)}</value>
    <shrsOrPrnAmt>
      <sshPrnamt>{item.get("shares", 100)}</sshPrnamt>
      <sshPrnamtType>SH</sshPrnamtType>
    </shrsOrPrnAmt>
    <investmentDiscretion>SOLE</investmentDiscretion>
    <votingAuthority>
      <sole>{item.get("shares", 100)}</sole>
      <shared>0</shared>
      <none>0</none>
    </votingAuthority>
  </infoTable>"""
        for item in holdings
    )
    return f"""<?xml version="1.0"?>
<informationTable xmlns="http://www.sec.gov/edgar/document/thirteenf/informationtable">
{rows}
</informationTable>""".encode()


@dataclass
class FakeEdgarClient:
    """A stand-in for :class:`EdgarClient` with recorded calls."""

    documents: dict[str, bytes] = field(default_factory=dict)
    filings: dict[str, list[FilingRef]] = field(default_factory=dict)
    institutional: dict[str, list[FilingRef]] = field(default_factory=dict)
    information_tables: dict[str, bytes] = field(default_factory=dict)
    tickers: dict[str, str] = field(default_factory=dict)
    fail_with: Exception | None = None
    fail_times: int = 0
    calls: list[str] = field(default_factory=list)

    name = "sec_edgar"

    def is_configured(self) -> bool:
        return True

    def _maybe_fail(self) -> None:
        if self.fail_with is not None and self.fail_times > 0:
            self.fail_times -= 1
            raise self.fail_with

    def cik_for_ticker(self, ticker: str) -> str | None:
        return self.tickers.get(ticker.upper())

    def recent_filings(
        self,
        cik: str,
        *,
        forms: Any = None,
        since: datetime | None = None,
        limit: int = 100,
    ) -> list[FilingRef]:
        self.calls.append(f"recent_filings:{cik}")
        self._maybe_fail()
        refs = self.filings.get(cik, [])
        if since is not None:
            refs = [ref for ref in refs if ref.accepted_at >= since]
        return refs[:limit]

    def institutional_filings(
        self, cik: str, *, since: datetime | None = None, limit: int = 20
    ) -> list[FilingRef]:
        self.calls.append(f"institutional_filings:{cik}")
        self._maybe_fail()
        refs = self.institutional.get(cik, [])
        if since is not None:
            refs = [ref for ref in refs if ref.accepted_at >= since]
        return refs[:limit]

    def document(self, cik: str, accession: str, filename: str) -> bytes:
        self.calls.append(f"document:{accession}")
        self._maybe_fail()
        if accession not in self.documents:
            raise SourceDataError(f"No fixture document for {accession}.")
        return self.documents[accession]

    def document_url(self, cik: str, accession: str, filename: str) -> str:
        return f"https://www.sec.gov/Archives/edgar/data/{cik}/{accession}/{filename}"

    def information_table(self, cik: str, accession: str) -> tuple[str, bytes]:
        self.calls.append(f"information_table:{accession}")
        self._maybe_fail()
        if accession not in self.information_tables:
            raise SourceDataError(f"No fixture information table for {accession}.")
        return "form13fInfoTable.xml", self.information_tables[accession]


def filing_ref(
    accession: str,
    *,
    accepted_at: datetime,
    symbol: str = "AAPL",
    issuer_cik: str = "0000320193",
    issuer_name: str = "Apple Inc.",
    form_type: str = "4",
    period: datetime | None = None,
) -> FilingRef:
    return FilingRef(
        accession_number=accession,
        form_type=form_type,
        issuer_cik=issuer_cik,
        issuer_name=issuer_name,
        symbol=symbol,
        filed_date=accepted_at,
        accepted_at=accepted_at,
        period_of_report=period or accepted_at,
        primary_document="primary.xml",
        source_url=f"https://www.sec.gov/Archives/edgar/data/{issuer_cik}/{accession}/primary.xml",
        is_amendment=form_type.endswith("/A"),
    )


__all__ = [
    "FIXED_NOW",
    "FakeEdgarClient",
    "SourceRateLimited",
    "SourceUnavailable",
    "filing_ref",
    "form4_xml",
    "information_table_xml",
]
