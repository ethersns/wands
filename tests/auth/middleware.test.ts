// @vitest-environment node

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CUSTOMER_PREFIXES,
  MEMBER_PAGE_PREFIXES,
  MEMBER_SESSION_COOKIES,
  OPERATOR_PREFIXES,
  PUBLIC_API_PREFIXES,
  isMemberPage,
  routeTier,
} from "@/lib/auth/routes";
import { SESSION_COOKIE, createSessionToken } from "@/lib/auth/session";
import { config, proxy } from "@/proxy";

const USERNAME = "operator";
const PASSWORD = "correct horse battery staple";
const SECRET = "test-session-secret";

function request(path: string, cookie?: string, extraHeaders?: Record<string, string>) {
  return new NextRequest(new URL(`http://localhost${path}`), {
    headers: { ...(cookie ? { cookie } : {}), ...extraHeaders },
  });
}

function passedThrough(response: Response): boolean {
  return response.headers.get("x-middleware-next") === "1";
}

beforeEach(() => {
  process.env.WANDS_OPERATOR_USERNAME = USERNAME;
  process.env.WANDS_OPERATOR_PASSWORD = PASSWORD;
  process.env.WANDS_SESSION_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.WANDS_OPERATOR_USERNAME;
  delete process.env.WANDS_OPERATOR_PASSWORD;
  delete process.env.WANDS_SESSION_SECRET;
  vi.unstubAllEnvs();
});

describe("public registration", () => {
  it("closes the Better Auth sign-up endpoint", async () => {
    // Accounts are only created by the activation route after a verified
    // payment. Leaving this open would be a free account with one POST.
    const response = await proxy(request("/api/auth/sign-up/email"));
    expect(response.status).toBe(404);
    expect(passedThrough(response)).toBe(false);
  });

  it("still allows sign-in and password reset", async () => {
    for (const path of [
      "/api/auth/sign-in/email",
      "/api/auth/request-password-reset",
      "/api/auth/get-session",
    ]) {
      const response = await proxy(request(path));
      expect(passedThrough(response), path).toBe(true);
    }
  });
});

describe("engine proxy gate", () => {
  it("forwards a request carrying a valid session", async () => {
    const token = await createSessionToken();
    const response = await proxy(
      request("/api/wands/engine/status", `${SESSION_COOKIE}=${token ?? ""}`),
    );
    expect(passedThrough(response)).toBe(true);
  });

  it("rejects a request with no session", async () => {
    const response = await proxy(request("/api/wands/engine/status"));
    expect(response.status).toBe(401);
    expect(passedThrough(response)).toBe(false);
  });

  it("rejects a forged session cookie", async () => {
    const response = await proxy(
      request("/api/wands/engine/status", `${SESSION_COOKIE}=v1.9999999999.forged`),
    );
    expect(response.status).toBe(401);
  });

  it("rejects a session signed with another secret", async () => {
    const token = await createSessionToken();
    process.env.WANDS_SESSION_SECRET = "rotated-secret";
    const response = await proxy(
      request("/api/wands/engine/status", `${SESSION_COOKIE}=${token ?? ""}`),
    );
    expect(response.status).toBe(401);
  });

  it("fails closed in production when the gate is unconfigured", async () => {
    delete process.env.WANDS_OPERATOR_PASSWORD;
    vi.stubEnv("NODE_ENV", "production");
    const response = await proxy(request("/api/wands/engine/status"));
    expect(response.status).toBe(503);
    expect(passedThrough(response)).toBe(false);
  });

  it("fails closed in development when the gate is unconfigured and no bypass is requested", async () => {
    delete process.env.WANDS_OPERATOR_PASSWORD;
    vi.stubEnv("NODE_ENV", "development");
    const response = await proxy(request("/api/wands/engine/status"));
    expect(response.status).toBe(503);
    expect(passedThrough(response)).toBe(false);
  });

  it("fails closed when the bypass is requested against an undeclared database", async () => {
    delete process.env.WANDS_OPERATOR_PASSWORD;
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("WANDS_DEV_OPERATOR_BYPASS", "1");
    const response = await proxy(request("/api/wands/engine/status"));
    expect(response.status).toBe(503);
    expect(passedThrough(response)).toBe(false);
  });

  it("allows the explicit bypass in development against a declared development database", async () => {
    delete process.env.WANDS_OPERATOR_PASSWORD;
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("WANDS_DEV_OPERATOR_BYPASS", "1");
    vi.stubEnv("WANDS_DATABASE_ENV", "development");
    const response = await proxy(request("/api/wands/engine/status"));
    expect(passedThrough(response)).toBe(true);
  });
});

