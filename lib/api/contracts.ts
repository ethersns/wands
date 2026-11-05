/**
 * Wands data contracts.
 *
 * These types are the single source of truth shared between the Next.js
 * frontend and the private Python trading service. The frontend never talks to
 * an exchange or broker directly — every value here is produced by the engine.
 */

export type TradingMode = "backtest" | "paper" | "live";

export type MarketType = "crypto" | "stocks";

/**
 * Where a payload came from. The UI must surface this on every figure so a
 * demonstration value can never be mistaken for a real account balance.
 */
export type DataProvenance = "live" | "demo" | "unavailable";

/**
 * The quality of a market-data observation. `delayed` is never real-time, and
 * `historical` is never an executable price. Only `live` data that is fresh,
 * two-sided and in an open session can price an order.
 */
export type DataQuality =
  | "live"
  | "delayed"
  | "historical"
  | "simulated"
  | "unavailable";

/** Where a position or balance came from. */
export type PositionSource = "paper_simulated" | "broker_confirmed";

export type Currency = "USD" | "EUR" | "GBP" | "JPY" | "AUD" | "CHF";

export interface Envelope<T> {
  data: T;
  provenance: DataProvenance;
  /** ISO-8601 timestamp of when the engine produced this payload. */
  generatedAt: string;
  /** Human-readable origin, e.g. "wands-engine" or "demo-fixture". */
  source: string;
  warnings: string[];
}

export interface ApiError {
  code:
    | "not_configured"
    | "unreachable"
    | "unauthorized"
    | "timeout"
    | "bad_request"
    | "server_error";
  message: string;
  /** HTTP status when the failure came from the engine itself. */
  status?: number;
}

export type ApiResult<T> =
  | { ok: true; envelope: Envelope<T> }
  | { ok: false; error: ApiError };

/* ------------------------------------------------------------------ */
/* Engine                                                              */
/* ------------------------------------------------------------------ */

export type EngineState =
  | "operational"
  | "degraded"
  | "paused"
  | "halted"
  | "offline";

export interface EngineStatus {
  state: EngineState;
  mode: TradingMode;
  /** Live trading is off until explicitly authorised server-side. */
  liveTradingEnabled: boolean;
  version: string;
  region: string;
  uptimeSeconds: number;
  lastHeartbeat: string;
  /** Round-trip latency to the market-data feed, in ms. */
  marketDataLatencyMs: number | null;
  /** Age of the oldest quote currently in use, in seconds. */
  stalestQuoteAgeSeconds: number | null;
  activeBots: number;
  queuedJobs: number;
  notes: string[];
}

/* ------------------------------------------------------------------ */
/* Accounts & portfolio                                                */
/* ------------------------------------------------------------------ */

export type ConnectionStatus =
  | "connected"
  | "degraded"
  | "disconnected"
  | "not_configured";

export type AccessLevel = "read_only" | "trading";

export interface BrokerAccount {
  id: string;
  provider: "kraken" | "alpaca" | "interactive_brokers";
  label: string;
  marketType: MarketType;
  status: ConnectionStatus;
  access: AccessLevel;
  mode: TradingMode;
  baseCurrency: Currency;
  /** Null when the engine has never completed a sync. */
  lastSyncedAt: string | null;
  equity: number | null;
  cash: number | null;
  buyingPower: number | null;
  permissions: string[];
  error: string | null;
  /** `paper_simulated` balances are never presented as venue balances. */
  source?: PositionSource | null;
  /** False when a position or FX rate is missing, so equity is unknown. */
  verified?: boolean;
}

export interface Position {
  id: string;
  accountId: string;
  symbol: string;
  name: string;
  marketType: MarketType;
  quantity: number;
  averageEntryPrice: number;
  lastPrice: number | null;
  marketValue: number | null;
  unrealisedPnl: number | null;
  unrealisedPnlPct: number | null;
  realisedPnl: number;
  feesPaid: number;
  openedAt: string;
  strategyId: string | null;
  botId: string | null;
  source?: PositionSource;
  /** Quality of the price used to value this position. */
  priceQuality?: DataQuality | null;
  priceAsOf?: string | null;
  priceAgeSeconds?: number | null;
  priceStale?: boolean;
}

export interface AllocationSlice {
  key: string;
  label: string;
  value: number;
  pct: number;
}

export interface EquityPoint {
  /** ISO-8601 timestamp. */
  t: string;
  equity: number;
  /** Benchmark (buy-and-hold) value for the same instant. */
  benchmark: number | null;
}

export interface PortfolioSummary {
  baseCurrency: Currency;
  totalEquity: number | null;
  cash: number | null;
  /** Capital committed to open orders. Not spendable. */
  reserved?: number | null;
  buyingPower: number | null;
  /** False when a price or FX rate is missing, so equity is unknown. */
  verified?: boolean;
  dayPnl: number | null;
  dayPnlPct: number | null;
  realisedPnl: number | null;
  unrealisedPnl: number | null;
  feesPaid: number | null;
  openPositions: number;
  equityCurve: EquityPoint[];
  allocation: AllocationSlice[];
  byMarket: Record<MarketType, { equity: number | null; pct: number | null }>;
  accounts: BrokerAccount[];
  positions: Position[];
}

