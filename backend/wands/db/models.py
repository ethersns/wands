"""Relational schema.

Money and quantities are ``Numeric(20, 8)`` throughout — never floats. A float
rounding error in a position size is a real loss, not a display glitch.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from wands.db.base import Base, UtcDateTime

MONEY = Numeric(20, 8)
PERCENT = Numeric(6, 3)


def utcnow() -> datetime:
    return datetime.now(tz=UTC)


def _uuid() -> uuid.UUID:
    return uuid.uuid4()


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )


# --------------------------------------------------------------------------
# Identity
# --------------------------------------------------------------------------


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    password_hash: Mapped[str | None] = mapped_column(Text)
    role: Mapped[str] = mapped_column(String(16), nullable=False, default="viewer")
    mfa_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    mfa_secret_encrypted: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    api_keys: Mapped[list[ApiKey]] = relationship(back_populates="user")
    settings: Mapped[UserSettings | None] = relationship(back_populates="user", uselist=False)


class ApiKey(Base):
    __tablename__ = "api_keys"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    key_prefix: Mapped[str] = mapped_column(String(16), unique=True, nullable=False)
    key_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False, default="viewer")
    scopes: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    user: Mapped[User] = relationship(back_populates="api_keys")


class AuditEvent(Base):
    """Append-only. There is no update or delete path in the application."""

    __tablename__ = "audit_events"
    __table_args__ = (Index("ix_audit_events_at", "at"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    actor: Mapped[str] = mapped_column(String(120), nullable=False)
    actor_type: Mapped[str] = mapped_column(String(16), nullable=False, default="system")
    action: Mapped[str] = mapped_column(String(80), nullable=False)
    target: Mapped[str | None] = mapped_column(String(120))
    outcome: Mapped[str] = mapped_column(String(16), nullable=False, default="success")
    detail: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    request_id: Mapped[str | None] = mapped_column(String(64))
    ip: Mapped[str | None] = mapped_column(String(64))


# --------------------------------------------------------------------------
# Engine state
# --------------------------------------------------------------------------


class EngineStateRow(Base):
    """Singleton row (id = 1).

    Emergency stop and pause live here rather than in process memory so that a
    restart cannot silently re-enable trading.
    """

    __tablename__ = "engine_state"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    trading_mode: Mapped[str] = mapped_column(String(16), nullable=False, default="paper")
    live_trading_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    trading_paused: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    emergency_stop_engaged: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    emergency_stop_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    emergency_stop_actor: Mapped[str | None] = mapped_column(String(120))
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )


# --------------------------------------------------------------------------
# Risk
# --------------------------------------------------------------------------


class RiskPolicyRow(Base):
    __tablename__ = "risk_policies"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(80), nullable=False, default="default")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    max_portfolio_exposure_pct: Mapped[Decimal] = mapped_column(PERCENT, nullable=False, default=80)
    max_position_exposure_pct: Mapped[Decimal] = mapped_column(PERCENT, nullable=False, default=5)
    per_trade_risk_pct: Mapped[Decimal] = mapped_column(
        PERCENT, nullable=False, default=Decimal("0.5")
    )
    daily_loss_limit_pct: Mapped[Decimal] = mapped_column(PERCENT, nullable=False, default=2)
    max_drawdown_pct: Mapped[Decimal] = mapped_column(PERCENT, nullable=False, default=10)
    crypto_allocation_cap_pct: Mapped[Decimal] = mapped_column(PERCENT, nullable=False, default=40)
    stocks_allocation_cap_pct: Mapped[Decimal] = mapped_column(PERCENT, nullable=False, default=60)
    max_quote_age_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    duplicate_order_window_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=60)
    allow_short_selling: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    allow_leverage: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )
    updated_by: Mapped[str | None] = mapped_column(String(120))


class RiskEventRow(Base):
    __tablename__ = "risk_events"
    __table_args__ = (Index("ix_risk_events_at", "at"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    severity: Mapped[str] = mapped_column(String(16), nullable=False, default="info")
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    detail: Mapped[str] = mapped_column(Text, nullable=False, default="")
    acknowledged: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    actor: Mapped[str] = mapped_column(String(120), nullable=False, default="system")


# --------------------------------------------------------------------------
# Connections
# --------------------------------------------------------------------------


class ConnectionRow(Base, TimestampMixin):
    __tablename__ = "connections"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    label: Mapped[str] = mapped_column(String(80), nullable=False)
    market_type: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="not_configured")
    access: Mapped[str] = mapped_column(String(16), nullable=False, default="read_only")
    mode: Mapped[str] = mapped_column(String(16), nullable=False, default="paper")
    key_hint: Mapped[str | None] = mapped_column(String(8))
    credentials_encrypted: Mapped[str | None] = mapped_column(Text)
    permissions: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error: Mapped[str | None] = mapped_column(Text)


# --------------------------------------------------------------------------
# Strategies, bots
# --------------------------------------------------------------------------


class StrategyRow(Base, TimestampMixin):
    __tablename__ = "strategies"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    slug: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    version: Mapped[str] = mapped_column(String(16), nullable=False, default="0.1.0")
    supported_markets: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    deployment: Mapped[str] = mapped_column(String(24), nullable=False, default="paper_only")
    config_schema: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False, default=list)


class BotRow(Base, TimestampMixin):
    __tablename__ = "bots"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    market_type: Mapped[str] = mapped_column(String(16), nullable=False)
    connection_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("connections.id", ondelete="SET NULL")
    )
    strategy_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("strategies.id", ondelete="SET NULL")
    )
    symbols: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    timeframe: Mapped[str] = mapped_column(String(8), nullable=False, default="1h")
    mode: Mapped[str] = mapped_column(String(16), nullable=False, default="paper")
    state: Mapped[str] = mapped_column(String(16), nullable=False, default="stopped")
    allocated_capital: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=0)
    position_size_pct: Mapped[Decimal] = mapped_column(PERCENT, nullable=False, default=1)
    stop_loss_pct: Mapped[Decimal] = mapped_column(PERCENT, nullable=False, default=2)
    take_profit_pct: Mapped[Decimal] = mapped_column(PERCENT, nullable=False, default=4)
    max_open_positions: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    daily_loss_limit_pct: Mapped[Decimal] = mapped_column(PERCENT, nullable=False, default=2)
    schedule: Mapped[str] = mapped_column(String(64), nullable=False, default="*/15 * * * *")
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text)


class BotLogRow(Base):
    __tablename__ = "bot_logs"
    __table_args__ = (Index("ix_bot_logs_bot_at", "bot_id", "at"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    bot_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("bots.id", ondelete="CASCADE"))
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    level: Mapped[str] = mapped_column(String(8), nullable=False, default="info")
    message: Mapped[str] = mapped_column(Text, nullable=False)


# --------------------------------------------------------------------------
# Orders, fills, positions
# --------------------------------------------------------------------------


class OrderRow(Base, TimestampMixin):
    __tablename__ = "orders"
    __table_args__ = (
        UniqueConstraint("client_order_id", name="uq_orders_client_order_id"),
        Index("ix_orders_connection_created", "connection_id", "created_at"),
        Index("ix_orders_status", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    client_order_id: Mapped[str] = mapped_column(String(64), nullable=False)
    connection_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("connections.id", ondelete="SET NULL")
    )
    symbol: Mapped[str] = mapped_column(String(32), nullable=False)
    market_type: Mapped[str] = mapped_column(String(16), nullable=False)
    side: Mapped[str] = mapped_column(String(8), nullable=False)
    type: Mapped[str] = mapped_column(String(16), nullable=False, default="market")
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="open")
    quantity: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    filled_quantity: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=0)
    limit_price: Mapped[Decimal | None] = mapped_column(MONEY)
    average_fill_price: Mapped[Decimal | None] = mapped_column(MONEY)
    fees: Mapped[Decimal | None] = mapped_column(MONEY)
    mode: Mapped[str] = mapped_column(String(16), nullable=False, default="paper")
    bot_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("bots.id", ondelete="SET NULL"))
    strategy_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("strategies.id", ondelete="SET NULL")
    )
    exchange_confirmation_id: Mapped[str | None] = mapped_column(String(120))
    reconciliation: Mapped[str] = mapped_column(String(16), nullable=False, default="matched")
    reject_reason: Mapped[str | None] = mapped_column(Text)


class FillRow(Base):
    __tablename__ = "fills"
    __table_args__ = (Index("ix_fills_order", "order_id"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"))
    symbol: Mapped[str] = mapped_column(String(32), nullable=False)
    side: Mapped[str] = mapped_column(String(8), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    price: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    fees: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=0)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class PositionRow(Base):
    __tablename__ = "positions"
    __table_args__ = (
        UniqueConstraint("connection_id", "symbol", name="uq_positions_connection_symbol"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    connection_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("connections.id", ondelete="CASCADE")
    )
    symbol: Mapped[str] = mapped_column(String(32), nullable=False)
    market_type: Mapped[str] = mapped_column(String(16), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=0)
    average_entry_price: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=0)
    realised_pnl: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=0)
    fees_paid: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=0)
    # ``broker_confirmed`` positions come from a venue sync; ``paper_simulated``
    # positions come from the paper gateway. They are never mixed in a valuation
    # without the caller being told which is which.
    source: Mapped[str] = mapped_column(
        String(24), nullable=False, default="paper_simulated"
    )
    opened_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    strategy_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("strategies.id", ondelete="SET NULL")
    )
    bot_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("bots.id", ondelete="SET NULL"))


# --------------------------------------------------------------------------
# Backtests
# --------------------------------------------------------------------------


class BacktestRow(Base):
    __tablename__ = "backtests"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    strategy_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("strategies.id", ondelete="SET NULL")
    )
    symbols: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    timeframe: Mapped[str] = mapped_column(String(8), nullable=False, default="1h")
    period_from: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    period_to: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    initial_capital: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="queued")
    metrics: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    equity_curve: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False, default=list)
    trades: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False, default=list)
    walk_forward: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


# --------------------------------------------------------------------------
# Settings
# --------------------------------------------------------------------------


class UserSettings(Base):
    __tablename__ = "user_settings"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), unique=True
    )
    base_currency: Mapped[str] = mapped_column(String(3), nullable=False, default="USD")
    theme: Mapped[str] = mapped_column(String(8), nullable=False, default="dark")
    two_factor_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    notifications: Mapped[dict[str, bool]] = mapped_column(JSON, nullable=False, default=dict)
    retention_days: Mapped[int] = mapped_column(Integer, nullable=False, default=365)
    last_backup_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    user: Mapped[User] = relationship(back_populates="settings")


# --------------------------------------------------------------------------
# Phase 3 — market data
# --------------------------------------------------------------------------

RATE = Numeric(20, 10)


class MarketCandleRow(Base):
    """A closed OHLCV bar.

    The unique constraint is the duplicate-prevention guarantee: re-ingesting the
    same provider bar is a no-op at the database level, not a silent second row
    that would double a backtest's volume.
    """

    __tablename__ = "market_candles"
    __table_args__ = (
        UniqueConstraint(
            "provider", "symbol", "interval", "open_time", name="uq_market_candles_series"
        ),
        Index("ix_market_candles_lookup", "symbol", "interval", "open_time"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    symbol: Mapped[str] = mapped_column(String(32), nullable=False)
    market_type: Mapped[str] = mapped_column(String(16), nullable=False)
    interval: Mapped[str] = mapped_column(String(8), nullable=False)
    open_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    open: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    high: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    low: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    close: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    volume: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=0)
    # ``live`` | ``delayed`` | ``historical`` | ``simulated`` | ``unavailable``
    quality: Mapped[str] = mapped_column(String(16), nullable=False, default="historical")
    provider_timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    ingested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )


class MarketQuoteRow(Base):
    """A point-in-time bid/ask snapshot.

    Quotes are append-only so freshness can be measured against the provider's
    own timestamp rather than against the moment a row happened to be written.
    """

    __tablename__ = "market_quotes"
    __table_args__ = (
        UniqueConstraint(
            "provider", "symbol", "provider_timestamp", name="uq_market_quotes_snapshot"
        ),
        Index("ix_market_quotes_symbol_ts", "symbol", "provider_timestamp"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    symbol: Mapped[str] = mapped_column(String(32), nullable=False)
    market_type: Mapped[str] = mapped_column(String(16), nullable=False)
    bid: Mapped[Decimal | None] = mapped_column(MONEY)
    ask: Mapped[Decimal | None] = mapped_column(MONEY)
    last: Mapped[Decimal | None] = mapped_column(MONEY)
    spread_pct: Mapped[Decimal | None] = mapped_column(PERCENT)
    volume_24h: Mapped[Decimal | None] = mapped_column(MONEY)
    high_24h: Mapped[Decimal | None] = mapped_column(MONEY)
    low_24h: Mapped[Decimal | None] = mapped_column(MONEY)
    change_24h_pct: Mapped[Decimal | None] = mapped_column(PERCENT)
    session: Mapped[str] = mapped_column(String(16), nullable=False, default="closed")
    quality: Mapped[str] = mapped_column(String(16), nullable=False, default="unavailable")
    provider_timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    ingested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )


class FxRateRow(Base):
    """A stored FX snapshot.

    Rates are never derived by inverting another pair at read time: an inverted
    rate is a different number with different rounding, and a portfolio that
    values the same position two ways is not auditable.
    """

    __tablename__ = "fx_rates"
    __table_args__ = (
        UniqueConstraint(
            "base_currency", "quote_currency", "as_of", name="uq_fx_rates_snapshot"
        ),
        Index("ix_fx_rates_pair_asof", "base_currency", "quote_currency", "as_of"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    base_currency: Mapped[str] = mapped_column(String(3), nullable=False)
    quote_currency: Mapped[str] = mapped_column(String(3), nullable=False)
    rate: Mapped[Decimal] = mapped_column(RATE, nullable=False)
    as_of: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    source: Mapped[str] = mapped_column(String(32), nullable=False, default="manual")
    ingested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )


# --------------------------------------------------------------------------
# Phase 3 — portfolio accounting
# --------------------------------------------------------------------------


class PaperAccountRow(Base):
    """A simulated account. There is no code path that promotes one to live."""

    __tablename__ = "paper_accounts"
    __table_args__ = (
        UniqueConstraint("connection_id", name="uq_paper_accounts_connection"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    connection_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("connections.id", ondelete="CASCADE"), nullable=False
    )
    base_currency: Mapped[str] = mapped_column(String(3), nullable=False, default="USD")
    starting_cash: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
    provenance: Mapped[str] = mapped_column(
        String(24), nullable=False, default="paper_simulated"
    )
    initialised_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    initialised_by: Mapped[str] = mapped_column(String(120), nullable=False, default="system")
    reset_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reset_by: Mapped[str | None] = mapped_column(String(120))


class AccountBalanceRow(Base):
    """Cash and reserved capital per account and currency.

    ``reserved`` is capital committed to open orders. Buying power is
    ``cash - reserved``; treating reserved cash as spendable is how a paper
    account silently goes negative.
    """

    __tablename__ = "account_balances"
    __table_args__ = (
        UniqueConstraint(
            "connection_id", "currency", name="uq_account_balances_connection_currency"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    connection_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("connections.id", ondelete="CASCADE"), nullable=False
    )
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="USD")
    cash: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=0)
    reserved: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=0)
    source: Mapped[str] = mapped_column(
        String(24), nullable=False, default="paper_simulated"
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )


class PortfolioLedgerRow(Base):
    """Append-only cash and position movements.

    Performance is computed from this ledger, not from a running total, so a
    deposit is never mistaken for profit. ``reference`` is unique per account,
    which makes replaying a fill idempotent.
    """

    __tablename__ = "portfolio_ledger"
    __table_args__ = (
        UniqueConstraint(
            "connection_id", "reference", name="uq_portfolio_ledger_reference"
        ),
        Index("ix_portfolio_ledger_connection_at", "connection_id", "at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    connection_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("connections.id", ondelete="CASCADE"), nullable=False
    )
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    # initialisation | deposit | withdrawal | fill | fee | transfer | reservation | release
    kind: Mapped[str] = mapped_column(String(24), nullable=False)
    amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="USD")
    reference: Mapped[str] = mapped_column(String(120), nullable=False)
    source: Mapped[str] = mapped_column(
        String(24), nullable=False, default="paper_simulated"
    )
    detail: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)


class EquitySnapshotRow(Base):
    """A stored valuation. Drawdown and day P&L are read from these, never guessed."""

    __tablename__ = "equity_snapshots"
    __table_args__ = (
        UniqueConstraint("connection_id", "at", name="uq_equity_snapshots_connection_at"),
        Index("ix_equity_snapshots_connection_at", "connection_id", "at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    connection_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("connections.id", ondelete="CASCADE"), nullable=False
    )
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    equity: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    cash: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    positions_value: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    source: Mapped[str] = mapped_column(
        String(24), nullable=False, default="paper_simulated"
    )


# --------------------------------------------------------------------------
# Intelligence
#
# Every row here is a record of something a public source published, stamped
# with the moment it became public. Nothing in this section can place an order
# or read a broker credential: research data and execution data are kept in
# separate tables on purpose.
# --------------------------------------------------------------------------


class IntelFilingRow(Base):
    """One SEC ownership filing (Form 3, 4, 5 or an amendment).

    ``accepted_at`` is the SEC acceptance timestamp, which is the moment the
    filing became public. It is the only timestamp a backtest may use to decide
    whether a signal was knowable; ``period_of_report`` and ``transaction_date``
    are facts about the past, not about availability.
    """

    __tablename__ = "intel_filings"
    __table_args__ = (
        UniqueConstraint("accession_number", name="uq_intel_filings_accession"),
        Index("ix_intel_filings_symbol_accepted", "symbol", "accepted_at"),
        Index("ix_intel_filings_accepted", "accepted_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    accession_number: Mapped[str] = mapped_column(String(32), nullable=False)
    form_type: Mapped[str] = mapped_column(String(16), nullable=False)
    document_type: Mapped[str] = mapped_column(String(8), nullable=False, default="")
    issuer_cik: Mapped[str] = mapped_column(String(16), nullable=False, default="")
    issuer_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    symbol: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    period_of_report: Mapped[datetime | None] = mapped_column(UtcDateTime)
    filed_date: Mapped[datetime | None] = mapped_column(UtcDateTime)
    accepted_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False)
    source_url: Mapped[str] = mapped_column(Text, nullable=False, default="")
    source: Mapped[str] = mapped_column(String(32), nullable=False, default="sec_edgar")
    is_amendment: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    amends_accession: Mapped[str | None] = mapped_column(String(32))
    original_submission_date: Mapped[datetime | None] = mapped_column(UtcDateTime)
    # Hash of the raw document. A re-fetch that returns different bytes for the
    # same accession is a source-integrity event worth noticing.
    raw_sha256: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    ingested_at: Mapped[datetime] = mapped_column(
        UtcDateTime, default=utcnow, nullable=False
    )

    transactions: Mapped[list[IntelInsiderTransactionRow]] = relationship(
        back_populates="filing", cascade="all, delete-orphan"
    )


class IntelInsiderTransactionRow(Base):
    """One reported transaction line from a Form 3/4/5.

    ``value`` is null when the filing reports no price. A gift or an award has
    no transaction price, and inventing a zero would make an aggregate purchase
    value quietly wrong.
    """

    __tablename__ = "intel_insider_transactions"
    __table_args__ = (
        UniqueConstraint(
            "accession_number",
            "reporting_person_cik",
            "table_kind",
            "ordinal",
            name="uq_intel_insider_tx_line",
        ),
        Index("ix_intel_insider_tx_symbol_date", "symbol", "transaction_date"),
        Index("ix_intel_insider_tx_class", "classification"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    filing_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("intel_filings.id", ondelete="CASCADE"), nullable=False
    )
    accession_number: Mapped[str] = mapped_column(String(32), nullable=False)
    symbol: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    issuer_cik: Mapped[str] = mapped_column(String(16), nullable=False, default="")
    issuer_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    reporting_person_cik: Mapped[str] = mapped_column(String(16), nullable=False, default="")
    reporting_person_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    is_director: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_officer: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_ten_percent_owner: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    officer_title: Mapped[str] = mapped_column(String(120), nullable=False, default="")

    table_kind: Mapped[str] = mapped_column(String(16), nullable=False, default="non_derivative")
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    security_title: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    transaction_date: Mapped[datetime | None] = mapped_column(UtcDateTime)
    transaction_code: Mapped[str] = mapped_column(String(4), nullable=False, default="")
    acquired_disposed: Mapped[str] = mapped_column(String(1), nullable=False, default="")
    shares: Mapped[Decimal | None] = mapped_column(MONEY)
    price_per_share: Mapped[Decimal | None] = mapped_column(MONEY)
    value: Mapped[Decimal | None] = mapped_column(MONEY)
    shares_owned_after: Mapped[Decimal | None] = mapped_column(MONEY)
    direct_or_indirect: Mapped[str] = mapped_column(String(1), nullable=False, default="")
    nature_of_ownership: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    classification: Mapped[str] = mapped_column(String(32), nullable=False, default="other")
    is_open_market: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_derivative: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    footnote_ids: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    # Copied from the filing so a transaction can be filtered by availability
    # without a join, and so a point-in-time query cannot accidentally use the
    # transaction date instead.
    accepted_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False)
    is_amendment: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    source_url: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(
        UtcDateTime, default=utcnow, nullable=False
    )

    filing: Mapped[IntelFilingRow] = relationship(back_populates="transactions")


class IntelInstitutionRow(Base):
    """A 13F filer. Identity only — never a claim about current positioning."""

    __tablename__ = "intel_institutions"
    __table_args__ = (UniqueConstraint("cik", name="uq_intel_institutions_cik"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    cik: Mapped[str] = mapped_column(String(16), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(
        UtcDateTime, default=utcnow, nullable=False
    )


class IntelInstitutionalHoldingRow(Base):
    """One reported 13F position for one quarter.

    A 13F is a snapshot filed up to 45 days after quarter end. ``period_of_report``
    is the quarter end and ``accepted_at`` is when the world could read it; the
    two are never interchangeable.
    """

    __tablename__ = "intel_institutional_holdings"
    __table_args__ = (
        UniqueConstraint(
            "accession_number", "ordinal", name="uq_intel_institutional_holding_line"
        ),
        Index("ix_intel_institutional_holdings_period", "period_of_report"),
        Index("ix_intel_institutional_holdings_cusip", "cusip"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    institution_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("intel_institutions.id", ondelete="CASCADE"), nullable=False
    )
    accession_number: Mapped[str] = mapped_column(String(32), nullable=False)
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    period_of_report: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False)
    filed_date: Mapped[datetime | None] = mapped_column(UtcDateTime)
    accepted_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False)
    cusip: Mapped[str] = mapped_column(String(16), nullable=False, default="")
    issuer_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    class_title: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    value_usd: Mapped[Decimal | None] = mapped_column(MONEY)
    shares: Mapped[Decimal | None] = mapped_column(MONEY)
    share_type: Mapped[str] = mapped_column(String(16), nullable=False, default="SH")
    put_call: Mapped[str] = mapped_column(String(8), nullable=False, default="")
    investment_discretion: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    voting_sole: Mapped[Decimal | None] = mapped_column(MONEY)
    voting_shared: Mapped[Decimal | None] = mapped_column(MONEY)
    voting_none: Mapped[Decimal | None] = mapped_column(MONEY)
    is_amendment: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    source_url: Mapped[str] = mapped_column(Text, nullable=False, default="")
    ingested_at: Mapped[datetime] = mapped_column(
        UtcDateTime, default=utcnow, nullable=False
    )


class IntelSignalRow(Base):
    """A research signal derived from stored events.

    ``signal_key`` is a deterministic hash of the category, symbol, window and
    source events, so recomputing a signal is idempotent rather than a way to
    inflate a backtest with duplicates.
    """

    __tablename__ = "intel_signals"
    __table_args__ = (
        UniqueConstraint("signal_key", name="uq_intel_signals_key"),
        Index("ix_intel_signals_symbol_available", "symbol", "public_available_at"),
        Index("ix_intel_signals_category", "category"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    signal_key: Mapped[str] = mapped_column(String(64), nullable=False)
    category: Mapped[str] = mapped_column(String(48), nullable=False)
    symbol: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    source_event_ids: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    event_time: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False)
    public_available_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False)
    calculated_at: Mapped[datetime] = mapped_column(
        UtcDateTime, default=utcnow, nullable=False
    )
    raw_measurement: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=0)
    raw_unit: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    score: Mapped[Decimal | None] = mapped_column(PERCENT)
    explanation: Mapped[str] = mapped_column(Text, nullable=False, default="")
    data_quality: Mapped[str] = mapped_column(String(16), nullable=False, default="reported")
    confidence_notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    parameters: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    engine_version: Mapped[str] = mapped_column(String(16), nullable=False, default="1.0")


class IntelIngestRunRow(Base):
    """One ingestion attempt. Freshness is read from these, never assumed."""

    __tablename__ = "intel_ingest_runs"
    __table_args__ = (Index("ix_intel_ingest_runs_started", "started_at"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    source: Mapped[str] = mapped_column(String(32), nullable=False, default="sec_edgar")
    started_at: Mapped[datetime] = mapped_column(
        UtcDateTime, default=utcnow, nullable=False
    )
    finished_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="running")
    filings_seen: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    filings_new: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    transactions_new: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    signals_new: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    errors: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False, default=list)
    detail: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
