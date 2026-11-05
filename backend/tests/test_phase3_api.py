"""Phase 3 HTTP surface: paper accounts, portfolio provenance, risk snapshot."""

from __future__ import annotations

from .conftest import AUTH, make_api_key, make_connection


def test_a_paper_account_can_be_initialised_over_http(client):
    account = make_connection(mode="paper")

    response = client.post(
        "/v1/paper/accounts",
        headers=AUTH,
        json={"connectionId": account, "startingCash": 25000, "currency": "USD"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["provenance"] == "live"
    data = payload["data"]
    assert data["startingCash"] == 25000
    assert data["cash"] == 25000
    assert data["buyingPower"] == 25000
    assert data["provenance"] == "paper_simulated"
    assert data["verified"] is True


def test_a_paper_account_cannot_be_initialised_twice_over_http(client):
    account = make_connection(mode="paper")
    body = {"connectionId": account, "startingCash": 1000}

    assert client.post("/v1/paper/accounts", headers=AUTH, json=body).status_code == 200
    second = client.post("/v1/paper/accounts", headers=AUTH, json=body)

    assert second.status_code == 409
    assert second.json()["error"]["code"] == "conflict"


def test_a_paper_account_rejects_a_live_connection_over_http(client):
    account = make_connection(mode="live")

    response = client.post(
        "/v1/paper/accounts",
        headers=AUTH,
        json={"connectionId": account, "startingCash": 1000},
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "bad_request"


def test_a_viewer_cannot_create_a_paper_account(client):
    key, _, _ = make_api_key("viewer")
    account = make_connection(mode="paper")

    response = client.post(
        "/v1/paper/accounts",
        headers={"authorization": f"Bearer {key}"},
        json={"connectionId": account, "startingCash": 1000},
    )

    assert response.status_code == 403


def test_a_paper_account_can_be_reset_over_http(client):
    account = make_connection(mode="paper")
    client.post(
        "/v1/paper/accounts",
        headers=AUTH,
        json={"connectionId": account, "startingCash": 10000},
    )

    response = client.post(
        f"/v1/paper/accounts/{account}/reset",
        headers=AUTH,
        json={"startingCash": 5000},
    )

    assert response.status_code == 200
    assert response.json()["data"]["cash"] == 5000


def test_portfolio_becomes_live_after_paper_initialisation(client):
    account = make_connection(mode="paper")
    client.post(
        "/v1/paper/accounts",
        headers=AUTH,
        json={"connectionId": account, "startingCash": 10000},
    )

    payload = client.get("/v1/portfolio", headers=AUTH).json()

    assert payload["provenance"] == "live"
    assert payload["data"]["totalEquity"] == 10000
    assert payload["data"]["cash"] == 10000
    assert payload["data"]["verified"] is True
    assert payload["data"]["accounts"][0]["source"] == "paper_simulated"


def test_verification_endpoint_matches_the_ledger(client):
    account = make_connection(mode="paper")
    client.post(
        "/v1/paper/accounts",
        headers=AUTH,
        json={"connectionId": account, "startingCash": 10000},
    )

    payload = client.get(f"/v1/accounts/{account}/verification", headers=AUTH).json()

    assert payload["provenance"] == "live"
    assert payload["data"]["ok"] is True
    assert payload["data"]["difference"] == 0


def test_the_ledger_endpoint_returns_the_initialisation(client):
    account = make_connection(mode="paper")
    client.post(
        "/v1/paper/accounts",
        headers=AUTH,
        json={"connectionId": account, "startingCash": 10000},
    )

    payload = client.get(f"/v1/accounts/{account}/ledger", headers=AUTH).json()

    kinds = [entry["kind"] for entry in payload["data"]]
    assert "initialisation" in kinds


def test_risk_snapshot_flags_an_unverified_portfolio(client):
    make_connection(mode="paper")

    payload = client.get("/v1/risk", headers=AUTH).json()

    keys = {breach["key"] for breach in payload["data"]["breaches"]}
    assert "portfolio_unverified" in keys
    assert payload["data"]["utilisation"]["portfolioExposurePct"] is None


def test_risk_snapshot_reports_utilisation_after_initialisation(client):
    account = make_connection(mode="paper")
    client.post(
        "/v1/paper/accounts",
        headers=AUTH,
        json={"connectionId": account, "startingCash": 10000},
    )

    payload = client.get("/v1/risk", headers=AUTH).json()

    keys = {breach["key"] for breach in payload["data"]["breaches"]}
    assert "portfolio_unverified" not in keys
    assert payload["data"]["utilisation"]["portfolioExposurePct"] == 0


def test_market_health_is_empty_when_no_provider_is_configured(client):
    payload = client.get("/v1/markets/health", headers=AUTH).json()

    assert payload["provenance"] == "live"
    assert payload["data"] == []


def test_a_quote_for_an_unknown_symbol_is_not_found(client):
    response = client.get("/v1/markets/BTC-USD/quote", headers=AUTH)

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"
