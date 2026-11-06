"""SEC ownership document parsing (Forms 3, 4, 5 and their amendments).

The parser is deliberately literal. It reads what the document says and leaves a
field empty when the document leaves it empty. Two consequences are worth
stating because they are the difference between a usable dataset and a
plausible-looking one:

* A missing ``transactionPricePerShare`` stays ``None``. Gifts, awards and
  withholding have no transaction price, and substituting zero would make an
  aggregate purchase value quietly wrong.
* ``transactionDate`` is a calendar date, not a timestamp. It is stored at UTC
  midnight and is never used to decide when information became public — that is
  the SEC acceptance time, which the index supplies.

Form 3 is an initial holdings statement and contains no transactions. Its
holdings are parsed as lines with an empty transaction code so the position is
recorded without being mistaken for a trade.
"""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from typing import Any
from xml.etree import ElementTree

from defusedxml.common import DefusedXmlException
from defusedxml.ElementTree import fromstring as safe_fromstring

from wands.intelligence.base import (
    ParsedFiling,
    ParsedHolding,
    ParsedInstitutionalFiling,
    ParsedTransaction,
    ReportingOwner,
    SourceDataError,
)

# SEC documents are untrusted input. ``defusedxml`` refuses entity expansion and
# external entity resolution, so a hostile document cannot exhaust memory or read
# a local file through the parser.
_XML_ERRORS = (ElementTree.ParseError, DefusedXmlException)

# 13F values switched from thousands of dollars to whole dollars for periods of
# report on or after this date.
_DOLLAR_VALUES_FROM = datetime(2023, 1, 3, tzinfo=UTC)

# Element names that carry a reported line, mapped to the table they belong to.
_LINE_ELEMENTS: dict[str, str] = {
    "nonDerivativeTransaction": "non_derivative",
    "nonDerivativeHolding": "non_derivative",
    "derivativeTransaction": "derivative",
    "derivativeHolding": "derivative",
}


def _local(tag: Any) -> str:
    """Strip an XML namespace so the parser works with or without one."""
    if not isinstance(tag, str):
        return ""
    return tag.rsplit("}", 1)[-1]


def _child(node: ElementTree.Element | None, name: str) -> ElementTree.Element | None:
    if node is None:
        return None
    for child in node:
        if _local(child.tag) == name:
            return child
    return None


def _children(node: ElementTree.Element | None, name: str) -> list[ElementTree.Element]:
    if node is None:
        return []
    return [child for child in node if _local(child.tag) == name]


def _text(node: ElementTree.Element | None, *path: str) -> str:
    current = node
    for name in path:
        current = _child(current, name)
        if current is None:
            return ""
    if current.text is None:
        return ""
    return current.text.strip()


def _decimal(value: str) -> Decimal | None:
    text = (value or "").strip().replace(",", "").replace("$", "")
    if not text:
        return None
    try:
        return Decimal(text)
    except (InvalidOperation, ValueError):
        return None


def _date(value: str) -> datetime | None:
    text = (value or "").strip()
    if not text:
        return None
    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%m/%d/%Y"):
        try:
            return datetime.strptime(text, fmt).replace(tzinfo=UTC)
        except ValueError:
            continue
    return None


def _flag(value: str) -> bool:
    return (value or "").strip().lower() in {"1", "true", "y", "yes"}


def _footnote_ids(node: ElementTree.Element) -> list[str]:
    ids: list[str] = []
    for child in node:
        if _local(child.tag) == "footnoteId":
            identifier = (child.get("id") or "").strip()
            if identifier:
                ids.append(identifier)
    return ids


def _parse_line(node: ElementTree.Element, table_kind: str, ordinal: int) -> ParsedTransaction:
    amounts = _child(node, "transactionAmounts")
    post = _child(node, "postTransactionAmounts")
    nature = _child(node, "ownershipNature")

    return ParsedTransaction(
        table_kind=table_kind,
        ordinal=ordinal,
        security_title=_text(node, "securityTitle", "value"),
        transaction_date=_date(_text(node, "transactionDate", "value")),
        transaction_code=_text(node, "transactionCoding", "transactionCode").upper(),
        acquired_disposed=_text(
            amounts, "transactionAcquiredDisposedCode", "value"
        ).upper(),
        shares=_decimal(_text(amounts, "transactionShares", "value")),
        price_per_share=_decimal(_text(amounts, "transactionPricePerShare", "value")),
        shares_owned_after=_decimal(
            _text(post, "sharesOwnedFollowingTransaction", "value")
        ),
        direct_or_indirect=_text(nature, "directOrIndirectOwnership", "value").upper(),
        nature_of_ownership=_text(nature, "natureOfOwnership", "value"),
        footnote_ids=_footnote_ids(node),
    )


def _parse_owner(node: ElementTree.Element) -> ReportingOwner:
    relationship = _child(node, "reportingOwnerRelationship")
    return ReportingOwner(
        cik=_text(node, "reportingOwnerId", "rptOwnerCik"),
        name=_text(node, "reportingOwnerId", "rptOwnerName"),
        is_director=_flag(_text(relationship, "isDirector")),
        is_officer=_flag(_text(relationship, "isOfficer")),
        is_ten_percent_owner=_flag(_text(relationship, "isTenPercentOwner")),
        officer_title=_text(relationship, "officerTitle"),
    )


