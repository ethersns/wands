import type {
  BacktestResult,
  BotLogEntry,
  BrokerAccount,
  Candle,
  CandleSeries,
  Connection,
  EngineStatus,
  EquityPoint,
  Fill,
  MarketOverview,
  Order,
  PaperAccount,
  PortfolioSummary,
  Position,
  Quote,
  RiskSnapshot,
  Strategy,
  TradingBot,
  UserSettings,
} from "./contracts";

/**
 * Deterministic demonstration fixtures.
 *
 * These exist so the interface can be evaluated before the Python engine is
 * deployed. Every payload built from this module is tagged `provenance: "demo"`
 * and the UI renders that tag next to the figures — demo values are never
 * presented as a real account.
 */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY = 86_400_000;

function iso(offsetMs: number) {
  return new Date(Date.now() + offsetMs).toISOString();
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/* ------------------------------------------------------------------ */
/* Engine                                                              */
/* ------------------------------------------------------------------ */

export const demoEngineStatus: EngineStatus = {
  state: "operational",
  mode: "paper",
  liveTradingEnabled: false,
  version: "0.4.2-demo",
  region: "fra1",
  uptimeSeconds: 412_800,
  lastHeartbeat: iso(-4_000),
  marketDataLatencyMs: 84,
  stalestQuoteAgeSeconds: 3,
  activeBots: 3,
  queuedJobs: 1,
  notes: [
    "Running in paper mode. Live order routing is disabled at the engine level.",
    "Kraken adapter is read-only until trading permissions are granted.",
  ],
};

/* ------------------------------------------------------------------ */
/* Accounts                                                            */
/* ------------------------------------------------------------------ */

const demoAccountSeeds: BrokerAccount[] = [
  {
    id: "acct-kraken-paper",
    provider: "kraken",
    label: "Kraken · Paper",
    marketType: "crypto",
    status: "connected",
    access: "read_only",
    mode: "paper",
    baseCurrency: "USD",
    lastSyncedAt: iso(-42_000),
    equity: 68_420.55,
    cash: 21_180.4,
    buyingPower: 21_180.4,
    permissions: ["balances:read", "orders:read", "marketdata:read"],
    error: null,
  },
  {
    id: "acct-alpaca-paper",
    provider: "alpaca",
    label: "Alpaca · Paper",
    marketType: "stocks",
    status: "connected",
    access: "read_only",
    mode: "paper",
    baseCurrency: "USD",
    lastSyncedAt: iso(-18_000),
    equity: 54_910.12,
    cash: 12_640.9,
    buyingPower: 25_281.8,
    permissions: ["account:read", "positions:read", "marketdata:read"],
    error: null,
  },
  {
    id: "acct-ibkr",
    provider: "interactive_brokers",
    label: "Interactive Brokers",
    marketType: "stocks",
    status: "not_configured",
    access: "read_only",
    mode: "paper",
    baseCurrency: "USD",
    lastSyncedAt: null,
    equity: null,
    cash: null,
    buyingPower: null,
    permissions: [],
    error: "Adapter not available in this engine build.",
  },
];

export const demoAccounts: BrokerAccount[] = demoAccountSeeds.map((account) => ({
  ...account,
  source: account.mode === "paper" ? "paper_simulated" : "broker_confirmed",
  verified: account.status === "connected",
}));

export const demoPaperAccounts: PaperAccount[] = demoAccounts
  .filter((account) => account.mode === "paper" && account.status === "connected")
  .map((account) => ({
    id: `paper-${account.id}`,
    connectionId: account.id,
    baseCurrency: account.baseCurrency,
    startingCash: 100_000,
    status: "active",
    provenance: "paper_simulated",
    initialisedAt: iso(-21 * DAY),
    initialisedBy: "demo",
    resetAt: null,
    resetBy: null,
    cash: account.cash,
    reserved: 0,
    buyingPower: account.buyingPower,
    equity: account.equity,
    verified: true,
  }));

/* ------------------------------------------------------------------ */
/* Positions                                                           */
/* ------------------------------------------------------------------ */

const demoPositionSeeds: Position[] = [
  {
    id: "pos-btc",
    accountId: "acct-kraken-paper",
    symbol: "BTC/USD",
    name: "Bitcoin",
    marketType: "crypto",
    quantity: 0.412,
    averageEntryPrice: 61_240.5,
    lastPrice: 67_812.4,
    marketValue: 27_938.71,
    unrealisedPnl: 2_707.62,
    unrealisedPnlPct: 10.73,
    realisedPnl: 1_184.2,
    feesPaid: 96.4,
    openedAt: iso(-38 * DAY),
    strategyId: "strat-trend",
    botId: "bot-btc-trend",
  },
  {
    id: "pos-eth",
    accountId: "acct-kraken-paper",
    symbol: "ETH/USD",
    name: "Ethereum",
    marketType: "crypto",
    quantity: 6.84,
    averageEntryPrice: 3_120.8,
    lastPrice: 3_284.15,
    marketValue: 22_463.59,
    unrealisedPnl: 1_117.13,
    unrealisedPnlPct: 5.23,
    realisedPnl: 402.8,
    feesPaid: 61.2,
    openedAt: iso(-21 * DAY),
    strategyId: "strat-momentum",
    botId: "bot-eth-momentum",
  },
  {
    id: "pos-sol",
    accountId: "acct-kraken-paper",
    symbol: "SOL/USD",
    name: "Solana",
    marketType: "crypto",
    quantity: 118.5,
    averageEntryPrice: 148.2,
    lastPrice: 141.06,
    marketValue: 16_715.61,
    unrealisedPnl: -846.09,
    unrealisedPnlPct: -4.82,
    realisedPnl: -128.4,
    feesPaid: 34.8,
    openedAt: iso(-9 * DAY),
    strategyId: "strat-grid",
    botId: "bot-sol-grid",
  },
  {
    id: "pos-nvda",
    accountId: "acct-alpaca-paper",
    symbol: "NVDA",
    name: "NVIDIA Corp",
    marketType: "stocks",
    quantity: 42,
    averageEntryPrice: 118.4,
    lastPrice: 131.86,
    marketValue: 5_538.12,
    unrealisedPnl: 565.32,
    unrealisedPnlPct: 11.37,
    realisedPnl: 0,
    feesPaid: 2.1,
    openedAt: iso(-27 * DAY),
    strategyId: "strat-momentum",
    botId: "bot-equity-momentum",
  },
  {
    id: "pos-msft",
    accountId: "acct-alpaca-paper",
    symbol: "MSFT",
    name: "Microsoft Corp",
    marketType: "stocks",
    quantity: 18,
    averageEntryPrice: 402.15,
    lastPrice: 418.72,
    marketValue: 7_536.96,
    unrealisedPnl: 298.26,
    unrealisedPnlPct: 4.12,
    realisedPnl: 0,
    feesPaid: 1.8,
    openedAt: iso(-16 * DAY),
    strategyId: "strat-trend",
    botId: "bot-equity-momentum",
  },
  {
    id: "pos-spy",
    accountId: "acct-alpaca-paper",
    symbol: "SPY",
    name: "SPDR S&P 500 ETF",
    marketType: "stocks",
    quantity: 34,
    averageEntryPrice: 552.4,
    lastPrice: 561.18,
    marketValue: 19_080.12,
    unrealisedPnl: 298.52,
    unrealisedPnlPct: 1.59,
    realisedPnl: 0,
    feesPaid: 3.4,
    openedAt: iso(-64 * DAY),
    strategyId: null,
    botId: null,
  },
];

export const demoPositions: Position[] = demoPositionSeeds.map((position) => ({
  ...position,
  source: "paper_simulated",
  priceQuality: "live",
  priceAsOf: iso(-4_000),
  priceAgeSeconds: 4,
  priceStale: false,
}));

/* ------------------------------------------------------------------ */
/* Equity curve                                                        */
/* ------------------------------------------------------------------ */

function buildEquityCurve(days: number, start: number, seed: number): EquityPoint[] {
  const rand = mulberry32(seed);
  const points: EquityPoint[] = [];
  let equity = start;
  let benchmark = start;

  for (let i = days; i >= 0; i -= 1) {
    const drift = 0.0011;
    const shock = (rand() - 0.5) * 0.019;
    equity = equity * (1 + drift + shock);
    benchmark = benchmark * (1 + 0.0006 + (rand() - 0.5) * 0.013);
    points.push({
      t: new Date(Date.now() - i * DAY).toISOString(),
      equity: round(equity, 2),
      benchmark: round(benchmark, 2),
    });
  }
  return points;
}

const equityCurve = buildEquityCurve(180, 96_000, 20_260_511);

/* ------------------------------------------------------------------ */
/* Portfolio                                                           */
/* ------------------------------------------------------------------ */

const cryptoEquity = demoPositions
  .filter((p) => p.marketType === "crypto")
  .reduce((sum, p) => sum + (p.marketValue ?? 0), 0);
const stocksEquity = demoPositions
  .filter((p) => p.marketType === "stocks")
  .reduce((sum, p) => sum + (p.marketValue ?? 0), 0);
const totalEquity = cryptoEquity + stocksEquity + 33_821.3;

export const demoPortfolio: PortfolioSummary = {
  baseCurrency: "USD",
  totalEquity: round(totalEquity, 2),
  cash: 33_821.3,
  reserved: 1_240.5,
  buyingPower: 46_462.2,
  verified: true,
  dayPnl: 1_284.62,
  dayPnlPct: 1.04,
  realisedPnl: 1_458.6,
  unrealisedPnl: 3_842.76,
  feesPaid: 199.7,
  openPositions: demoPositions.length,
  equityCurve,
  allocation: [
    { key: "crypto", label: "Crypto", value: round(cryptoEquity, 2), pct: 0 },
    { key: "stocks", label: "Stocks & ETFs", value: round(stocksEquity, 2), pct: 0 },
    { key: "cash", label: "Cash", value: 33_821.3, pct: 0 },
  ].map((slice) => ({
    ...slice,
    pct: round((slice.value / totalEquity) * 100, 1),
  })),
  byMarket: {
    crypto: {
      equity: round(cryptoEquity, 2),
      pct: round((cryptoEquity / totalEquity) * 100, 1),
    },
    stocks: {
      equity: round(stocksEquity, 2),
      pct: round((stocksEquity / totalEquity) * 100, 1),
    },
  },
  accounts: demoAccounts,
  positions: demoPositions,
};

/* ------------------------------------------------------------------ */
/* Markets                                                             */
/* ------------------------------------------------------------------ */

interface QuoteSeed {
  symbol: string;
  name: string;
  marketType: "crypto" | "stocks";
  price: number;
  change: number;
  volume: number;
  vol: number;
  session: Quote["session"];
  eligible: boolean;
}

const quoteSeeds: QuoteSeed[] = [
  { symbol: "BTC/USD", name: "Bitcoin", marketType: "crypto", price: 67_812.4, change: 2.41, volume: 28_400_000_000, vol: 42.6, session: "always", eligible: true },
  { symbol: "ETH/USD", name: "Ethereum", marketType: "crypto", price: 3_284.15, change: 1.18, volume: 14_100_000_000, vol: 51.2, session: "always", eligible: true },
  { symbol: "SOL/USD", name: "Solana", marketType: "crypto", price: 141.06, change: -3.62, volume: 3_820_000_000, vol: 78.4, session: "always", eligible: true },
  { symbol: "AVAX/USD", name: "Avalanche", marketType: "crypto", price: 27.84, change: -1.94, volume: 412_000_000, vol: 84.1, session: "always", eligible: true },
  { symbol: "LINK/USD", name: "Chainlink", marketType: "crypto", price: 14.62, change: 4.08, volume: 298_000_000, vol: 69.3, session: "always", eligible: true },
  { symbol: "ARB/USD", name: "Arbitrum", marketType: "crypto", price: 0.742, change: -5.21, volume: 121_000_000, vol: 96.7, session: "always", eligible: false },
  { symbol: "NVDA", name: "NVIDIA Corp", marketType: "stocks", price: 131.86, change: 1.92, volume: 214_000_000, vol: 38.4, session: "open", eligible: true },
  { symbol: "MSFT", name: "Microsoft Corp", marketType: "stocks", price: 418.72, change: 0.64, volume: 18_400_000, vol: 21.8, session: "open", eligible: true },
  { symbol: "AAPL", name: "Apple Inc", marketType: "stocks", price: 228.14, change: -0.42, volume: 42_100_000, vol: 24.6, session: "open", eligible: true },
  { symbol: "SPY", name: "SPDR S&P 500 ETF", marketType: "stocks", price: 561.18, change: 0.31, volume: 61_200_000, vol: 14.2, session: "open", eligible: true },
  { symbol: "TSLA", name: "Tesla Inc", marketType: "stocks", price: 248.5, change: -2.18, volume: 88_400_000, vol: 62.1, session: "open", eligible: true },
  { symbol: "QQQ", name: "Invesco QQQ Trust", marketType: "stocks", price: 486.32, change: 0.88, volume: 31_800_000, vol: 19.4, session: "open", eligible: true },
];

export const demoQuotes: Quote[] = quoteSeeds.map((seed, index) => {
  const ageSeconds = index === 5 ? 412 : 2 + index * 3;
  const stale = ageSeconds > 300;
  const spreadBps = seed.marketType === "crypto" ? 8 : 3;
  const half = (seed.price * spreadBps) / 20_000;
  const quality = seed.eligible ? "live" : "delayed";
  return {
    symbol: seed.symbol,
    name: seed.name,
    marketType: seed.marketType,
    price: seed.price,
    change24hPct: seed.change,
    changeAbs: round((seed.price * seed.change) / 100, 2),
    volume24h: seed.volume,
    high24h: round(seed.price * 1.021, 2),
    low24h: round(seed.price * 0.978, 2),
    volatilityPct: seed.vol,
    session: seed.session,
    asOf: iso(-ageSeconds * 1_000),
    ageSeconds,
    stale,
    strategyEligible: seed.eligible && !stale,
    provider: seed.marketType === "crypto" ? "kraken" : "alpaca",
    bid: round(seed.price - half, 4),
    ask: round(seed.price + half, 4),
    mid: seed.price,
    spreadPct: spreadBps / 100,
    quality,
    executablePrice: seed.eligible && !stale ? seed.price : null,
    timestampSource: "provider",
  };
});

export const demoMarketOverview: MarketOverview = {
  quotes: demoQuotes,
  watchlist: ["BTC/USD", "ETH/USD", "SOL/USD", "NVDA", "MSFT", "SPY"],
  feedUpdatedAt: iso(-3_000),
  feedHealthy: true,
};

export function demoCandles(
  symbol: string,
  interval: CandleSeries["interval"] = "1h",
): CandleSeries {
  const seedQuote = demoQuotes.find((q) => q.symbol === symbol) ?? demoQuotes[0];
  const base = seedQuote.price ?? 100;
  const stepMs =
    interval === "1d"
      ? DAY
      : interval === "4h"
        ? 4 * 3_600_000
        : interval === "1h"
          ? 3_600_000
          : interval === "15m"
            ? 900_000
            : interval === "5m"
              ? 300_000
              : 60_000;
  const count = 180;
  const rand = mulberry32(
    symbol.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 7),
  );

  const candles: Candle[] = [];
  let price = base * 0.94;

  for (let i = count; i >= 0; i -= 1) {
    const open = price;
    const drift = (rand() - 0.47) * 0.012;
    const close = open * (1 + drift);
    const high = Math.max(open, close) * (1 + rand() * 0.004);
    const low = Math.min(open, close) * (1 - rand() * 0.004);
    candles.push({
      time: Math.floor((Date.now() - i * stepMs) / 1000),
      open: round(open, 4),
      high: round(high, 4),
      low: round(low, 4),
      close: round(close, 4),
      volume: round(rand() * 1_800 + 200, 0),
    });
    price = close;
  }

  return { symbol, interval, candles };
}

