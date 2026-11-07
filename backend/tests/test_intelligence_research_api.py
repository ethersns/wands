"""Research HTTP surface: permissions, envelopes and empty states.

The permission tests are the important ones. A backfill is the only intelligence
endpoint that writes anything, so it must be admin-only and it must be audited.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import select

from wands.db.models import AuditEvent, IntelJobRow, IntelSignalRow
from wands.intelligence.base import SignalCategory

from .conftest import AUTH, make_api_key


def _admin_headers() -> dict[str, str]:
    key, _, _ = make_api_key("admin")
    return {"authorization": f"Bearer {key}"}


def _viewer_headers() -> dict[str, str]:
    key, _, _ = make_api_key("viewer")
    return {"authorization": f"Bearer {key}"}


def _signal(session, *, index: int = 0) -> IntelSignalRow:
    moment = datetime(2024, 3, 4, 18, 0, tzinfo=UTC) + timedelta(days=index)
    row = IntelSignalRow(
        signal_key=f"api-key-{index}",
        category=SignalCategory.INSIDER_PURCHASE_CLUSTER.value,
        symbol="AAPL",
        source_event_ids=[f"event-{index}"],
        event_time=moment - timedelta(days=1),
        public_available_at=moment,
        raw_measurement=Decimal("3"),
        raw_unit="count",
        score=Decimal("70"),
        explanation="fixture",
        data_quality="derived",
        confidence_notes="",
        parameters={},
        engine_version="1.0",
    )
    session.add(row)
    session.flush()
    return row


def test_every_research_endpoint_requires_authentication(client):
    for path in (
        "/v1/intelligence/jobs",
        "/v1/intelligence/coverage",
        "/v1/intelligence/experiments",
    ):
        assert client.get(path).status_code == 401


def test_jobs_returns_an_envelope_and_explains_an_empty_state(client):
    response = client.get("/v1/intelligence/jobs", headers=AUTH)

    assert response.status_code == 200
    body = response.json()
    assert body["provenance"] == "unavailable"
    assert body["data"]["total"] == 0
    assert body["data"]["schedulerEnabled"] is False
    assert body["warnings"]


def test_jobs_lists_a_registered_job(client, session):
    session.add(
        IntelJobRow(
            name="insider_ingest",
            kind="ingest",
            schedule_seconds=3600,
            enabled=True,
            paused=False,
            status="idle",
            last_status="idle",
            last_error="",
            consecutive_failures=0,
            total_runs=3,
            total_failures=0,
            parameters={},
            metrics={"filingsNew": 12},
            created_at=datetime.now(tz=UTC),
            updated_at=datetime.now(tz=UTC),
        )
    )
    session.commit()

    body = client.get("/v1/intelligence/jobs", headers=AUTH).json()

    assert body["provenance"] == "live"
    assert body["data"]["total"] == 1
    assert body["data"]["items"][0]["name"] == "insider_ingest"
    assert body["data"]["items"][0]["metrics"]["filingsNew"] == 12


def test_coverage_reports_collection_state_and_identifier_health(client):
    response = client.get("/v1/intelligence/coverage", headers=AUTH)

    assert response.status_code == 200
    body = response.json()
    assert body["provenance"] == "unavailable"
    data = body["data"]
    assert data["filings"] == 0
    assert data["identifiers"]["distinctCusips"] == 0
    assert data["priceCoverage"]["symbolsWithSignals"] == 0
    assert data["backfill"] == []


def test_coverage_names_the_symbols_without_prices(client, session):
    _signal(session)
    session.commit()

    data = client.get("/v1/intelligence/coverage", headers=AUTH).json()["data"]

    assert data["signals"] == 1
    assert data["priceCoverage"]["symbolsWithSignals"] == 1
    assert data["priceCoverage"]["missing"] == ["AAPL"]


def test_experiments_is_empty_until_one_is_run(client):
    body = client.get("/v1/intelligence/experiments", headers=AUTH).json()

    assert body["provenance"] == "unavailable"
    assert body["data"]["total"] == 0
    assert "No research experiment" in body["warnings"][0]


def test_an_unknown_experiment_is_a_404(client):
    response = client.get(
        f"/v1/intelligence/experiments/{uuid.uuid4()}", headers=AUTH
    )
    assert response.status_code == 404


def test_a_malformed_experiment_id_is_rejected(client):
    # 422 is this engine's established status for a malformed identifier, the
    # same as the existing /signals/{id} route.
    response = client.get("/v1/intelligence/experiments/not-a-uuid", headers=AUTH)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "bad_request"


def test_an_unknown_signal_validation_is_a_404(client):
    response = client.get(
        f"/v1/intelligence/signals/{uuid.uuid4()}/validation", headers=AUTH
    )
    assert response.status_code == 404


def test_signal_validation_reports_the_category_and_flags_missing_prices(client, session):
    signal = _signal(session)
    session.commit()

    response = client.get(
        f"/v1/intelligence/signals/{signal.id}/validation", headers=AUTH
    )

    assert response.status_code == 200
    body = response.json()
    assert body["provenance"] == "unavailable"
    data = body["data"]
    assert data["signalId"] == str(signal.id)
    assert data["category"] == SignalCategory.INSIDER_PURCHASE_CLUSTER.value
    assert data["status"] == "no_price_data"
    assert data["sampleSize"] == 1
    assert any("historical measurements" in flag for flag in data["flags"])


def test_a_viewer_cannot_start_a_backfill(client):
    response = client.post(
        "/v1/intelligence/backfill", json={"ciks": ["0000320193"]}, headers=_viewer_headers()
    )
    assert response.status_code == 403


def test_an_admin_backfill_is_audited(client, monkeypatch):
    from wands.intelligence import research as research_module

    class StubRunner:
        def __init__(self, session, settings):
            pass

        def run(self, **kwargs):
            from wands.intelligence.backfill import BackfillResult

            result = BackfillResult()
            result.streams = 1
            result.completed = 1
            result.filings_seen = 4
            result.filings_new = 3
            return result

    monkeypatch.setattr(research_module, "BackfillRunner", StubRunner)

    response = client.post(
        "/v1/intelligence/backfill",
        json={"ciks": ["0000320193"], "formFamily": "ownership"},
        headers=_admin_headers(),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["provenance"] == "live"
    assert body["data"]["filingsNew"] == 3

    with __import__("wands.db.session", fromlist=["session_scope"]).session_scope() as session:
        events = session.scalars(
            select(AuditEvent).where(AuditEvent.action == "intelligence.backfill")
        ).all()
        assert len(events) == 1
        assert events[0].target == "0000320193"


def test_a_failed_backfill_is_reported_as_unavailable(client, monkeypatch):
    from wands.intelligence import research as research_module

    class StubRunner:
        def __init__(self, session, settings):
            pass

        def run(self, **kwargs):
            from wands.intelligence.backfill import BackfillResult

            result = BackfillResult()
            result.errors.append({"stage": "config", "message": "SEC is not configured."})
            return result

    monkeypatch.setattr(research_module, "BackfillRunner", StubRunner)

    response = client.post(
        "/v1/intelligence/backfill", json={}, headers=_admin_headers()
    )

    assert response.status_code == 200
    body = response.json()
    assert body["provenance"] == "unavailable"
    assert "SEC is not configured." in " ".join(body["warnings"])


def test_pausing_an_unknown_job_is_a_404(client):
    response = client.post(
        "/v1/intelligence/jobs/nope/pause", headers=_admin_headers()
    )
    assert response.status_code == 404


def test_a_viewer_cannot_pause_a_job(client):
    response = client.post(
        "/v1/intelligence/jobs/insider_ingest/pause", headers=_viewer_headers()
    )
    assert response.status_code == 403


def test_an_admin_can_pause_and_resume_a_job(client, session):
    session.add(
        IntelJobRow(
            name="insider_ingest",
            kind="ingest",
            schedule_seconds=3600,
            enabled=True,
            paused=False,
            status="idle",
            last_status="idle",
            last_error="",
            consecutive_failures=0,
            total_runs=0,
            total_failures=0,
            parameters={},
            metrics={},
            created_at=datetime.now(tz=UTC),
            updated_at=datetime.now(tz=UTC),
        )
    )
    session.commit()

    headers = _admin_headers()
    paused = client.post("/v1/intelligence/jobs/insider_ingest/pause", headers=headers)
    assert paused.status_code == 200
    assert paused.json()["data"]["paused"] is True

    resumed = client.post("/v1/intelligence/jobs/insider_ingest/resume", headers=headers)
    assert resumed.status_code == 200
    assert resumed.json()["data"]["paused"] is False


def test_the_research_endpoints_are_read_only_except_for_the_admin_ones():
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
        ("/intelligence/quant-lab/run", "POST"),
    }
