"""index institutional holdings by filer and quarter

Revision ID: b8d3f5a1c927
Revises: a7c4e2b91f38
Create Date: 2026-11-09

Every read of a filer's holdings filters on ``institution_id`` and
``period_of_report``. The table carried indexes on ``period_of_report`` and
``cusip`` but none on ``institution_id``, so each of those reads was a
sequential scan of the whole holdings table. The institutional feed issued one
such read per filer per request, which is why its latency grew with the number
of filers.

The composite index matches the equality predicates in the order they are
applied. ``accepted_at`` is deliberately not a third column: it is a range
predicate and the query returns every column, so a covering index would not
avoid the heap access that dominates the read.

This is an additive index build, not a table rewrite. On a table large enough
for the build to hold a lock for a noticeable time, run it with
``CREATE INDEX CONCURRENTLY`` outside a transaction instead.
"""

from __future__ import annotations

from alembic import op

revision: str = "b8d3f5a1c927"
down_revision: str | None = "a7c4e2b91f38"
branch_labels = None
depends_on = None

INDEX_NAME = "ix_intel_institutional_holdings_institution_period"


def upgrade() -> None:
    op.create_index(
        INDEX_NAME,
        "intel_institutional_holdings",
        ["institution_id", "period_of_report"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(INDEX_NAME, table_name="intel_institutional_holdings")