describe("routes that reach the engine without the wands prefix", () => {
  it("gates the research assistant, which reads the operator's portfolio", async () => {
    const response = await proxy(request("/api/research"));
    expect(response.status).toBe(401);
    expect(passedThrough(response)).toBe(false);
  });

  it("gates the candle feed", async () => {
    const response = await proxy(request("/api/markets/candles?symbol=BTC/USD"));
    expect(response.status).toBe(401);
  });

  it("lets a signed-in operator through", async () => {
    const token = await createSessionToken();
    const response = await proxy(
      request("/api/research", `${SESSION_COOKIE}=${token ?? ""}`),
    );
    expect(passedThrough(response)).toBe(true);
  });
});

describe("operator console pages", () => {
  it("redirects an unauthenticated visitor to the sign-in form", async () => {
    const response = await proxy(request("/portfolio"));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/portfolio");
  });

  it("serves the page to a signed-in operator", async () => {
    const token = await createSessionToken();
    const response = await proxy(
      request("/risk", `${SESSION_COOKIE}=${token ?? ""}`),
    );
    expect(passedThrough(response)).toBe(true);
  });

  it("fails closed in development when the gate is unconfigured and no bypass is requested", async () => {
    delete process.env.WANDS_OPERATOR_PASSWORD;
    delete process.env.WANDS_SESSION_SECRET;
    vi.stubEnv("NODE_ENV", "development");

    const response = await proxy(request("/portfolio"));
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/login");
  });

  it("serves the console in development only under the explicit bypass", async () => {
    delete process.env.WANDS_OPERATOR_PASSWORD;
    delete process.env.WANDS_SESSION_SECRET;
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("WANDS_DEV_OPERATOR_BYPASS", "1");
    vi.stubEnv("WANDS_DATABASE_ENV", "test");

    const response = await proxy(request("/portfolio"));
    expect(passedThrough(response)).toBe(true);
  });

  it("redirects to sign-in in production when the gate is unconfigured", async () => {
    delete process.env.WANDS_OPERATOR_PASSWORD;
    delete process.env.WANDS_SESSION_SECRET;
    vi.stubEnv("NODE_ENV", "production");

    const response = await proxy(request("/portfolio"));
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/login");
  });
});

