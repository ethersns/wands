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

from wands.db.base import Base

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
