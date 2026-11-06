"""Permission denials are audited, and stay denied when auditing fails.

The gap these cover: authorisation is enforced by a dependency, so a 403 is
raised before the route body runs. Auditing inside the handler therefore never
saw a denial at all.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from wands.db.models import AuditEvent
from wands.db.session import session_scope
from wands.security.audit import DENIAL_ACTION, denial_counts, reset_denial_counts
from wands.security.totp import code_at

from .conftest import AUTH, make_api_key

ADMIN_ROUTE = "/v1/risk/policy"
ADMIN_TARGET = f"PATCH {ADMIN_ROUTE}"


@pytest.fixture(autouse=True)
def clear_counters():
    reset_denial_counts()
    yield
    reset_denial_counts()


def _denials() -> list[AuditEvent]:
    with session_scope() as session:
        return list(
            session.scalars(
                select(AuditEvent)
                .where(AuditEvent.action == DENIAL_ACTION)
                .order_by(AuditEvent.at)
            ).all()
        )


def _patch_policy(client, key: str, **headers):
    return client.patch(
        ADMIN_ROUTE,
        headers={"authorization": f"Bearer {key}", **headers},
        json={"daily_loss_limit_pct": 50},
    )


def test_viewer_denial_is_audited(client):
    key, user, _ = make_api_key("viewer")

    response = _patch_policy(client, key)

    assert response.status_code == 403
    denials = _denials()
    assert len(denials) == 1
    event = denials[0]
    assert event.actor == user.email
    assert event.actor_type == "user"
    assert event.target == ADMIN_TARGET
    assert event.outcome == "denied"
    assert event.request_id
    assert event.detail["code"] == "forbidden"
    assert event.detail["role"] == "viewer"


def test_operator_denial_is_audited(client):
    key, user, _ = make_api_key("operator")

    response = _patch_policy(client, key)

    assert response.status_code == 403
    denials = _denials()
    assert len(denials) == 1
    assert denials[0].actor == user.email
    assert denials[0].detail["role"] == "operator"


def test_admin_missing_second_factor_is_audited(client):
    key, user, _ = make_api_key("admin", mfa=True)

    response = _patch_policy(client, key)

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "mfa_required"
    denials = _denials()
    assert len(denials) == 1
    assert denials[0].actor == user.email
    assert denials[0].detail["code"] == "mfa_required"


def test_admin_with_valid_second_factor_is_not_audited_as_denied(client):
    key, _, secret = make_api_key("admin", mfa=True)
    code = code_at(secret, datetime.now(tz=UTC))

    response = _patch_policy(client, key, **{"x-wands-mfa-code": code})

    assert response.status_code == 200
    assert _denials() == []


def test_one_request_records_one_denial(client):
    key, _, _ = make_api_key("viewer")

    _patch_policy(client, key)

    assert len(_denials()) == 1


def test_unauthenticated_rejection_is_counted_but_not_persisted(client):
    response = client.patch(ADMIN_ROUTE, json={"daily_loss_limit_pct": 50})

    assert response.status_code == 401
    assert _denials() == []
    assert denial_counts()["unauthorized"] == 1


def test_denial_detail_never_contains_the_credential(client):
    key, _, _ = make_api_key("viewer")

    _patch_policy(client, key)

    denials = _denials()
    assert len(denials) == 1
    serialised = json.dumps(denials[0].detail)
    assert key not in serialised
    assert "authorization" not in serialised.lower()


def test_denial_stays_denied_when_the_audit_store_is_unavailable(client, monkeypatch):
    """Fail closed: a broken audit trail must not turn a 403 into a 200."""
    import wands.security.audit as audit_module

    def explode():
        raise RuntimeError("audit store unreachable")

    monkeypatch.setattr(audit_module, "session_scope", explode)
    key, _, _ = make_api_key("viewer")

    response = _patch_policy(client, key)

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden"
    assert _denials() == []


def test_deployment_level_live_trading_refusal_is_audited(client):
    """A refused privileged action is recorded even though the actor is admin.

    The refusal comes from the deployment flag rather than the role, but an
    attempt to switch on real-money trading is exactly the event the trail
    exists to capture.
    """
    response = client.post(
        "/v1/engine/live-trading",
        headers=AUTH,
        json={"enabled": True, "confirmation": "ENABLE LIVE TRADING"},
    )

    assert response.status_code == 403
    denials = _denials()
    assert len(denials) == 1
    assert denials[0].actor_type == "service"
    assert denials[0].target == "POST /v1/engine/live-trading"