describe("public marketing routes", () => {
  it("never requires an operator session", async () => {
    for (const path of ["/", "/pricing", "/waitlist", "/legal/terms", "/blog/post"]) {
      const response = await proxy(request(path));
      expect(passedThrough(response), path).toBe(true);
    }
  });

  it("stays reachable in production when the operator gate is unconfigured", async () => {
    delete process.env.WANDS_OPERATOR_PASSWORD;
    delete process.env.WANDS_SESSION_SECRET;
    vi.stubEnv("NODE_ENV", "production");

    const response = await proxy(request("/pricing"));
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

describe("public API endpoints", () => {
  it("serves the marketing form endpoints without a session", async () => {
    for (const path of PUBLIC_API_PREFIXES) {
      const response = await proxy(request(path));
      expect(passedThrough(response), path).toBe(true);
    }
  });

  it("keeps the Stripe webhook reachable so signature verification can run", async () => {
    delete process.env.WANDS_OPERATOR_PASSWORD;
    delete process.env.WANDS_SESSION_SECRET;
    vi.stubEnv("NODE_ENV", "production");

    const response = await proxy(request("/api/billing/webhook"));
    expect(passedThrough(response)).toBe(true);
    expect(response.status).not.toBe(503);
  });
});

describe("unclassified API routes", () => {
  it("denies an API route that no list claims", async () => {
    const response = await proxy(request("/api/internal/engine/keys"));
    expect(response.status).toBe(404);
    expect(passedThrough(response)).toBe(false);
  });

  it("denies it even for a signed-in operator, because the route is undeclared", async () => {
    const token = await createSessionToken();
    const response = await proxy(
      request("/api/unknown", `${SESSION_COOKIE}=${token ?? ""}`),
    );
    expect(response.status).toBe(404);
  });

  it("does not deny a new marketing page", async () => {
    const response = await proxy(request("/blog/2026-outlook"));
    expect(passedThrough(response)).toBe(true);
  });
});

describe("customer tier", () => {
  it("does not gate non-member subscriber surfaces behind the operator session", async () => {
    for (const path of CUSTOMER_PREFIXES.filter((prefix) => !isMemberPage(prefix))) {
      const response = await proxy(request(path));
      expect(passedThrough(response), path).toBe(true);
    }
  });

  it("keeps subscriber surfaces and the engine in separate tiers", () => {
    expect(routeTier("/account")).toBe("customer");
    expect(routeTier("/api/billing/portal")).toBe("customer");
    expect(routeTier("/api/wands/engine/status")).toBe("operator");
    expect(routeTier("/dashboard")).toBe("operator");
  });

  it("rejects a session cookie that is not a signed operator session", async () => {
    // A Stripe customer session is a different credential entirely; presenting
    // it to the operator gate must not be enough.
    const response = await proxy(
      request("/api/wands/engine/status", "wands_customer=cs_test_123"),
    );
    expect(response.status).toBe(401);
  });
});

function matcherCovers(pattern: string, pathname: string): boolean {
  const base = pattern.replace(/\/:path\*$/, "");
  return pathname === base || pathname.startsWith(`${base}/`);
}

describe("member pages", () => {
  it("sends a signed-out visitor to the customer sign-in form", async () => {
    const response = await proxy(request("/app/watchlists"));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/signin");
    expect(location.searchParams.get("next")).toBe("/app/watchlists");
  });

  it("lets a request carrying a member cookie through to the layout", async () => {
    for (const name of MEMBER_SESSION_COOKIES) {
      const response = await proxy(request("/app", `${name}=present`));
      expect(passedThrough(response), name).toBe(true);
    }
  });

  it("overwrites a client-supplied entitlement exemption instead of trusting it", async () => {
    // The workspace layout reads this header to decide whether the paid gate
    // applies. A member who could set it themselves would exempt themselves
    // from the subscription check, so the proxy must replace it, not merge it.
    const spoofed = { "x-wands-entitlement-exempt": "1" };

    const gated = await proxy(request("/app/signals", "wands.session_token=present", spoofed));
    expect(gated.headers.get("x-middleware-request-x-wands-entitlement-exempt")).toBe("0");

    const billing = await proxy(request("/app/membership", "wands.session_token=present", spoofed));
    expect(billing.headers.get("x-middleware-request-x-wands-entitlement-exempt")).toBe("1");
  });

  it("recognises the secure-prefixed cookie Better Auth issues on HTTPS", async () => {
    // Better Auth prepends `__Secure-` when the cookie is secure. Missing this
    // name bounced signed-in visitors between /app and /signin.
    expect(MEMBER_SESSION_COOKIES).toContain("__Secure-wands.session_token");
  });

  it("never treats a member cookie as an operator session", async () => {
    for (const name of MEMBER_SESSION_COOKIES) {
      const response = await proxy(request("/api/wands/engine/status", `${name}=present`));
      expect(response.status, name).toBe(401);
    }
  });

  it("never lets a member session into the operator console, even under the development bypass", async () => {
    // The bypass keeps an unconfigured console open for the operator. A customer
    // session must not inherit that: trading functions are operator-only in
    // every environment.
    delete process.env.WANDS_OPERATOR_PASSWORD;
    delete process.env.WANDS_SESSION_SECRET;
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("WANDS_DEV_OPERATOR_BYPASS", "1");
    vi.stubEnv("WANDS_DATABASE_ENV", "development");

    for (const name of MEMBER_SESSION_COOKIES) {
      const page = await proxy(request("/portfolio", `${name}=present`));
      expect(page.status, name).toBe(307);
      expect(new URL(page.headers.get("location") ?? "").pathname, name).toBe("/login");

      const api = await proxy(request("/api/wands/engine/status", `${name}=present`));
      expect(api.status, name).toBe(401);
      expect(passedThrough(api), name).toBe(false);
    }
  });

  it("keeps member APIs reachable so the route handler can authorise them", async () => {
    const response = await proxy(request("/api/member/watchlists"));
    expect(passedThrough(response)).toBe(true);
  });

  it("keeps the auth endpoints public so sign-in can run", async () => {
    const response = await proxy(request("/api/auth/sign-in/email"));
    expect(passedThrough(response)).toBe(true);
  });

  it("covers every member page in the matcher", () => {
    for (const prefix of MEMBER_PAGE_PREFIXES) {
      const covered = config.matcher.some((pattern) => matcherCovers(pattern, prefix));
      expect(covered, `matcher is missing ${prefix}`).toBe(true);
    }
  });
});

describe("matcher parity", () => {
  it("covers every operator prefix", () => {
    for (const prefix of OPERATOR_PREFIXES) {
      const covered = config.matcher.some((pattern) =>
        matcherCovers(pattern, prefix),
      );
      expect(covered, `matcher is missing ${prefix}`).toBe(true);
    }
  });

  it("covers every API route so unclassified ones can be denied", () => {
    const covered = config.matcher.some((pattern) =>
      matcherCovers(pattern, "/api/anything/at/all"),
    );
    expect(covered).toBe(true);
  });
});
