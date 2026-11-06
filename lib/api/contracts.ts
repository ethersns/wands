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

/* ------------------------------------------------------------------ */
/* Intelligence                                                        */
/*                                                                     */
/* Research data is a different kind of claim from market data. A      */
/* filing is reported by a named person to the SEC; a signal is        */
/* computed by us from those filings and can be wrong. Neither is a    */
/* price, and neither may be rendered as one.                          */
/* ------------------------------------------------------------------ */

/**
 * How current a collector is. Derived from completed ingestion runs, so a
 * collector that has silently stopped shows as `stale` rather than looking
 * populated.
 */
export type IntelFreshness = "fresh" | "stale" | "never" | "failing";

export interface IntelSourceStatus {
  source: string;
  status: IntelFreshness;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  ageSeconds: number | null;
  staleAfterSeconds: number;
  detail: string;
}

export interface IntelStatus {
  enabled: boolean;
  freshness: IntelFreshness;
  sources: IntelSourceStatus[];
  filings: number;
  transactions: number;
  signals: number;
  institutions: number;
  holdings: number;
  symbolsCovered: string[];
  latestFilingAt: string | null;
  latestSignalAt: string | null;
  signalEngineVersion: string;
  caveats: string[];
}

/**
 * What a reported transaction actually was. Only `open_market_purchase` and
 * `open_market_sale` are decisions to trade in the market; the rest move shares
 * for other reasons and must not be presented as buying or selling.
 */
export type InsiderTransactionClass =
  | "open_market_purchase"
  | "open_market_sale"
  | "award_grant"
  | "tax_withholding"
  | "gift"
  | "derivative_exercise"
  | "disposition_to_issuer"
  | "other";

export interface InsiderTransaction {
  id: string;
  accessionNumber: string;
  symbol: string;
  issuerName: string;
  reportingPersonName: string;
  reportingPersonCik: string;
  /** e.g. "Director and officer (Chief Executive Officer)". */
  role: string;
  /** The date the transaction happened. Never the date it became public. */
  transactionDate: string | null;
  transactionCode: string;
  classification: InsiderTransactionClass;
  isOpenMarket: boolean;
  securityTitle: string;
  shares: number | null;
  pricePerShare: number | null;
  /** `null` when the filing reported no price. Never zero. */
  value: number | null;
  sharesOwnedAfter: number | null;
  directOrIndirect: string;
  /** The SEC acceptance time: when this became public. */
  acceptedAt: string;
  isAmendment: boolean;
  sourceUrl: string;
  description: string;
  dataQuality: "reported" | "incomplete";
}

