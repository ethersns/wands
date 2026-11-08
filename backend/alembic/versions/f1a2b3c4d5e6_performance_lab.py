"""performance lab evidence capture

Revision ID: f1a2b3c4d5e6
Revises: e5b9c3d1f726
Create Date: 2026-11-07

Adds the tables the Performance Lab needs to capture evidence before the outcome
is known: frozen strategy versions, append-only recorded signals, append-only
evaluations, immutable evidence records, an audit trail and the evaluation queue.

The append-only tables carry a content hash so a later reader can tell whether a
row still says what it said when it was written. That is tamper-evidence, not a
third-party audit, and the API says so.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "f1a2b3c4d5e6"
down_revision: str | None = "e5b9c3d1f726"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "perf_strategy_versions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("strategy_key", sa.String(length=64), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("signal_version", sa.String(length=64), nullable=False),
        sa.Column("parameters", sa.JSON(), nullable=False),
        sa.Column("definition_hash", sa.String(length=64), nullable=False),
        sa.Column("frozen", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "strategy_key", "version", name="uq_perf_strategy_versions_key_version"
        ),
        sa.UniqueConstraint(
            "strategy_key",
            "definition_hash",
            name="uq_perf_strategy_versions_key_hash",
        ),
    )
    op.create_index(
        "ix_perf_strategy_versions_key",
        "perf_strategy_versions",
        ["strategy_key", "version"],
    )

    op.create_table(
        "perf_recorded_signals",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("signal_key", sa.String(length=200), nullable=False),
        sa.Column(
            "strategy_version_id",
            sa.Uuid(),
            sa.ForeignKey("perf_strategy_versions.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("symbol", sa.String(length=32), nullable=False),
        sa.Column("asset_class", sa.String(length=16), nullable=False),
        sa.Column("direction", sa.String(length=8), nullable=False),
        sa.Column("timeframe", sa.String(length=16), nullable=False),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("reference_price", sa.Numeric(20, 8), nullable=True),
        sa.Column("reference_price_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("confidence", sa.Numeric(6, 4), nullable=True),
        sa.Column("data_source", sa.String(length=64), nullable=False),
        sa.Column("data_freshness_seconds", sa.Integer(), nullable=True),
        sa.Column("conditions", sa.JSON(), nullable=False),
        sa.Column("risk_parameters", sa.JSON(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("model_metadata", sa.JSON(), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("signal_key", name="uq_perf_recorded_signals_signal_key"),
    )
    op.create_index(
        "ix_perf_recorded_signals_symbol",
        "perf_recorded_signals",
        ["symbol", "generated_at"],
    )
    op.create_index(
        "ix_perf_recorded_signals_generated",
        "perf_recorded_signals",
        ["generated_at"],
    )

    op.create_table(
        "perf_signal_evaluations",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "signal_id",
            sa.Uuid(),
            sa.ForeignKey("perf_recorded_signals.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("horizon_label", sa.String(length=16), nullable=False),
        sa.Column("horizon_days", sa.Integer(), nullable=False),
        sa.Column("eligible_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("evaluated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("entry_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("entry_price", sa.Numeric(20, 8), nullable=True),
        sa.Column("exit_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("exit_price", sa.Numeric(20, 8), nullable=True),
        sa.Column("gross_return", sa.Numeric(20, 10), nullable=True),
        sa.Column("net_return", sa.Numeric(20, 10), nullable=True),
        sa.Column("benchmark_return", sa.Numeric(20, 10), nullable=True),
        sa.Column("excess_return", sa.Numeric(20, 10), nullable=True),
        sa.Column("direction_correct", sa.Boolean(), nullable=True),
        sa.Column("cost_bps", sa.Numeric(10, 4), nullable=False),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "signal_id",
            "horizon_label",
            name="uq_perf_signal_evaluations_signal_horizon",
        ),
    )
    op.create_index(
        "ix_perf_signal_evaluations_status",
        "perf_signal_evaluations",
        ["status", "eligible_at"],
    )

    op.create_table(
        "perf_evidence_records",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("run_id", sa.String(length=64), nullable=False),
        sa.Column("kind", sa.String(length=24), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("objective", sa.Text(), nullable=False),
        sa.Column(
            "strategy_version_id",
            sa.Uuid(),
            sa.ForeignKey("perf_strategy_versions.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.Column("dataset", sa.JSON(), nullable=False),
        sa.Column("assumptions", sa.JSON(), nullable=False),
        sa.Column("results", sa.JSON(), nullable=False),
        sa.Column("limitations", sa.JSON(), nullable=False),
        sa.Column("conclusion", sa.Text(), nullable=True),
        sa.Column("integrity_hash", sa.String(length=64), nullable=False),
        sa.Column("finalized_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("run_id", name="uq_perf_evidence_records_run_id"),
    )
    op.create_index(
        "ix_perf_evidence_records_kind",
        "perf_evidence_records",
        ["kind", "created_at"],
    )

    op.create_table(
        "perf_audit_events",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("actor", sa.String(length=160), nullable=False),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("subject_type", sa.String(length=48), nullable=False),
        sa.Column("subject_id", sa.String(length=64), nullable=False),
        sa.Column("detail", sa.JSON(), nullable=False),
    )
    op.create_index(
        "ix_perf_audit_events_subject",
        "perf_audit_events",
        ["subject_type", "subject_id"],
    )
    op.create_index("ix_perf_audit_events_at", "perf_audit_events", ["occurred_at"])

    op.create_table(
        "perf_evaluation_jobs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "signal_id",
            sa.Uuid(),
            sa.ForeignKey("perf_recorded_signals.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("horizon_label", sa.String(length=16), nullable=False),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="pending"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "signal_id", "horizon_label", name="uq_perf_evaluation_jobs_signal_horizon"
        ),
    )
    op.create_index(
        "ix_perf_evaluation_jobs_due",
        "perf_evaluation_jobs",
        ["status", "due_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_perf_evaluation_jobs_due", table_name="perf_evaluation_jobs")
    op.drop_table("perf_evaluation_jobs")
    op.drop_index("ix_perf_audit_events_at", table_name="perf_audit_events")
    op.drop_index("ix_perf_audit_events_subject", table_name="perf_audit_events")
    op.drop_table("perf_audit_events")
    op.drop_index("ix_perf_evidence_records_kind", table_name="perf_evidence_records")
    op.drop_table("perf_evidence_records")
    op.drop_index("ix_perf_signal_evaluations_status", table_name="perf_signal_evaluations")
    op.drop_table("perf_signal_evaluations")
    op.drop_index("ix_perf_recorded_signals_generated", table_name="perf_recorded_signals")
    op.drop_index("ix_perf_recorded_signals_symbol", table_name="perf_recorded_signals")
    op.drop_table("perf_recorded_signals")
    op.drop_index("ix_perf_strategy_versions_key", table_name="perf_strategy_versions")
    op.drop_table("perf_strategy_versions")