/* ------------------------------------------------------------------ */
/* Strategies                                                          */
/* ------------------------------------------------------------------ */

export const demoStrategies: Strategy[] = [
  {
    id: "strat-trend",
    name: "Adaptive Trend",
    category: "trend_following",
    description:
      "Follows sustained directional moves using a dual moving-average crossover with an ATR-based trailing stop.",
    supportedMarkets: ["crypto", "stocks"],
    deployment: "paper_and_live",
    parameters: [
      { key: "fastPeriod", label: "Fast MA", type: "number", value: 21, min: 5, max: 100, step: 1, help: "Lookback for the fast moving average." },
      { key: "slowPeriod", label: "Slow MA", type: "number", value: 89, min: 20, max: 300, step: 1, help: "Lookback for the slow moving average." },
      { key: "atrMultiplier", label: "ATR stop", type: "number", value: 2.4, min: 0.5, max: 6, step: 0.1, help: "Trailing stop distance in ATR units." },
      { key: "riskPerTrade", label: "Risk per trade", type: "percent", value: 0.75, min: 0.1, max: 3, step: 0.05, help: "Share of equity risked on a single entry." },
    ],
    updatedAt: iso(-6 * DAY),
  },
  {
    id: "strat-momentum",
    name: "Cross-Sectional Momentum",
    category: "momentum",
    description:
      "Ranks a universe by risk-adjusted return and holds the strongest names, rebalancing on a fixed cadence.",
    supportedMarkets: ["crypto", "stocks"],
    deployment: "paper_and_live",
    parameters: [
      { key: "lookback", label: "Lookback (days)", type: "number", value: 60, min: 10, max: 250, step: 5, help: "Window used to score momentum." },
      { key: "holdings", label: "Holdings", type: "number", value: 5, min: 1, max: 20, step: 1, help: "Number of instruments held at once." },
      { key: "rebalance", label: "Rebalance", type: "select", value: "weekly", options: [{ label: "Daily", value: "daily" }, { label: "Weekly", value: "weekly" }, { label: "Monthly", value: "monthly" }], help: "How often the ranking is refreshed." },
    ],
    updatedAt: iso(-2 * DAY),
  },
  {
    id: "strat-meanrev",
    name: "Bollinger Reversion",
    category: "mean_reversion",
    description:
      "Fades extensions beyond a volatility band and exits on reversion to the mean, with a hard regime filter.",
    supportedMarkets: ["crypto", "stocks"],
    deployment: "paper_and_live",
    parameters: [
      { key: "period", label: "Band period", type: "number", value: 20, min: 5, max: 100, step: 1, help: "Lookback for the band calculation." },
      { key: "stdDev", label: "Band width (σ)", type: "number", value: 2.2, min: 1, max: 4, step: 0.1, help: "Standard deviations from the mean." },
      { key: "regimeFilter", label: "Regime filter", type: "boolean", value: true, help: "Skip entries when trend strength is high." },
    ],
    updatedAt: iso(-11 * DAY),
  },
  {
    id: "strat-grid",
    name: "Range Grid",
    category: "grid",
    description:
      "Places a ladder of limit orders across a defined range. Profits from oscillation, not direction.",
    supportedMarkets: ["crypto"],
    deployment: "paper_and_live",
    parameters: [
      { key: "levels", label: "Grid levels", type: "number", value: 12, min: 3, max: 50, step: 1, help: "Number of price levels in the ladder." },
      { key: "rangePct", label: "Range width", type: "percent", value: 8, min: 1, max: 40, step: 0.5, help: "Total width of the grid around the anchor price." },
      { key: "stepPct", label: "Step size", type: "percent", value: 0.65, min: 0.1, max: 5, step: 0.05, help: "Spacing between adjacent levels." },
    ],
    updatedAt: iso(-19 * DAY),
  },
  {
    id: "strat-mm",
    name: "Passive Market Making",
    category: "market_making",
    description:
      "Quotes both sides of the book with inventory-aware skew. Requires low-latency connectivity.",
    supportedMarkets: ["crypto"],
    deployment: "paper_only",
    parameters: [
      { key: "spreadBps", label: "Quote spread (bps)", type: "number", value: 8, min: 1, max: 100, step: 1, help: "Half-spread quoted around mid." },
      { key: "maxInventory", label: "Max inventory", type: "number", value: 2.5, min: 0.1, max: 20, step: 0.1, help: "Inventory cap before skewing quotes." },
    ],
    updatedAt: iso(-31 * DAY),
  },
  {
    id: "strat-arb",
    name: "Cross-Venue Basis",
    category: "arbitrage",
    description:
      "Detects price dislocations between venues. Research only — execution requires co-located infrastructure.",
    supportedMarkets: ["crypto"],
    deployment: "paper_only",
    parameters: [
      { key: "minEdgeBps", label: "Minimum edge (bps)", type: "number", value: 12, min: 1, max: 200, step: 1, help: "Edge required after fees to signal." },
      { key: "venues", label: "Venues", type: "number", value: 2, min: 2, max: 6, step: 1, help: "Number of venues compared." },
    ],
    updatedAt: iso(-44 * DAY),
  },
];

