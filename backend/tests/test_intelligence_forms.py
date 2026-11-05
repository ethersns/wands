"""Ownership document parsing and transaction classification.

The classification tests are the important ones. A system that treats an award
or a tax withholding as insider buying produces a confident signal from nothing,
so each non-market code is asserted explicitly.
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

import pytest

from wands.intelligence.base import SourceDataError, TransactionClass
from wands.intelligence.classify import classify, describe, is_open_market
from wands.intelligence.forms import parse_information_table, parse_ownership_document

from .intelligence_fakes import form4_xml, information_table_xml

ACCEPTED = datetime(2024, 1, 16, 16, 30, tzinfo=UTC)


def _parse(document: bytes, **overrides):
    return parse_ownership_document(
        document,
        accession_number=overrides.pop("accession_number", "0000320193-24-000001"),
        accepted_at=overrides.pop("accepted_at", ACCEPTED),
        source_url=overrides.pop("source_url", "https://www.sec.gov/x"),
        **overrides,
    )


# --------------------------------------------------------------------------
# Parsing
# --------------------------------------------------------------------------


def test_parses_issuer_owner_and_transaction():
    parsed = _parse(form4_xml())

    assert parsed.issuer_cik == "0000320193"
    assert parsed.issuer_name == "Apple Inc."
    assert parsed.symbol == "AAPL"
    assert parsed.document_type == "4"
    assert parsed.period_of_report == datetime(2024, 1, 15, tzinfo=UTC)
    assert len(parsed.owners) == 1
    assert parsed.owners[0].cik == "0001214156"
    assert parsed.owners[0].is_officer is True
    assert len(parsed.transactions) == 1

    transaction = parsed.transactions[0]
    assert transaction.transaction_code == "P"
    assert transaction.acquired_disposed == "A"
    assert transaction.shares == Decimal("1000")
    assert transaction.price_per_share == Decimal("185.50")
    assert transaction.value == Decimal("185500.00")
    assert transaction.transaction_date == datetime(2024, 1, 10, tzinfo=UTC)


def test_transaction_date_is_a_calendar_date_not_a_timestamp():
    """A transaction date must never be mistaken for a publication time."""
    parsed = _parse(form4_xml())
    assert parsed.transactions[0].transaction_date == datetime(2024, 1, 10, tzinfo=UTC)
    assert parsed.accepted_at == ACCEPTED
    assert parsed.transactions[0].transaction_date != parsed.accepted_at


def test_missing_price_leaves_value_unknown():
    parsed = _parse(
        form4_xml(transactions=[{"code": "P", "date": "2024-01-10", "shares": 500}])
    )
    transaction = parsed.transactions[0]
    assert transaction.price_per_share is None
    assert transaction.value is None, "a missing price must not become a zero value"


def test_multiple_reporting_owners_are_all_captured():
    parsed = _parse(
        form4_xml(
            owners=[
                {"cik": "0000000001", "name": "FUND LP", "is_ten_percent_owner": True},
                {"cik": "0000000002", "name": "FUND GP LLC", "is_ten_percent_owner": True},
            ]
        )
    )
    assert [owner.cik for owner in parsed.owners] == ["0000000001", "0000000002"]


def test_form3_holdings_are_parsed_without_a_transaction_code():
    parsed = _parse(
        form4_xml(
            document_type="3",
            transactions=[
                {
                    "holding": True,
                    "shares": 10000,
                    "owned_after": 10000,
                    "acquired_disposed": "",
                }
            ],
        )
    )
    transaction = parsed.transactions[0]
    assert transaction.transaction_code == ""
    assert transaction.shares == Decimal("10000")
    assert classify(transaction) is TransactionClass.OTHER


def test_amendment_is_detected_from_document_type():
    parsed = _parse(
        form4_xml(document_type="4/A", original_submission="2024-01-12")
    )
    assert parsed.is_amendment is True
    assert parsed.original_submission_date == datetime(2024, 1, 12, tzinfo=UTC)


def test_amendment_is_detected_from_original_submission_date():
    parsed = _parse(form4_xml(original_submission="2024-01-12"))
    assert parsed.is_amendment is True


def test_footnote_ids_are_preserved():
    parsed = _parse(
        form4_xml(
            transactions=[
                {
                    "code": "P",
                    "date": "2024-01-10",
                    "shares": 10,
                    "price": "1",
                    "footnotes": ["F1", "F2"],
                }
            ]
        )
    )
    assert parsed.transactions[0].footnote_ids == ["F1", "F2"]


def test_raw_hash_is_recorded_for_integrity():
    document = form4_xml()
    parsed = _parse(document)
    assert len(parsed.raw_sha256) == 64
    assert _parse(document).raw_sha256 == parsed.raw_sha256


def test_malformed_xml_is_rejected():
    with pytest.raises(SourceDataError, match="not well-formed"):
        _parse(b"<ownershipDocument><unclosed>")


def test_non_ownership_document_is_rejected():
    with pytest.raises(SourceDataError, match="not an ownership document"):
        _parse(b"<html><body>not a filing</body></html>")


def test_empty_document_is_rejected():
    with pytest.raises(SourceDataError, match="empty document"):
        _parse(b"")


def test_entity_expansion_is_refused():
    """SEC documents are untrusted input, so a billion-laughs payload is rejected."""
    bomb = b"""<?xml version="1.0"?>
