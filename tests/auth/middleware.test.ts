// @vitest-environment node

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OPERATOR_PREFIXES, routeTier } from "@/lib/auth/routes";
import { SESSION_COOKIE, createSessionToken } from "@/lib/auth/session";
import { config, middleware } from "@/middleware";

const PASSWORD = "correct horse battery staple";
const SECRET = "test-session-secret";

function request(path: string, cookie?: string) {
  return new NextRequest(new URL(`http://localhost${path}`), {
    headers: cookie ? { cookie } : {},
  });
}

function passedThrough(response: Response): boolean {
  return response.headers.get("x-middleware-next") === "1";
}

beforeEach(() => {
  process.env.WANDS_OPERATOR_PASSWORD = PASSWORD;
  process.env.WANDS_SESSION_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.WANDS_OPERATOR_PASSWORD;
  delete process.env.WANDS_SESSION_SECRET;
  vi.unstubAllEnvs();
});

describe("engine proxy gate", () => {
  it("forwards a request carrying a valid session", async () => {
    const token = await createSessionToken();
    const response = await middleware(
      request("/api/wands/engine/status", `${SESSION_COOKIE}=${token ?? ""}`),
    );
    expect(passedThrough(response)).toBe(true);
  });

  it("rejects a request with no session", async () => {
    const response = await middleware(request("/api/wands/engine/status"));
    expect(response.status).toBe(401);
    expect(passedThrough(response)).toBe(false);
  });

  it("rejects a forged session cookie", async () => {
    const response = await middleware(
      request("/api/wands/engine/status", `${SESSION_COOKIE}=v1.9999999999.forged`),
    );
    expect(response.status).toBe(401);
  });

  it("rejects a session signed with another secret", async () => {
    const token = await createSessionToken();
    process.env.WANDS_SESSION_SECRET = "rotated-secret";
    const response = await middleware(
      request("/api/wands/engine/status", `${SESSION_COOKIE}=${token ?? ""}`),
    );
    expect(response.status).toBe(401);
  });

  it("fails closed in production when the gate is unconfigured", async () => {
    delete process.env.WANDS_OPERATOR_PASSWORD;
    vi.stubEnv("NODE_ENV", "production");
    const response = await middleware(request("/api/wands/engine/status"));
    expect(response.status).toBe(503);
    expect(passedThrough(response)).toBe(false);
  });

  it("stays open in development when the gate is unconfigured", async () => {
    delete process.env.WANDS_OPERATOR_PASSWORD;
    vi.stubEnv("NODE_ENV", "development");
    const response = await middleware(request("/api/wands/engine/status"));
    expect(passedThrough(response)).toBe(true);
  });
});

describe("routes that reach the engine without the wands prefix", () => {
  it("gates the research assistant, which reads the operator's portfolio", async () => {
    const response = await middleware(request("/api/research"));
    expect(response.status).toBe(401);
    expect(passedThrough(response)).toBe(false);
  });

  it("gates the candle feed", async () => {
    const response = await middleware(request("/api/markets/candles?symbol=BTC/USD"));
    expect(response.status).toBe(401);
  });

  it("lets a signed-in operator through", async () => {
    const token = await createSessionToken();
    const response = await middleware(
      request("/api/research", `${SESSION_COOKIE}=${token ?? ""}`),
    );
    expect(passedThrough(response)).toBe(true);
  });
});

describe("operator console pages", () => {
  it("redirects an unauthenticated visitor to the sign-in form", async () => {
    const response = await middleware(request("/portfolio"));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/portfolio");
  });

  it("serves the page to a signed-in operator", async () => {
    const token = await createSessionToken();
    const response = await middleware(
      request("/risk", `${SESSION_COOKIE}=${token ?? ""}`),
    );
    expect(passedThrough(response)).toBe(true);
  });

  it("stays open in development when the gate is unconfigured", async () => {
    delete process.env.WANDS_OPERATOR_PASSWORD;
    delete process.env.WANDS_SESSION_SECRET;
    vi.stubEnv("NODE_ENV", "development");

    const response = await middleware(request("/portfolio"));
    expect(passedThrough(response)).toBe(true);
  });

  it("redirects to sign-in in production when the gate is unconfigured", async () => {
    delete process.env.WANDS_OPERATOR_PASSWORD;
    delete process.env.WANDS_SESSION_SECRET;
    vi.stubEnv("NODE_ENV", "production");

    const response = await middleware(request("/portfolio"));
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/login");
  });
});

describe("public marketing routes", () => {
  it("never requires an operator session", async () => {
    for (const path of ["/", "/pricing", "/waitlist", "/legal/terms", "/blog/post"]) {
      const response = await middleware(request(path));
      expect(passedThrough(response), path).toBe(true);
    }
  });

  it("stays reachable in production when the operator gate is unconfigured", async () => {
    delete process.env.WANDS_OPERATOR_PASSWORD;
    delete process.env.WANDS_SESSION_SECRET;
    vi.stubEnv("NODE_ENV", "production");

    const response = await middleware(request("/pricing"));
    expect(passedThrough(response)).toBe(true);
    expect(response.status).not.toBe(503);
  });

  it("classifies the three tiers distinctly", () => {
    expect(routeTier("/pricing")).toBe("public");
    expect(routeTier("/")).toBe("public");
    expect(routeTier("/portfolio")).toBe("operator");
    expect(routeTier("/api/wands/engine/status")).toBe("operator");
    expect(routeTier("/api/research")).toBe("operator");
  });
});

describe("matcher parity", () => {
  it("covers every operator prefix", () => {
    const covered = config.matcher.map((pattern) =>
      pattern.replace(/\/:path\*$/, ""),
    );
    for (const prefix of OPERATOR_PREFIXES) {
      expect(covered, `matcher is missing ${prefix}`).toContain(prefix);
    }
  });
});