def parse_ownership_document(
    document: bytes,
    *,
    accession_number: str,
    accepted_at: datetime,
    source_url: str,
    form_type_hint: str = "",
    filed_date: datetime | None = None,
) -> ParsedFiling:
    """Parse a Form 3/4/5 ownership document.

    ``accepted_at`` comes from the filing index, not from the document: the
    document records when a transaction happened, never when the world could
    read about it.
    """
    if not document:
        raise SourceDataError(f"Filing {accession_number} has an empty document.")

    try:
        root = safe_fromstring(document)
    except _XML_ERRORS as exc:
        raise SourceDataError(
            f"Filing {accession_number} is not well-formed XML: {exc}"
        ) from exc

    if _local(root.tag) != "ownershipDocument":
        raise SourceDataError(
            f"Filing {accession_number} is not an ownership document "
            f"(root element is {_local(root.tag)!r})."
        )

    issuer = _child(root, "issuer")
    document_type = _text(root, "documentType")
    form_type = form_type_hint or document_type

    owners = [_parse_owner(node) for node in _children(root, "reportingOwner")]
    if not owners:
        raise SourceDataError(f"Filing {accession_number} names no reporting owner.")

    transactions: list[ParsedTransaction] = []
    for table_name in ("nonDerivativeTable", "derivativeTable"):
        table = _child(root, table_name)
        if table is None:
            continue
        ordinal = 0
        for node in table:
            table_kind = _LINE_ELEMENTS.get(_local(node.tag))
            if table_kind is None:
                continue
            transactions.append(_parse_line(node, table_kind, ordinal))
            ordinal += 1

    original_submission = _date(_text(root, "dateOfOriginalSubmission"))
    is_amendment = form_type.upper().endswith("/A") or original_submission is not None

    return ParsedFiling(
        accession_number=accession_number,
        form_type=form_type,
        document_type=document_type,
        issuer_cik=_text(issuer, "issuerCik"),
        issuer_name=_text(issuer, "issuerName"),
        symbol=_text(issuer, "issuerTradingSymbol").upper(),
        period_of_report=_date(_text(root, "periodOfReport")),
        accepted_at=accepted_at,
        source_url=source_url,
        is_amendment=is_amendment,
        original_submission_date=original_submission,
        owners=owners,
        transactions=transactions,
        raw_sha256=hashlib.sha256(document).hexdigest(),
        filed_date=filed_date,
    )


def parse_information_table(
    document: bytes,
    *,
    accession_number: str,
    cik: str,
    institution_name: str,
    period_of_report: datetime,
    filed_date: datetime | None,
    accepted_at: datetime,
    source_url: str,
    is_amendment: bool = False,
) -> ParsedInstitutionalFiling:
    """Parse a 13F information table.

    ``period_of_report`` is the quarter end and ``accepted_at`` is when the
    filing became public — up to 45 days later. The two are kept apart so a
    quarterly snapshot can never be presented as a current position.
    """
    if not document:
        raise SourceDataError(f"13F filing {accession_number} has an empty document.")

    try:
        root = safe_fromstring(document)
    except _XML_ERRORS as exc:
        raise SourceDataError(
            f"13F filing {accession_number} is not well-formed XML: {exc}"
        ) from exc

    # The SEC required 13F values in thousands of dollars until the amendments
    # effective 3 January 2023, and in whole dollars from then on. Mixing the
    # two would understate every pre-2023 position by a factor of 1000, so the
    # unit is normalised here rather than left to the reader.
    value_multiplier = Decimal("1000") if period_of_report < _DOLLAR_VALUES_FROM else Decimal("1")

    holdings: list[ParsedHolding] = []
    for ordinal, node in enumerate(_children(root, "infoTable")):
        voting = _child(node, "votingAuthority")
        reported_value = _decimal(_text(node, "value"))
        holdings.append(
            ParsedHolding(
                ordinal=ordinal,
                cusip=_text(node, "cusip").upper(),
                issuer_name=_text(node, "nameOfIssuer"),
                class_title=_text(node, "titleOfClass"),
                value_usd=(
                    reported_value * value_multiplier
                    if reported_value is not None
                    else None
                ),
                shares=_decimal(_text(node, "shrsOrPrnAmt", "sshPrnamt")),
                share_type=_text(node, "shrsOrPrnAmt", "sshPrnamtType").upper() or "SH",
                put_call=_text(node, "putCall").upper(),
                investment_discretion=_text(node, "investmentDiscretion"),
                voting_sole=_decimal(_text(voting, "sole")),
                voting_shared=_decimal(_text(voting, "shared")),
                voting_none=_decimal(_text(voting, "none")),
            )
        )

    return ParsedInstitutionalFiling(
        accession_number=accession_number,
        cik=cik,
        institution_name=institution_name,
        period_of_report=period_of_report,
        filed_date=filed_date,
        accepted_at=accepted_at,
        source_url=source_url,
        is_amendment=is_amendment,
        holdings=holdings,
    )
