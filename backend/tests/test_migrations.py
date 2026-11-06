"""Migration reliability.

Runs the real Alembic chain against a throwaway database: upgrade, downgrade to
base, upgrade again. A migration that cannot be reversed fails here rather than
during an incident.
"""

from __future__ import annotations

from pathlib import Path

from alembic.config import Config
from sqlalchemy import create_engine, inspect

from alembic import command

BACKEND_ROOT = Path(__file__).resolve().parents[1]


def _config(url: str) -> Config:
    config = Config(str(BACKEND_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_ROOT / "alembic"))
    config.set_main_option("sqlalchemy.url", url)
    return config


def test_upgrade_downgrade_upgrade(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path / 'migrations.db'}"
    monkeypatch.setenv("WANDS_DATABASE_URL", url)

    from wands.config import reset_settings_cache

    reset_settings_cache()
    try:
        config = _config(url)
        command.upgrade(config, "head")

        engine = create_engine(url)
        tables = set(inspect(engine).get_table_names())
        assert {"orders", "positions", "risk_policies", "engine_state", "audit_events"} <= tables
        assert {
            "intel_filings",
            "intel_insider_transactions",
            "intel_institutions",
            "intel_institutional_holdings",
            "intel_signals",
            "intel_ingest_runs",
        } <= tables
        # Intelligence 1.1: research state that has to survive a restart.
        assert {
            "intel_backfill_checkpoints",
            "intel_security_identifiers",
            "intel_jobs",
            "intel_job_failures",
            "intel_experiments",
            "intel_signal_outcomes",
        } <= tables
        engine.dispose()

        command.downgrade(config, "base")
        engine = create_engine(url)
        remaining = set(inspect(engine).get_table_names()) - {"alembic_version"}
        assert remaining == set(), f"downgrade left tables behind: {remaining}"
        engine.dispose()

        command.upgrade(config, "head")
        engine = create_engine(url)
        assert "orders" in inspect(engine).get_table_names()
        engine.dispose()
    finally:
        monkeypatch.undo()
        reset_settings_cache()


def test_orders_client_order_id_is_unique_in_the_migrated_schema(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path / 'unique.db'}"
    monkeypatch.setenv("WANDS_DATABASE_URL", url)

    from wands.config import reset_settings_cache

    reset_settings_cache()
    try:
        command.upgrade(_config(url), "head")
        engine = create_engine(url)
        inspector = inspect(engine)
        unique = inspector.get_unique_constraints("orders")
        assert any(constraint["column_names"] == ["client_order_id"] for constraint in unique), (
            "orders.client_order_id must be unique at the database level"
        )
        engine.dispose()
    finally:
        monkeypatch.undo()
        reset_settings_cache()