/* ------------------------------------------------------------------ */
/* Markets                                                             */
/* ------------------------------------------------------------------ */

export type MarketSessionState = "open" | "closed" | "pre" | "post" | "always";

export interface Quote {
  symbol: string;
  name: string;
  marketType: MarketType;
  price: number | null;
  change24hPct: number | null;
  changeAbs: number | null;
  volume24h: number | null;
  high24h: number | null;
  low24h: number | null;
  /** Annualised volatility estimate, percent. */
  volatilityPct: number | null;
  session: MarketSessionState;
  /** ISO-8601 timestamp of the quote itself. */
  asOf: string | null;
  /** Seconds since the quote was produced. */
  ageSeconds: number | null;
  stale: boolean;
  strategyEligible: boolean;
  provider?: string | null;
  bid?: number | null;
  ask?: number | null;
  mid?: number | null;
  spreadPct?: number | null;
  quality?: DataQuality | null;
  /**
   * The price an order may be priced against. Null when the quote is not live,
   * not fresh, one-sided, or the session is closed. A candle close is never
   * substituted for this.
   */
  executablePrice?: number | null;
  /** `provider` when the venue stamped the quote, `receipt` when it did not. */
  timestampSource?: string | null;
}

export interface Candle {
  /** Unix seconds, UTC. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CandleSeries {
  symbol: string;
  interval: "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
  candles: Candle[];
}

export interface MarketOverview {
  quotes: Quote[];
  watchlist: string[];
  /** ISO-8601 timestamp of the most recent successful feed update. */
  feedUpdatedAt: string | null;
  feedHealthy: boolean;
}

/* ------------------------------------------------------------------ */
/* Strategies & bots                                                   */
/* ------------------------------------------------------------------ */

export type StrategyCategory =
  | "trend_following"
  | "mean_reversion"
  | "momentum"
  | "grid"
  | "market_making"
  | "arbitrage"
  | "custom";

export interface StrategyParameter {
  key: string;
  label: string;
  type: "number" | "percent" | "select" | "boolean";
  value: number | string | boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: { label: string; value: string }[];
  help: string;
}

export interface Strategy {
  id: string;
  name: string;
  category: StrategyCategory;
  description: string;
  supportedMarkets: MarketType[];
  /** Arbitrage and other research-only strategies cannot be deployed live. */
  deployment: "paper_only" | "paper_and_live";
  parameters: StrategyParameter[];
  updatedAt: string;
}

export type BotState = "running" | "paused" | "stopped" | "error";

export interface TradingBot {
  id: string;
  name: string;
  marketType: MarketType;
  accountId: string;
  accountLabel: string;
  strategyId: string;
  strategyName: string;
  symbols: string[];
  timeframe: string;
  mode: TradingMode;
  state: BotState;
  allocatedCapital: number;
  positionSizePct: number;
  stopLossPct: number;
  takeProfitPct: number;
  maxOpenPositions: number;
  dailyLossLimitPct: number;
  schedule: string;
  createdAt: string;
  lastRunAt: string | null;
  stats: {
    trades: number;
    winRatePct: number | null;
    pnl: number | null;
    pnlPct: number | null;
    maxDrawdownPct: number | null;
  };
  lastError: string | null;
}

export interface BotLogEntry {
  id: string;
  botId: string;
  at: string;
  level: "info" | "warn" | "error";
  message: string;
}

/* ------------------------------------------------------------------ */
/* Backtesting                                                         */
/* ------------------------------------------------------------------ */

export interface BacktestMetrics {
  totalReturnPct: number | null;
  benchmarkReturnPct: number | null;
  profitFactor: number | null;
  maxDrawdownPct: number | null;
  winRatePct: number | null;
  averageWin: number | null;
  averageLoss: number | null;
  sharpe: number | null;
  trades: number;
  feesPaid: number | null;
  estimatedSlippage: number | null;
}

export interface BacktestTrade {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  entryAt: string;
  exitAt: string | null;
  entryPrice: number;
  exitPrice: number | null;
  quantity: number;
  pnl: number | null;
  pnlPct: number | null;
  fees: number;
}

export interface BacktestResult {
  id: string;
  strategyId: string;
  strategyName: string;
  symbols: string[];
  timeframe: string;
  from: string;
  to: string;
  initialCapital: number;
  metrics: BacktestMetrics;
  equityCurve: EquityPoint[];
  trades: BacktestTrade[];
  createdAt: string;
  /** Walk-forward validation summary, when the run included it. */
  walkForward: {
    folds: number;
    inSampleReturnPct: number | null;
    outOfSampleReturnPct: number | null;
    verdict: "passed" | "failed" | "inconclusive";
  } | null;
}

/* ------------------------------------------------------------------ */
/* Orders & fills                                                      */
/* ------------------------------------------------------------------ */

export type OrderStatus =
  | "open"
  | "partially_filled"
  | "filled"
  | "cancelled"
  | "rejected";

export type ReconciliationState = "matched" | "pending" | "mismatch";