/* ------------------------------------------------------------------ */
/* Bots                                                                */
/* ------------------------------------------------------------------ */

export const demoBots: TradingBot[] = [
  {
    id: "bot-btc-trend",
    name: "BTC Trend Core",
    marketType: "crypto",
    accountId: "acct-kraken-paper",
    accountLabel: "Kraken · Paper",
    strategyId: "strat-trend",
    strategyName: "Adaptive Trend",
    symbols: ["BTC/USD"],
    timeframe: "4h",
    mode: "paper",
    state: "running",
    allocatedCapital: 30_000,
    positionSizePct: 12,
    stopLossPct: 3.5,
    takeProfitPct: 9,
    maxOpenPositions: 1,
    dailyLossLimitPct: 2,
    schedule: "24/7",
    createdAt: iso(-92 * DAY),
    lastRunAt: iso(-120_000),
    stats: { trades: 148, winRatePct: 54.1, pnl: 4_182.4, pnlPct: 13.94, maxDrawdownPct: 8.2 },
    lastError: null,
  },
  {
    id: "bot-eth-momentum",
    name: "ETH Momentum",
    marketType: "crypto",
    accountId: "acct-kraken-paper",
    accountLabel: "Kraken · Paper",
    strategyId: "strat-momentum",
    strategyName: "Cross-Sectional Momentum",
    symbols: ["ETH/USD", "LINK/USD"],
    timeframe: "1d",
    mode: "paper",
    state: "running",
    allocatedCapital: 18_000,
    positionSizePct: 8,
    stopLossPct: 5,
    takeProfitPct: 14,
    maxOpenPositions: 2,
    dailyLossLimitPct: 2.5,
    schedule: "Daily 00:05 UTC",
    createdAt: iso(-61 * DAY),
    lastRunAt: iso(-3_600_000),
    stats: { trades: 42, winRatePct: 47.6, pnl: 1_284.9, pnlPct: 7.14, maxDrawdownPct: 11.4 },
    lastError: null,
  },
  {
    id: "bot-sol-grid",
    name: "SOL Range Grid",
    marketType: "crypto",
    accountId: "acct-kraken-paper",
    accountLabel: "Kraken · Paper",
    strategyId: "strat-grid",
    strategyName: "Range Grid",
    symbols: ["SOL/USD"],
    timeframe: "15m",
    mode: "paper",
    state: "paused",
    allocatedCapital: 12_000,
    positionSizePct: 4,
    stopLossPct: 6,
    takeProfitPct: 2.5,
    maxOpenPositions: 6,
    dailyLossLimitPct: 3,
    schedule: "24/7",
    createdAt: iso(-34 * DAY),
    lastRunAt: iso(-7_200_000),
    stats: { trades: 612, winRatePct: 61.2, pnl: -412.8, pnlPct: -3.44, maxDrawdownPct: 9.8 },
    lastError: null,
  },
  {
    id: "bot-equity-momentum",
    name: "US Equity Momentum",
    marketType: "stocks",
    accountId: "acct-alpaca-paper",
    accountLabel: "Alpaca · Paper",
    strategyId: "strat-momentum",
    strategyName: "Cross-Sectional Momentum",
    symbols: ["NVDA", "MSFT", "AAPL", "SPY", "QQQ"],
    timeframe: "1d",
    mode: "paper",
    state: "running",
    allocatedCapital: 40_000,
    positionSizePct: 10,
    stopLossPct: 4,
    takeProfitPct: 12,
    maxOpenPositions: 5,
    dailyLossLimitPct: 1.5,
    schedule: "Market hours · rebalance 15:45 ET",
    createdAt: iso(-48 * DAY),
    lastRunAt: iso(-900_000),
    stats: { trades: 76, winRatePct: 57.9, pnl: 2_104.6, pnlPct: 5.26, maxDrawdownPct: 6.1 },
    lastError: null,
  },
  {
    id: "bot-meanrev-eth",
    name: "ETH Reversion (staged)",
    marketType: "crypto",
    accountId: "acct-kraken-paper",
    accountLabel: "Kraken · Paper",
    strategyId: "strat-meanrev",
    strategyName: "Bollinger Reversion",
    symbols: ["ETH/USD"],
    timeframe: "1h",
    mode: "paper",
    state: "stopped",
    allocatedCapital: 8_000,
    positionSizePct: 6,
    stopLossPct: 2.5,
    takeProfitPct: 4,
    maxOpenPositions: 1,
    dailyLossLimitPct: 2,
    schedule: "24/7",
    createdAt: iso(-12 * DAY),
    lastRunAt: null,
    stats: { trades: 0, winRatePct: null, pnl: null, pnlPct: null, maxDrawdownPct: null },
    lastError: null,
  },
];

