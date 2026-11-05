"""intelligence v1: SEC ownership filings, 13F holdings and research signals

Additive only. Nothing in this revision touches the order, position, risk or
portfolio tables, so an existing deployment upgrades in place and the execution
path is unchanged.

Revision ID: 9b4e2c7d1a05
Revises: 7c1d4a9e2b30
Create Date: 2026-11-05 23:40:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "9b4e2c7d1a05"
down_revision: str | None = "7c1d4a9e2b30"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

MONEY = sa.Numeric(precision=20, scale=8)
PERCENT = sa.Numeric(precision=6, scale=3)


def upgrade() -> None:
    op.create_table(
        "intel_filings",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("accession_number", sa.String(length=32), nullable=False),
        sa.Column("form_type", sa.String(length=16), nullable=False),
        sa.Column("document_type", sa.String(length=8), nullable=False, server_default=""),
        sa.Column("issuer_cik", sa.String(length=16), nullable=False, server_default=""),
        sa.Column("issuer_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("symbol", sa.String(length=32), nullable=False, server_default=""),
        sa.Column("period_of_report", sa.DateTime(timezone=True), nullable=True),
        sa.Column("filed_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("source_url", sa.Text(), nullable=False, server_default=""),
        sa.Column("source", sa.String(length=32), nullable=False, server_default="sec_edgar"),
        sa.Column("is_amendment", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("amends_accession", sa.String(length=32), nullable=True),
        sa.Column("original_submission_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("raw_sha256", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("ingested_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("accession_number", name="uq_intel_filings_accession"),
    )
    op.create_index("ix_intel_filings_symbol_accepted", "intel_filings", ["symbol", "accepted_at"])
    op.create_index("ix_intel_filings_accepted", "intel_filings", ["accepted_at"])

    op.create_table(
        "intel_insider_transactions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "filing_id",
            sa.Uuid(),
            sa.ForeignKey("intel_filings.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("accession_number", sa.String(length=32), nullable=False),
        sa.Column("symbol", sa.String(length=32), nullable=False, server_default=""),
        sa.Column("issuer_cik", sa.String(length=16), nullable=False, server_default=""),
        sa.Column("issuer_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("reporting_person_cik", sa.String(length=16), nullable=False, server_default=""),
        sa.Column("reporting_person_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("is_director", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_officer", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "is_ten_percent_owner", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        sa.Column("officer_title", sa.String(length=120), nullable=False, server_default=""),
        sa.Column(
            "table_kind", sa.String(length=16), nullable=False, server_default="non_derivative"
        ),
        sa.Column("ordinal", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("security_title", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("transaction_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("transaction_code", sa.String(length=4), nullable=False, server_default=""),
        sa.Column("acquired_disposed", sa.String(length=1), nullable=False, server_default=""),
        sa.Column("shares", MONEY, nullable=True),
        sa.Column("price_per_share", MONEY, nullable=True),
        sa.Column("value", MONEY, nullable=True),
        sa.Column("shares_owned_after", MONEY, nullable=True),
        sa.Column("direct_or_indirect", sa.String(length=1), nullable=False, server_default=""),
        sa.Column("nature_of_ownership", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("classification", sa.String(length=32), nullable=False, server_default="other"),
        sa.Column("is_open_market", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_derivative", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("footnote_ids", sa.JSON(), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("is_amendment", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("source_url", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "accession_number",
            "reporting_person_cik",
            "table_kind",
            "ordinal",
            name="uq_intel_insider_tx_line",
        ),
    )
    op.create_index(
        "ix_intel_insider_tx_symbol_date",
        "intel_insider_transactions",
        ["symbol", "transaction_date"],
    )
    op.create_index(
        "ix_intel_insider_tx_class", "intel_insider_transactions", ["classification"]
    )

    op.create_table(
        "intel_institutions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("cik", sa.String(length=16), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("cik", name="uq_intel_institutions_cik"),
    )

    op.create_table(
        "intel_institutional_holdings",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "institution_id",
            sa.Uuid(),
            sa.ForeignKey("intel_institutions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("accession_number", sa.String(length=32), nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("period_of_report", sa.DateTime(timezone=True), nullable=False),
        sa.Column("filed_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("cusip", sa.String(length=16), nullable=False, server_default=""),
        sa.Column("issuer_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("class_title", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("value_usd", MONEY, nullable=True),
        sa.Column("shares", MONEY, nullable=True),
        sa.Column("share_type", sa.String(length=16), nullable=False, server_default="SH"),
        sa.Column("put_call", sa.String(length=8), nullable=False, server_default=""),
        sa.Column(
            "investment_discretion", sa.String(length=32), nullable=False, server_default=""
        ),
        sa.Column("voting_sole", MONEY, nullable=True),
        sa.Column("voting_shared", MONEY, nullable=True),
        sa.Column("voting_none", MONEY, nullable=True),
        sa.Column("is_amendment", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("source_url", sa.Text(), nullable=False, server_default=""),
        sa.Column("ingested_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "accession_number", "ordinal", name="uq_intel_institutional_holding_line"
        ),
    )
    op.create_index(
        "ix_intel_institutional_holdings_period",
        "intel_institutional_holdings",
        ["period_of_report"],
    )
    op.create_index(
        "ix_intel_institutional_holdings_cusip", "intel_institutional_holdings", ["cusip"]
    )

    op.create_table(
        "intel_signals",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("signal_key", sa.String(length=64), nullable=False),
        sa.Column("category", sa.String(length=48), nullable=False),
        sa.Column("symbol", sa.String(length=32), nullable=False, server_default=""),
        sa.Column("source_event_ids", sa.JSON(), nullable=False),
        sa.Column("event_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("public_available_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("calculated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("raw_measurement", MONEY, nullable=False, server_default="0"),
        sa.Column("raw_unit", sa.String(length=32), nullable=False, server_default=""),
        sa.Column("score", PERCENT, nullable=True),
        sa.Column("explanation", sa.Text(), nullable=False, server_default=""),
        sa.Column("data_quality", sa.String(length=16), nullable=False, server_default="reported"),
        sa.Column("confidence_notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("parameters", sa.JSON(), nullable=False),
        sa.Column("engine_version", sa.String(length=16), nullable=False, server_default="1.0"),
        sa.UniqueConstraint("signal_key", name="uq_intel_signals_key"),
    )
    op.create_index(
        "ix_intel_signals_symbol_available", "intel_signals", ["symbol", "public_available_at"]
    )
    op.create_index("ix_intel_signals_category", "intel_signals", ["category"])

    op.create_table(
        "intel_ingest_runs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("source", sa.String(length=32), nullable=False, server_default="sec_edgar"),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="running"),
        sa.Column("filings_seen", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("filings_new", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("transactions_new", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("signals_new", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("errors", sa.JSON(), nullable=False),
        sa.Column("detail", sa.JSON(), nullable=False),
    )
    op.create_index("ix_intel_ingest_runs_started", "intel_ingest_runs", ["started_at"])


def downgrade() -> None:
    op.drop_index("ix_intel_ingest_runs_started", table_name="intel_ingest_runs")
    op.drop_table("intel_ingest_runs")

    op.drop_index("ix_intel_signals_category", table_name="intel_signals")
    op.drop_index("ix_intel_signals_symbol_available", table_name="intel_signals")
    op.drop_table("intel_signals")

    op.drop_index(
        "ix_intel_institutional_holdings_cusip", table_name="intel_institutional_holdings"
    )
    op.drop_index(
        "ix_intel_institutional_holdings_period", table_name="intel_institutional_holdings"
    )
    op.drop_table("intel_institutional_holdings")

    op.drop_table("intel_institutions")

    op.drop_index("ix_intel_insider_tx_class", table_name="intel_insider_transactions")
    op.drop_index("ix_intel_insider_tx_symbol_date", table_name="intel_insider_transactions")
    op.drop_table("intel_insider_transactions")

    op.drop_index("ix_intel_filings_accepted", table_name="intel_filings")
    op.drop_index("ix_intel_filings_symbol_accepted", table_name="intel_filings")
    op.drop_table("intel_filings")
