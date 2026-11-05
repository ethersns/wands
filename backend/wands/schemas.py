"""Wire schemas.

These mirror ``lib/api/contracts.ts`` field for field. The frontend is the
contract, so the models are camelCase on the wire and snake_case in Python.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from enum import Enum, StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


def to_camel(value: str) -> str:
    head, *tail = value.split("_")
    return head + "".join(word.capitalize() for word in tail)


class CamelModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )


# --- enums ----------------------------------------------------------------


class TradingMode(StrEnum):
    BACKTEST = "backtest"
    PAPER = "paper"
    LIVE = "live"


class MarketType(StrEnum):
    CRYPTO = "crypto"
    STOCKS = "stocks"


class DataProvenance(StrEnum):
    LIVE = "live"
    DEMO = "demo"
    UNAVAILABLE = "unavailable"


class EngineState(StrEnum):
    OPERATIONAL = "operational"
    DEGRADED = "degraded"
    PAUSED = "paused"
    HALTED = "halted"
    OFFLINE = "offline"


class ConnectionStatus(StrEnum):
    CONNECTED = "connected"
    DEGRADED = "degraded"
    DISCONNECTED = "disconnected"
    NOT_CONFIGURED = "not_configured"


class AccessLevel(StrEnum):
    READ_ONLY = "read_only"
    TRADING = "trading"


class Provider(StrEnum):
    KRAKEN = "kraken"
    ALPACA = "alpaca"
    INTERACTIVE_BROKERS = "interactive_brokers"


class OrderStatus(StrEnum):
    OPEN = "open"
    PARTIALLY_FILLED = "partially_filled"
    FILLED = "filled"
    CANCELLED = "cancelled"
    REJECTED = "rejected"


class ReconciliationState(StrEnum):
    MATCHED = "matched"
    PENDING = "pending"
    MISMATCH = "mismatch"


class OrderSide(StrEnum):
    BUY = "buy"
    SELL = "sell"


class OrderType(StrEnum):
    MARKET = "market"
    LIMIT = "limit"
    STOP = "stop"
    STOP_LIMIT = "stop_limit"


class BotState(StrEnum):
    RUNNING = "running"
    PAUSED = "paused"
    STOPPED = "stopped"
    ERROR = "error"


class StrategyCategory(StrEnum):
    TREND_FOLLOWING = "trend_following"
    MEAN_REVERSION = "mean_reversion"
    MOMENTUM = "momentum"
    GRID = "grid"
    MARKET_MAKING = "market_making"
    ARBITRAGE = "arbitrage"
    CUSTOM = "custom"


class Deployment(StrEnum):
    PAPER_ONLY = "paper_only"
    PAPER_AND_LIVE = "paper_and_live"


class RiskSeverity(StrEnum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


class RiskCategory(StrEnum):
    EXPOSURE = "exposure"
    DRAWDOWN = "drawdown"
    CIRCUIT_BREAKER = "circuit_breaker"
    STALE_DATA = "stale_data"
    DUPLICATE_ORDER = "duplicate_order"
    PERMISSION = "permission"
    EMERGENCY_STOP = "emergency_stop"
    POLICY_CHANGE = "policy_change"


class MarketSessionState(StrEnum):
    OPEN = "open"
    CLOSED = "closed"
    PRE = "pre"
    POST = "post"
    ALWAYS = "always"


class CandleInterval(StrEnum):
    M1 = "1m"
    M5 = "5m"
    M15 = "15m"
    H1 = "1h"
    H4 = "4h"
    D1 = "1d"


# --- engine ---------------------------------------------------------------


class EngineStatus(CamelModel):
    state: EngineState
    mode: TradingMode
    live_trading_enabled: bool
    version: str
    region: str
    uptime_seconds: int
    last_heartbeat: str
    market_data_latency_ms: float | None = None
    stalest_quote_age_seconds: float | None = None
    active_bots: int = 0
    queued_jobs: int = 0
    notes: list[str] = Field(default_factory=list)


# --- portfolio ------------------------------------------------------------


class BrokerAccount(CamelModel):
    id: str
    provider: Provider
    label: str
    market_type: MarketType
    status: ConnectionStatus
    access: AccessLevel
    mode: TradingMode
    base_currency: str
    last_synced_at: str | None = None
    equity: Decimal | None = None
    cash: Decimal | None = None
    buying_power: Decimal | None = None
    permissions: list[str] = Field(default_factory=list)
    error: str | None = None
    # ``paper_simulated`` or ``broker_confirmed``. A simulated balance is never
    # presented as a venue balance.
    source: str | None = None
    verified: bool = False


class PositionOut(CamelModel):
    id: str
    account_id: str
    symbol: str
    name: str
    market_type: MarketType
    quantity: Decimal
    average_entry_price: Decimal
    last_price: Decimal | None = None
    market_value: Decimal | None = None
    unrealised_pnl: Decimal | None = None
    unrealised_pnl_pct: Decimal | None = None
    realised_pnl: Decimal
    fees_paid: Decimal
    opened_at: str
    strategy_id: str | None = None
    bot_id: str | None = None
    source: str = "paper_simulated"
    price_quality: str | None = None
    price_as_of: str | None = None
    price_age_seconds: float | None = None
    price_stale: bool = True


class AllocationSlice(CamelModel):
    key: str
    label: str
    value: Decimal
    pct: Decimal


class EquityPoint(CamelModel):
    t: str
    equity: Decimal
    benchmark: Decimal | None = None


class MarketBreakdown(CamelModel):
    equity: Decimal | None = None
    pct: Decimal | None = None


class PortfolioSummary(CamelModel):
    base_currency: str
    total_equity: Decimal | None = None
    cash: Decimal | None = None
    reserved: Decimal | None = None
    buying_power: Decimal | None = None
    verified: bool = False
    day_pnl: Decimal | None = None
    day_pnl_pct: Decimal | None = None
    realised_pnl: Decimal | None = None
    unrealised_pnl: Decimal | None = None
    fees_paid: Decimal | None = None
    open_positions: int = 0
    equity_curve: list[EquityPoint] = Field(default_factory=list)
    allocation: list[AllocationSlice] = Field(default_factory=list)
    by_market: dict[str, MarketBreakdown] = Field(default_factory=dict)
    accounts: list[BrokerAccount] = Field(default_factory=list)
    positions: list[PositionOut] = Field(default_factory=list)


# --- markets --------------------------------------------------------------


class Quote(CamelModel):
    symbol: str
    name: str
    market_type: MarketType
    price: Decimal | None = None
    change_24h_pct: Decimal | None = None
    change_abs: Decimal | None = None
    volume_24h: Decimal | None = None
    high_24h: Decimal | None = None
    low_24h: Decimal | None = None
    volatility_pct: Decimal | None = None
    session: MarketSessionState
    as_of: str | None = None
    age_seconds: float | None = None
    stale: bool = True
    strategy_eligible: bool = False
    provider: str | None = None
    bid: Decimal | None = None
    ask: Decimal | None = None
    mid: Decimal | None = None
    spread_pct: Decimal | None = None
    # ``live`` | ``delayed`` | ``historical`` | ``simulated`` | ``unavailable``
    quality: str | None = None
    # The price an order may be priced against. ``None`` when the quote is not
    # live, not fresh, one-sided or the session is closed.
    executable_price: Decimal | None = None
    timestamp_source: str | None = None


class Candle(CamelModel):
    time: int
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: Decimal


class CandleSeries(CamelModel):
    symbol: str
    interval: CandleInterval
    candles: list[Candle] = Field(default_factory=list)


class MarketOverview(CamelModel):
    quotes: list[Quote] = Field(default_factory=list)
    watchlist: list[str] = Field(default_factory=list)
    feed_updated_at: str | None = None
    feed_healthy: bool = False


# --- strategies -----------------------------------------------------------


class StrategyParameter(CamelModel):
    key: str
    label: str
    type: Literal["number", "percent", "select", "boolean"]
    value: float | str | bool
    min: float | None = None
    max: float | None = None
    step: float | None = None
    options: list[dict[str, str]] | None = None
    help: str = ""


class StrategyOut(CamelModel):
    id: str
    name: str
    category: StrategyCategory
    description: str
    supported_markets: list[MarketType]
    deployment: Deployment
    parameters: list[StrategyParameter] = Field(default_factory=list)
    updated_at: str


# --- bots -----------------------------------------------------------------


class BotStats(CamelModel):
    trades: int = 0
    win_rate_pct: Decimal | None = None
    pnl: Decimal | None = None
    pnl_pct: Decimal | None = None
    max_drawdown_pct: Decimal | None = None


class TradingBotOut(CamelModel):
    id: str
    name: str
    market_type: MarketType
    account_id: str
    account_label: str
    strategy_id: str
    strategy_name: str
    symbols: list[str]
    timeframe: str
    mode: TradingMode
    state: BotState
    allocated_capital: Decimal
    position_size_pct: Decimal
    stop_loss_pct: Decimal
    take_profit_pct: Decimal
    max_open_positions: int
    daily_loss_limit_pct: Decimal
    schedule: str
    created_at: str
    last_run_at: str | None = None
    stats: BotStats = Field(default_factory=BotStats)
    last_error: str | None = None


class BotLogEntry(CamelModel):
    id: str
    bot_id: str
    at: str
    level: Literal["info", "warn", "error"]
    message: str


# --- backtests ------------------------------------------------------------


class BacktestMetrics(CamelModel):
    total_return_pct: Decimal | None = None
    benchmark_return_pct: Decimal | None = None
    profit_factor: Decimal | None = None
    max_drawdown_pct: Decimal | None = None
    win_rate_pct: Decimal | None = None
    average_win: Decimal | None = None
    average_loss: Decimal | None = None
    sharpe: Decimal | None = None
    trades: int = 0
    fees_paid: Decimal | None = None
    estimated_slippage: Decimal | None = None


class BacktestTrade(CamelModel):
    id: str
    symbol: str
    side: OrderSide
    entry_at: str
    exit_at: str | None = None
    entry_price: Decimal
    exit_price: Decimal | None = None
    quantity: Decimal
    pnl: Decimal | None = None
    pnl_pct: Decimal | None = None
    fees: Decimal


class WalkForward(CamelModel):
    folds: int
    in_sample_return_pct: Decimal | None = None
    out_of_sample_return_pct: Decimal | None = None
    verdict: Literal["passed", "failed", "inconclusive"]


class BacktestResult(CamelModel):
    id: str
    strategy_id: str
    strategy_name: str
    symbols: list[str]
    timeframe: str
    from_: str = Field(alias="from")
    to: str
    initial_capital: Decimal
    metrics: BacktestMetrics
    equity_curve: list[EquityPoint] = Field(default_factory=list)
    trades: list[BacktestTrade] = Field(default_factory=list)
    created_at: str
    walk_forward: WalkForward | None = None


# --- orders ---------------------------------------------------------------


class OrderOut(CamelModel):
    id: str
    client_order_id: str
    account_id: str
    account_label: str
    symbol: str
    market_type: MarketType
    side: OrderSide
    type: OrderType
    status: OrderStatus
    quantity: Decimal
    filled_quantity: Decimal
    limit_price: Decimal | None = None
    average_fill_price: Decimal | None = None
    fees: Decimal | None = None
    mode: TradingMode
    bot_id: str | None = None
    strategy_name: str | None = None
    created_at: str
    updated_at: str
    exchange_confirmation_id: str | None = None
    reconciliation: ReconciliationState
    reject_reason: str | None = None


class FillOut(CamelModel):
    id: str
    order_id: str
    symbol: str
    side: OrderSide
    quantity: Decimal
    price: Decimal
    fees: Decimal
    at: str


class TradeIntentIn(CamelModel):
    symbol: str = Field(min_length=1, max_length=32)
    market_type: MarketType
    side: OrderSide
    quantity: Decimal = Field(gt=0)
    type: Literal["market", "limit"] = "market"
    limit_price: Decimal | None = Field(default=None, gt=0)
    account_id: str
    mode: TradingMode
    # Required: the per-trade risk budget is a loss-at-stop budget, so an order
    # without a stop distance has unbounded risk and cannot be evaluated.
    stop_loss_pct: Decimal = Field(gt=0, le=50)
    rationale: str = Field(default="", max_length=500)
    client_order_id: str | None = Field(default=None, max_length=64)


class TradeIntentOut(CamelModel):
    id: str
    symbol: str
    market_type: MarketType
    side: OrderSide
    quantity: Decimal
    type: Literal["market", "limit"]
    limit_price: Decimal | None = None
    account_id: str
    mode: TradingMode
    rationale: str
    created_at: str
    status: Literal["proposed", "approved", "rejected", "expired"]


# --- risk -----------------------------------------------------------------


class RiskPolicyOut(CamelModel):
    max_portfolio_exposure_pct: Decimal
    max_position_exposure_pct: Decimal
    per_trade_risk_pct: Decimal
    daily_loss_limit_pct: Decimal
    max_drawdown_pct: Decimal
    crypto_allocation_cap_pct: Decimal
    stocks_allocation_cap_pct: Decimal
    max_quote_age_seconds: int
    duplicate_order_window_seconds: int
    allow_short_selling: bool = False
    allow_leverage: bool = False
    trading_paused: bool
    emergency_stop_engaged: bool
    updated_at: str


class RiskPolicyPatch(CamelModel):
    max_portfolio_exposure_pct: Decimal | None = Field(default=None, ge=0, le=100)
    max_position_exposure_pct: Decimal | None = Field(default=None, gt=0, le=100)
    per_trade_risk_pct: Decimal | None = Field(default=None, gt=0, le=10)
    daily_loss_limit_pct: Decimal | None = Field(default=None, gt=0, le=100)
    max_drawdown_pct: Decimal | None = Field(default=None, gt=0, le=100)
    crypto_allocation_cap_pct: Decimal | None = Field(default=None, ge=0, le=100)
    stocks_allocation_cap_pct: Decimal | None = Field(default=None, ge=0, le=100)
    max_quote_age_seconds: int | None = Field(default=None, ge=1, le=3600)
    duplicate_order_window_seconds: int | None = Field(default=None, ge=0, le=86400)
    allow_short_selling: bool | None = None
    allow_leverage: bool | None = None


class RiskEventOut(CamelModel):
    id: str
    at: str
    severity: RiskSeverity
    category: RiskCategory
    title: str
    detail: str
    acknowledged: bool
    actor: str


class RiskUtilisation(CamelModel):
    portfolio_exposure_pct: Decimal | None = None
    largest_position_pct: Decimal | None = None
    daily_loss_pct: Decimal | None = None
    drawdown_pct: Decimal | None = None
    crypto_allocation_pct: Decimal | None = None
    stocks_allocation_pct: Decimal | None = None


class RiskBreach(CamelModel):
    key: str
    label: str
    severity: RiskSeverity
    detail: str


class RiskSnapshot(CamelModel):
    policy: RiskPolicyOut
    utilisation: RiskUtilisation
    breaches: list[RiskBreach] = Field(default_factory=list)
    events: list[RiskEventOut] = Field(default_factory=list)


# --- connections ----------------------------------------------------------


class ConnectionOut(CamelModel):
    id: str
    provider: Provider
    label: str
    market_type: MarketType
    status: ConnectionStatus
    access: AccessLevel
    mode: TradingMode
    key_hint: str | None = None
    permissions: list[str] = Field(default_factory=list)
    last_synced_at: str | None = None
    error: str | None = None
    available: bool = False


class ConnectionCreate(CamelModel):
    provider: Provider
    label: str = Field(min_length=1, max_length=80)
    market_type: MarketType
    mode: TradingMode = TradingMode.PAPER
    access: AccessLevel = AccessLevel.READ_ONLY
    api_key: str = Field(min_length=8, max_length=256)
    api_secret: str = Field(min_length=8, max_length=256)


# --- settings -------------------------------------------------------------


class NotificationSettings(CamelModel):
    trade_fills: bool = True
    risk_breaches: bool = True
    engine_offline: bool = True
    daily_summary: bool = False


class EngineSettings(CamelModel):
    endpoint_configured: bool
    region: str
    heartbeat_seconds: int


class AuditSettings(CamelModel):
    last_backup_at: str | None = None
    retention_days: int


class UserSettingsOut(CamelModel):
    display_name: str
    email: str
    base_currency: str
    theme: Literal["dark", "light", "system"]
    two_factor_enabled: bool
    notifications: NotificationSettings
    engine: EngineSettings
    audit: AuditSettings


class UserSettingsPatch(CamelModel):
    display_name: str | None = Field(default=None, max_length=80)
    base_currency: str | None = Field(default=None, max_length=3)
    theme: Literal["dark", "light", "system"] | None = None
    notifications: NotificationSettings | None = None


# --- misc -----------------------------------------------------------------


class PauseRequest(CamelModel):
    paused: bool


class LiveTradingRequest(CamelModel):
    enabled: bool
    confirmation: str = Field(description='Must be exactly "ENABLE LIVE TRADING".')


class AuditEventOut(CamelModel):
    id: str
    at: str
    actor: str
    actor_type: str
    action: str
    target: str | None = None
    outcome: str
    detail: dict[str, Any] = Field(default_factory=dict)
    request_id: str | None = None
    ip: str | None = None


# --- phase 3: paper accounts, verification, market data health -------------


class PaperAccountCreate(CamelModel):
    connection_id: str = Field(min_length=1, max_length=64)
    starting_cash: Decimal | None = Field(default=None, gt=0)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    reset: bool = False


class PaperAccountReset(CamelModel):
    starting_cash: Decimal | None = Field(default=None, gt=0)
    currency: str | None = Field(default=None, min_length=3, max_length=3)


class PaperAccountOut(CamelModel):
    id: str
    connection_id: str
    base_currency: str
    starting_cash: Decimal
    status: str
    provenance: str
    initialised_at: str
    initialised_by: str
    reset_at: str | None = None
    reset_by: str | None = None
    cash: Decimal | None = None
    reserved: Decimal | None = None
    buying_power: Decimal | None = None
    equity: Decimal | None = None
    verified: bool = False


class PortfolioVerificationOut(CamelModel):
    connection_id: str
    ok: bool
    expected_cash: Decimal | None = None
    stored_cash: Decimal | None = None
    difference: Decimal | None = None
    checked_at: str
    detail: str


class LedgerEntryOut(CamelModel):
    id: str
    at: str
    kind: str
    amount: Decimal
    currency: str
    reference: str
    source: str
    detail: dict[str, Any] = Field(default_factory=dict)


class MarketDataHealthOut(CamelModel):
    provider: str
    configured: bool
    last_success_at: str | None = None
    last_error: str | None = None
    last_error_at: str | None = None
    consecutive_failures: int = 0
    latency_ms: float | None = None


class MarketRefreshOut(CamelModel):
    refreshed: int
    quotes: list[Quote] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


def jsonable(value: Any) -> Any:
    """Convert Python values to the JSON shape the frontend expects.

    ``Decimal`` becomes a JSON number, not a string: the TypeScript contract
    declares these fields as ``number`` and the UI does arithmetic on them.
    Precision is preserved in the database and in Python; only the wire format
    is a float.
    """
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, datetime):
        return value.isoformat().replace("+00:00", "Z")
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, dict):
        return {key: jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [jsonable(item) for item in value]
    return value


def dump(model: BaseModel) -> dict[str, Any]:
    """Serialise a model to the camelCase wire shape."""
    return jsonable(model.model_dump(by_alias=True))


def dump_many(models: list[BaseModel]) -> list[dict[str, Any]]:
    return [dump(model) for model in models]


def as_iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.isoformat().replace("+00:00", "Z")