export const demoBotLogs: BotLogEntry[] = [
  { id: "log-1", botId: "bot-btc-trend", at: iso(-120_000), level: "info", message: "Signal evaluated: fast MA above slow MA, trend regime confirmed." },
  { id: "log-2", botId: "bot-btc-trend", at: iso(-118_000), level: "info", message: "Position size computed at 12% of allocated capital. No order required — already at target." },
  { id: "log-3", botId: "bot-btc-trend", at: iso(-3_600_000), level: "warn", message: "Quote age exceeded 300s on secondary feed. Primary feed used." },
  { id: "log-4", botId: "bot-eth-momentum", at: iso(-3_600_000), level: "info", message: "Daily rebalance complete. 2 of 2 target holdings in range." },
  { id: "log-5", botId: "bot-sol-grid", at: iso(-7_200_000), level: "warn", message: "Paused by operator. 6 resting orders cancelled at venue." },
  { id: "log-6", botId: "bot-equity-momentum", at: iso(-900_000), level: "info", message: "Rebalance scheduled for 15:45 ET. Universe screened: 5 eligible." },
  { id: "log-7", botId: "bot-sol-grid", at: iso(-9 * 3_600_000), level: "error", message: "Grid range breached to the downside. Strategy halted pending review." },
];

/* ------------------------------------------------------------------ */
/* Backtests                                                           */
/* ------------------------------------------------------------------ */

