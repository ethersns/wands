"""Emergency stop persistence.

The stop must survive a process restart. It is stored in the database, so the
test simulates a restart by discarding the engine and building a new app.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from wands.db.session import reset_engine
from wands.main import create_app

from .conftest import AUTH


def test_emergency_stop_engages_and_blocks(client):
    response = client.post("/v1/risk/emergency-stop", headers=AUTH)
    assert response.status_code == 200
    assert response.json()["data"]["emergencyStopEngaged"] is True

    snapshot = client.get("/v1/risk", headers=AUTH).json()["data"]
    assert snapshot["policy"]["emergencyStopEngaged"] is True
    assert snapshot["policy"]["tradingPaused"] is True
    assert any(breach["key"] == "emergency_stop" for breach in snapshot["breaches"])

    status = client.get("/v1/engine/status", headers=AUTH).json()["data"]
    assert status["state"] == "halted"


def test_emergency_stop_survives_a_restart(client):
    client.post("/v1/risk/emergency-stop", headers=AUTH)

    # Simulate a process restart: drop the engine and build a fresh app.
    reset_engine()
    with TestClient(create_app()) as restarted:
        snapshot = restarted.get("/v1/risk", headers=AUTH).json()["data"]
        assert snapshot["policy"]["emergencyStopEngaged"] is True
        assert snapshot["policy"]["tradingPaused"] is True


def test_emergency_stop_can_be_cleared(client):
    client.post("/v1/risk/emergency-stop", headers=AUTH)
    response = client.post("/v1/engine/emergency-stop/clear", headers=AUTH)
    assert response.status_code == 200
    assert response.json()["data"]["emergencyStopEngaged"] is False

    snapshot = client.get("/v1/risk", headers=AUTH).json()["data"]
    assert snapshot["policy"]["emergencyStopEngaged"] is False


def test_clearing_an_inactive_stop_is_rejected(client):
    response = client.post("/v1/engine/emergency-stop/clear", headers=AUTH)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "bad_request"


def test_emergency_stop_is_audited(client):
    client.post("/v1/risk/emergency-stop", headers=AUTH)
    events = client.get("/v1/engine/audit", headers=AUTH).json()["data"]
    assert any(event["action"] == "risk.emergency_stop" for event in events)
