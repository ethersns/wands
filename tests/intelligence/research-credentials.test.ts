import { afterEach, describe, expect, it, vi } from "vitest";

import { researchConfig, researchFetch } from "@/lib/api/client";

const ENGINE_URL = "https://engine.test";
const OPERATOR_TOKEN = "operator-token-must-never-reach-a-member-request";
const RESEARCH_TOKEN = "research-scoped-token";

function stubEnv(values: Record<string, string>) {
  for (const [key, value] of Object.entries(values)) {
    vi.stubEnv(key, value);
  }
}

function envelope<T>(data: T) {
  return new Response(
    JSON.stringify({
      data,
      provenance: "live",
      generatedAt: "2026-11-07T00:00:00.000Z",
      source: "wands-engine",
      warnings: [],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the member research credential", () => {
  it("has no token when only the operator token is configured", () => {
    stubEnv({
      WANDS_ENGINE_URL: ENGINE_URL,
      WANDS_ENGINE_TOKEN: OPERATOR_TOKEN,
      WANDS_RESEARCH_TOKEN: "",
    });

    const config = researchConfig();

    expect(config.token).toBeNull();
    expect(config.scoped).toBe(false);
    expect(config.configured).toBe(true);
  });

  it("uses its own credential when one is issued", () => {
    stubEnv({
      WANDS_ENGINE_URL: ENGINE_URL,
      WANDS_ENGINE_TOKEN: OPERATOR_TOKEN,
      WANDS_RESEARCH_TOKEN: RESEARCH_TOKEN,
    });

    const config = researchConfig();

    expect(config.token).toBe(RESEARCH_TOKEN);
    expect(config.scoped).toBe(true);
  });

  it("reports itself unconfigured rather than borrowing the operator token", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    stubEnv({
      WANDS_ENGINE_URL: ENGINE_URL,
      WANDS_ENGINE_TOKEN: OPERATOR_TOKEN,
      WANDS_RESEARCH_TOKEN: "",
    });

    const result = await researchFetch("/v1/intelligence/experiments");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("research_unconfigured");
      expect(result.error.message).toContain("will not borrow the operator token");
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends the research credential and never the operator one", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(envelope({ items: [] }));
    vi.stubGlobal("fetch", fetchSpy);
    stubEnv({
      WANDS_ENGINE_URL: ENGINE_URL,
      WANDS_ENGINE_TOKEN: OPERATOR_TOKEN,
      WANDS_RESEARCH_TOKEN: RESEARCH_TOKEN,
    });

    const result = await researchFetch("/v1/intelligence/experiments");

    expect(result.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [, init] = fetchSpy.mock.calls[0] as [URL, RequestInit];
    const headers = new Headers(init.headers);

    expect(headers.get("authorization")).toBe(`Bearer ${RESEARCH_TOKEN}`);
    expect(headers.get("authorization")).not.toContain(OPERATOR_TOKEN);
  });

  it("does not send an authorization header at all when no credential exists", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(envelope({ items: [] }));
    vi.stubGlobal("fetch", fetchSpy);
    stubEnv({
      WANDS_ENGINE_URL: ENGINE_URL,
      WANDS_ENGINE_TOKEN: "",
      WANDS_RESEARCH_TOKEN: "",
    });

    const result = await researchFetch("/v1/intelligence/experiments");

    expect(result.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
