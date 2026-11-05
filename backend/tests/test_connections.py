"""Connection handling: credentials must never come back out."""

from __future__ import annotations

from sqlalchemy import select

from wands.db.models import ConnectionRow
from wands.db.session import session_scope
from wands.security.secrets import SecretBox

from .conftest import AUTH

PAYLOAD = {
    "provider": "kraken",
    "label": "Kraken paper",
    "marketType": "crypto",
    "mode": "paper",
    "access": "trading",
    "apiKey": "kraken-public-key-1234",
    "apiSecret": "kraken-private-secret-5678",
}


def test_connection_is_created_and_credentials_are_encrypted(client):
    response = client.post("/v1/connections", headers=AUTH, json=PAYLOAD)
    assert response.status_code == 200
    connection_id = response.json()["data"]["id"]

    with session_scope() as session:
        row = session.get(ConnectionRow, __import__("uuid").UUID(connection_id))
        assert row is not None
        assert row.credentials_encrypted is not None
        assert "kraken-private-secret-5678" not in row.credentials_encrypted
        assert row.key_hint == "...1234"

        decrypted = SecretBox().decrypt(row.credentials_encrypted)
        assert decrypted["apiSecret"] == "kraken-private-secret-5678"
        assert "withdraw" not in " ".join(decrypted["permissions"])


def test_connection_list_never_returns_secrets(client):
    client.post("/v1/connections", headers=AUTH, json=PAYLOAD)
    body = client.get("/v1/connections", headers=AUTH).text

    assert "kraken-private-secret-5678" not in body
    assert "kraken-public-key-1234" not in body
    assert "...1234" in body

    connection = client.get("/v1/connections", headers=AUTH).json()["data"][0]
    assert connection["available"] is False
    assert connection["status"] == "not_configured"


def test_provider_market_mismatch_is_rejected(client):
    response = client.post(
        "/v1/connections",
        headers=AUTH,
        json={**PAYLOAD, "provider": "alpaca", "marketType": "crypto"},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "bad_request"


def test_testing_an_unimplemented_adapter_does_not_claim_success(client):
    connection_id = client.post("/v1/connections", headers=AUTH, json=PAYLOAD).json()["data"]["id"]
    response = client.post(f"/v1/connections/{connection_id}/test", headers=AUTH)
    assert response.status_code == 200
    assert response.json()["data"]["status"] == "not_configured"
    assert "cannot be tested" in response.json()["data"]["error"]


def test_connection_can_be_deleted(client):
    connection_id = client.post("/v1/connections", headers=AUTH, json=PAYLOAD).json()["data"]["id"]
    assert client.delete(f"/v1/connections/{connection_id}", headers=AUTH).status_code == 200

    with session_scope() as session:
        assert session.scalar(select(ConnectionRow)) is None
