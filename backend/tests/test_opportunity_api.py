"""Opportunity Desk HTTP surface.

The desk is admin-only and append-only. These tests pin the two properties the
member UI depends on: a non-admin cannot reach it, and a recorded decision can be
read back rather than only acknowledged. A UI that can only show the response to
its own request cannot tell the founder what was already decided.
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

from wands.db.models import OppCandidateRow

from .conftest import make_api_key

NOW = datetime(2026, 11, 9, 15, 0, tzinfo=UTC)


def _admin() -> dict[str, str]:
    key, _user, _secret = make_api_key("admin")
    return {"authorization": f"Bearer {key}"}


def _candidate(
    session,
    *,
    symbol: str = "BTC/USD",
    quantity: Decimal | None = Decimal("0.05"),
) -> OppCandidateRow:
    row = OppCandidateRow(
        symbol=symbol,
        market_type="crypto",
        strategy_key="intraday_breakout",
        strategy_version=1,
        observed_at=NOW,
        reference_price=Decimal("101.2"),
        invalidation_price=Decimal("99.8"),
        target_price=Decimal("104.0"),
        range_high=Decimal("100.0"),
        volume_ratio=Decimal("2.0"),
        breakout_margin=Decimal("0.012"),
        why_qualified="Closed above the 20-candle high on 2.00x average volume.",
        entry_condition="Enter at the open of the next completed 5-minute candle.",
        invalidation_condition="Exit at or below 99.8000.",
        exit_condition="Target 104.0000, or the 4-hour time stop.",
        max_holding_hours=4,
        quantity=quantity,
        notional=None if quantity is None else Decimal("5.06"),
        risk_at_stop=None if quantity is None else Decimal("0.07"),
        binding_constraint="maximum position exposure",
        rejected_reason=(
            None
            if quantity is not None
            else "One share costs more than the exposure ceiling."
        ),
        fee_bps=Decimal("5.0"),
        slippage_bps=Decimal("10.0"),
        data_fresh=True,
        data_age_seconds=Decimal("30"),
        data_warnings=[],
        rank_reason="Volume 2.00x its 20-candle average.",
    )
    session.add(row)
    session.commit()
    return row


# --- authorization --------------------------------------------------------


def test_the_desk_rejects_a_non_admin(client) -> None:
    key, _user, _secret = make_api_key("viewer")
    headers = {"authorization": f"Bearer {key}"}
    for path in ("/v1/opportunity/decisions", "/v1/opportunity/candidates", "/v1/opportunity/tests"):
        assert client.get(path, headers=headers).status_code == 403


def test_the_desk_rejects_an_unauthenticated_request(client) -> None:
    assert client.get("/v1/opportunity/decisions").status_code == 401


# --- decisions ------------------------------------------------------------


def test_a_recorded_decision_can_be_read_back(client, session) -> None:
    candidate = _candidate(session)
    headers = _admin()

    recorded = client.post(
        f"/v1/opportunity/candidates/{candidate.id}/decision",
        headers=headers,
        json={"decision": "candidate_watched", "note": "Watching the retest."},
    )
    assert recorded.status_code == 200
    assert recorded.json()["data"]["decision"] == "candidate_watched"

    listed = client.get("/v1/opportunity/decisions", headers=headers)
    assert listed.status_code == 200
    decisions = listed.json()["data"]["decisions"]
    assert len(decisions) == 1
    assert decisions[0]["candidateId"] == str(candidate.id)
    assert decisions[0]["note"] == "Watching the retest."


def test_decisions_are_appended_rather_than_overwritten(client, session) -> None:
    candidate = _candidate(session)
    headers = _admin()

    for decision in ("candidate_watched", "candidate_rejected"):
        response = client.post(
            f"/v1/opportunity/candidates/{candidate.id}/decision",
            headers=headers,
            json={"decision": decision},
        )
        assert response.status_code == 200

    decisions = client.get("/v1/opportunity/decisions", headers=headers).json()["data"][
        "decisions"
    ]
    assert len(decisions) == 2
    assert {item["decision"] for item in decisions} == {
        "candidate_watched",
        "candidate_rejected",
    }


def test_an_unknown_decision_is_refused(client, session) -> None:
    candidate = _candidate(session)
    response = client.post(
        f"/v1/opportunity/candidates/{candidate.id}/decision",
        headers=_admin(),
        json={"decision": "candidate_promoted"},
    )
    assert response.status_code == 422
    assert "candidate_watched" in response.json()["error"]["message"]


def test_a_decision_about_a_missing_candidate_is_a_404(client) -> None:
    response = client.post(
        "/v1/opportunity/candidates/00000000-0000-0000-0000-000000000000/decision",
        headers=_admin(),
        json={"decision": "candidate_watched"},
    )
    assert response.status_code == 404


# --- paper tests ----------------------------------------------------------


def test_a_paper_test_is_recorded_and_listed(client, session) -> None:
    candidate = _candidate(session)
    headers = _admin()

    recorded = client.post(
        f"/v1/opportunity/candidates/{candidate.id}/tests",
        headers=headers,
        json={},
    )
    assert recorded.status_code == 200
    body = recorded.json()["data"]
    assert body["status"] == "test_active"
    assert Decimal(body["quantity"]) == Decimal("0.05")
    assert body["candidateId"] == str(candidate.id)

    listed = client.get("/v1/opportunity/tests", headers=headers)
    assert listed.status_code == 200
    assert len(listed.json()["data"]["tests"]) == 1


def test_an_infeasible_candidate_cannot_be_tested(client, session) -> None:
    """A test that could not have been opened is not evidence."""
    candidate = _candidate(session, quantity=None)
    response = client.post(
        f"/v1/opportunity/candidates/{candidate.id}/tests",
        headers=_admin(),
        json={},
    )
    assert response.status_code == 422
    assert "exposure ceiling" in response.json()["error"]["message"]


def test_a_non_positive_quantity_override_is_refused(client, session) -> None:
    candidate = _candidate(session)
    response = client.post(
        f"/v1/opportunity/candidates/{candidate.id}/tests",
        headers=_admin(),
        json={"quantity": "0"},
    )
    assert response.status_code == 422
    assert "positive" in response.json()["error"]["message"]


def test_the_desk_exposes_no_order_route(client) -> None:
    """A guard against the desk quietly growing an execution path."""
    headers = _admin()
    for path in (
        "/v1/opportunity/orders",
        "/v1/opportunity/candidates/x/order",
        "/v1/opportunity/tests/x/execute",
    ):
        assert client.post(path, headers=headers, json={}).status_code == 404
