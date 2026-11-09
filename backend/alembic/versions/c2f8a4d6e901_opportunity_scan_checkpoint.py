"""Durable, fenced opportunity scan checkpoint; no trading tables are changed.

A separate singleton prevents SEC job recovery/scheduling from modifying scans.
Candidate writes and cursor advancement commit together, surviving response loss.
"""

import sqlalchemy as sa

from alembic import op

revision = "c2f8a4d6e901"
down_revision = "b8d3f5a1c927"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "opp_scan_state",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("state", sa.JSON(), nullable=False),
        sa.Column("lease_owner", sa.String(36), nullable=True),
        sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("next_batch_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.bulk_insert(
        sa.table("opp_scan_state", sa.column("id", sa.Integer()), sa.column("state", sa.JSON())),
        [{"id": 1, "state": {}}],
    )


def downgrade() -> None:
    op.drop_table("opp_scan_state")
