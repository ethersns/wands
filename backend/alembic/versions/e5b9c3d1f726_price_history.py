"""price history adjustment and coverage

Revision ID: e5b9c3d1f726
Revises: d4a7b2c9e815
Create Date: 2026-11-07

Adds the adjustment label to stored bars and a coverage table that records what
a historical collection run actually obtained. A gap becomes a stored fact with
a retrieval timestamp instead of an inference made at read time.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "e5b9c3d1f726"
down_revision: str | None = "d4a7b2c9e815"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "market_candles",
        sa.Column("adjustment", sa.String(length=32), nullable=True),
    )
    op.create_table(
        "market_price_coverage",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("symbol", sa.String(length=32), nullable=False),
        sa.Column("interval", sa.String(length=8), nullable=False, server_default="1d"),
        sa.Column("window_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("window_end", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expected_days", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("stored_days", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("missing_days", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("missing_dates", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="empty"),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.Column("retrieved_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "provider",
            "symbol",
            "interval",
            "window_start",
            "window_end",
            name="uq_market_price_coverage_window",
        ),
    )
    op.create_index(
        "ix_market_price_coverage_symbol",
        "market_price_coverage",
        ["symbol", "interval"],
    )


def downgrade() -> None:
    op.drop_index("ix_market_price_coverage_symbol", table_name="market_price_coverage")
    op.drop_table("market_price_coverage")
    op.drop_column("market_candles", "adjustment")
