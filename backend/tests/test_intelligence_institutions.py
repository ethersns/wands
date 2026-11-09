"""Institutional radar: 13F ingestion, reporting delay and quarter changes.

The reporting-delay tests matter because a 13F describes a quarter that ended up
to 45 days before anyone could read it. Treating the quarter end as the moment of
availability would hand a backtest six weeks of foresight.
"""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import func, select

from wands.config import get_settings
from wands.db.models import IntelInstitutionalHoldingRow, IntelInstitutionRow
from wands.intelligence.base import SignalCategory
from wands.intelligence.ingest import InstitutionalIngestor
from wands.intelligence.institutions import (
    CHANGE_DECREASED,
    CHANGE_EXITED,
    CHANGE_INCREASED,
    CHANGE_NEW,
    InstitutionalRadar,
)

from .intelligence_fakes import FakeEdgarClient, filing_ref, information_table_xml

CIK = "0001067983"
Q1_END = datetime(2024, 3, 31, tzinfo=UTC)
Q2_END = datetime(2024, 6, 30, tzinfo=UTC)
Q1_FILED = datetime(2024, 5, 15, 20, 0, tzinfo=UTC)
Q2_FILED = datetime(2024, 8, 14, 20, 0, tzinfo=UTC)


def _ingest(session, *, accession: str, period: datetime, accepted: datetime, holdings: list[dict]):
    client = FakeEdgarClient(
        information_tables={accession: information_table_xml(holdings)},
        institutional={
            CIK: [
                filing_ref(
                    accession,
                    accepted_at=accepted,
                    issuer_cik=CIK,
                    issuer_name="Berkshire Hathaway Inc",
                    form_type="13F-HR",
                    period=period,
                )
            ]
        },
    )
    return InstitutionalIngestor(session, get_settings(), client=client).run(ciks=[CIK])


def _radar(session) -> InstitutionalRadar:
    return InstitutionalRadar(session, get_settings())


# --------------------------------------------------------------------------
# Ingestion
# --------------------------------------------------------------------------


def test_13f_holdings_are_stored_with_their_quarter(session):
    result = _ingest(
        session,
        accession="0001067983-24-000001",
        period=Q1_END,
        accepted=Q1_FILED,
        holdings=[{"cusip": "037833100", "issuer_name": "APPLE INC", "value": 100, "shares": 10}],
    )

    assert result.status == "ok"
    assert result.filings_new == 1
    assert result.transactions_new == 1

    row = session.scalar(select(IntelInstitutionalHoldingRow))
    assert row is not None
    assert row.period_of_report == Q1_END
    assert row.accepted_at == Q1_FILED
    assert row.accepted_at > row.period_of_report, "the filing is public after the quarter ends"


def test_13f_ingestion_is_idempotent(session):
    for _ in range(2):
        _ingest(
            session,
            accession="0001067983-24-000001",
            period=Q1_END,
            accepted=Q1_FILED,
            holdings=[{"cusip": "037833100", "value": 100, "shares": 10}],
        )

    assert session.scalar(select(func.count()).select_from(IntelInstitutionalHoldingRow)) == 1


def test_13f_without_a_period_is_rejected(session):
    ref = filing_ref(
        "0001067983-24-000009",
        accepted_at=Q1_FILED,
        issuer_cik=CIK,
        form_type="13F-HR",
    )
    client = FakeEdgarClient(
        information_tables={"0001067983-24-000009": information_table_xml([{"value": 1}])},
        institutional={CIK: [replace(ref, period_of_report=None)]},
    )
    result = InstitutionalIngestor(session, get_settings(), client=client).run(ciks=[CIK])

    assert result.status == "failed"
    assert "period of report" in result.errors[0]["message"]


# --------------------------------------------------------------------------
# Reporting delay
# --------------------------------------------------------------------------


def test_holdings_are_invisible_before_the_filing_was_public(session):
    _ingest(
        session,
        accession="0001067983-24-000001",
        period=Q1_END,
        accepted=Q1_FILED,
        holdings=[{"cusip": "037833100", "value": 100, "shares": 10}],
    )

    radar = _radar(session)
    assert radar.periods(CIK, as_of=Q1_FILED - timedelta(seconds=1)) == []
    assert radar.periods(CIK, as_of=Q1_FILED) == [Q1_END]


def test_quarter_end_is_not_treated_as_the_availability_time(session):
    _ingest(
        session,
        accession="0001067983-24-000001",
        period=Q1_END,
        accepted=Q1_FILED,
        holdings=[{"cusip": "037833100", "value": 100, "shares": 10}],
    )

    radar = _radar(session)
    # The quarter ended on 31 March, but nothing was knowable until 15 May.
    assert radar.periods(CIK, as_of=datetime(2024, 4, 15, tzinfo=UTC)) == []


# --------------------------------------------------------------------------
# Quarter-over-quarter change
# --------------------------------------------------------------------------


