import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MEMBER_FOOTER_NAV, MEMBER_NAV } from "@/components/member/member-shell";
import { ProvenanceNote } from "@/components/member/ui";
import { getAssetResearch, getResearchDashboard, getSignalFeed } from "@/lib/api/research";
import { routeTier } from "@/lib/auth/routes";
import { assetHref, filingHref, savedHref, signalHref } from "@/lib/member/links";
import { memberResearch } from "@/lib/member/research";

const ALL_NAV = [...MEMBER_NAV, ...MEMBER_FOOTER_NAV];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("member navigation", () => {
  it("exposes asset research from the member nav", () => {
    const research = MEMBER_NAV.find((item) => item.href === "/app/research");
    expect(research).toBeDefined();
    expect(research?.label).toBe("Research");
  });

  it("keeps every member destination inside the member workspace", () => {
    for (const item of ALL_NAV) {
      expect(item.href.startsWith("/app"), item.href).toBe(true);
      expect(routeTier(item.href), item.href).toBe("customer");
    }
  });

  it("never routes a member into an operator console", () => {
    for (const item of ALL_NAV) {
      expect(routeTier(item.href), item.href).not.toBe("operator");
    }
  });

  it("keeps the operator research console out of the member nav", () => {
    const hrefs = ALL_NAV.map((item) => item.href);
    expect(hrefs).not.toContain("/research");
    expect(hrefs).not.toContain("/intelligence");
    expect(hrefs).not.toContain("/portfolio");
  });

  it("reaches asset research without an operator route", () => {
    expect(routeTier("/app/research")).toBe("customer");
    expect(routeTier("/app/assets/AAPL")).toBe("customer");
    expect(routeTier("/app/signals/sig-1")).toBe("customer");
    expect(routeTier("/app/insiders/tx-1")).toBe("customer");
  });
});

describe("member research permissions", () => {
  it("exposes only customer-safe research reads", () => {
    expect(Object.keys(memberResearch).sort()).toEqual([
      "asset",
      "coverage",
      "dashboard",
      "insiders",
      "institutions",
      "signals",
      "sources",
    ]);
  });

  it("has no trading, portfolio, risk or job-control function", () => {
    for (const name of [
      "orders",
      "portfolio",
      "risk",
      "bots",
      "backtest",
      "startBackfill",
      "setJobPaused",
      "connections",
      "settings",
      "status",
    ]) {
      expect(memberResearch, name).not.toHaveProperty(name);
    }
  });

  it("keeps the operator research console in the operator tier", () => {
    expect(routeTier("/research")).toBe("operator");
    expect(routeTier("/intelligence/symbols/AAPL")).toBe("operator");
    expect(routeTier("/api/wands/engine/status")).toBe("operator");
  });
});

describe("research linking", () => {
  it("builds asset links from a ticker", () => {
    expect(assetHref("aapl")).toBe("/app/assets/AAPL");
    expect(assetHref(" BRK.B ")).toBe("/app/assets/BRK.B");
  });

  it("builds detail links for signals and filings", () => {
    expect(signalHref("sig-1")).toBe("/app/signals/sig-1");
    expect(filingHref("tx-1")).toBe("/app/insiders/tx-1");
  });

  it("reopens a saved asset on its research page", () => {
    expect(savedHref({ kind: "asset", refId: "AAPL", symbol: "AAPL" })).toBe("/app/assets/AAPL");
  });

  it("reopens a saved signal on its detail view", () => {
    expect(savedHref({ kind: "signal", refId: "sig-1", symbol: "AAPL" })).toBe("/app/signals/sig-1");
  });

  it("reopens a saved filing on its detail view", () => {
    expect(savedHref({ kind: "insider", refId: "tx-1", symbol: "AAPL" })).toBe("/app/insiders/tx-1");
    expect(savedHref({ kind: "filing", refId: "tx-2", symbol: "AAPL" })).toBe("/app/insiders/tx-2");
  });

  it("keeps every saved link inside the member workspace", () => {
    for (const kind of ["asset", "signal", "insider", "filing"] as const) {
      const href = savedHref({ kind, refId: "x", symbol: "AAPL" });
      expect(href.startsWith("/app/"), `${kind} -> ${href}`).toBe(true);
      expect(routeTier(href), `${kind} -> ${href}`).toBe("customer");
    }
  });
});

describe("unavailable research states", () => {
  it("marks the asset payload unavailable instead of inventing data", async () => {
    vi.stubEnv("WANDS_ENGINE_URL", "");

    const envelope = await getAssetResearch("AAPL");

    expect(envelope.provenance).toBe("unavailable");
    expect(envelope.data.symbol).toBe("AAPL");
    expect(envelope.data.signals).toEqual([]);
    expect(envelope.data.sources).toEqual([]);
    expect(envelope.data.coverage.status).toBe("unavailable");
    expect(envelope.data.insider.purchaseCount).toBe(0);
    expect(envelope.data.insider.purchaseValueUsd).toBeNull();
    expect(envelope.data.fusion.compositeScore).toBeNull();
    expect(envelope.warnings.length).toBeGreaterThan(0);
  });

  it("marks the dashboard unavailable with zero counts and no timestamps", async () => {
    vi.stubEnv("WANDS_ENGINE_URL", "");

    const envelope = await getResearchDashboard();

    expect(envelope.provenance).toBe("unavailable");
    expect(envelope.data.counts.filings).toBe(0);
    expect(envelope.data.latestFilingAt).toBeNull();
    expect(envelope.data.latestSignalAt).toBeNull();
    expect(envelope.data.topSignals).toEqual([]);
    expect(envelope.data.recentPurchases).toEqual([]);
  });

  it("returns an empty signal feed rather than a fabricated one", async () => {
    vi.stubEnv("WANDS_ENGINE_URL", "");

    const envelope = await getSignalFeed({ limit: 5 });

    expect(envelope.provenance).toBe("unavailable");
    expect(envelope.data.items).toEqual([]);
    expect(envelope.data.total).toBe(0);
  });

  it("degrades to unavailable when the engine cannot be reached", async () => {
    vi.stubEnv("WANDS_ENGINE_URL", "https://engine.invalid");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("connection refused"));

    const envelope = await getAssetResearch("MSFT");

    expect(envelope.provenance).toBe("unavailable");
    expect(envelope.data.signals).toEqual([]);
    expect(envelope.warnings[0]).toMatch(/unavailable/i);
  });

  it("renders an unavailable state with the engine's own reason", () => {
    render(
      <ProvenanceNote
        provenance="unavailable"
        generatedAt={new Date().toISOString()}
        warnings={["WANDS_ENGINE_URL is not configured. No research data is available."]}
      />,
    );

    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(
      screen.getByText("WANDS_ENGINE_URL is not configured. No research data is available."),
    ).toBeInTheDocument();
  });

  it("renders a live state when the engine answered", () => {
    render(
      <ProvenanceNote provenance="live" generatedAt={new Date().toISOString()} warnings={[]} />,
    );

    expect(screen.getByText("Live data")).toBeInTheDocument();
    expect(screen.queryByText("Unavailable")).not.toBeInTheDocument();
  });
});
