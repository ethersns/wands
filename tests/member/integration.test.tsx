import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_FOOTER_NAV, MEMBER_NAV } from "@/components/member/member-shell";
import { ProvenanceNote } from "@/components/member/ui";
import { researchConfig } from "@/lib/api/client";
import {
  getAssetResearch,
  getInsiderTransaction,
  getResearchDashboard,
  getSignal,
  getSignalFeed,
} from "@/lib/api/research";
import { routeTier } from "@/lib/auth/routes";
import { assetHref, filingHref, savedHref, savedItemHref, signalHref } from "@/lib/member/links";
import { memberResearch } from "@/lib/member/research";

const ALL_NAV = [...MEMBER_NAV, ...MEMBER_FOOTER_NAV];

// The member research surface requires its own credential. Stubbing one here
// keeps the read tests about the read, and the credential tests override it.
beforeEach(() => {
  vi.stubEnv("WANDS_RESEARCH_TOKEN", "research-token");
});

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

  it("exposes Catalyst Radar from the member nav", () => {
    const catalysts = MEMBER_NAV.find((item) => item.href === "/app/catalysts");
    expect(catalysts).toBeDefined();
    expect(catalysts?.label).toBe("Catalyst Radar");
    expect(routeTier("/app/catalysts")).toBe("customer");
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
      "catalysts",
      "coverage",
      "dashboard",
      "experiment",
      "experiments",
      "insiderTransaction",
      "insiders",
      "institutionChanges",
      "institutions",
      "prices",
      "signal",
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

  it("reopens a saved record on its own saved page by stable id", () => {
    expect(savedHref({ id: "saved-1" })).toBe("/app/saved/saved-1");
    expect(savedItemHref("saved-2")).toBe("/app/saved/saved-2");
  });

  it("keeps the live record reachable from a saved record", () => {
    expect(assetHref("AAPL")).toBe("/app/assets/AAPL");
    expect(signalHref("sig-1")).toBe("/app/signals/sig-1");
    expect(filingHref("tx-1")).toBe("/app/insiders/tx-1");
  });

  it("keeps every saved link inside the member workspace", () => {
    const href = savedHref({ id: "saved-1" });
    expect(href.startsWith("/app/")).toBe(true);
    expect(routeTier(href)).toBe("customer");
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
    expect(envelope.unreachable).toBe(true);
  });

  it("does not call an empty collection an outage", async () => {
    vi.stubEnv("WANDS_ENGINE_URL", "https://engine.invalid");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            symbol: "MSFT",
            issuerName: "MICROSOFT CORP",
            asOf: new Date().toISOString(),
            freshness: "fresh",
            insider: {
              symbol: "MSFT",
              issuerName: "MICROSOFT CORP",
              windowDays: 30,
              purchaseCount: 0,
              saleCount: 3,
              distinctPurchasers: 0,
              distinctSellers: 1,
              purchaseValueUsd: null,
              unpricedPurchaseLines: 0,
              latestFilingAt: null,
              latestTransactionDate: null,
              caveats: [],
            },
            signals: [],
            fusion: {
              symbol: "MSFT",
              asOf: new Date().toISOString(),
              components: [],
              compositeScore: null,
              coverage: 0,
              explanation: "No research evidence is available for this symbol.",
              dataQuality: "unavailable",
              caveats: [],
            },
            sources: [],
            coverage: {
              status: "unavailable",
              windowStart: null,
              windowEnd: null,
              symbolsCovered: 0,
              symbolsRequested: 1,
              gaps: [],
              caveats: [],
            },
            caveats: [],
          },
          provenance: "unavailable",
          generatedAt: new Date().toISOString(),
          source: "wands-engine",
          warnings: ["No research evidence is stored for MSFT."],
        }),
        { status: 200 },
      ),
    );

    const envelope = await getAssetResearch("MSFT");

    // The engine answered, so this is a collection gap, not an outage.
    expect(envelope.provenance).toBe("unavailable");
    expect(envelope.unreachable).toBe(false);
    expect(envelope.data.insider.saleCount).toBe(3);
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

  it("returns no single signal record rather than a fabricated one", async () => {
    vi.stubEnv("WANDS_ENGINE_URL", "");

    const envelope = await getSignal("11111111-1111-1111-1111-111111111111");

    expect(envelope.provenance).toBe("unavailable");
    expect(envelope.data).toBeNull();
    expect(envelope.warnings.length).toBeGreaterThan(0);
  });

  it("tells a missing signal apart from an unreachable engine", async () => {
    vi.stubEnv("WANDS_ENGINE_URL", "https://engine.invalid");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "No signal with id x is stored." }), { status: 404 }),
    );

    const envelope = await getSignal("11111111-1111-1111-1111-111111111111");

    expect(envelope.provenance).toBe("unavailable");
    expect(envelope.data).toBeNull();
    expect(envelope.warnings[0]).toMatch(/no stored signal/i);
  });

  it("returns no single filing record rather than a fabricated one", async () => {
    vi.stubEnv("WANDS_ENGINE_URL", "");

    const envelope = await getInsiderTransaction("tx-1");

    expect(envelope.provenance).toBe("unavailable");
    expect(envelope.data).toBeNull();
    expect(envelope.warnings.length).toBeGreaterThan(0);
  });

  it("reads a filing by its identifier without scanning the feed", async () => {
    vi.stubEnv("WANDS_ENGINE_URL", "https://engine.invalid");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: "not_found", message: "No insider transaction with id x is stored." } }),
        { status: 404 },
      ),
    );

    const envelope = await getInsiderTransaction("11111111-1111-1111-1111-111111111111");

    expect(envelope.provenance).toBe("unavailable");
    expect(envelope.data).toBeNull();
    expect(envelope.warnings[0]).toMatch(/no stored filing/i);
    // The engine answered, so this is a missing record rather than an outage.
    expect(envelope.unreachable).toBe(false);
    // One request, to the stable-id route. A feed scan would be a second call.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain("/v1/intelligence/insiders/transactions/");
  });

  it("tells a missing filing apart from an unreachable engine", async () => {
    vi.stubEnv("WANDS_ENGINE_URL", "https://engine.invalid");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("connection refused"));

    const envelope = await getInsiderTransaction("11111111-1111-1111-1111-111111111111");

    expect(envelope.provenance).toBe("unavailable");
    expect(envelope.data).toBeNull();
    expect(envelope.warnings[0]).toMatch(/unavailable/i);
  });

  it("rejects a malformed filing identifier without inventing a record", async () => {
    vi.stubEnv("WANDS_ENGINE_URL", "https://engine.invalid");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: "bad_request", message: "not a transaction identifier" } }),
        { status: 422 },
      ),
    );

    const envelope = await getInsiderTransaction("not-a-uuid");

    expect(envelope.data).toBeNull();
    expect(envelope.warnings[0]).toMatch(/not a filing identifier/i);
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

