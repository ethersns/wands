"""The new additive migration is exercised only on an in-memory database."""

import importlib.util
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect, text


def test_scanner_checkpoint_migration_round_trip():
    path = Path(__file__).parents[1] / "alembic/versions/c2f8a4d6e901_opportunity_scan_checkpoint.py"
    spec = importlib.util.spec_from_file_location("scanner_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        module.op = Operations(MigrationContext.configure(connection))
        module.upgrade()
        assert "opp_scan_state" in inspect(connection).get_table_names()
        assert connection.execute(text("SELECT id FROM opp_scan_state")).scalar_one() == 1
        module.downgrade()
        assert "opp_scan_state" not in inspect(connection).get_table_names()
        module.upgrade()
        assert connection.execute(text("SELECT id FROM opp_scan_state")).scalar_one() == 1
