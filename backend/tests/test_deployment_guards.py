"""Guards that stop a misconfigured host from starting healthy and wrong."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from wands.config import Settings
from wands.main import create_app


def _settings(**overrides) -> Settings:
    base = {
        "database_url": "sqlite://",
        "live_trading_enabled": False,
        "market_data_worker_enabled": False,
        "intelligence_jobs_enabled": False,
        # Pinned so the suite-wide ingestion switch cannot leak in and make
        # these guards assert against the wrong starting state.
        "intelligence_ingest_enabled": False,
        "sec_user_agent": "wands-research/0.1 (research; contact: ops@example.com)",
    }
    base.update(overrides)
    return Settings(**base)


def test_production_refuses_to_start_on_sqlite():
    """A production host on SQLite would create an empty database and serve it."""
    app = create_app(_settings(environment="production"))

    with pytest.raises(RuntimeError, match="SQLite in production"):
        with TestClient(app):
            pass


def test_development_may_start_on_sqlite():
    app = create_app(_settings(environment="development"))

    with TestClient(app) as client:
        assert client.get("/healthz").status_code == 200


def test_placeholder_sec_contact_is_allowed_while_ingestion_is_off():
    """The shipped placeholder is fine as long as nothing is being collected."""
    settings = _settings()
    assert settings.intelligence_ingest_enabled is False
    assert "example.com" in settings.sec_user_agent


def test_placeholder_sec_contact_blocks_enabling_ingestion():
    with pytest.raises(ValueError, match="placeholder contact"):
        _settings(intelligence_ingest_enabled=True)


def test_sec_contact_without_an_email_blocks_enabling_ingestion():
    with pytest.raises(ValueError, match="contact email"):
        _settings(
            intelligence_ingest_enabled=True,
            sec_user_agent="wands-research/0.1 (research)",
        )


def test_real_sec_contact_allows_enabling_ingestion():
    settings = _settings(
        intelligence_ingest_enabled=True,
        sec_user_agent="wands-research/0.1 (ops@wands.internal)",
    )
    assert settings.intelligence_ingest_enabled is True
