import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { MarketPulsePanel } from "@/components/opportunity/market-pulse-panel";
import type { MarketPulseMarket, MarketPulseSnapshot } from "@/lib/api/opportunity";
import {
  getMarketsForCategory,
  sortMarketPulseMarkets,
} from "@/lib/opportunity/market-pulse";

const mocks = vi.hoisted(() => ({ readMarketPulseAction: vi.fn() }));
vi.mock("@/lib/opportunity/scan-actions", () => mocks);

function market(
  symbol: string,
  turnover: string,
  dayMove: string,
  range: string,
  spread: string,
): MarketPulseMarket {
  return {
    symbol,
    status: "online",
    tickerAvailable: true,
    provider: "kraken",
    lastPrice: "100",
    bid: "99.9",
    ask: "100.1",
    baseVolume24h: "1000",
    vwap24h: "100",
    turnover24hUsd: turnover,
    high24h: "110",
    low24h: "90",
    dayOpen: "100",
    dayChangePct: dayMove,
    range24hPct: range,
    spreadPct: spread,
    warnings: [],
  };
}

const markets = [
  market("BTC/USD", "1000000", "1", "5", "0.02"),
  market("ETH/USD", "500000", "3", "8", "0.04"),
  market("SOL/USD", "300000", "9", "18", "0.8"),
  market("DOGE/USD", "50000", "-14", "27", "2"),
];

const snapshot: MarketPulseSnapshot = {
  asOf: "2026-11-09T15:00:00Z",
  timestampSource: "provider",
  source: "Kraken public AssetPairs and Ticker REST endpoints",
  activeMarkets: markets.length,
  minimumTurnoverUsd: "100000",
  maxSpreadPct: "1.0",
  markets,
};

function renderPanel() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MarketPulsePanel />
    </SWRConfig>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readMarketPulseAction.mockResolvedValue(snapshot);
});

describe("Market Pulse measurements", () => {
  it("filters categories by different measured evidence and ranks ties deterministically", () => {
    expect(getMarketsForCategory(markets, "popular", "100000", "1").map((item) => item.symbol)).toEqual(["BTC/USD"]);
    expect(getMarketsForCategory(markets, "trending", "100000", "1").map((item) => item.symbol)).toEqual(["BTC/USD"]);
    expect(getMarketsForCategory(markets, "top-movers", "100000", "1").map((item) => item.symbol)).toEqual(["DOGE/USD"]);
    expect(getMarketsForCategory(markets, "high-risk", "100000", "1").map((item) => item.symbol)).toEqual(["DOGE/USD"]);
    expect(getMarketsForCategory(markets, "lower-volatility", "100000", "1").map((item) => item.symbol)).toEqual(["BTC/USD"]);
    expect(getMarketsForCategory(markets, "wildcards", "100000", "1").map((item) => item.symbol)).toEqual(["DOGE/USD"]);
    expect(getMarketsForCategory(markets, "strong-liquidity", "100000", "1").map((item) => item.symbol)).toEqual(["BTC/USD", "ETH/USD", "SOL/USD"]);
    expect(sortMarketPulseMarkets([market("ZED/USD", "10", "1", "2", "1"), market("ABC/USD", "10", "1", "2", "1")], "turnover").map((item) => item.symbol)).toEqual(["ABC/USD", "ZED/USD"]);
  });

  it("does not invent candle, social, or search interest when source measurements are absent", () => {
    expect(getMarketsForCategory(markets, "momentum", "100000", "1")).toEqual([]);
    expect(getMarketsForCategory(markets, "volume-surges", "100000", "1")).toEqual([]);
    expect(getMarketsForCategory(markets, "social-buzz", "100000", "1")).toEqual([]);
    expect(getMarketsForCategory(markets, "search-trending", "100000", "1")).toEqual([]);
    const missing = { ...market("NEW/USD", "0", "0", "0", "0"), tickerAvailable: false, turnover24hUsd: null, dayChangePct: null, range24hPct: null, spreadPct: null };
    expect(getMarketsForCategory([missing], "popular", "100000", "1")).toEqual([]);
  });

  it("changes visible markets when a category is selected", async () => {
    renderPanel();
    const table = await screen.findByRole("table");

    fireEvent.click(screen.getByRole("button", { name: /Popular/ }));
    expect(await within(table).findByText("BTC/USD")).toBeInTheDocument();
    expect(within(table).queryByText("DOGE/USD")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /High Risk \/ High Movement/ }));
    expect(await within(table).findByText("DOGE/USD")).toBeInTheDocument();
    expect(within(table).queryByText("BTC/USD")).not.toBeInTheDocument();
    expect(screen.getByText(/the 24h high-low range is a movement proxy, not a forecast/)).toBeInTheDocument();
    fireEvent.click(within(table).getByRole("button", { name: /DOGE\/USD/ }));
    expect(await screen.findByText(/24h USD turnover is below the \$100,000 scanner floor/)).toBeInTheDocument();
  });

  it("expands verified evidence and compares multiple markets without a setup", async () => {
    renderPanel();
    const table = await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: /All Markets/ }));

    fireEvent.click(await screen.findByRole("checkbox", { name: "Add BTC/USD to comparison" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Add ETH/USD to comparison" }));
    expect(await screen.findByRole("heading", { name: "Compare markets" })).toBeInTheDocument();
    expect(screen.getByText(/Side-by-side measurements only; no setup or trade is implied/)).toBeInTheDocument();

    fireEvent.click(within(table).getByRole("button", { name: /BTC\/USD/ }));
    expect(await screen.findByText("Change from Kraken's UTC day open")).toBeInTheDocument();
    expect(within(table).getByText("Snapshot time")).toBeInTheDocument();
  });

  it("searches the full supported catalog and shows an explicit unavailable state", async () => {
    renderPanel();
    const search = await screen.findByRole("textbox", { name: /Search supported USD markets/i });
    fireEvent.click(screen.getByRole("button", { name: /Popular/ }));
    fireEvent.change(search, { target: { value: "DOGE" } });
    expect(await screen.findByText("DOGE/USD")).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /Hype \/ Social Buzz/ }));
    expect(screen.getByText(/No verified, attributed social-attention provider is connected/)).toBeInTheDocument();
    expect(screen.getByText(/No verified measurements are available for this category/)).toBeInTheDocument();
  });
});