export interface Order {
  id: string;
  clientOrderId: string;
  accountId: string;
  accountLabel: string;
  symbol: string;
  marketType: MarketType;
  side: "buy" | "sell";
  type: "market" | "limit" | "stop" | "stop_limit";
  status: OrderStatus;
  quantity: number;
  filledQuantity: number;
  limitPrice: number | null;
  averageFillPrice: number | null;
  fees: number | null;
  mode: TradingMode;
  botId: string | null;
  strategyName: string | null;
  createdAt: string;
  updatedAt: string;
  exchangeConfirmationId: string | null;
  reconciliation: ReconciliationState;
  rejectReason: string | null;
}

export interface Fill {
  id: string;
  orderId: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  fees: number;
  at: string;
}

export interface TradeIntent {
  id: string;
  symbol: string;
  marketType: MarketType;
  side: "buy" | "sell";
  quantity: number;
  type: "market" | "limit";
  limitPrice: number | null;
  accountId: string;
  mode: TradingMode;
  rationale: string;
  createdAt: string;
  status: "proposed" | "approved" | "rejected" | "expired";
}

/* ------------------------------------------------------------------ */
/* Risk                                                                */
/* ------------------------------------------------------------------ */

export interface RiskPolicy {
  maxPortfolioExposurePct: number;
  maxPositionExposurePct: number;
  perTradeRiskPct: number;
  dailyLossLimitPct: number;
  maxDrawdownPct: number;
  cryptoAllocationCapPct: number;
  stocksAllocationCapPct: number;
  maxQuoteAgeSeconds: number;
  duplicateOrderWindowSeconds: number;
  tradingPaused: boolean;
  emergencyStopEngaged: boolean;
  updatedAt: string;
}

export type RiskSeverity = "info" | "warning" | "critical";

export interface RiskEvent {
  id: string;
  at: string;
  severity: RiskSeverity;
  category:
    | "exposure"
    | "drawdown"
    | "circuit_breaker"
    | "stale_data"
    | "duplicate_order"
    | "permission"
    | "emergency_stop"
    | "policy_change";
  title: string;
  detail: string;
  acknowledged: boolean;
  actor: string;
}

export interface RiskSnapshot {
  policy: RiskPolicy;
  /** Current utilisation of each limit, as a percentage of the limit. */
  utilisation: {
    portfolioExposurePct: number | null;
    largestPositionPct: number | null;
    dailyLossPct: number | null;
    drawdownPct: number | null;
    cryptoAllocationPct: number | null;
    stocksAllocationPct: number | null;
  };
  breaches: {
    key: string;
    label: string;
    severity: RiskSeverity;
    detail: string;
  }[];
  events: RiskEvent[];
}

/* ------------------------------------------------------------------ */
/* Connections                                                         */
/* ------------------------------------------------------------------ */

export interface Connection {
  id: string;
  provider: "kraken" | "alpaca" | "interactive_brokers";
  label: string;
  marketType: MarketType;
  status: ConnectionStatus;
  access: AccessLevel;
  mode: TradingMode;
  /** Only the last four characters are ever returned by the engine. */
  keyHint: string | null;
  permissions: string[];
  lastSyncedAt: string | null;
  error: string | null;
  /** Whether the adapter exists in this build of the engine. */
  available: boolean;
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Paper accounts & verification                                       */
/* ------------------------------------------------------------------ */

export interface PaperAccount {
  id: string;
  connectionId: string;
  baseCurrency: Currency;
  startingCash: number;
  status: "active" | "reset";
  /** Always `paper_simulated`. There is no promotion path to live. */
  provenance: "paper_simulated";
  initialisedAt: string;
  initialisedBy: string;
  resetAt: string | null;
  resetBy: string | null;
  cash: number | null;
  reserved: number | null;
  buyingPower: number | null;
  equity: number | null;
  verified: boolean;
}

export interface PortfolioVerification {
  connectionId: string;
  ok: boolean;
  expectedCash: number | null;
  storedCash: number | null;
  difference: number | null;
  checkedAt: string;
  detail: string;
}

export interface LedgerEntry {
  id: string;
  at: string;
  kind:
    | "initialisation"
    | "deposit"
    | "withdrawal"
    | "fill"
    | "fee"
    | "transfer"
    | "reservation"
    | "release";
  amount: number;
  currency: Currency;
  reference: string;
  source: PositionSource;
  detail: Record<string, unknown>;
}

export interface MarketDataHealth {
  provider: string;
  configured: boolean;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  consecutiveFailures: number;
  latencyMs: number | null;
}

export interface UserSettings {
  displayName: string;
  email: string;
  baseCurrency: Currency;
  theme: "dark" | "light" | "system";
  twoFactorEnabled: boolean;
  notifications: {
    tradeFills: boolean;
    riskBreaches: boolean;
    engineOffline: boolean;
    dailySummary: boolean;
  };
  engine: {
    endpointConfigured: boolean;
    region: string;
    heartbeatSeconds: number;
  };
  audit: {
    lastBackupAt: string | null;
    retentionDays: number;
  };
}
