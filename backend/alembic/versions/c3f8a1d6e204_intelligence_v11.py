"""intelligence v1.1: backfill cursors, identifier history, jobs, experiments

Additive only. Nothing here touches the order, position, risk or portfolio
tables, so an existing deployment upgrades in place and the execution path is
unchanged. Every new table is research state: how far a crawl got, which ticker
a CUSIP meant on a given day, whether a collector is running, and what an
experiment measured.

Revision ID: c3f8a1d6e204
Revises: 9b4e2c7d1a05
Create Date: 2026-11-05 23:55:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "c3f8a1d6e204"
down_revision: str | None = "9b4e2c7d1a05"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

MONEY = sa.Numeric(precision=20, scale=8)
PERCENT = sa.Numeric(precision=6, scale=3)


def upgrade() -> None:
    op.create_table(
        "intel_backfill_checkpoints",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("source", sa.String(length=32), nullable=False, server_default="sec_edgar"),
        sa.Column("issuer_cik", sa.String(length=16), nullable=False),
        sa.Column("form_family", sa.String(length=16), nullable=False, server_default="ownership"),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="pending"),
        sa.Column("cursor_accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cursor_accession", sa.String(length=32), nullable=True),
        sa.Column("window_start", sa.DateTime(timezone=True), nullable=True),
        sa.Column("window_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column("filings_seen", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("filings_new", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("filings_skipped", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("filings_unavailable", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("filings_malformed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.Text(), nullable=False, server_default=""),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint(
            "source", "issuer_cik", "form_family", name="uq_intel_backfill_stream"
        ),
    )
    op.create_index("ix_intel_backfill_status", "intel_backfill_checkpoints", ["status"])

    op.create_table(
        "intel_security_identifiers",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("cusip", sa.String(length=16), nullable=False),
        sa.Column("symbol", sa.String(length=32), nullable=False, server_default=""),
        sa.Column("issuer_cik", sa.String(length=16), nullable=False, server_default=""),
        sa.Column("issuer_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column(
            "security_description", sa.String(length=255), nullable=False, server_default=""
        ),
        sa.Column("share_class", sa.String(length=32), nullable=False, server_default=""),
        sa.Column("effective_from", sa.DateTime(timezone=True), nullable=False),
        sa.Column("effective_to", sa.DateTime(timezone=True), nullable=True),
        sa.Column("source", sa.String(length=48), nullable=False, server_default=""),
        sa.Column(
            "verification_status", sa.String(length=16), nullable=False, server_default="unresolved"
        ),
        sa.Column("confidence", PERCENT, nullable=False, server_default="0"),
        sa.Column("is_primary", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "cusip", "effective_from", "source", name="uq_intel_identifiers_version"
        ),
    )
    op.create_index(
        "ix_intel_identifiers_cusip_effective",
        "intel_security_identifiers",
        ["cusip", "effective_from"],
    )
    op.create_index("ix_intel_identifiers_symbol", "intel_security_identifiers", ["symbol"])
    op.create_index(
        "ix_intel_identifiers_status", "intel_security_identifiers", ["verification_status"]
    )

    op.create_table(
        "intel_jobs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False, server_default="ingest"),
        sa.Column("schedule_seconds", sa.Integer(), nullable=False, server_default="3600"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("paused", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="idle"),
        sa.Column("last_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_status", sa.String(length=16), nullable=False, server_default=""),
        sa.Column("last_error", sa.Text(), nullable=False, server_default=""),
        sa.Column("next_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("consecutive_failures", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_runs", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_failures", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("lease_owner", sa.String(length=64), nullable=True),
        sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("parameters", sa.JSON(), nullable=False),
        sa.Column("metrics", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("name", name="uq_intel_jobs_name"),
    )
    op.create_index("ix_intel_jobs_next_run", "intel_jobs", ["next_run_at"])

    op.create_table(
        "intel_job_failures",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("job_name", sa.String(length=64), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("attempt", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("error_type", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("message", sa.Text(), nullable=False, server_default=""),
        sa.Column("context", sa.JSON(), nullable=False),
    )
    op.create_index(
        "ix_intel_job_failures_job", "intel_job_failures", ["job_name", "occurred_at"]
    )

    op.create_table(
        "intel_experiments",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("name", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("signal_version", sa.String(length=32), nullable=False, server_default=""),
        sa.Column("data_version", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("period_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("period_end", sa.DateTime(timezone=True), nullable=False),
        sa.Column("information_cutoff", sa.DateTime(timezone=True), nullable=False),
        sa.Column("benchmark", sa.String(length=32), nullable=False, server_default=""),
        sa.Column("parameters", sa.JSON(), nullable=False),
        sa.Column("execution_assumptions", sa.JSON(), nullable=False),
        sa.Column("cost_assumptions", sa.JSON(), nullable=False),
        sa.Column("sample_size", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("coverage", sa.JSON(), nullable=False),
        sa.Column("metrics", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="complete"),
        sa.Column("flags", sa.JSON(), nullable=False),
        sa.Column("definition_hash", sa.String(length=64), nullable=False),
        sa.Column("data_fingerprint", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("definition_hash", name="uq_intel_experiments_definition"),
    )
    op.create_index("ix_intel_experiments_created", "intel_experiments", ["created_at"])

    op.create_table(
        "intel_signal_outcomes",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "experiment_id",
            sa.Uuid(),
            sa.ForeignKey("intel_experiments.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "signal_id",
            sa.Uuid(),
            sa.ForeignKey("intel_signals.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("symbol", sa.String(length=32), nullable=False, server_default=""),
        sa.Column("horizon_days", sa.Integer(), nullable=False),
        sa.Column("entry_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("entry_price", MONEY, nullable=True),
        sa.Column("exit_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("exit_price", MONEY, nullable=True),
        sa.Column("gross_return", PERCENT, nullable=True),
        sa.Column("benchmark_return", PERCENT, nullable=True),
        sa.Column("net_return", PERCENT, nullable=True),
        sa.Column("cost_bps", PERCENT, nullable=False, server_default="0"),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="ok"),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.UniqueConstraint(
            "experiment_id", "signal_id", "horizon_days", name="uq_intel_signal_outcome"
        ),
    )
    op.create_index(
        "ix_intel_signal_outcomes_signal", "intel_signal_outcomes", ["signal_id"]
    )
    op.create_index(
        "ix_intel_signal_outcomes_experiment", "intel_signal_outcomes", ["experiment_id"]
    )


def downgrade() -> None:
    op.drop_table("intel_signal_outcomes")
    op.drop_table("intel_experiments")
    op.drop_table("intel_job_failures")
    op.drop_table("intel_jobs")
    op.drop_table("intel_security_identifiers")
    op.drop_table("intel_backfill_checkpoints")
