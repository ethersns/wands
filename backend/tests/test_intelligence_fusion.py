"""Signal fusion and the research/execution boundary.

The boundary test is the important one here. Research signals must not be able to
reach the order path, and the cheapest way to guarantee that is to assert the
import graph rather than to trust a convention.
"""

from __future__ import annotations

import ast
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pytest

from wands.config import get_settings
from wands.db.models import MarketCandleRow
from wands.intelligence.base import SignalCategory
from wands.intelligence.forms import parse_ownership_document
from wands.intelligence.fusion import WEIGHTS, SignalFusion
from wands.intelligence.ingest import InsiderIngestor
from wands.intelligence.signals import InsiderSignalEngine, SignalParameters

from .intelligence_fakes import FakeEdgarClient, form4_xml

ACCEPTED = datetime(2024, 2, 1, 18, 0, tzinfo=UTC)
INTELLIGENCE_ROOT = Path(__file__).resolve().parents[1] / "wands" / "intelligence"

FORBIDDEN_IMPORTS = ("wands.execution", "wands.brokers", "wands.risk")


def _candles(session, symbol: str = "AAPL", *, bars: int = 25, trend: str = "up") -> None:
    start = datetime(2024, 1, 1, tzinfo=UTC)
    price = Decimal("100")
    for index in range(bars):
        step = Decimal("1") if trend == "up" else Decimal("-1")
        price = price + step
        session.add(
            MarketCandleRow(
                provider="fixture",
                symbol=symbol,
                market_type="stocks",
                interval="1d",
                open_time=start + timedelta(days=index),
                open=price,
                high=price + 1,
                low=price - 1,
                close=price,
                volume=Decimal("1000") if index < bars - 1 else Decimal("5000"),
                quality="historical",
                provider_timestamp=start + timedelta(days=index),
            )
        )
    session.commit()


def _insider_signals(session, count: int = 3) -> None:
    for index in range(count):
        parsed = parse_ownership_document(
            form4_xml(
                owners=[{"cik": f"000000030{index}", "name": f"INSIDER {index}"}],
                transactions=[
                    {"code": "P", "date": "2024-01-10", "shares": 100, "price": "100"}
                ],
            ),
            accession_number=f"0000320193-24-00030{index}",
            accepted_at=ACCEPTED + timedelta(days=index),
            source_url="https://www.sec.gov/x",
        )
        InsiderIngestor(session, get_settings(), client=FakeEdgarClient()).persist(parsed)

    InsiderSignalEngine(
        session,
        get_settings(),
        parameters=SignalParameters(
            window_days=30,
            min_insiders=3,
            value_threshold_usd=1000,
            baseline_days=180,
        ),
    ).compute_and_persist(symbols=["AAPL"], as_of=ACCEPTED + timedelta(days=10))
    session.commit()


# --------------------------------------------------------------------------
# Boundary
# --------------------------------------------------------------------------


def test_intelligence_cannot_import_the_execution_path():
    """A research module that could place an order is a design failure."""
    offenders: list[str] = []
    for path in INTELLIGENCE_ROOT.glob("*.py"):
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module:
                if node.module.startswith(FORBIDDEN_IMPORTS):
                    offenders.append(f"{path.name}: from {node.module}")
            elif isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name.startswith(FORBIDDEN_IMPORTS):
                        offenders.append(f"{path.name}: import {alias.name}")
    assert offenders == [], f"intelligence imports the execution path: {offenders}"


def test_intelligence_does_not_read_broker_credentials():
    """Research code must not touch a secret that could also authorise a trade."""
    credential_settings = (
        "alpaca_data_key",
        "alpaca_data_secret",
        "engine_token",
        "encryption_key",
        "api_key_pepper",
    )
    offenders: list[str] = []
    for path in INTELLIGENCE_ROOT.glob("*.py"):
        text = path.read_text()
        for marker in credential_settings:
            if marker in text:
                offenders.append(f"{path.name}: {marker}")
    assert offenders == [], f"intelligence references credentials: {offenders}"


# --------------------------------------------------------------------------
# Fusion
# --------------------------------------------------------------------------


def _fusion(session) -> SignalFusion:
    return SignalFusion(session, get_settings())


