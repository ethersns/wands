"""Intelligence HTTP surface: authentication, pagination and empty states.

The empty-state tests are as important as the populated ones. A research feed
that returns a zero-filled payload when nothing has been collected is
indistinguishable from a feed that found nothing, and the frontend cannot tell
the difference either.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from wands.config import get_settings
from wands.intelligence.forms import parse_ownership_document
from wands.intelligence.ingest import InsiderIngestor
from wands.intelligence.signals import InsiderSignalEngine, SignalParameters

from .conftest import AUTH, make_api_key
from .intelligence_fakes import FakeEdgarClient, form4_xml

ACCEPTED = datetime(2024, 2, 1, 18, 0, tzinfo=UTC)


def _store(session, *, accession: str, accepted_at: datetime, owner_cik: str, transactions):
    parsed = parse_ownership_document(
        form4_xml(
            owners=[{"cik": owner_cik, "name": f"INSIDER {owner_cik}", "is_officer": True}],
            transactions=transactions,
        ),
        accession_number=accession,
        accepted_at=accepted_at,
        source_url=f"https://www.sec.gov/{accession}",
    )
    InsiderIngestor(session, get_settings(), client=FakeEdgarClient()).persist(parsed)


def _seed(session, count: int = 3) -> None:
    for index in range(count):
        _store(
            session,
            accession=f"0000320193-24-00020{index}",
            accepted_at=ACCEPTED + timedelta(days=index),
            owner_cik=f"000000020{index}",
            transactions=[
                {"code": "P", "date": "2024-01-10", "shares": 100, "price": "100"},
                {"code": "A", "date": "2024-01-11", "shares": 50, "price": "0"},
            ],
        )
    # The HTTP client reads through its own session, so the fixture data has to
    # be committed before the request is made.
    session.commit()


def _compute_signals(session) -> None:
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
# Authentication
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "path",
    [
        "/v1/intelligence/status",
        "/v1/intelligence/insiders",
        "/v1/intelligence/insiders/AAPL",
        "/v1/intelligence/institutions",
        "/v1/intelligence/signals",
        "/v1/intelligence/symbols/AAPL/summary",
    ],
)
def test_every_endpoint_requires_a_token(client, path):
    response = client.get(path)
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"


def test_a_viewer_may_read_research(client):
    key, _, _ = make_api_key("viewer")
    response = client.get(
        "/v1/intelligence/status", headers={"authorization": f"Bearer {key}"}
    )
    assert response.status_code == 200


def test_the_intelligence_surface_is_read_only(client):
    """No research endpoint may mutate state, so no write verb is registered."""
    schema = client.get("/openapi.json").json()
    for path, operations in schema["paths"].items():
        if "/intelligence" not in path:
            continue
        assert set(operations) <= {"get"}, f"{path} exposes a write verb: {set(operations)}"


# --------------------------------------------------------------------------
# Status
# --------------------------------------------------------------------------


def test_status_reports_an_empty_store_honestly(client):
    response = client.get("/v1/intelligence/status", headers=AUTH)
    assert response.status_code == 200

    payload = response.json()
    assert payload["provenance"] == "live"
    data = payload["data"]
    assert data["enabled"] is True
    assert data["filings"] == 0
    assert data["transactions"] == 0
    assert data["freshness"] == "never"
    assert any("nothing has been collected" in item for item in data["caveats"])


def test_status_counts_stored_filings(client, session):
    _seed(session, count=2)
    data = client.get("/v1/intelligence/status", headers=AUTH).json()["data"]

    assert data["filings"] == 2
    assert data["transactions"] == 4
    assert data["symbolsCovered"] == ["AAPL"]


# --------------------------------------------------------------------------
# Insider feed
# --------------------------------------------------------------------------


def test_empty_insider_feed_is_unavailable_not_zero(client):
    response = client.get("/v1/intelligence/insiders", headers=AUTH)
    payload = response.json()

    assert payload["provenance"] == "unavailable"
    assert payload["data"]["items"] == []
    assert payload["data"]["total"] == 0
    assert payload["warnings"]


def test_insider_feed_returns_stored_transactions(client, session):
    _seed(session, count=1)
    payload = client.get("/v1/intelligence/insiders", headers=AUTH).json()

    assert payload["provenance"] == "live"
    items = payload["data"]["items"]
    assert len(items) == 2
    purchase = next(item for item in items if item["classification"] == "open_market_purchase")
    assert purchase["symbol"] == "AAPL"
    assert purchase["value"] == 10000.0
    assert purchase["isOpenMarket"] is True
    assert purchase["sourceUrl"].startswith("https://www.sec.gov/")
    assert purchase["role"] == "Officer"


def test_insider_feed_paginates(client, session):
    _seed(session, count=3)

    first = client.get("/v1/intelligence/insiders?page=1&limit=2", headers=AUTH).json()
    second = client.get("/v1/intelligence/insiders?page=2&limit=2", headers=AUTH).json()

    assert first["data"]["total"] == 6
    assert len(first["data"]["items"]) == 2
    assert first["data"]["hasMore"] is True
    assert len(second["data"]["items"]) == 2
    assert {item["id"] for item in first["data"]["items"]}.isdisjoint(
        {item["id"] for item in second["data"]["items"]}
    )


def test_insider_feed_filters_by_classification(client, session):
    _seed(session, count=1)
    payload = client.get(
        "/v1/intelligence/insiders?classification=award_grant", headers=AUTH
    ).json()

    assert payload["data"]["total"] == 1
    assert payload["data"]["items"][0]["classification"] == "award_grant"


def test_insider_feed_filters_to_open_market_only(client, session):
    _seed(session, count=1)
    payload = client.get(
        "/v1/intelligence/insiders?open_market_only=true", headers=AUTH
    ).json()

    assert payload["data"]["total"] == 1
    assert all(item["isOpenMarket"] for item in payload["data"]["items"])


def test_insider_feed_rejects_an_oversized_page(client):
    response = client.get("/v1/intelligence/insiders?limit=5000", headers=AUTH)
    assert response.status_code == 422


def test_symbol_summary_reports_an_empty_state(client):
    payload = client.get("/v1/intelligence/insiders/TSLA", headers=AUTH).json()
    assert payload["provenance"] == "unavailable"
    assert payload["data"]["purchaseCount"] == 0
    assert payload["data"]["purchaseValueUsd"] is None


def test_symbol_summary_aggregates_purchases(client, session):
    _seed(session, count=2)
    payload = client.get(
        "/v1/intelligence/insiders/AAPL?as_of=2024-02-20T00:00:00Z", headers=AUTH
    ).json()

    assert payload["provenance"] == "live"
    data = payload["data"]
    assert data["purchaseCount"] == 2
    assert data["distinctPurchasers"] == 2
    assert data["purchaseValueUsd"] == 20000.0
    assert data["unpricedPurchaseLines"] == 0


# --------------------------------------------------------------------------
# Signals
# --------------------------------------------------------------------------


def test_empty_signal_feed_is_unavailable(client):
    payload = client.get("/v1/intelligence/signals", headers=AUTH).json()
    assert payload["provenance"] == "unavailable"
    assert payload["data"]["items"] == []


def test_signals_are_served_with_their_explanations(client, session):
    _seed(session, count=3)
    _compute_signals(session)

    payload = client.get("/v1/intelligence/signals", headers=AUTH).json()
    assert payload["provenance"] == "live"
    items = payload["data"]["items"]
    assert items

    cluster = next(
        item for item in items if item["category"] == "INSIDER_PURCHASE_CLUSTER"
    )
    assert cluster["explanation"]
    assert cluster["confidenceNotes"]
    assert cluster["publicAvailableAt"]
    assert cluster["sourceEventIds"]
    assert cluster["score"] is not None


def test_signals_can_be_filtered_by_category(client, session):
    _seed(session, count=3)
    _compute_signals(session)

    payload = client.get(
        "/v1/intelligence/signals?category=INSIDER_PURCHASE_VALUE", headers=AUTH
    ).json()
    assert all(
        item["category"] == "INSIDER_PURCHASE_VALUE" for item in payload["data"]["items"]
    )


def test_a_single_signal_can_be_fetched(client, session):
    _seed(session, count=3)
    _compute_signals(session)

    listed = client.get("/v1/intelligence/signals", headers=AUTH).json()["data"]["items"]
    signal_id = listed[0]["id"]

    response = client.get(f"/v1/intelligence/signals/{signal_id}", headers=AUTH)
    assert response.status_code == 200
    assert response.json()["data"]["id"] == signal_id


def test_an_unknown_signal_is_a_404(client):
    response = client.get(
        "/v1/intelligence/signals/00000000-0000-0000-0000-000000000000", headers=AUTH
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_a_malformed_signal_id_is_a_422(client):
    response = client.get("/v1/intelligence/signals/not-a-uuid", headers=AUTH)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "bad_request"


# --------------------------------------------------------------------------
# Institutions
# --------------------------------------------------------------------------


def test_empty_institution_feed_is_unavailable(client):
    payload = client.get("/v1/intelligence/institutions", headers=AUTH).json()
    assert payload["provenance"] == "unavailable"
    assert payload["data"]["items"] == []


def test_unknown_institution_changes_are_a_404(client):
    response = client.get("/v1/intelligence/institutions/0000000000/changes", headers=AUTH)
    assert response.status_code == 404


# --------------------------------------------------------------------------
# Symbol summary
# --------------------------------------------------------------------------


def test_symbol_summary_is_unavailable_without_evidence(client):
    payload = client.get("/v1/intelligence/symbols/NVDA/summary", headers=AUTH).json()
    assert payload["provenance"] == "unavailable"
    assert payload["data"]["signals"] == []
    assert payload["data"]["fusion"]["compositeScore"] is None
    assert payload["data"]["fusion"]["dataQuality"] == "unavailable"


def test_symbol_summary_includes_fusion_and_caveats(client, session):
    _seed(session, count=3)
    payload = client.get(
        "/v1/intelligence/symbols/AAPL/summary?as_of=2024-02-20T00:00:00Z", headers=AUTH
    ).json()

    assert payload["provenance"] == "live"
    data = payload["data"]
    assert data["symbol"] == "AAPL"
    assert data["insider"]["purchaseCount"] == 3
    assert data["fusion"]["symbol"] == "AAPL"
    assert any("not a probability of profit" in item for item in data["caveats"])
    assert any("CUSIP" in item for item in data["fusion"]["caveats"])
