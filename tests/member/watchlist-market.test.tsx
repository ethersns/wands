import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WatchlistManager } from "@/components/member/watchlist-manager";
import type { Watchlist } from "@/lib/member/watchlists";

const watchlist: Watchlist = {
  id: "wl_1",
  name: "Core",
  isDefault: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  items: [
    {
      id: "i_1",
      symbol: "AAPL",
      marketType: "stocks",
      note: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "i_2",
      symbol: "BTC/USD",
      marketType: "crypto",
      note: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ],
};

function renderManager() {
  return render(<WatchlistManager initial={[watchlist]} maxWatchlists={3} planLabel="Pro" />);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("watchlist market selector", () => {
  it("marks a stored crypto pair as crypto and leaves the ticker unmarked", () => {
    renderManager();

    const cryptoLink = screen.getByRole("link", { name: "BTC/USD" });
    expect(within(cryptoLink.parentElement as HTMLElement).getByText("Crypto")).toBeInTheDocument();

    const stockLink = screen.getByRole("link", { name: "AAPL" });
    expect(within(stockLink.parentElement as HTMLElement).queryByText("Crypto")).toBeNull();
  });

  it("adds a crypto pair with the crypto market", async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url === "/api/member/watchlists") {
        return { ok: true, json: async () => ({ watchlists: [watchlist] }) };
      }
      return { ok: true, json: async () => ({ item: {} }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    renderManager();

    fireEvent.click(screen.getByRole("button", { name: "Crypto" }));
    fireEvent.change(screen.getByLabelText(/Add a crypto pair to Core/), {
      target: { value: "btc-usd" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) => url === "/api/member/watchlists/wl_1/items"),
      ).toBe(true);
    });

    const post = fetchMock.mock.calls.find(([url]) => url === "/api/member/watchlists/wl_1/items");
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      symbol: "BTC/USD",
      marketType: "crypto",
    });
  });

  it("refuses a bare base asset in the crypto market", async () => {
    renderManager();

    fireEvent.click(screen.getByRole("button", { name: "Crypto" }));
    fireEvent.change(screen.getByLabelText(/Add a crypto pair to Core/), {
      target: { value: "BTC" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/BTC\/USD/);
  });
});
