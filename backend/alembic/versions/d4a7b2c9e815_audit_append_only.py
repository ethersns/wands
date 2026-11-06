"""audit integrity: make audit_events append-only in the database

The application has no update or delete path for audit rows, but that is a
property of the code, not of the data. A trigger closes the gap for anyone
holding a database connection: a trail that can be edited after the fact is not
an audit trail. Retention must be handled by archiving rows out, never by
deleting them in place.

PostgreSQL only. SQLite is a test backend and has no portable equivalent, so the
guard is skipped there rather than silently approximated.

Revision ID: d4a7b2c9e815
Revises: c3f8a1d6e204
Create Date: 2026-11-06 12:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "d4a7b2c9e815"
down_revision: str | None = "c3f8a1d6e204"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_FUNCTION = """
CREATE OR REPLACE FUNCTION wands_audit_events_immutable()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_events is append-only (attempted %)', TG_OP;
END;
$$ LANGUAGE plpgsql;
"""

_TRIGGER = """
CREATE TRIGGER audit_events_append_only
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION wands_audit_events_immutable();
"""


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute(_FUNCTION)
    op.execute(_TRIGGER)


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute("DROP TRIGGER IF EXISTS audit_events_append_only ON audit_events;")
    op.execute("DROP FUNCTION IF EXISTS wands_audit_events_immutable();")
