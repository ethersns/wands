"""phase 3: market data, portfolio accounting and paper accounts

Additive only. The Phase 2 revision is left untouched so an existing deployment
can upgrade in place without rewriting history.

Revision ID: 7c1d4a9e2b30
Revises: 30aab3f55099
Create Date: 2026-11-05 23:10:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "7c1d4a9e2b30"
down_revision: str | None = "30aab3f55099"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

MONEY = sa.Numeric(precision=20, scale=8)
PERCENT = sa.Numeric(precision=6, scale=3)
RATE = sa.Numeric(precision=20, scale=10)


def upgrade() -> None:
    with op.batch_alter_table("positions", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "source",
                sa.String(length=24),
                nullable=False,
                server_default="paper_simulated",
            )
        )

    op.create_table(
        "market_candles",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("symbol", sa.String(length=32), nullable=False),
        sa.Column("market_type", sa.String(length=16), nullable=False),
        sa.Column("interval", sa.String(length=8), nullable=False),
        sa.Column("open_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("open", MONEY, nullable=False),
        sa.Column("high", MONEY, nullable=False),
        sa.Column("low", MONEY, nullable=False),
        sa.Column("close", MONEY, nullable=False),
        sa.Column("volume", MONEY, nullable=False),
        sa.Column("quality", sa.String(length=16), nullable=False),
        sa.Column("provider_timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ingested_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_market_candles")),
        sa.UniqueConstraint(
            "provider", "symbol", "interval", "open_time", name="uq_market_candles_series"
        ),
    )
    with op.batch_alter_table("market_candles", schema=None) as batch_op:
        batch_op.create_index(
            "ix_market_candles_lookup", ["symbol", "interval", "open_time"], unique=False
        )

    op.create_table(
        "market_quotes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("symbol", sa.String(length=32), nullable=False),
        sa.Column("market_type", sa.String(length=16), nullable=False),
        sa.Column("bid", MONEY, nullable=True),
        sa.Column("ask", MONEY, nullable=True),
        sa.Column("last", MONEY, nullable=True),
        sa.Column("spread_pct", PERCENT, nullable=True),
        sa.Column("volume_24h", MONEY, nullable=True),
        sa.Column("high_24h", MONEY, nullable=True),
        sa.Column("low_24h", MONEY, nullable=True),
        sa.Column("change_24h_pct", PERCENT, nullable=True),
        sa.Column("session", sa.String(length=16), nullable=False),
        sa.Column("quality", sa.String(length=16), nullable=False),
        sa.Column("provider_timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ingested_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_market_quotes")),
        sa.UniqueConstraint(
            "provider", "symbol", "provider_timestamp", name="uq_market_quotes_snapshot"
        ),
    )
    with op.batch_alter_table("market_quotes", schema=None) as batch_op:
        batch_op.create_index(
            "ix_market_quotes_symbol_ts", ["symbol", "provider_timestamp"], unique=False
        )

    op.create_table(
        "fx_rates",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("base_currency", sa.String(length=3), nullable=False),
        sa.Column("quote_currency", sa.String(length=3), nullable=False),
        sa.Column("rate", RATE, nullable=False),
        sa.Column("as_of", sa.DateTime(timezone=True), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("ingested_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_fx_rates")),
        sa.UniqueConstraint(
            "base_currency", "quote_currency", "as_of", name="uq_fx_rates_snapshot"
        ),
    )
    with op.batch_alter_table("fx_rates", schema=None) as batch_op:
        batch_op.create_index(
            "ix_fx_rates_pair_asof",
            ["base_currency", "quote_currency", "as_of"],
            unique=False,
        )

    op.create_table(
        "paper_accounts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("connection_id", sa.Uuid(), nullable=False),
        sa.Column("base_currency", sa.String(length=3), nullable=False),
        sa.Column("starting_cash", MONEY, nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("provenance", sa.String(length=24), nullable=False),
        sa.Column("initialised_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("initialised_by", sa.String(length=120), nullable=False),
        sa.Column("reset_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reset_by", sa.String(length=120), nullable=True),
        sa.ForeignKeyConstraint(
            ["connection_id"],
            ["connections.id"],
            name=op.f("fk_paper_accounts_connection_id_connections"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_paper_accounts")),
        sa.UniqueConstraint("connection_id", name="uq_paper_accounts_connection"),
    )

    op.create_table(
        "account_balances",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("connection_id", sa.Uuid(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("cash", MONEY, nullable=False),
        sa.Column("reserved", MONEY, nullable=False),
        sa.Column("source", sa.String(length=24), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["connection_id"],
            ["connections.id"],
            name=op.f("fk_account_balances_connection_id_connections"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_account_balances")),
        sa.UniqueConstraint(
            "connection_id", "currency", name="uq_account_balances_connection_currency"
        ),
    )

    op.create_table(
        "portfolio_ledger",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("connection_id", sa.Uuid(), nullable=False),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("kind", sa.String(length=24), nullable=False),
        sa.Column("amount", MONEY, nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("reference", sa.String(length=120), nullable=False),
        sa.Column("source", sa.String(length=24), nullable=False),
        sa.Column("detail", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(
            ["connection_id"],
            ["connections.id"],
            name=op.f("fk_portfolio_ledger_connection_id_connections"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_portfolio_ledger")),
        sa.UniqueConstraint(
            "connection_id", "reference", name="uq_portfolio_ledger_reference"
        ),
    )
    with op.batch_alter_table("portfolio_ledger", schema=None) as batch_op:
        batch_op.create_index(
            "ix_portfolio_ledger_connection_at", ["connection_id", "at"], unique=False
        )

    op.create_table(
        "equity_snapshots",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("connection_id", sa.Uuid(), nullable=False),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("equity", MONEY, nullable=False),
        sa.Column("cash", MONEY, nullable=False),
        sa.Column("positions_value", MONEY, nullable=False),
        sa.Column("source", sa.String(length=24), nullable=False),
        sa.ForeignKeyConstraint(
            ["connection_id"],
            ["connections.id"],
            name=op.f("fk_equity_snapshots_connection_id_connections"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_equity_snapshots")),
        sa.UniqueConstraint(
            "connection_id", "at", name="uq_equity_snapshots_connection_at"
        ),
    )
    with op.batch_alter_table("equity_snapshots", schema=None) as batch_op:
        batch_op.create_index(
            "ix_equity_snapshots_connection_at", ["connection_id", "at"], unique=False
        )


def downgrade() -> None:
    with op.batch_alter_table("equity_snapshots", schema=None) as batch_op:
        batch_op.drop_index("ix_equity_snapshots_connection_at")
    op.drop_table("equity_snapshots")

    with op.batch_alter_table("portfolio_ledger", schema=None) as batch_op:
        batch_op.drop_index("ix_portfolio_ledger_connection_at")
    op.drop_table("portfolio_ledger")

    op.drop_table("account_balances")
    op.drop_table("paper_accounts")

    with op.batch_alter_table("fx_rates", schema=None) as batch_op:
        batch_op.drop_index("ix_fx_rates_pair_asof")
    op.drop_table("fx_rates")

    with op.batch_alter_table("market_quotes", schema=None) as batch_op:
        batch_op.drop_index("ix_market_quotes_symbol_ts")
    op.drop_table("market_quotes")

    with op.batch_alter_table("market_candles", schema=None) as batch_op:
        batch_op.drop_index("ix_market_candles_lookup")
    op.drop_table("market_candles")

    with op.batch_alter_table("positions", schema=None) as batch_op:
        batch_op.drop_column("source")
