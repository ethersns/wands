"""Authentication, authorisation and MFA."""

from __future__ import annotations

from datetime import UTC, datetime

from wands.security.totp import code_at

from .conftest import AUTH, make_api_key


def test_missing_token_is_rejected(client):
    response = client.get("/v1/engine/status")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"


def test_malformed_token_is_rejected(client):
    response = client.get("/v1/engine/status", headers={"authorization": "Bearer nonsense"})
    assert response.status_code == 401


def test_service_token_is_accepted(client):
    response = client.get("/v1/engine/status", headers=AUTH)
    assert response.status_code == 200
    assert response.json()["provenance"] == "live"


def test_viewer_cannot_change_risk_policy(client):
    key, _, _ = make_api_key("viewer")
    response = client.patch(
        "/v1/risk/policy",
        headers={"authorization": f"Bearer {key}"},
        json={"daily_loss_limit_pct": 50},
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden"


def test_operator_cannot_change_risk_policy(client):
    key, _, _ = make_api_key("operator")
    response = client.patch(
        "/v1/risk/policy",
        headers={"authorization": f"Bearer {key}"},
        json={"daily_loss_limit_pct": 50},
    )
    assert response.status_code == 403


def test_admin_without_mfa_code_is_challenged(client):
    key, _, _ = make_api_key("admin", mfa=True)
    response = client.patch(
        "/v1/risk/policy",
        headers={"authorization": f"Bearer {key}"},
        json={"daily_loss_limit_pct": 3},
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "mfa_required"


def test_admin_with_valid_mfa_code_succeeds(client):
    key, _, secret = make_api_key("admin", mfa=True)
    code = code_at(secret, datetime.now(tz=UTC))
    response = client.patch(
        "/v1/risk/policy",
        headers={"authorization": f"Bearer {key}", "x-wands-mfa-code": code},
        json={"daily_loss_limit_pct": 3},
    )
    assert response.status_code == 200
    assert response.json()["data"]["dailyLossLimitPct"] == 3


def test_admin_with_wrong_mfa_code_is_rejected(client):
    key, _, _ = make_api_key("admin", mfa=True)
    response = client.patch(
        "/v1/risk/policy",
        headers={"authorization": f"Bearer {key}", "x-wands-mfa-code": "000000"},
        json={"daily_loss_limit_pct": 3},
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "mfa_required"


def test_revoked_api_key_is_rejected(client):
    from sqlalchemy import select

    from wands.db.models import ApiKey
    from wands.db.session import session_scope

    key, user, _ = make_api_key("viewer")
    with session_scope() as session:
        row = session.scalar(select(ApiKey).where(ApiKey.user_id == user.id))
        row.revoked_at = datetime.now(tz=UTC)

    response = client.get("/v1/engine/status", headers={"authorization": f"Bearer {key}"})
    assert response.status_code == 401
