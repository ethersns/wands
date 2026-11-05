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
from wands.db.models import IntelInstitutionalHoldingRow
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