def _two_quarters(session):
    _ingest(
        session,
        accession="0001067983-24-000001",
        period=Q1_END,
        accepted=Q1_FILED,
        holdings=[
            {"cusip": "AAA", "issuer_name": "ALPHA", "value": 100, "shares": 100},
            {"cusip": "BBB", "issuer_name": "BETA", "value": 200, "shares": 200},
            {"cusip": "CCC", "issuer_name": "GAMMA", "value": 300, "shares": 300},
        ],
    )
    _ingest(
        session,
        accession="0001067983-24-000002",
        period=Q2_END,
        accepted=Q2_FILED,
        holdings=[
            {"cusip": "AAA", "issuer_name": "ALPHA", "value": 150, "shares": 150},
            {"cusip": "BBB", "issuer_name": "BETA", "value": 100, "shares": 100},
            {"cusip": "DDD", "issuer_name": "DELTA", "value": 400, "shares": 400},
        ],
    )


def test_changes_classify_new_exited_increased_and_decreased(session):
    _two_quarters(session)
    changes = {item.cusip: item for item in _radar(session).changes(CIK)}

    assert changes["AAA"].change_type == CHANGE_INCREASED
    assert changes["AAA"].share_change == Decimal("50")
    assert changes["BBB"].change_type == CHANGE_DECREASED
    assert changes["CCC"].change_type == CHANGE_EXITED
    assert changes["CCC"].current_shares is None
    assert changes["DDD"].change_type == CHANGE_NEW
    assert changes["DDD"].prior_shares is None


def test_an_exit_becomes_public_with_the_filing_that_omitted_it(session):
    """A position that disappears is knowable from the later filing, not the earlier one.

    The prior filing reported the position as still held, so dating the exit to
    that filing would place the change before anyone could have observed it.
    """
    _two_quarters(session)
    changes = {item.cusip: item for item in _radar(session).changes(CIK)}

    exited = changes["CCC"]
    assert exited.change_type == CHANGE_EXITED
    assert exited.public_available_at == Q2_FILED
    assert exited.public_available_at > Q1_FILED

    # The document that supports the absence is the current quarter's filing.
    assert exited.source_url == changes["AAA"].source_url
    assert exited.source_url != ""


def test_changes_are_invisible_before_the_second_quarter_was_filed(session):
    _two_quarters(session)
    radar = _radar(session)

    before = radar.changes(CIK, as_of=Q2_FILED - timedelta(seconds=1))
    assert before == [], "only one quarter is known, so there is nothing to compare"

    after = radar.changes(CIK, as_of=Q2_FILED)
    assert len(after) == 4


def test_amended_13f_replaces_the_original_from_its_own_acceptance_time(session):
    _ingest(
        session,
        accession="0001067983-24-000001",
        period=Q1_END,
        accepted=Q1_FILED,
        holdings=[{"cusip": "AAA", "value": 100, "shares": 100}],
    )
    amended_at = Q1_FILED + timedelta(days=10)
    _ingest(
        session,
        accession="0001067983-24-000003",
        period=Q1_END,
        accepted=amended_at,
        holdings=[{"cusip": "AAA", "value": 100, "shares": 50}],
    )

    radar = _radar(session)
    summary_before = radar.summary(CIK, as_of=Q1_FILED + timedelta(days=1))
    summary_after = radar.summary(CIK, as_of=amended_at)

    assert summary_before is not None and summary_before.position_count == 1
    assert summary_after is not None and summary_after.position_count == 1, (
        "the amendment replaces the original rather than adding to it"
    )


def test_duplicate_cusip_lines_are_aggregated(session):
    _ingest(
        session,
        accession="0001067983-24-000001",
        period=Q1_END,
        accepted=Q1_FILED,
        holdings=[
            {"cusip": "AAA", "value": 100, "shares": 100},
            {"cusip": "AAA", "value": 50, "shares": 50},
        ],
    )

    summary = _radar(session).summary(CIK)
    assert summary is not None
    assert summary.position_count == 1
    assert summary.reported_value_usd == Decimal("150")


# --------------------------------------------------------------------------
# Read cost
# --------------------------------------------------------------------------


def _seed_filers(session, count: int, *, offset: int = 0) -> list[str]:
    """Create ``count`` filers, each with two quarters of holdings."""
    ciks: list[str] = []
    for index in range(offset, offset + count):
        cik = f"000000{index:04d}"
        institution = IntelInstitutionRow(cik=cik, name=f"Filer {index:02d}")
        session.add(institution)
        session.flush()
        for period, accepted, shares in ((Q1_END, Q1_FILED, 100), (Q2_END, Q2_FILED, 150)):
            session.add(
                IntelInstitutionalHoldingRow(
                    institution_id=institution.id,
                    accession_number=f"{cik}-24-{period.month:02d}",
                    ordinal=0,
                    period_of_report=period,
                    accepted_at=accepted,
                    cusip="AAA",
                    issuer_name="ALPHA",
                    value_usd=Decimal(shares),
                    shares=Decimal(shares),
                    source_url="https://www.sec.gov/Archives/edgar/data/1/x.xml",
                )
            )
        ciks.append(cik)
    session.flush()
    return ciks