function buildBacktestCurve(seed: number, start: number, days: number) {
  const rand = mulberry32(seed);
  const points: EquityPoint[] = [];
  let equity = start;
  let benchmark = start;
  for (let i = days; i >= 0; i -= 1) {
    equity *= 1 + 0.0016 + (rand() - 0.5) * 0.016;
    benchmark *= 1 + 0.0007 + (rand() - 0.5) * 0.011;
    points.push({
      t: new Date(Date.now() - i * DAY).toISOString(),
      equity: round(equity, 2),
      benchmark: round(benchmark, 2),
    });
  }
  return points;
}

export const demoBacktests: BacktestResult[] = [
  {
    id: "bt-001",
    strategyId: "strat-trend",
    strategyName: "Adaptive Trend",
    symbols: ["BTC/USD"],
    timeframe: "4h",
    from: iso(-365 * DAY),
    to: iso(-1 * DAY),
    initialCapital: 25_000,
    metrics: {
      totalReturnPct: 34.8,
      benchmarkReturnPct: 21.4,
      profitFactor: 1.72,
      maxDrawdownPct: 12.6,
      winRatePct: 53.4,
      averageWin: 412.8,
      averageLoss: -238.4,
      sharpe: 1.18,
      trades: 186,
      feesPaid: 1_284.2,
      estimatedSlippage: 642.1,
    },
    equityCurve: buildBacktestCurve(11, 25_000, 365),
    trades: [],
    createdAt: iso(-2 * DAY),
    walkForward: { folds: 5, inSampleReturnPct: 38.2, outOfSampleReturnPct: 19.6, verdict: "passed" },
  },
  {
    id: "bt-002",
    strategyId: "strat-momentum",
    strategyName: "Cross-Sectional Momentum",
    symbols: ["NVDA", "MSFT", "AAPL", "SPY", "QQQ"],
    timeframe: "1d",
    from: iso(-540 * DAY),
    to: iso(-1 * DAY),
    initialCapital: 40_000,
    metrics: {
      totalReturnPct: 22.1,
      benchmarkReturnPct: 27.8,
      profitFactor: 1.34,
      maxDrawdownPct: 9.4,
      winRatePct: 56.2,
      averageWin: 684.2,
      averageLoss: -412.6,
      sharpe: 0.94,
      trades: 94,
      feesPaid: 412.8,
      estimatedSlippage: 218.4,
    },
    equityCurve: buildBacktestCurve(29, 40_000, 540),
    trades: [],
    createdAt: iso(-5 * DAY),
    walkForward: { folds: 4, inSampleReturnPct: 26.4, outOfSampleReturnPct: 8.1, verdict: "inconclusive" },
  },
  {
    id: "bt-003",
    strategyId: "strat-grid",
    strategyName: "Range Grid",
    symbols: ["SOL/USD"],
    timeframe: "15m",
    from: iso(-180 * DAY),
    to: iso(-1 * DAY),
    initialCapital: 12_000,
    metrics: {
      totalReturnPct: -4.2,
      benchmarkReturnPct: 11.6,
      profitFactor: 0.88,
      maxDrawdownPct: 14.8,
      winRatePct: 62.4,
      averageWin: 42.1,
      averageLoss: -96.4,
      sharpe: -0.21,
      trades: 1_284,
      feesPaid: 2_184.6,
      estimatedSlippage: 1_042.8,
    },
    equityCurve: buildBacktestCurve(47, 12_000, 180),
    trades: [],
    createdAt: iso(-9 * DAY),
    walkForward: { folds: 3, inSampleReturnPct: 6.2, outOfSampleReturnPct: -11.4, verdict: "failed" },
  },
];

