"""The Envelope contract the frontend depends on."""

from __future__ import annotations

from .conftest import AUTH

REQUIRED_KEYS = {"data", "provenance", "generatedAt", "source", "warnings"}


def test_engine_status_is_enveloped(client):
    payload = client.get("/v1/engine/status", headers=AUTH).json()
    assert REQUIRED_KEYS <= payload.keys()
    assert payload["provenance"] == "live"
    assert payload["source"] == "wands-engine"
    assert payload["data"]["mode"] == "paper"
    assert payload["data"]["liveTradingEnabled"] is False


def test_portfolio_is_unavailable_not_zero(client):
    payload = client.get("/v1/portfolio", headers=AUTH).json()
    assert payload["provenance"] == "unavailable"
    assert payload["warnings"], "an unavailable payload must explain itself"
    assert payload["data"]["totalEquity"] is None
    assert payload["data"]["cash"] is None


def test_market_overview_is_unavailable(client):
    payload = client.get("/v1/markets/overview", headers=AUTH).json()
    assert payload["provenance"] == "unavailable"
    assert payload["data"]["feedHealthy"] is False
    assert payload["data"]["quotes"] == []


def test_candles_are_not_fabricated(client):
    """With no provider configured the series is empty and says so.

    Phase 3 implements candles, so the guarantee is no longer a 501: it is that
    an empty series is returned as ``unavailable`` rather than filled with
    invented bars.
    """
    response = client.get("/v1/markets/BTC-USD/candles?interval=1h", headers=AUTH)
    assert response.status_code == 200
    payload = response.json()
    assert payload["provenance"] == "unavailable"
    assert payload["data"]["candles"] == []
    assert payload["warnings"]


def test_backtest_creation_is_not_fabricated(client):
    response = client.post(
        "/v1/backtests",
        headers=AUTH,
        json={
            "strategyId": "00000000-0000-0000-0000-000000000000",
            "symbols": ["BTC-USD"],
            "timeframe": "1h",
            "from": "2025-01-01T00:00:00Z",
            "to": "2025-06-01T00:00:00Z",
            "initialCapital": 10000,
        },
    )
    assert response.status_code == 501
    assert response.json()["error"]["code"] == "not_implemented"


def test_health_endpoints_are_open(client):
    assert client.get("/healthz").status_code == 200
    assert client.get("/readyz").status_code == 200


def test_unknown_route_returns_404(client):
    assert client.get("/v1/nope", headers=AUTH).status_code == 404