def _count_queries(session, action) -> int:
    from sqlalchemy import event

    statements: list[str] = []

    def _record(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    engine = session.get_bind()
    event.listen(engine, "before_cursor_execute", _record)
    try:
        action()
    finally:
        event.remove(engine, "before_cursor_execute", _record)
    return len(statements)


def test_institution_feed_query_count_does_not_grow_with_filers(session):
    """The feed used to issue five round-trips per filer.

    On a remote database each round-trip is the dominant cost, so the endpoint's
    latency scaled with the number of filers rather than with the amount of data.
    The batched path must stay flat as filers are added.
    """
    from wands.intelligence.service import IntelligenceService

    _seed_filers(session, 2)
    service = IntelligenceService(session, get_settings())
    small = _count_queries(session, lambda: service.institutions())

    _seed_filers(session, 6, offset=2)
    large = _count_queries(session, lambda: service.institutions())

    assert small == large, (
        f"query count grew from {small} to {large} when the filer count grew; "
        "the feed is still issuing per-filer queries"
    )
    assert large <= 5, f"expected a bounded query count, got {large}"


def test_batched_summaries_match_the_single_filer_path(session):
    """The batched read must report the same figures as the per-filer read."""
    ciks = _seed_filers(session, 3)
    radar = _radar(session)

    batched = radar.summaries(ciks)

    assert set(batched) == set(ciks)
    for cik in ciks:
        single = radar.summary(cik)
        assert single is not None
        assert batched[cik] == single


def test_batched_summaries_respect_the_point_in_time_rule(session):
    """A quarter is invisible until the filing that reported it was accepted."""
    ciks = _seed_filers(session, 1)
    radar = _radar(session)

    before = radar.summaries(ciks, as_of=Q2_FILED - timedelta(seconds=1))[ciks[0]]
    after = radar.summaries(ciks, as_of=Q2_FILED)[ciks[0]]

    assert before.latest_period == Q1_END
    assert after.latest_period == Q2_END
    assert after.position_count == 1


# --------------------------------------------------------------------------
# Signals
# --------------------------------------------------------------------------


def test_institutional_signal_carries_the_disclosure_caveat(session):
    _two_quarters(session)
    drafts = _radar(session).signal_drafts(CIK)

    assert len(drafts) == 1
    draft = drafts[0]
    assert draft.category is SignalCategory.INSTITUTIONAL_POSITION_CHANGE
    assert "45 days" in draft.confidence_notes
    assert "not a current position" in draft.confidence_notes
    assert draft.parameters["newPositions"] == 1
    assert draft.parameters["exitedPositions"] == 1
    assert draft.public_available_at == Q2_FILED


def test_institutional_signals_are_not_duplicated(session):
    _two_quarters(session)
    radar = _radar(session)

    first = radar.persist_signals([CIK])
    second = radar.persist_signals([CIK])

    assert first == 1
    assert second == 0


def test_no_holdings_produces_no_signal(session):
    assert _radar(session).signal_drafts(CIK) == []


class _RawResponse:
    def __init__(self, content: bytes, status_code: int = 200) -> None:
        self.status_code = status_code
        self.content = content


class _FilingHttp:
    """Serves a filing index plus the documents it lists, matched by suffix."""

    def __init__(self, documents: dict[str, bytes]) -> None:
        self.documents = documents
        self.requested: list[str] = []

    def get(self, url: str, **kwargs):
        self.requested.append(url)
        for suffix, body in self.documents.items():
            if url.endswith(suffix):
                return _RawResponse(body)
        return _RawResponse(b"", status_code=404)


def _filing_index(*names: str) -> bytes:
    import json

    return json.dumps(
        {"directory": {"item": [{"name": name, "type": "text.gif"} for name in names]}}
    ).encode()


def test_the_information_table_is_found_by_root_element_not_filename():
    """Real 13F filings name the table freely, so the name cannot identify it.

    Berkshire's table is ``46994.xml`` and the index reports every item as
    ``text.gif``. Matching on the filename found nothing on real filings, which
    surfaced as "no information table XML" for every one of them.
    """
    from wands.intelligence.edgar import EdgarClient

    cover = (
        b'<?xml version="1.0"?><edgarSubmission '
        b'xmlns="http://www.sec.gov/edgar/thirteenffiler"><headerData/></edgarSubmission>'
    )
    http = _FilingHttp(
        {
            "index.json": _filing_index(
                "0001067983-25-000001-index.html", "primary_doc.xml", "46994.xml"
            ),
            "primary_doc.xml": cover,
            "46994.xml": information_table_xml([{"value": 1000}]),
        }
    )
    client = EdgarClient(user_agent="wands-test/1.0 (test)", client=http)

    filename, body = client.information_table(CIK, "0001067983-25-000001")

    assert filename == "46994.xml"
    assert b"<informationTable" in body


def test_a_filing_without_an_information_table_is_reported_not_guessed():
    import pytest

    from wands.intelligence.base import SourceDataError
    from wands.intelligence.edgar import EdgarClient

    http = _FilingHttp({"index.json": _filing_index("primary_doc.xml")})
    client = EdgarClient(user_agent="wands-test/1.0 (test)", client=http)

    with pytest.raises(SourceDataError):
        client.information_table(CIK, "0001067983-25-000002")
