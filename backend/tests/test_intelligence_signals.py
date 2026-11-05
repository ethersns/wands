"""Insider signal calculation, clustering and point-in-time correctness.

The point-in-time tests are the reason this module exists. A signal that becomes
visible before its source filing was public would make every backtest built on it
worthless, so the boundary is asserted from both sides.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import func, select

from wands.config import get_settings
from wands.db.models import IntelSignalRow
from wands.intelligence.base import IntelQuality, SignalCategory
from wands.intelligence.forms import parse_ownership_document
from wands.intelligence.ingest import InsiderIngestor
from wands.intelligence.signals import (
    InsiderSignalEngine,
    SignalParameters,
    saturate,
    signal_key,
)

from .intelligence_fakes import FakeEdgarClient, form4_xml

PARAMETERS = SignalParameters(
    window_days=30,
    min_insiders=3,
    value_threshold_usd=Decimal("1000"),
    baseline_days=180,
)


def _store(
    session,
    *,
    accession: str,
    accepted_at: datetime,
    transactions: list[dict],
    owner_cik: str = "0001214156",
    owner_name: str = "COOK TIMOTHY D",
    symbol: str = "AAPL",
    period: str = "2024-01-15",
    document_type: str = "4",
    original_submission: str | None = None,
) -> None:
    document = form4_xml(
        document_type=document_type,
        period=period,
        symbol=symbol,
        owners=[{"cik": owner_cik, "name": owner_name, "is_officer": True}],
        transactions=transactions,
        original_submission=original_submission,
    )
    parsed = parse_ownership_document(
        document,
        accession_number=accession,
        accepted_at=accepted_at,
        source_url=f"https://www.sec.gov/{accession}",
    )
    InsiderIngestor(session, get_settings(), client=FakeEdgarClient()).persist(parsed)


def _engine(session) -> InsiderSignalEngine:
    return InsiderSignalEngine(session, get_settings(), parameters=PARAMETERS)


def _purchase(shares: int, price: str = "100", date: str = "2024-01-10") -> dict:
    return {"code": "P", "date": date, "shares": shares, "price": price}


def _sale(shares: int, price: str = "100", date: str = "2024-01-10") -> dict:
    return {
        "code": "S",
        "date": date,
        "shares": shares,
        "price": price,
        "acquired_disposed": "D",
    }


# --------------------------------------------------------------------------
# Clustering
# --------------------------------------------------------------------------


def test_cluster_fires_at_the_configured_threshold(session):
    base = datetime(2024, 2, 1, 18, 0, tzinfo=UTC)
    for index in range(3):
        _store(
            session,
            accession=f"0000320193-24-00000{index}",
            accepted_at=base + timedelta(days=index),
            transactions=[_purchase(100)],
            owner_cik=f"000000000{index}",
            owner_name=f"INSIDER {index}",
        )

    drafts = _engine(session).compute(symbols=["AAPL"], as_of=base + timedelta(days=5))
    clusters = [
        draft
        for draft in drafts
        if draft.category is SignalCategory.INSIDER_PURCHASE_CLUSTER
    ]
    assert len(clusters) == 1
    assert clusters[0].raw_measurement == Decimal("3")
    assert clusters[0].raw_unit == "distinct_insiders"
    assert clusters[0].score is not None and clusters[0].score > 0


def test_cluster_does_not_fire_below_the_threshold(session):
    base = datetime(2024, 2, 1, 18, 0, tzinfo=UTC)
    for index in range(2):
        _store(
            session,
            accession=f"0000320193-24-00001{index}",
            accepted_at=base + timedelta(days=index),
            transactions=[_purchase(100)],
            owner_cik=f"000000001{index}",
        )

    drafts = _engine(session).compute(symbols=["AAPL"], as_of=base + timedelta(days=5))
    assert not [
        draft for draft in drafts if draft.category is SignalCategory.INSIDER_PURCHASE_CLUSTER
    ]


def test_cluster_counts_insiders_not_transaction_lines(session):
    """One insider buying three times is not a cluster of three insiders."""
    base = datetime(2024, 2, 1, 18, 0, tzinfo=UTC)
    _store(
        session,
        accession="0000320193-24-000020",
        accepted_at=base,
        transactions=[_purchase(100), _purchase(200), _purchase(300)],
        owner_cik="0000000009",
    )

    drafts = _engine(session).compute(symbols=["AAPL"], as_of=base + timedelta(days=1))
    assert not [
        draft for draft in drafts if draft.category is SignalCategory.INSIDER_PURCHASE_CLUSTER
    ]


def test_awards_do_not_contribute_to_a_purchase_cluster(session):
    base = datetime(2024, 2, 1, 18, 0, tzinfo=UTC)
    for index in range(3):
        _store(
            session,
            accession=f"0000320193-24-00003{index}",
            accepted_at=base + timedelta(days=index),
            transactions=[{"code": "A", "date": "2024-01-10", "shares": 100, "price": "0"}],
            owner_cik=f"000000002{index}",
        )

    drafts = _engine(session).compute(symbols=["AAPL"], as_of=base + timedelta(days=5))
    assert not [
        draft for draft in drafts if draft.category is SignalCategory.INSIDER_PURCHASE_CLUSTER
    ]


def test_selling_cluster_is_reported_with_caveats(session):
    base = datetime(2024, 2, 1, 18, 0, tzinfo=UTC)
    for index in range(3):
        _store(
            session,
            accession=f"0000320193-24-00004{index}",
            accepted_at=base + timedelta(days=index),
            transactions=[_sale(100)],
            owner_cik=f"000000003{index}",
        )

    drafts = _engine(session).compute(symbols=["AAPL"], as_of=base + timedelta(days=5))
    selling = [
        draft for draft in drafts if draft.category is SignalCategory.INSIDER_SELLING_CLUSTER
    ]
    assert len(selling) == 1
    assert "10b5-1" in selling[0].confidence_notes
    assert "not evidence of a negative view" in selling[0].confidence_notes


# --------------------------------------------------------------------------
# Point-in-time correctness
# --------------------------------------------------------------------------


def test_signal_is_invisible_before_its_filing_was_public(session):
    accepted = datetime(2024, 2, 10, 21, 0, tzinfo=UTC)
    for index in range(3):
        _store(
            session,
            accession=f"0000320193-24-00005{index}",
            accepted_at=accepted,
            transactions=[_purchase(100)],
            owner_cik=f"000000004{index}",
        )

    engine = _engine(session)
    before = engine.compute(symbols=["AAPL"], as_of=accepted - timedelta(seconds=1))
    after = engine.compute(symbols=["AAPL"], as_of=accepted)

    assert not [
        draft for draft in before if draft.category is SignalCategory.INSIDER_PURCHASE_CLUSTER
    ]
    assert [
        draft for draft in after if draft.category is SignalCategory.INSIDER_PURCHASE_CLUSTER
    ]


def test_public_availability_is_the_filing_time_not_the_transaction_date(session):
    """The transaction happened in January; the world learned in February."""
    accepted = datetime(2024, 2, 10, 21, 0, tzinfo=UTC)
    for index in range(3):
        _store(
            session,
            accession=f"0000320193-24-00006{index}",
            accepted_at=accepted,
            transactions=[_purchase(100, date="2024-01-05")],
            owner_cik=f"000000005{index}",
        )

    drafts = _engine(session).compute(symbols=["AAPL"], as_of=accepted)
    cluster = next(
        draft
        for draft in drafts
        if draft.category is SignalCategory.INSIDER_PURCHASE_CLUSTER
    )
    assert cluster.public_available_at == accepted
    assert cluster.event_time == datetime(2024, 1, 5, tzinfo=UTC)
    assert cluster.public_available_at > cluster.event_time


def test_amendment_supersedes_the_original_without_double_counting(session):
    original_at = datetime(2024, 2, 1, 18, 0, tzinfo=UTC)
    amended_at = datetime(2024, 2, 5, 18, 0, tzinfo=UTC)

    _store(
        session,
        accession="0000320193-24-000070",
        accepted_at=original_at,
        transactions=[_purchase(1000)],
        owner_cik="0000000060",
    )
    _store(
        session,
        accession="0000320193-24-000071",
        accepted_at=amended_at,
        transactions=[_purchase(500)],
        owner_cik="0000000060",
        document_type="4/A",
        original_submission="2024-02-01",
    )

    engine = _engine(session)

    before = engine.compute(symbols=["AAPL"], as_of=original_at + timedelta(days=1))
    value_before = next(
        draft
        for draft in before
        if draft.category is SignalCategory.INSIDER_PURCHASE_VALUE
    )
    assert value_before.raw_measurement == Decimal("100000")

    after = engine.compute(symbols=["AAPL"], as_of=amended_at + timedelta(days=1))
    value_after = next(
        draft for draft in after if draft.category is SignalCategory.INSIDER_PURCHASE_VALUE
    )
    assert value_after.raw_measurement == Decimal("50000"), (
        "the amendment replaces the original; it must not be added to it"
    )


# --------------------------------------------------------------------------
# Value and quality
# --------------------------------------------------------------------------


def test_unpriced_purchases_are_excluded_and_marked_incomplete(session):
    accepted = datetime(2024, 2, 1, 18, 0, tzinfo=UTC)
    _store(
        session,
        accession="0000320193-24-000080",
        accepted_at=accepted,
        transactions=[
            _purchase(100, price="100"),
            {"code": "P", "date": "2024-01-10", "shares": 500},
        ],
        owner_cik="0000000070",
    )

    drafts = _engine(session).compute(symbols=["AAPL"], as_of=accepted + timedelta(days=1))
    value = next(
        draft for draft in drafts if draft.category is SignalCategory.INSIDER_PURCHASE_VALUE
    )
    assert value.raw_measurement == Decimal("10000")
    assert value.data_quality is IntelQuality.INCOMPLETE
    assert value.parameters["unpricedLines"] == 1
    assert "excluded from the total" in value.confidence_notes


def test_purchase_value_below_threshold_produces_no_signal(session):
    accepted = datetime(2024, 2, 1, 18, 0, tzinfo=UTC)
    _store(
        session,
        accession="0000320193-24-000090",
        accepted_at=accepted,
        transactions=[_purchase(1, price="1")],
        owner_cik="0000000080",
    )

    drafts = _engine(session).compute(symbols=["AAPL"], as_of=accepted + timedelta(days=1))
    assert not [
        draft for draft in drafts if draft.category is SignalCategory.INSIDER_PURCHASE_VALUE
    ]


def test_activity_change_compares_against_the_baseline_window(session):
    baseline_at = datetime(2023, 9, 1, 18, 0, tzinfo=UTC)
    current_at = datetime(2024, 2, 1, 18, 0, tzinfo=UTC)

    _store(
        session,
        accession="0000320193-24-000100",
        accepted_at=baseline_at,
        transactions=[_purchase(100, price="100")],
        owner_cik="0000000090",
        period="2023-08-15",
    )
    _store(
        session,
        accession="0000320193-24-000101",
        accepted_at=current_at,
        transactions=[_purchase(400, price="100")],
        owner_cik="0000000090",
    )

    drafts = _engine(session).compute(symbols=["AAPL"], as_of=current_at + timedelta(days=1))
    change = next(
        draft for draft in drafts if draft.category is SignalCategory.INSIDER_ACTIVITY_CHANGE
    )
    assert change.raw_measurement == Decimal("4.0000")
    assert Decimal(change.parameters["currentUsd"]) == Decimal("40000")
    assert Decimal(change.parameters["baselineUsd"]) == Decimal("10000")


# --------------------------------------------------------------------------
# Persistence and scoring
# --------------------------------------------------------------------------


def test_persisting_the_same_evidence_twice_creates_one_signal(session):
    accepted = datetime(2024, 2, 1, 18, 0, tzinfo=UTC)
    for index in range(3):
        _store(
            session,
            accession=f"0000320193-24-00011{index}",
            accepted_at=accepted,
            transactions=[_purchase(100)],
            owner_cik=f"000000011{index}",
        )

    engine = _engine(session)
    first = engine.compute_and_persist(symbols=["AAPL"], as_of=accepted + timedelta(days=1))
    second = engine.compute_and_persist(symbols=["AAPL"], as_of=accepted + timedelta(days=1))

    assert first > 0
    assert second == 0, "recomputing the same evidence must not duplicate signals"

    total = session.scalar(select(func.count()).select_from(IntelSignalRow))
    assert total == first


def test_signal_key_depends_on_evidence_not_on_calculation_time():
    events = ["a", "b"]
    first = signal_key(SignalCategory.INSIDER_PURCHASE_CLUSTER, "AAPL", events)
    second = signal_key(SignalCategory.INSIDER_PURCHASE_CLUSTER, "aapl", ["b", "a"])
    assert first == second

    different = signal_key(SignalCategory.INSIDER_PURCHASE_CLUSTER, "AAPL", ["a", "c"])
    assert different != first


def test_saturate_is_bounded_and_monotonic():
    assert saturate(Decimal("0"), Decimal("10")) == Decimal("0")
    assert saturate(Decimal("-5"), Decimal("10")) == Decimal("0")
    assert saturate(Decimal("10"), Decimal("10")) < Decimal("100")
    assert saturate(Decimal("1000"), Decimal("10")) <= Decimal("100")
    assert saturate(Decimal("5"), Decimal("10")) < saturate(Decimal("10"), Decimal("10"))
    assert saturate(Decimal("10"), Decimal("0")) == Decimal("0")


def test_every_signal_carries_its_provenance_and_limitations(session):
    accepted = datetime(2024, 2, 1, 18, 0, tzinfo=UTC)
    for index in range(3):
        _store(
            session,
            accession=f"0000320193-24-00012{index}",
            accepted_at=accepted,
            transactions=[_purchase(100)],
            owner_cik=f"000000012{index}",
        )

    drafts = _engine(session).compute(symbols=["AAPL"], as_of=accepted + timedelta(days=1))
    assert drafts
    for draft in drafts:
        assert draft.source_event_ids
        assert draft.public_available_at >= draft.event_time
        assert draft.explanation
        assert draft.confidence_notes
        assert draft.raw_unit
        assert draft.parameters["asOf"]
