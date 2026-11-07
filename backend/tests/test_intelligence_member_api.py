"""The member research surface: provenance, coverage, permissions, retrieval.

These tests run against real persisted SEC filings rather than hand-built rows
wherever the point of the test is provenance, because the claim under test is
"this figure can be traced to this document". A fixture that invents a filing
would prove nothing about that.

The permission tests are the other half. The member surface is gated on a
scope, not a role, so a credential issued for the member workspace can read
research without being able to reach orders, risk or connections.
"""

from __future__ import annotations

import os
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from wands.config import get_settings
from wands.db.models import ApiKey, IntelFilingRow, IntelInsiderTransactionRow, User
from wands.db.session import session_scope
from wands.intelligence.forms import parse_ownership_document
from wands.intelligence.ingest import InsiderIngestor
from wands.intelligence.signals import InsiderSignalEngine, SignalParameters
from wands.security.auth import generate_api_key

from .conftest import AUTH, PEPPER, make_api_key
from .intelligence_fakes import FakeEdgarClient, form4_xml

ACCEPTED = datetime(2024, 2, 1, 18, 0, tzinfo=UTC)
AS_OF = "2024-02-20T00:00:00Z"

MEMBER_PATHS = (
    "/v1/intelligence/dashboard",
    "/v1/intelligence/sources?subject_type=symbol&subject_id=AAPL",
    "/v1/intelligence/coverage/public",
    "/v1/intelligence/symbols/AAPL/summary",
    f"/v1/intelligence/signals/{uuid.uuid4()}",
    f"/v1/intelligence/insiders/transactions/{uuid.uuid4()}",
)

# Fields that exist on the operator projection and must never reach a member.
OPERATOR_ONLY_KEYS = {
    "jobs",
    "backfill",
    "leaseOwner",
    "lastError",
    "consecutiveFailures",
    "identifiers",
    "storageKey",
    "fetchAttempts",
    "lastFetchError",
    "rawDocument",
    "parserWarnings",
    "unresolvedCusips",
}


