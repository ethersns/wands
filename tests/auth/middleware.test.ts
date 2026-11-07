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
import { config, middleware } from "@/middleware";

const USERNAME = "operator";
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

describe("public API endpoints", () => {
  it("serves the marketing form endpoints without a session", async () => {
    for (const path of PUBLIC_API_PREFIXES) {
      const response = await middleware(request(path));
      expect(passedThrough(response), path).toBe(true);
    }
  });

  it("keeps the Stripe webhook reachable so signature verification can run", async () => {
    delete process.env.WANDS_OPERATOR_PASSWORD;
    delete process.env.WANDS_SESSION_SECRET;
    vi.stubEnv("NODE_ENV", "production");

    const response = await middleware(request("/api/billing/webhook"));
    expect(passedThrough(response)).toBe(true);
    expect(response.status).not.toBe(503);
  });
});

describe("unclassified API routes", () => {
  it("denies an API route that no list claims", async () => {
    const response = await middleware(request("/api/internal/engine/keys"));
    expect(response.status).toBe(404);
    expect(passedThrough(response)).toBe(false);
  });

  it("denies it even for a signed-in operator, because the route is undeclared", async () => {
    const token = await createSessionToken();
    const response = await middleware(
      request("/api/unknown", `${SESSION_COOKIE}=${token ?? ""}`),
    );
    expect(response.status).toBe(404);
  });

  it("does not deny a new marketing page", async () => {
    const response = await middleware(request("/blog/2026-outlook"));
    expect(passedThrough(response)).toBe(true);
  });
});

describe("customer tier", () => {
  it("does not gate non-member subscriber surfaces behind the operator session", async () => {
    for (const path of CUSTOMER_PREFIXES.filter((prefix) => !isMemberPage(prefix))) {
      const response = await middleware(request(path));
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
    const response = await middleware(
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
    const response = await middleware(request("/app/watchlists"));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/signin");
    expect(location.searchParams.get("next")).toBe("/app/watchlists");
  });

  it("lets a request carrying a member cookie through to the layout", async () => {
    for (const name of MEMBER_SESSION_COOKIES) {
      const response = await middleware(request("/app", `${name}=present`));
      expect(passedThrough(response), name).toBe(true);
    }
  });

  it("recognises the secure-prefixed cookie Better Auth issues on HTTPS", async () => {
    // Better Auth prepends `__Secure-` when the cookie is secure. Missing this
    // name bounced signed-in visitors between /app and /signin.
    expect(MEMBER_SESSION_COOKIES).toContain("__Secure-wands.session_token");
  });

  it("never treats a member cookie as an operator session", async () => {
    for (const name of MEMBER_SESSION_COOKIES) {
      const response = await middleware(request("/api/wands/engine/status", `${name}=present`));
      expect(response.status, name).toBe(401);
    }
  });

  it("never lets a member session into the operator console, even with the gate unconfigured", async () => {
    // The development affordance keeps an unconfigured console open for the
    // operator. A customer session must not inherit that: trading functions are
    // operator-only in every environment.
    delete process.env.WANDS_OPERATOR_PASSWORD;
    delete process.env.WANDS_SESSION_SECRET;
    vi.stubEnv("NODE_ENV", "development");

    for (const name of MEMBER_SESSION_COOKIES) {
      const page = await middleware(request("/portfolio", `${name}=present`));
      expect(page.status, name).toBe(307);
      expect(new URL(page.headers.get("location") ?? "").pathname, name).toBe("/login");

      const api = await middleware(request("/api/wands/engine/status", `${name}=present`));
      expect(api.status, name).toBe(401);
      expect(passedThrough(api), name).toBe(false);
    }
  });

  it("keeps member APIs reachable so the route handler can authorise them", async () => {
    const response = await middleware(request("/api/member/watchlists"));
    expect(passedThrough(response)).toBe(true);
  });

  it("keeps the auth endpoints public so sign-in can run", async () => {
    const response = await middleware(request("/api/auth/sign-in/email"));
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
