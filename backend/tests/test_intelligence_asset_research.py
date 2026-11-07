"""CUSIP resolution and the asset research view that depends on it.

Two claims make the asset page trustworthy, and both are asserted here.

*A CUSIP resolves to a security only when a source asserted it.* OpenFIGI is
asked about the reported identifier, and a CUSIP that lists under more than one
ticker is stored as a conflict rather than resolved by preference.

*An institutional position is shown only once its filing was public.* A 13F is a
quarterly snapshot published up to 45 days after the quarter ends, so a lookup
dated before the filing was readable must not see the position.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal

from wands.config import get_settings
from wands.db.models import IntelInstitutionalHoldingRow, IntelInstitutionRow
from wands.intelligence.identifiers import (
    IdentifierMapping,
    IdentifierResolver,
    MappingStatus,
    OpenFigiSource,
    cusip_check_digit,
    full_cusip,
)
from wands.intelligence.member import MemberResearchService
from wands.marketdata.history import NasdaqHistoricalProvider, trading_days

APPLE_CUSIP = "037833100"
APPLE_BASE = "03783310"
OBSERVED = datetime(2024, 3, 1, tzinfo=UTC)
Q3_2023 = datetime(2023, 9, 30, tzinfo=UTC)
Q4_2023 = datetime(2023, 12, 31, tzinfo=UTC)
Q3_PUBLIC = datetime(2023, 11, 14, tzinfo=UTC)
Q4_PUBLIC = datetime(2024, 2, 14, tzinfo=UTC)


class _Response:
    def __init__(self, payload) -> None:
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self):
        return self._payload


class _Client:
    """Records each request body so a test can assert what was actually sent."""

    def __init__(self, payload) -> None:
        self.payload = payload
        self.requests: list[list[dict]] = []

    def post(self, url, json=None, headers=None):
        self.requests.append(json)
        return _Response(self.payload)


def _equity(ticker: str, *, exch: str = "US", **extra) -> dict:
    return {"ticker": ticker, "exchCode": exch, "marketSector": "Equity", **extra}


# --------------------------------------------------------------------------
# CUSIP identity
# --------------------------------------------------------------------------


def test_the_check_digit_is_recomputed_from_the_base():
    # A stored base has lost its check digit; the digit is a function of the
    # base, so restoring it reproduces the reported identifier.
    assert cusip_check_digit(APPLE_BASE) == "0"
    assert full_cusip(APPLE_BASE) == APPLE_CUSIP
    assert full_cusip(APPLE_CUSIP) == APPLE_CUSIP


def test_a_corrupted_check_digit_is_rejected_rather_than_repaired():
    # 46647P107 is not a valid CUSIP: the base 46647P10 checks to 6. Accepting
    # the 7 would send a different security's identifier to the resolver.
    assert full_cusip("46647P107") == ""
    assert full_cusip("46647P106") == "46647P106"


def test_a_malformed_identifier_is_never_sent_to_the_resolver():
    assert full_cusip("ABC") == ""
    assert full_cusip("") == ""
    assert full_cusip("0378331!") == ""


# --------------------------------------------------------------------------
# OpenFIGI resolution
# --------------------------------------------------------------------------


def test_openfigi_resolves_a_single_us_listing_to_a_verified_mapping():
    client = _Client(
        [
            {
                "data": [
                    _equity(
                        "AAPL",
                        name="APPLE INC",
                        securityType2="Common Stock",
                        shareClassFIGI="BBG001S5N8V8",
                    ),
                    _equity("AAPL", exch="UA"),
                ]
            }
        ]
    )

    mappings = OpenFigiSource(
        [APPLE_CUSIP], client=client, observed_at=OBSERVED
    ).fetch()

    assert len(mappings) == 1
    mapping = mappings[0]
    assert mapping.symbol == "AAPL"
    assert mapping.cusip == APPLE_BASE
    assert mapping.verification_status is MappingStatus.VERIFIED
    assert mapping.share_class == "BBG001S5N8V8"
    assert mapping.security_description == "Common Stock"
    # The mapping describes the moment it was observed, not the filing's period.
    assert "observed_at" in mapping.notes


def test_the_request_carries_the_full_nine_character_cusip():
    client = _Client([{"data": []}])

    OpenFigiSource([APPLE_BASE], client=client, observed_at=OBSERVED).fetch()

    assert client.requests == [[{"idType": "ID_CUSIP", "idValue": APPLE_CUSIP}]]


def test_a_foreign_listing_does_not_turn_one_security_into_a_conflict():
    # The same CUSIP lists on many venues under different local tickers. Only
    # the US composite decides the ticker a US filing refers to.
    client = _Client(
        [{"data": [_equity("AAPL"), _equity("AAPL34", exch="BZ")]}]
    )

    mappings = OpenFigiSource(
        [APPLE_CUSIP], client=client, observed_at=OBSERVED
    ).fetch()

    assert [mapping.symbol for mapping in mappings] == ["AAPL"]
    assert mappings[0].verification_status is MappingStatus.VERIFIED


def test_two_us_tickers_for_one_cusip_are_stored_as_a_conflict():
    client = _Client([{"data": [_equity("AAA"), _equity("BBB")]}])

    mappings = OpenFigiSource(
        [APPLE_CUSIP], client=client, observed_at=OBSERVED
    ).fetch()

    # A claim is keyed on (cusip, effective_from, source), so the ambiguity is
    # carried in the status and the note rather than split across rows.
    assert len(mappings) == 1
    assert mappings[0].verification_status is MappingStatus.CONFLICT
    assert "AAA" in mappings[0].notes and "BBB" in mappings[0].notes


def test_a_non_equity_cusip_is_left_unresolved():
    client = _Client(
        [{"data": [{"ticker": "", "marketSector": "Corp", "securityType": "Bond"}]}]
    )

    assert (
        OpenFigiSource([APPLE_CUSIP], client=client, observed_at=OBSERVED).fetch() == []
    )


def test_an_unknown_cusip_is_left_unresolved():
    client = _Client([{"error": "No identifier found."}])

    assert (
        OpenFigiSource([APPLE_CUSIP], client=client, observed_at=OBSERVED).fetch() == []
    )


def test_a_conflict_from_openfigi_never_becomes_fusion_eligible(session):
    client = _Client([{"data": [_equity("AAA"), _equity("BBB")]}])
    resolver = IdentifierResolver(session)
    resolver.ingest(
        OpenFigiSource([APPLE_CUSIP], client=client, observed_at=OBSERVED).fetch(),
        source="openfigi",
    )

    result = resolver.resolve(APPLE_CUSIP, OBSERVED)

    assert result.status is MappingStatus.CONFLICT
    assert result.usable_for_fusion is False
    # The claim survives so the ambiguity stays visible rather than vanishing.
    assert len(resolver.history(APPLE_CUSIP)) == 1
    assert "AAA" in resolver.history(APPLE_CUSIP)[0].notes


def test_a_verified_mapping_survives_a_restart(session):
    client = _Client([{"data": [_equity("AAPL")]}])
    source = OpenFigiSource([APPLE_CUSIP], client=client, observed_at=OBSERVED)
    resolver = IdentifierResolver(session)

    first = resolver.ingest(source.fetch(), source="openfigi")
    second = resolver.ingest(source.fetch(), source="openfigi")

    assert first.inserted == 1
    assert second.inserted == 0
    assert second.updated == 1
    assert len(resolver.history(APPLE_CUSIP)) == 1
    assert resolver.resolve(APPLE_CUSIP, OBSERVED).symbol == "AAPL"


# --------------------------------------------------------------------------
# Asset research
# --------------------------------------------------------------------------


def _seed_institution(session, *, cik: str = "0001067983") -> IntelInstitutionRow:
    institution = IntelInstitutionRow(cik=cik, name="BERKSHIRE HATHAWAY INC")
    session.add(institution)
    session.flush()
    return institution


def _seed_holding(
    session,
    institution: IntelInstitutionRow,
    *,
    period: datetime,
    accepted_at: datetime,
    shares: str,
    value: str,
    accession: str,
    ordinal: int = 0,
    cusip: str = APPLE_CUSIP,
) -> None:
    session.add(
        IntelInstitutionalHoldingRow(
            institution_id=institution.id,
            accession_number=accession,
            ordinal=ordinal,
            period_of_report=period,
            filed_date=accepted_at,
            accepted_at=accepted_at,
            cusip=cusip,
            issuer_name="APPLE INC",
            class_title="COM",
            value_usd=Decimal(value),
            shares=Decimal(shares),
            source_url=f"https://www.sec.gov/Archives/edgar/data/{accession}",
        )
    )
    session.flush()


def _seed_mapping(
    session,
    *,
    symbol: str = "AAPL",
    cusip: str = APPLE_CUSIP,
    effective_from: datetime = datetime(2020, 1, 1, tzinfo=UTC),
) -> None:
    IdentifierResolver(session).ingest(
        [
            IdentifierMapping(
                cusip=cusip,
                symbol=symbol,
                effective_from=effective_from,
                issuer_name="Apple Inc.",
                source="openfigi",
                verification_status=MappingStatus.VERIFIED,
                confidence=Decimal("95"),
                is_primary=True,
            )
        ],
        source="openfigi",
    )
    session.flush()


def test_a_holding_is_not_shown_before_its_filing_was_public(session):
    institution = _seed_institution(session)
    _seed_holding(
        session,
        institution,
        period=Q4_2023,
        accepted_at=Q4_PUBLIC,
        shares="1000",
        value="100000",
        accession="0001067983-24-000001",
    )
    _seed_mapping(session)

    service = MemberResearchService(session, get_settings())

    before = service.asset("AAPL", as_of=datetime(2024, 2, 1, tzinfo=UTC))
    after = service.asset("AAPL", as_of=datetime(2024, 3, 1, tzinfo=UTC))

    # The quarter had ended, but the filing was not readable yet.
    assert before.institutional.holdings == []
    assert len(after.institutional.holdings) == 1
    assert after.institutional.holdings[0].public_available_at == Q4_PUBLIC
    assert after.institutional.holdings[0].period_of_report == Q4_2023


def test_an_unresolved_cusip_reports_no_holdings_and_says_why(session):
    institution = _seed_institution(session)
    _seed_holding(
        session,
        institution,
        period=Q4_2023,
        accepted_at=Q4_PUBLIC,
        shares="1000",
        value="100000",
        accession="0001067983-24-000001",
    )

    asset = MemberResearchService(session, get_settings()).asset(
        "AAPL", as_of=datetime(2024, 3, 1, tzinfo=UTC)
    )

    assert asset.institutional.holdings == []
    assert asset.identifier_mappings == []
    assert any(
        "No verified CUSIP mapping" in caveat
        for caveat in asset.institutional.caveats
    )
    assert any(gap.key == "no_identifier_mapping" for gap in asset.coverage.gaps)


def test_a_holdings_change_is_measured_against_the_prior_quarter(session):
    institution = _seed_institution(session)
    _seed_holding(
        session,
        institution,
        period=Q3_2023,
        accepted_at=Q3_PUBLIC,
        shares="1000",
        value="90000",
        accession="0001067983-23-000002",
    )
    _seed_holding(
        session,
        institution,
        period=Q4_2023,
        accepted_at=Q4_PUBLIC,
        shares="1500",
        value="120000",
        accession="0001067983-24-000001",
    )
    _seed_mapping(session)

    asset = MemberResearchService(session, get_settings()).asset(
        "AAPL", as_of=datetime(2024, 3, 1, tzinfo=UTC)
    )

    holding = asset.institutional.holdings[0]
    assert holding.shares == Decimal("1500")
    assert holding.share_change == Decimal("500")
    assert holding.share_change_pct == Decimal("50.00")
    assert holding.prior_period_of_report == Q3_2023
    assert holding.source_url.endswith("0001067983-24-000001")


def test_the_asset_exposes_the_verified_mapping_it_rests_on(session):
    _seed_mapping(session)

    asset = MemberResearchService(session, get_settings()).asset(
        "AAPL", as_of=datetime(2024, 3, 1, tzinfo=UTC)
    )

    assert len(asset.identifier_mappings) == 1
    mapping = asset.identifier_mappings[0]
    assert mapping.cusip == APPLE_BASE
    assert mapping.source == "openfigi"
    assert mapping.verification_status == "verified"


def test_a_holding_in_another_security_is_not_attributed_to_this_asset(session):
    institution = _seed_institution(session)
    _seed_holding(
        session,
        institution,
        period=Q4_2023,
        accepted_at=Q4_PUBLIC,
        shares="1000",
        value="100000",
        accession="0001067983-24-000001",
        cusip="594918104",  # Microsoft, not Apple
    )
    _seed_mapping(session)

    asset = MemberResearchService(session, get_settings()).asset(
        "AAPL", as_of=datetime(2024, 3, 1, tzinfo=UTC)
    )

    assert asset.institutional.holdings == []


# --------------------------------------------------------------------------
# Price series labelling and calendar
# --------------------------------------------------------------------------


def test_a_nasdaq_bar_carries_its_adjustment_label():
    # The endpoint returns post-split values, so the bar must not claim raw.
    bar = NasdaqHistoricalProvider()._bar(
        "AAPL",
        {
            "date": "01/03/2023",
            "open": "130.28",
            "high": "130.90",
            "low": "124.17",
            "close": "125.07",
            "volume": "112117500",
        },
    )

    assert bar is not None
    assert bar.adjustment == "split"


def test_known_market_holidays_are_not_counted_as_expected_sessions():
    days = trading_days(date(2023, 1, 1), date(2024, 12, 31))

    for holiday in (
        date(2023, 1, 2),  # New Year observed
        date(2023, 4, 7),  # Good Friday
        date(2023, 11, 23),  # Thanksgiving
        date(2024, 3, 29),  # Good Friday
        date(2024, 12, 25),  # Christmas
    ):
        assert holiday not in days

    # A normal session is still expected.
    assert date(2023, 1, 3) in days