def _store(
    session,
    *,
    accession: str,
    accepted_at: datetime,
    owner_cik: str,
    transactions,
    source_url: str | None = None,
) -> None:
    parsed = parse_ownership_document(
        form4_xml(
            owners=[{"cik": owner_cik, "name": f"INSIDER {owner_cik}", "is_officer": True}],
            transactions=transactions,
        ),
        accession_number=accession,
        accepted_at=accepted_at,
        source_url=source_url if source_url is not None else f"https://www.sec.gov/{accession}",
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


def _key_with_scopes(scopes: list[str]) -> dict[str, str]:
    with session_scope() as session:
        user = User(
            email=f"scoped-{os.urandom(3).hex()}@test.local",
            display_name="Scoped",
            role="viewer",
            mfa_enabled=False,
            is_active=True,
        )
        session.add(user)
        session.flush()

        full, prefix, hashed = generate_api_key(PEPPER)
        session.add(
            ApiKey(
                user_id=user.id,
                name="scoped key",
                key_prefix=prefix,
                key_hash=hashed,
                role="viewer",
                scopes=scopes,
            )
        )
        session.flush()
    return {"authorization": f"Bearer {full}"}


def _keys(payload) -> set[str]:
    """Every object key anywhere in a JSON payload."""
    found: set[str] = set()
    if isinstance(payload, dict):
        for key, value in payload.items():
            found.add(key)
            found |= _keys(value)
    elif isinstance(payload, list):
        for item in payload:
            found |= _keys(item)
    return found


# --------------------------------------------------------------------------
# Permissions
# --------------------------------------------------------------------------


@pytest.mark.parametrize("path", MEMBER_PATHS)
def test_every_member_endpoint_requires_a_token(client, path):
    response = client.get(path)
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"


def test_a_credential_without_the_research_scope_is_denied(client):
    headers = _key_with_scopes(["orders:read", "portfolio:read"])

    for path in MEMBER_PATHS:
        response = client.get(path, headers=headers)
        assert response.status_code == 403, path
        assert "research:read" in response.json()["error"]["message"]


def test_a_credential_with_only_the_research_scope_may_read_research(client):
    headers = _key_with_scopes(["research:read"])

    for path in MEMBER_PATHS:
        # 404 is a legitimate answer for an unknown id; the point is that the
        # request was authorised rather than refused.
        assert client.get(path, headers=headers).status_code in {200, 404}, path


OPERATOR_PATHS = (
    # Trading, portfolio, risk, broker connections and credentials.
    "/v1/orders",
    "/v1/portfolio",
    "/v1/connections",
    "/v1/settings",
    "/v1/risk",
    "/v1/engine/status",
    "/v1/engine/audit",
    # Intelligence administration: collection jobs, operator coverage,
    # experiment management and the administrative status projection.
    "/v1/intelligence/status",
    "/v1/intelligence/jobs",
    "/v1/intelligence/coverage",
    "/v1/intelligence/experiments",
)


def test_a_research_only_credential_cannot_reach_operator_surfaces(client):
    headers = _key_with_scopes(["research:read"])

    for path in OPERATOR_PATHS:
        response = client.get(path, headers=headers)
        assert response.status_code == 403, path
        assert "scoped to research" in response.json()["error"]["message"], path


def test_a_research_only_credential_may_read_the_research_feeds(client):
    headers = _key_with_scopes(["research:read"])

    for path in (
        "/v1/intelligence/insiders",
        "/v1/intelligence/institutions",
        "/v1/intelligence/signals",
        "/v1/intelligence/insiders/AAPL",
    ):
        assert client.get(path, headers=headers).status_code == 200, path


def test_an_operator_credential_still_reaches_intelligence_administration(client):
    headers = _key_with_scopes(["orders:read", "portfolio:read"])

    for path in (
        "/v1/intelligence/status",
        "/v1/intelligence/jobs",
        "/v1/intelligence/coverage",
        "/v1/intelligence/experiments",
    ):
        assert client.get(path, headers=headers).status_code == 200, path


def test_an_operator_credential_still_reaches_operator_surfaces(client):
    headers = _key_with_scopes(["orders:read", "portfolio:read"])

    for path in ("/v1/orders", "/v1/portfolio"):
        assert client.get(path, headers=headers).status_code == 200, path


def test_a_viewer_api_key_may_read_research(client):
    key, _, _ = make_api_key("viewer")
    response = client.get(
        "/v1/intelligence/dashboard", headers={"authorization": f"Bearer {key}"}
    )
    assert response.status_code == 200


def test_the_member_surface_adds_no_write_routes():
    from wands.api.routes import intelligence

    writes = {
        (route.path, method)
        for route in intelligence.router.routes
        for method in (getattr(route, "methods", set()) or set())
        if method in {"POST", "PUT", "PATCH", "DELETE"}
    }
    assert writes == {
        ("/intelligence/backfill", "POST"),
        ("/intelligence/jobs/{name}/pause", "POST"),
        ("/intelligence/jobs/{name}/resume", "POST"),
    }


# --------------------------------------------------------------------------
# Dashboard
# --------------------------------------------------------------------------


def test_dashboard_is_unavailable_before_anything_is_collected(client):
    body = client.get("/v1/intelligence/dashboard", headers=AUTH).json()

    assert body["provenance"] == "unavailable"
    data = body["data"]
    assert data["counts"] == {
        "filings": 0,
        "transactions": 0,
        "signals": 0,
        "institutions": 0,
        "holdings": 0,
        "symbols": 0,
    }
    assert data["latestFilingAt"] is None
    assert data["topSignals"] == []
    assert data["recentPurchases"] == []
    assert data["coverage"]["status"] == "unavailable"
    assert any("nothing has been collected" in item.lower() for item in body["warnings"])


def test_dashboard_counts_stored_records_and_names_the_latest_filing(client, session):
    _seed(session, count=3)

    body = client.get("/v1/intelligence/dashboard", headers=AUTH).json()

    assert body["provenance"] == "live"
    data = body["data"]
    assert data["counts"]["filings"] == 3
    assert data["counts"]["transactions"] == 6
    assert data["counts"]["symbols"] == 1
    assert data["latestFilingAt"] == "2024-02-03T18:00:00Z"
    # Only open-market purchases are "recent purchases"; the award is not one.
    assert len(data["recentPurchases"]) == 3
    assert all(item["isOpenMarket"] for item in data["recentPurchases"])
    assert all(item["classification"] == "open_market_purchase" for item in data["recentPurchases"])


def test_dashboard_ranks_signals_and_reports_coverage(client, session):
    _seed(session, count=3)
    _compute_signals(session)

    data = client.get("/v1/intelligence/dashboard", headers=AUTH).json()["data"]

    assert data["counts"]["signals"] > 0
    assert data["topSignals"]
    assert data["latestSignalAt"] is not None
    assert data["coverage"]["status"] in {"partial", "complete"}
    assert data["coverage"]["symbolsCovered"] == 1


def test_dashboard_does_not_expose_collection_machinery(client, session):
    _seed(session, count=3)
    _compute_signals(session)

    body = client.get("/v1/intelligence/dashboard", headers=AUTH).json()

    leaked = _keys(body) & OPERATOR_ONLY_KEYS
    assert leaked == set()


# --------------------------------------------------------------------------
# Sources
# --------------------------------------------------------------------------


def test_sources_returns_the_original_sec_url_and_availability_time(client, session):
    _seed(session, count=1)

    body = client.get(
        "/v1/intelligence/sources?subject_type=symbol&subject_id=AAPL", headers=AUTH
    ).json()

    assert body["provenance"] == "live"
    assert len(body["data"]) == 1
    link = body["data"][0]
    assert link["url"] == "https://www.sec.gov/0000320193-24-000200"
    assert link["accessionNumber"] == "0000320193-24-000200"
    assert link["formType"] == "4"
    assert link["kind"] == "sec_filing"
    # Availability is the acceptance time, never the transaction date.
    assert link["publicAvailableAt"] == "2024-02-01T18:00:00Z"
    assert link["retrievedAt"]
    assert link["supports"]
    assert link["label"].startswith("4 — ")


def test_sources_omits_a_filing_with_no_resolvable_url(client, session):
    _seed(session, count=2)
    blanked = session.scalar(
        select(IntelFilingRow).where(
            IntelFilingRow.accession_number == "0000320193-24-000200"
        )
    )
    blanked.source_url = ""
    session.commit()

    body = client.get(
        "/v1/intelligence/sources?subject_type=symbol&subject_id=AAPL", headers=AUTH
    ).json()

    accessions = {item["accessionNumber"] for item in body["data"]}
    assert accessions == {"0000320193-24-000201"}

    asset = client.get(
        f"/v1/intelligence/symbols/AAPL/summary?as_of={AS_OF}", headers=AUTH
    ).json()
    assert any("no resolvable SEC source URL" in item for item in asset["data"]["caveats"])


def test_sources_resolves_a_transaction_to_its_filing(client, session):
    _seed(session, count=1)
    transaction = session.scalar(select(IntelInsiderTransactionRow))

    body = client.get(
        f"/v1/intelligence/sources?subject_type=insider_transaction&subject_id={transaction.id}",
        headers=AUTH,
    ).json()

    assert len(body["data"]) == 1
    assert body["data"][0]["accessionNumber"] == "0000320193-24-000200"


def test_sources_resolves_a_signal_to_its_evidence(client, session):
    _seed(session, count=3)
    _compute_signals(session)

    signal_id = client.get("/v1/intelligence/signals", headers=AUTH).json()["data"]["items"][0]["id"]
    body = client.get(
        f"/v1/intelligence/sources?subject_type=signal&subject_id={signal_id}", headers=AUTH
    ).json()

    assert body["provenance"] == "live"
    assert body["data"]
    assert all(item["url"].startswith("https://www.sec.gov/") for item in body["data"])


def test_sources_for_an_unknown_subject_is_unavailable_not_empty(client):
    body = client.get(
        "/v1/intelligence/sources?subject_type=symbol&subject_id=ZZZZ", headers=AUTH
    ).json()

    assert body["provenance"] == "unavailable"
    assert body["data"] == []
    assert any("no resolvable sec source" in item.lower() for item in body["warnings"])


def test_sources_rejects_an_unknown_subject_type(client):
    response = client.get(
        "/v1/intelligence/sources?subject_type=portfolio&subject_id=1", headers=AUTH
    )
    assert response.status_code == 422


# --------------------------------------------------------------------------
# Coverage
# --------------------------------------------------------------------------


def test_public_coverage_is_unavailable_before_collection(client):
    body = client.get("/v1/intelligence/coverage/public", headers=AUTH).json()

    assert body["provenance"] == "unavailable"
    data = body["data"]
    assert data["status"] == "unavailable"
    assert data["symbolsCovered"] == 0
    assert data["windowStart"] is None
    assert {gap["key"] for gap in data["gaps"]} >= {"no_filings", "no_signals"}


def test_public_coverage_reports_the_window_and_the_gaps(client, session):
    _seed(session, count=3)

    data = client.get("/v1/intelligence/coverage/public", headers=AUTH).json()["data"]

    assert data["windowStart"] == "2024-02-01T18:00:00Z"
    assert data["windowEnd"] == "2024-02-03T18:00:00Z"
    assert data["symbolsCovered"] == 1
    assert data["symbolsRequested"] >= 1
    # Filings exist but no signal has been derived, so the stored data cannot
    # support a signal claim yet.
    assert data["status"] == "insufficient"
    keys = {gap["key"] for gap in data["gaps"]}
    assert "no_signals" in keys
    assert "no_price_series" in keys
    assert "collector_not_current" in keys
    assert all(gap["detail"] for gap in data["gaps"])


def test_public_coverage_does_not_expose_operator_internals(client, session):
    _seed(session, count=3)

    body = client.get("/v1/intelligence/coverage/public", headers=AUTH).json()

    assert _keys(body) & OPERATOR_ONLY_KEYS == set()


# --------------------------------------------------------------------------
# Asset page
# --------------------------------------------------------------------------


def test_asset_summary_carries_sources_and_coverage(client, session):
    _seed(session, count=3)

    body = client.get(
        f"/v1/intelligence/symbols/AAPL/summary?as_of={AS_OF}", headers=AUTH
    ).json()

    assert body["provenance"] == "live"
    data = body["data"]
    assert data["symbol"] == "AAPL"
    assert data["issuerName"]
    assert data["insider"]["purchaseCount"] == 3
    assert data["fusion"]["symbol"] == "AAPL"
    assert len(data["sources"]) == 3
    assert data["coverage"]["symbolsRequested"] == 1
    assert data["coverage"]["symbolsCovered"] == 1
    assert data["coverage"]["windowStart"] == "2024-02-01T18:00:00Z"
    # Price coverage is a member-facing disclosure: it says what history backs
    # the analysis. With no bars stored it must read as unavailable, not empty.
    assert data["priceCoverage"]["status"] == "unavailable"
    assert data["priceCoverage"]["bars"] == 0
    assert _keys(body) & OPERATOR_ONLY_KEYS == set()


def test_asset_summary_without_evidence_says_so(client):
    body = client.get("/v1/intelligence/symbols/NVDA/summary", headers=AUTH).json()

    assert body["provenance"] == "unavailable"
    data = body["data"]
    assert data["sources"] == []
    assert data["coverage"]["status"] == "unavailable"
    assert data["coverage"]["symbolsCovered"] == 0
    assert any("no sec ownership filing" in item.lower() for item in data["caveats"])


# --------------------------------------------------------------------------
# Retrieval by stable id
# --------------------------------------------------------------------------


def test_an_insider_transaction_is_retrievable_beyond_the_first_feed_page(client, session):
    for index in range(60):
        _store(
            session,
            accession=f"0000320193-24-{index:06d}",
            accepted_at=ACCEPTED + timedelta(hours=index),
            owner_cik=f"0000000{index:03d}",
            transactions=[{"code": "P", "date": "2024-01-10", "shares": 10, "price": "50"}],
        )
    session.commit()

    oldest = session.scalar(
        select(IntelInsiderTransactionRow).order_by(
            IntelInsiderTransactionRow.accepted_at
        )
    )

    page = client.get("/v1/intelligence/insiders?page=1&limit=50", headers=AUTH).json()
    assert page["data"]["total"] == 60
    assert oldest.id.hex not in {item["id"].replace("-", "") for item in page["data"]["items"]}

    response = client.get(
        f"/v1/intelligence/insiders/transactions/{oldest.id}", headers=AUTH
    )

    assert response.status_code == 200
    body = response.json()
    assert body["provenance"] == "live"
    data = body["data"]
    assert data["id"] == str(oldest.id)
    assert data["accessionNumber"] == oldest.accession_number
    assert data["sourceUrl"] == f"https://www.sec.gov/{oldest.accession_number}"
    assert data["acceptedAt"] == "2024-02-01T18:00:00Z"
    assert data["transactionDate"] == "2024-01-10T00:00:00Z"
    assert data["classification"] == "open_market_purchase"
    assert data["isOpenMarket"] is True
    assert data["dataQuality"] == "reported"


def test_an_unknown_transaction_is_a_404(client):
    response = client.get(
        f"/v1/intelligence/insiders/transactions/{uuid.uuid4()}", headers=AUTH
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_a_malformed_transaction_id_is_a_422(client):
    response = client.get("/v1/intelligence/insiders/transactions/not-a-uuid", headers=AUTH)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "bad_request"


def test_a_signal_is_retrievable_by_id_with_the_contract_shape(client, session):
    _seed(session, count=3)
    _compute_signals(session)

    listed = client.get("/v1/intelligence/signals", headers=AUTH).json()["data"]["items"][0]
    body = client.get(f"/v1/intelligence/signals/{listed['id']}", headers=AUTH).json()

    assert body["provenance"] == "live"
    data = body["data"]
    assert set(data) == {
        "id",
        "category",
        "symbol",
        "sourceEventIds",
        "eventTime",
        "publicAvailableAt",
        "calculatedAt",
        "rawMeasurement",
        "rawUnit",
        "score",
        "explanation",
        "dataQuality",
        "confidenceNotes",
        "parameters",
        "engineVersion",
    }
    # The two timestamps are distinct claims and must not be conflated.
    assert data["eventTime"] != data["publicAvailableAt"]
    assert data["publicAvailableAt"] >= data["eventTime"]