export interface InsiderFeed {
  items: InsiderTransaction[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface InsiderSymbolSummary {
  symbol: string;
  issuerName: string;
  windowDays: number;
  purchaseCount: number;
  saleCount: number;
  distinctPurchasers: number;
  distinctSellers: number;
  /** `null` when no purchase reported a price. */
  purchaseValueUsd: number | null;
  unpricedPurchaseLines: number;
  latestFilingAt: string | null;
  latestTransactionDate: string | null;
  caveats: string[];
}

export type ResearchSignalCategory =
  | "INSIDER_PURCHASE_CLUSTER"
  | "INSIDER_PURCHASE_VALUE"
  | "INSIDER_ACTIVITY_CHANGE"
  | "INSIDER_SELLING_CLUSTER"
  | "INSTITUTIONAL_POSITION_CHANGE"
  | "MARKET_TREND"
  | "VOLUME_ANOMALY";

export interface ResearchSignal {
  id: string;
  category: ResearchSignalCategory;
  symbol: string;
  sourceEventIds: string[];
  /** When the underlying activity happened. */
  eventTime: string;
  /** When the source information became public. A backtest may not use the
   * signal before this instant. */
  publicAvailableAt: string;
  calculatedAt: string;
  rawMeasurement: number;
  rawUnit: string;
  /** A bounded research ranking on a 0-100 scale. Not a probability. */
  score: number | null;
  explanation: string;
  dataQuality: "reported" | "derived" | "incomplete" | "unavailable";
  confidenceNotes: string;
  parameters: Record<string, unknown>;
  engineVersion: string;
}

export interface SignalFeed {
  items: ResearchSignal[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export type InstitutionalChangeType =
  | "new"
  | "exited"
  | "increased"
  | "decreased"
  | "unchanged";

export interface InstitutionalHoldingChange {
  cusip: string;
  issuerName: string;
  classTitle: string;
  changeType: InstitutionalChangeType;
  currentShares: number | null;
  priorShares: number | null;
  currentValueUsd: number | null;
  priorValueUsd: number | null;
  shareChange: number | null;
  shareChangePct: number | null;
  /** The quarter end. Not the date the filing was published. */
  periodOfReport: string;
  priorPeriodOfReport: string | null;
  publicAvailableAt: string;
  sourceUrl: string;
}

export interface Institution {
  cik: string;
  name: string;
  periods: string[];
  latestPeriod: string | null;
  latestPublicAvailableAt: string | null;
  reportedValueUsd: number | null;
  positionCount: number;
  caveats: string[];
}

export interface InstitutionFeed {
  items: Institution[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface InstitutionChanges {
  cik: string;
  name: string;
  periodOfReport: string | null;
  priorPeriodOfReport: string | null;
  changes: InstitutionalHoldingChange[];
  caveats: string[];
}

export interface FusionComponent {
  name: string;
  category: ResearchSignalCategory;
  measurement: number;
  unit: string;
  score: number | null;
  publicAvailableAt: string;
  explanation: string;
  dataQuality: string;
  source: string;
}

export interface FusionRanking {
  symbol: string;
  asOf: string;
  components: FusionComponent[];
  /** `null` when no component is available. Never a zero standing in for
   * "no evidence". */
  compositeScore: number | null;
  /** How much of the total weight is actually present, 0-1. */
  coverage: number;
  explanation: string;
  dataQuality: string;
  caveats: string[];
}

export interface SymbolResearchSummary {
  symbol: string;
  asOf: string;
  insider: InsiderSymbolSummary;
  signals: ResearchSignal[];
  fusion: FusionRanking;
  freshness: IntelFreshness;
  caveats: string[];
}

/* ------------------------------------------------------------------ */
/* Research operations (intelligence 1.1)                              */
/*                                                                     */
/* These describe the machinery that produces the research above, not  */
/* the research itself. A job that has stopped, a backfill that could  */
/* not fetch a filing, and an experiment that ran out of price data    */
/* are all states the UI has to be able to show honestly.              */
/* ------------------------------------------------------------------ */

export type IntelJobStatus =
  | "idle"
  | "running"
  | "failed"
  | "paused"
  | "interrupted";

export interface IntelJob {
  name: string;
  kind: string;
  scheduleSeconds: number;
  enabled: boolean;
  paused: boolean;
  status: IntelJobStatus;
  lastStatus: string;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  nextRunAt: string | null;
  lastError: string;
  consecutiveFailures: number;
  totalRuns: number;
  totalFailures: number;
  /** The worker holding the lease, or `null` when the job is not running. */
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  metrics: Record<string, unknown>;
}

export interface IntelJobFeed {
  items: IntelJob[];
  total: number;
  schedulerEnabled: boolean;
  caveats: string[];
}

export type IntelBackfillStatus =
  | "pending"
  | "running"
  | "complete"
  | "paused"
  | "failed";

export interface IntelBackfillStream {
  issuerCik: string;
  formFamily: string;
  status: IntelBackfillStatus;
  /** The acceptance time of the last filing persisted. `null` means the
   * stream has not stored anything yet, not that it is finished. */
  cursor: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  filingsSeen: number;
  filingsNew: number;
  filingsSkipped: number;
  /** Filings the SEC index listed but whose document could not be fetched. */
  filingsUnavailable: number;
  /** Filings that were fetched but could not be parsed. */
  filingsMalformed: number;
  attempts: number;
  lastError: string;
}

export interface IntelCoverage {
  filings: number;
  transactions: number;
  signals: number;
  institutions: number;
  holdings: number;
  earliestFilingAt: string | null;
  latestFilingAt: string | null;
  earliestSignalAt: string | null;
  latestSignalAt: string | null;
  symbolsCovered: string[];
  /** Identifier resolution counts, including unresolved CUSIPs. */
  identifiers: Record<string, unknown>;
  backfill: IntelBackfillStream[];
  /** Which symbols have usable historical prices, and which do not. */
  priceCoverage: Record<string, unknown>;
  caveats: string[];
}

export type IntelExperimentStatus =
  | "complete"
  | "insufficient_data"
  | "no_price_data"
  | "failed";

export interface IntelExperiment {
  id: string;
  name: string;
  signalVersion: string;
  dataVersion: string;
  periodStart: string;
  periodEnd: string;
  /** No signal published after this instant may enter the sample. */
  informationCutoff: string;
  benchmark: string;
  parameters: Record<string, unknown>;
  executionAssumptions: Record<string, unknown>;
  costAssumptions: Record<string, unknown>;
  sampleSize: number;
  coverage: Record<string, unknown>;
  metrics: Record<string, unknown>;
  status: IntelExperimentStatus;
  /** Why a result is incomplete. Empty only when the experiment is sound. */
  flags: string[];
  /** Identifies the definition. Two runs with the same hash are comparable. */
  definitionHash: string;
  /** Identifies the input data. A changed fingerprint means the data moved. */
  dataFingerprint: string;
  createdAt: string;
  completedAt: string | null;
}

export interface IntelExperimentFeed {
  items: IntelExperiment[];
  total: number;
  caveats: string[];
}

export type IntelValidationStatus =
  | "complete"
  | "insufficient_sample"
  | "no_price_data"
  | "no_signals";

export interface IntelValidation {
  signalId: string;
  category: ResearchSignalCategory;
  status: IntelValidationStatus;
  benchmark: string;
  costBps: number;
  sampleSize: number;
  coverage: Record<string, unknown>;
  flags: string[];
  /** How much the sample overlaps itself. Overlapping windows are not
   * independent observations. */
  overlap: Record<string, unknown>;
  multipleTesting: Record<string, unknown> | null;
  horizons: Record<string, unknown>[];
  splits: Record<string, unknown>[];
}

export interface IntelBackfillRequest {
  ciks?: string[];
  formFamily?: "ownership" | "institutional";
  startDate?: string;
  endDate?: string;
  maxFilings?: number;
}

export interface IntelBackfillResult {
  source: string;
  status: "ok" | "partial" | "failed" | "paused";
  streams: number;
  completed: number;
  failed: number;
  paused: number;
  filingsSeen: number;
  filingsNew: number;
  filingsSkipped: number;
  filingsUnavailable: number;
  filingsMalformed: number;
  stoppedEarly: boolean;
  errors: { kind: string; message: string }[];
  progress: IntelBackfillStream[];
}