/* ------------------------------------------------------------------ */
/* Orders & fills                                                      */
/* ------------------------------------------------------------------ */

export const demoOrders: Order[] = [
  {
    id: "ord-8841",
    clientOrderId: "wands-8841",
    accountId: "acct-kraken-paper",
    accountLabel: "Kraken · Paper",
    symbol: "BTC/USD",
    marketType: "crypto",
    side: "buy",
    type: "limit",
    status: "open",
    quantity: 0.05,
    filledQuantity: 0,
    limitPrice: 66_400,
    averageFillPrice: null,
    fees: null,
    mode: "paper",
    botId: "bot-btc-trend",
    strategyName: "Adaptive Trend",
    createdAt: iso(-1_800_000),
    updatedAt: iso(-1_800_000),
    exchangeConfirmationId: "KRAK-9F2A41",
    reconciliation: "matched",
    rejectReason: null,
  },
  {
    id: "ord-8840",
    clientOrderId: "wands-8840",
    accountId: "acct-alpaca-paper",
    accountLabel: "Alpaca · Paper",
    symbol: "NVDA",
    marketType: "stocks",
    side: "buy",
    type: "market",
    status: "filled",
    quantity: 12,
    filledQuantity: 12,
    limitPrice: null,
    averageFillPrice: 130.42,
    fees: 0.6,
    mode: "paper",
    botId: "bot-equity-momentum",
    strategyName: "Cross-Sectional Momentum",
    createdAt: iso(-5_400_000),
    updatedAt: iso(-5_380_000),
    exchangeConfirmationId: "ALPC-7712B",
    reconciliation: "matched",
    rejectReason: null,
  },
  {
    id: "ord-8839",
    clientOrderId: "wands-8839",
    accountId: "acct-kraken-paper",
    accountLabel: "Kraken · Paper",
    symbol: "SOL/USD",
    marketType: "crypto",
    side: "sell",
    type: "limit",
    status: "cancelled",
    quantity: 40,
    filledQuantity: 0,
    limitPrice: 148.2,
    averageFillPrice: null,
    fees: null,
    mode: "paper",
    botId: "bot-sol-grid",
    strategyName: "Range Grid",
    createdAt: iso(-7_300_000),
    updatedAt: iso(-7_200_000),
    exchangeConfirmationId: "KRAK-9F2A38",
    reconciliation: "matched",
    rejectReason: null,
  },
  {
    id: "ord-8838",
    clientOrderId: "wands-8838",
    accountId: "acct-kraken-paper",
    accountLabel: "Kraken · Paper",
    symbol: "ARB/USD",
    marketType: "crypto",
    side: "buy",
    type: "market",
    status: "rejected",
    quantity: 4_000,
    filledQuantity: 0,
    limitPrice: null,
    averageFillPrice: null,
    fees: null,
    mode: "paper",
    botId: null,
    strategyName: null,
    createdAt: iso(-9 * 3_600_000),
    updatedAt: iso(-9 * 3_600_000),
    exchangeConfirmationId: null,
    reconciliation: "mismatch",
    rejectReason: "Instrument not eligible for automated strategies (liquidity screen).",
  },
  {
    id: "ord-8837",
    clientOrderId: "wands-8837",
    accountId: "acct-alpaca-paper",
    accountLabel: "Alpaca · Paper",
    symbol: "SPY",
    marketType: "stocks",
    side: "buy",
    type: "limit",
    status: "partially_filled",
    quantity: 20,
    filledQuantity: 8,
    limitPrice: 560.5,
    averageFillPrice: 560.48,
    fees: 0.4,
    mode: "paper",
    botId: null,
    strategyName: null,
    createdAt: iso(-11 * 3_600_000),
    updatedAt: iso(-10 * 3_600_000),
    exchangeConfirmationId: "ALPC-7708C",
    reconciliation: "pending",
    rejectReason: null,
  },
];

