// @vitest-environment node

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cookieStore } = vi.hoisted(() => ({ cookieStore: { get: vi.fn() } }));

vi.mock("next/headers", () => ({ cookies: async () => cookieStore }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

vi.mock("@/lib/api/client", () => ({
  engineConfig: () => ({ baseUrl: null, token: null, configured: false }),
}));

vi.mock("@/lib/api/endpoints", () => ({
  getCandles: vi.fn(async () => ({ data: [], provenance: "demo" })),
  getBacktests: vi.fn(),
  getBots: vi.fn(),
  getMarkets: vi.fn(),
  getPortfolio: vi.fn(),
  getRisk: vi.fn(),
}));

import { GET as candles } from "@/app/api/markets/candles/route";
import { POST as research } from "@/app/api/research/route";
import { GET as wands } from "@/app/api/wands/[...path]/route";
import { createSessionToken } from "@/lib/auth/session";

const USERNAME = "operator";
const PASSWORD = "correct horse battery staple";
const SECRET = "test-session-secret";

const wandsContext = { params: Promise.resolve({ path: ["engine", "status"] }) };

function wandsRequest() {
  return new NextRequest(new URL("http://localhost/api/wands/engine/status"));
}

function candlesRequest() {
  return new NextRequest(
    new URL("http://localhost/api/markets/candles?symbol=BTC/USD"),
  );
}

function researchRequest() {
  return new Request("http://localhost/api/research", {
    method: "POST",
    body: JSON.stringify({ messages: [] }),
  });
}

beforeEach(() => {
  process.env.WANDS_OPERATOR_USERNAME = USERNAME;
  process.env.WANDS_OPERATOR_PASSWORD = PASSWORD;
  process.env.WANDS_SESSION_SECRET = SECRET;
  cookieStore.get.mockReset();
  cookieStore.get.mockReturnValue(undefined);
});

afterEach(() => {
  delete process.env.WANDS_OPERATOR_USERNAME;
  delete process.env.WANDS_OPERATOR_PASSWORD;
  delete process.env.WANDS_SESSION_SECRET;
  vi.unstubAllEnvs();
});

/**
 * These routes are reachable only through middleware in the running app, so the
 * point of this suite is that each one refuses a direct request on its own. A
 * rewrite, a matcher change or a future config edit must not turn any of them
 * into an anonymous admin channel to the engine.
 */
describe("engine proxy routes authorise in-route", () => {
  it("refuses an unauthenticated wands proxy call", async () => {
    const response = await wands(wandsRequest(), wandsContext);
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("unauthorized");
  });

  it("refuses an unauthenticated candle request", async () => {
    const response = await candles(candlesRequest());
    expect(response.status).toBe(401);
  });

  it("refuses an unauthenticated research request", async () => {
    const response = await research(researchRequest());
    expect(response.status).toBe(401);
  });

  it("answers 503 when the gate is unconfigured rather than forwarding", async () => {
    delete process.env.WANDS_OPERATOR_PASSWORD;

    const response = await wands(wandsRequest(), wandsContext);
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("operator_gate_unconfigured");
  });

  it("forwards a wands call once the operator session is valid", async () => {
    const token = await createSessionToken();
    cookieStore.get.mockReturnValue({ value: token });

    const response = await wands(wandsRequest(), wandsContext);
    // The engine is unconfigured in this test, so the guard passing shows up as
    // the proxy's own 503 rather than a 401.
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("not_configured");
  });

  it("serves candles once the operator session is valid", async () => {
    const token = await createSessionToken();
    cookieStore.get.mockReturnValue({ value: token });

    const response = await candles(candlesRequest());
    expect(response.status).toBe(200);
  });

  it("never leaks the operator password or the session secret in a denial", async () => {
    const text = await (await wands(wandsRequest(), wandsContext)).text();
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain(SECRET);
  });
});
