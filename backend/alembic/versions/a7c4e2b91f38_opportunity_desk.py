"""opportunity desk research records

Revision ID: a7c4e2b91f38
Revises: f1a2b3c4d5e6
Create Date: 2026-11-08

Adds the three tables the Opportunity Desk needs: the candidates the rule
produced, the founder's manual decision about each one, and the paper tests
recorded against them.

The migration is additive. It creates tables and indexes and touches nothing
that already exists, so it can be applied without affecting the Performance Lab,
Quant Lab or any trading table. The downgrade drops only what this revision
created.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "a7c4e2b91f38"
down_revision: str | None = "f1a2b3c4d5e6"
branch_labels = None
depends_on = None

MONEY = sa.Numeric(precision=20, scale=8)


def upgrade() -> None:
    op.create_table(
        "opp_candidates",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("symbol", sa.String(length=32), nullable=False),
        sa.Column("market_type", sa.String(length=16), nullable=False),
        sa.Column("strategy_key", sa.String(length=64), nullable=False),
        sa.Column("strategy_version", sa.Integer(), nullable=False),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("reference_price", MONEY, nullable=False),
        sa.Column("invalidation_price", MONEY, nullable=False),
        sa.Column("target_price", MONEY, nullable=False),
        sa.Column("range_high", MONEY, nullable=False),
        sa.Column("volume_ratio", sa.Numeric(precision=12, scale=6), nullable=False),
        sa.Column("breakout_margin", sa.Numeric(precision=12, scale=10), nullable=False),
        sa.Column("why_qualified", sa.Text(), nullable=False),
        sa.Column("entry_condition", sa.Text(), nullable=False),
        sa.Column("invalidation_condition", sa.Text(), nullable=False),
        sa.Column("exit_condition", sa.Text(), nullable=False),
        sa.Column("max_holding_hours", sa.Integer(), nullable=False),
        sa.Column("quantity", MONEY, nullable=True),
        sa.Column("notional", MONEY, nullable=True),
        sa.Column("risk_at_stop", MONEY, nullable=True),
        sa.Column("binding_constraint", sa.String(length=48), nullable=False),
        sa.Column("rejected_reason", sa.Text(), nullable=True),
        sa.Column("fee_bps", sa.Numeric(precision=8, scale=4), nullable=False),
        sa.Column("slippage_bps", sa.Numeric(precision=8, scale=4), nullable=False),
        sa.Column("data_fresh", sa.Boolean(), nullable=False),
        sa.Column("data_age_seconds", sa.Numeric(precision=14, scale=3), nullable=True),
        sa.Column("data_warnings", sa.JSON(), nullable=False),
        sa.Column("rank_reason", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_opp_candidates_symbol_observed",
        "opp_candidates",
        ["symbol", "observed_at"],
    )

    op.create_table(
        "opp_decisions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "candidate_id",
            sa.Uuid(),
            sa.ForeignKey("opp_candidates.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("decision", sa.String(length=24), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_opp_decisions_candidate",
        "opp_decisions",
        ["candidate_id", "decided_at"],
    )

    op.create_table(
        "opp_paper_tests",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "candidate_id",
            sa.Uuid(),
            sa.ForeignKey("opp_candidates.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("symbol", sa.String(length=32), nullable=False),
        sa.Column("market_type", sa.String(length=16), nullable=False),
        sa.Column("strategy_key", sa.String(length=64), nullable=False),
        sa.Column("strategy_version", sa.Integer(), nullable=False),
        sa.Column("reference_price", MONEY, nullable=False),
        sa.Column("invalidation_price", MONEY, nullable=False),
        sa.Column("target_price", MONEY, nullable=False),
        sa.Column("quantity", MONEY, nullable=False),
        sa.Column("fee_bps", sa.Numeric(precision=8, scale=4), nullable=False),
        sa.Column("slippage_bps", sa.Numeric(precision=8, scale=4), nullable=False),
        sa.Column("opened_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deadline", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("exit_reason", sa.Text(), nullable=True),
        sa.Column("entry_price", MONEY, nullable=True),
        sa.Column("exit_price", MONEY, nullable=True),
        sa.Column("exit_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("holding_seconds", sa.Numeric(precision=14, scale=3), nullable=True),
        sa.Column("gross_return", MONEY, nullable=True),
        sa.Column("fees", MONEY, nullable=True),
        sa.Column("slippage", MONEY, nullable=True),
        sa.Column("net_return", MONEY, nullable=True),
        sa.Column("drawdown", sa.Numeric(precision=20, scale=10), nullable=True),
        sa.Column("notes", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_opp_paper_tests_status",
        "opp_paper_tests",
        ["status", "deadline"],
    )


def downgrade() -> None:
    op.drop_index("ix_opp_paper_tests_status", table_name="opp_paper_tests")
    op.drop_table("opp_paper_tests")
    op.drop_index("ix_opp_decisions_candidate", table_name="opp_decisions")
    op.drop_table("opp_decisions")
    op.drop_index("ix_opp_candidates_symbol_observed", table_name="opp_candidates")
    op.drop_table("opp_candidates")