export const demoFills: Fill[] = [
  { id: "fill-1", orderId: "ord-8840", symbol: "NVDA", side: "buy", quantity: 12, price: 130.42, fees: 0.6, at: iso(-5_380_000) },
  { id: "fill-2", orderId: "ord-8837", symbol: "SPY", side: "buy", quantity: 8, price: 560.48, fees: 0.4, at: iso(-10 * 3_600_000) },
  { id: "fill-3", orderId: "ord-8836", symbol: "ETH/USD", side: "buy", quantity: 1.2, price: 3_241.8, fees: 3.9, at: iso(-14 * 3_600_000) },
  { id: "fill-4", orderId: "ord-8835", symbol: "MSFT", side: "buy", quantity: 6, price: 415.2, fees: 0.3, at: iso(-22 * 3_600_000) },
];

/* ------------------------------------------------------------------ */
/* Risk                                                                */
/* ------------------------------------------------------------------ */

export const demoRiskSnapshot: RiskSnapshot = {
  policy: {
    maxPortfolioExposurePct: 80,
    maxPositionExposurePct: 15,
    perTradeRiskPct: 0.75,
    dailyLossLimitPct: 2,
    maxDrawdownPct: 15,
    cryptoAllocationCapPct: 60,
    stocksAllocationCapPct: 60,
    maxQuoteAgeSeconds: 300,
    duplicateOrderWindowSeconds: 30,
    tradingPaused: false,
    emergencyStopEngaged: false,
    updatedAt: iso(-4 * DAY),
  },
  utilisation: {
    portfolioExposurePct: 68.4,
    largestPositionPct: 12.1,
    dailyLossPct: 0,
    drawdownPct: 4.2,
    cryptoAllocationPct: 38.6,
    stocksAllocationPct: 29.8,
  },
  breaches: [
    {
      key: "stale-feed",
      label: "Stale quote on secondary feed",
      severity: "warning",
      detail: "ARB/USD quote is 412s old, above the 300s policy limit. The instrument is excluded from strategy eligibility.",
    },
    {
      key: "reconciliation",
      label: "Unreconciled order",
      severity: "warning",
      detail: "Order ord-8838 was rejected at the venue but is still marked pending reconciliation.",
    },
  ],
  events: [
    { id: "ev-1", at: iso(-9 * 3_600_000), severity: "critical", category: "permission", title: "Order rejected by venue", detail: "ARB/USD buy rejected: instrument not eligible for automated strategies.", acknowledged: false, actor: "engine" },
    { id: "ev-2", at: iso(-7_200_000), severity: "warning", category: "circuit_breaker", title: "Bot paused by operator", detail: "SOL Range Grid paused. 6 resting orders cancelled.", acknowledged: true, actor: "operator" },
    { id: "ev-3", at: iso(-2 * DAY), severity: "info", category: "policy_change", title: "Daily loss limit tightened", detail: "Daily loss circuit breaker reduced from 3.0% to 2.0%.", acknowledged: true, actor: "operator" },
    { id: "ev-4", at: iso(-4 * DAY), severity: "info", category: "exposure", title: "Position cap raised", detail: "Maximum per-position exposure increased from 12% to 15%.", acknowledged: true, actor: "operator" },
  ],
};