describe("research credential", () => {
  it("prefers the research-scoped token over the operator token", () => {
    vi.stubEnv("WANDS_ENGINE_URL", "https://engine.invalid");
    vi.stubEnv("WANDS_ENGINE_TOKEN", "operator-token");
    vi.stubEnv("WANDS_RESEARCH_TOKEN", "research-token");

    const config = researchConfig();

    expect(config.token).toBe("research-token");
    expect(config.scoped).toBe(true);
  });

  it("never falls back to the operator token when no research token is issued", () => {
    vi.stubEnv("WANDS_ENGINE_URL", "https://engine.invalid");
    vi.stubEnv("WANDS_ENGINE_TOKEN", "operator-token");
    vi.stubEnv("WANDS_RESEARCH_TOKEN", "");

    const config = researchConfig();

    expect(config.token).toBeNull();
    expect(config.scoped).toBe(false);
  });

  it("reports an explicit unconfigured state instead of reading with the operator token", async () => {
    vi.stubEnv("WANDS_ENGINE_URL", "https://engine.invalid");
    vi.stubEnv("WANDS_ENGINE_TOKEN", "operator-token");
    vi.stubEnv("WANDS_RESEARCH_TOKEN", "");
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const envelope = await getResearchDashboard();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(envelope.provenance).toBe("unavailable");
    expect(envelope.warnings.join(" ")).toMatch(/WANDS_RESEARCH_TOKEN/);
    expect(envelope.warnings.join(" ")).toMatch(/operator credential is never used/);
  });

  it("sends the research credential on a member research read", async () => {
    vi.stubEnv("WANDS_ENGINE_URL", "https://engine.invalid");
    vi.stubEnv("WANDS_ENGINE_TOKEN", "operator-token");
    vi.stubEnv("WANDS_RESEARCH_TOKEN", "research-token");

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {},
          provenance: "live",
          generatedAt: new Date().toISOString(),
          source: "wands-engine",
          warnings: [],
        }),
        { status: 200 },
      ),
    );

    await getResearchDashboard();

    const headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer research-token");
  });
});