<!DOCTYPE ownershipDocument [
  <!ENTITY a "aaaaaaaaaa">
  <!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">
  <!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;">
]>
<ownershipDocument><documentType>&c;</documentType></ownershipDocument>"""
    with pytest.raises(SourceDataError, match="not well-formed"):
        _parse(bomb)


def test_external_entity_is_refused():
    """An external entity must not be able to read a local file."""
    payload = b"""<?xml version="1.0"?>
<!DOCTYPE ownershipDocument [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
<ownershipDocument><documentType>&xxe;</documentType></ownershipDocument>"""
    with pytest.raises(SourceDataError, match="not well-formed"):
        _parse(payload)


def test_document_without_reporting_owner_is_rejected():
    document = form4_xml().replace(b"<reportingOwner>", b"<notAnOwner>").replace(
        b"</reportingOwner>", b"</notAnOwner>"
    )
    with pytest.raises(SourceDataError, match="no reporting owner"):
        _parse(document)


# --------------------------------------------------------------------------
# Classification
# --------------------------------------------------------------------------


def _classify(transaction: dict) -> TransactionClass:
    parsed = _parse(form4_xml(transactions=[transaction]))
    return classify(parsed.transactions[0])


def test_open_market_purchase_is_recognised():
    classification = _classify(
        {"code": "P", "date": "2024-01-10", "shares": 100, "price": "10"}
    )
    assert classification is TransactionClass.OPEN_MARKET_PURCHASE
    assert is_open_market(classification) is True


def test_open_market_sale_is_recognised():
    classification = _classify(
        {
            "code": "S",
            "date": "2024-01-10",
            "shares": 100,
            "price": "10",
            "acquired_disposed": "D",
        }
    )
    assert classification is TransactionClass.OPEN_MARKET_SALE
    assert is_open_market(classification) is True


def test_award_is_not_an_open_market_purchase():
    classification = _classify(
        {"code": "A", "date": "2024-01-10", "shares": 100, "price": "0"}
    )
    assert classification is TransactionClass.AWARD_GRANT
    assert is_open_market(classification) is False


def test_gift_is_not_an_open_market_transaction():
    classification = _classify({"code": "G", "date": "2024-01-10", "shares": 100})
    assert classification is TransactionClass.GIFT
    assert is_open_market(classification) is False


def test_tax_withholding_is_not_an_open_market_sale():
    classification = _classify(
        {
            "code": "F",
            "date": "2024-01-10",
            "shares": 100,
            "price": "10",
            "acquired_disposed": "D",
        }
    )
    assert classification is TransactionClass.TAX_WITHHOLDING
    assert is_open_market(classification) is False


def test_derivative_exercise_is_not_an_open_market_purchase():
    classification = _classify(
        {
            "code": "M",
            "table": "derivative",
            "date": "2024-01-10",
            "shares": 100,
            "price": "10",
        }
    )
    assert classification is TransactionClass.DERIVATIVE_EXERCISE
    assert is_open_market(classification) is False


def test_shares_received_from_an_exercise_are_not_a_market_purchase():
    """A non-derivative row with code M is the settlement, not a purchase."""
    classification = _classify(
        {"code": "M", "date": "2024-01-10", "shares": 100, "price": "10"}
    )
    assert classification is TransactionClass.DERIVATIVE_EXERCISE
    assert is_open_market(classification) is False


def test_purchase_of_a_derivative_is_not_a_purchase_of_the_stock():
    classification = _classify(
        {
            "code": "P",
            "table": "derivative",
            "date": "2024-01-10",
            "shares": 100,
            "price": "10",
        }
    )
    assert classification is TransactionClass.OTHER
    assert is_open_market(classification) is False


def test_purchase_code_with_a_disposition_is_not_trusted():
    classification = _classify(
        {
            "code": "P",
            "date": "2024-01-10",
            "shares": 100,
            "price": "10",
            "acquired_disposed": "D",
        }
    )
    assert classification is TransactionClass.OTHER
    assert is_open_market(classification) is False


def test_disposition_to_issuer_is_classified():
    classification = _classify(
        {
            "code": "D",
            "date": "2024-01-10",
            "shares": 100,
            "price": "10",
            "acquired_disposed": "D",
        }
    )
    assert classification is TransactionClass.DISPOSITION_TO_ISSUER


def test_unknown_code_falls_back_to_other():
    classification = _classify({"code": "Q", "date": "2024-01-10", "shares": 1})
    assert classification is TransactionClass.OTHER


def test_description_states_that_an_award_is_not_a_purchase():
    parsed = _parse(
        form4_xml(transactions=[{"code": "A", "date": "2024-01-10", "shares": 100}])
    )
    text = describe(parsed.transactions[0], TransactionClass.AWARD_GRANT)
    assert "Not a market purchase" in text


# --------------------------------------------------------------------------
# 13F information table
# --------------------------------------------------------------------------


def test_information_table_values_are_normalised_to_dollars_after_2023():
    parsed = parse_information_table(
        information_table_xml([{"value": 1500, "shares": 10}]),
        accession_number="0001067983-24-000001",
        cik="0001067983",
        institution_name="Berkshire Hathaway",
        period_of_report=datetime(2024, 3, 31, tzinfo=UTC),
        filed_date=datetime(2024, 5, 15, tzinfo=UTC),
        accepted_at=datetime(2024, 5, 15, 20, 0, tzinfo=UTC),
        source_url="https://www.sec.gov/x",
    )
    assert parsed.holdings[0].value_usd == Decimal("1500")


def test_information_table_values_are_scaled_before_2023():
    """Before the 2023 amendments 13F values were reported in thousands."""
    parsed = parse_information_table(
        information_table_xml([{"value": 1500, "shares": 10}]),
        accession_number="0001067983-22-000001",
        cik="0001067983",
        institution_name="Berkshire Hathaway",
        period_of_report=datetime(2022, 3, 31, tzinfo=UTC),
        filed_date=datetime(2022, 5, 16, tzinfo=UTC),
        accepted_at=datetime(2022, 5, 16, 20, 0, tzinfo=UTC),
        source_url="https://www.sec.gov/x",
    )
    assert parsed.holdings[0].value_usd == Decimal("1500000")


def test_information_table_parses_holdings():
    parsed = parse_information_table(
        information_table_xml(
            [
                {"cusip": "037833100", "issuer_name": "APPLE INC", "value": 100, "shares": 5},
                {"cusip": "594918104", "issuer_name": "MICROSOFT CORP", "value": 200, "shares": 7},
            ]
        ),
        accession_number="0001067983-24-000002",
        cik="0001067983",
        institution_name="Berkshire Hathaway",
        period_of_report=datetime(2024, 6, 30, tzinfo=UTC),
        filed_date=None,
        accepted_at=datetime(2024, 8, 14, tzinfo=UTC),
        source_url="https://www.sec.gov/x",
    )
    assert [holding.cusip for holding in parsed.holdings] == ["037833100", "594918104"]
    assert parsed.holdings[1].shares == Decimal("7")