/* ------------------------------------------------------------------ */
/* Connections                                                         */
/* ------------------------------------------------------------------ */

export const demoConnections: Connection[] = [
  {
    id: "conn-kraken",
    provider: "kraken",
    label: "Kraken",
    marketType: "crypto",
    status: "connected",
    access: "read_only",
    mode: "paper",
    keyHint: "••••4f2a",
    permissions: ["balances:read", "orders:read", "marketdata:read"],
    lastSyncedAt: iso(-42_000),
    error: null,
    available: true,
  },
  {
    id: "conn-alpaca",
    provider: "alpaca",
    label: "Alpaca",
    marketType: "stocks",
    status: "connected",
    access: "read_only",
    mode: "paper",
    keyHint: "••••91c7",
    permissions: ["account:read", "positions:read", "marketdata:read"],
    lastSyncedAt: iso(-18_000),
    error: null,
    available: true,
  },
  {
    id: "conn-ibkr",
    provider: "interactive_brokers",
    label: "Interactive Brokers",
    marketType: "stocks",
    status: "not_configured",
    access: "read_only",
    mode: "paper",
    keyHint: null,
    permissions: [],
    lastSyncedAt: null,
    error: "Adapter not available in this engine build.",
    available: false,
  },
];

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export const demoUserSettings: UserSettings = {
  displayName: "Operator",
  email: "operator@wands.local",
  baseCurrency: "USD",
  theme: "dark",
  twoFactorEnabled: false,
  notifications: {
    tradeFills: true,
    riskBreaches: true,
    engineOffline: true,
    dailySummary: false,
  },
  engine: {
    endpointConfigured: false,
    region: "fra1",
    heartbeatSeconds: 15,
  },
  audit: {
    lastBackupAt: null,
    retentionDays: 365,
  },
};