def test_fusion_reports_an_empty_state_rather_than_a_zero_score(session):
    ranking = _fusion(session).rank(["AAPL"], as_of=ACCEPTED)[0]

    assert ranking.composite_score is None
    assert ranking.coverage == Decimal("0")
    assert ranking.data_quality == "unavailable"
    assert ranking.components == []
    assert "Nothing is inferred from the absence" in ranking.explanation


def test_fusion_combines_insider_signals_into_a_composite(session):
    _insider_signals(session)
    ranking = _fusion(session).rank(["AAPL"], as_of=ACCEPTED + timedelta(days=10))[0]

    assert ranking.composite_score is not None
    assert ranking.composite_score > 0
    assert ranking.coverage > 0
    categories = {component.category for component in ranking.components}
    assert SignalCategory.INSIDER_PURCHASE_CLUSTER.value in categories
    assert SignalCategory.INSIDER_PURCHASE_VALUE.value in categories


def test_each_component_keeps_its_own_source_and_timing(session):
    _insider_signals(session)
    _candles(session)
    ranking = _fusion(session).rank(["AAPL"], as_of=ACCEPTED + timedelta(days=10))[0]

    for component in ranking.components:
        assert component.source
        assert component.public_available_at is not None
        assert component.explanation
        assert component.unit

    sources = {component.source for component in ranking.components}
    assert "sec_edgar" in sources
    assert any(source.startswith("market_candles:") for source in sources)


def test_market_trend_is_derived_from_stored_candles(session):
    _candles(session, trend="up")
    ranking = _fusion(session).rank(["AAPL"], as_of=ACCEPTED)[0]

    trend = next(
        component
        for component in ranking.components
        if component.category == SignalCategory.MARKET_TREND.value
    )
    assert trend.measurement > 0
    assert trend.unit == "pct_change"
    assert "not a forecast" in trend.explanation


def test_volume_anomaly_is_derived_from_stored_candles(session):
    _candles(session)
    ranking = _fusion(session).rank(["AAPL"], as_of=ACCEPTED)[0]

    volume = next(
        component
        for component in ranking.components
        if component.category == SignalCategory.VOLUME_ANOMALY.value
    )
    assert volume.measurement == Decimal("5.0000")
    assert "not directional" in volume.explanation


def test_market_components_are_absent_without_enough_history(session):
    _candles(session, bars=5)
    ranking = _fusion(session).rank(["AAPL"], as_of=ACCEPTED)[0]
    assert ranking.components == []


def test_institutional_component_is_omitted_without_a_cusip_mapping(session):
    ranking = _fusion(session).rank(["AAPL"], as_of=ACCEPTED)[0]
    assert not [
        component
        for component in ranking.components
        if component.category == SignalCategory.INSTITUTIONAL_POSITION_CHANGE.value
    ]
    assert any("CUSIP" in caveat for caveat in ranking.caveats)


def test_rankings_are_ordered_by_composite_score(session):
    _insider_signals(session)
    _candles(session, symbol="AAPL")

    rankings = _fusion(session).rank(
        ["MSFT", "AAPL"], as_of=ACCEPTED + timedelta(days=10)
    )
    assert rankings[0].symbol == "AAPL"
    assert rankings[0].composite_score is not None
    assert rankings[1].symbol == "MSFT"
    assert rankings[1].composite_score is None, "a symbol with no evidence sorts last"


def test_every_ranking_carries_the_research_caveat(session):
    _insider_signals(session)
    ranking = _fusion(session).rank(["AAPL"], as_of=ACCEPTED + timedelta(days=10))[0]
    assert any("not a probability of profit" in caveat for caveat in ranking.caveats)
    assert any("cannot trigger execution" in caveat for caveat in ranking.caveats)


def test_weights_cover_every_implemented_category():
    assert set(WEIGHTS) == {
        SignalCategory.INSIDER_PURCHASE_CLUSTER.value,
        SignalCategory.INSIDER_PURCHASE_VALUE.value,
        SignalCategory.INSIDER_ACTIVITY_CHANGE.value,
        SignalCategory.INSIDER_SELLING_CLUSTER.value,
        SignalCategory.INSTITUTIONAL_POSITION_CHANGE.value,
        SignalCategory.MARKET_TREND.value,
        SignalCategory.VOLUME_ANOMALY.value,
    }
    assert sum(WEIGHTS.values()) == pytest.approx(Decimal("1.000"))
