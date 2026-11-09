// @vitest-environment node

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { routeTier } from "@/lib/auth/routes";
import { SESSION_COOKIE, createSessionToken } from "@/lib/auth/session";
import { config, proxy } from "@/proxy";

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

describe("admin route classification", () => {
  it("puts every control-centre page in the operator tier", () => {
    for (const path of [
      "/dashboard",
      "/dashboard/members",
      "/dashboard/members/abc-123",
      "/dashboard/waitlist",
      "/dashboard/traffic",
      "/dashboard/activity",
      "/dashboard/system",
    ]) {
      expect(routeTier(path), path).toBe("operator");
    }
  });

  it("puts the admin API in the operator tier", () => {
    expect(routeTier("/api/admin/waitlist/export")).toBe("operator");
    expect(routeTier("/api/admin/anything")).toBe("operator");
  });

  it("keeps the tracking beacon public", () => {
    expect(routeTier("/api/track")).toBe("public");
  });

  it("keeps the member workspace in the customer tier", () => {
    expect(routeTier("/app")).toBe("customer");
    expect(routeTier("/app/quant-lab")).toBe("customer");
    expect(routeTier("/app/opportunity")).toBe("customer");
  });

  it("still denies an unclassified API route", () => {
    expect(routeTier("/api/internal/engine/keys")).toBe("denied");
  });
});

describe("admin pages behind the operator gate", () => {
  it("redirects an unauthenticated visitor to the operator sign-in", async () => {
    const response = await proxy(request("/dashboard/members"));

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/dashboard/members");
  });

  it("serves the page to a signed-in operator", async () => {
    const token = await createSessionToken();
    const response = await proxy(
      request("/dashboard/waitlist", `${SESSION_COOKIE}=${token ?? ""}`),
    );
    expect(passedThrough(response)).toBe(true);
  });

  it("does not let a member session reach an admin page", async () => {
    const response = await proxy(
      request("/dashboard/members", "wands.session_token=member-token"),
    );

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/login");
  });

  it("fails closed in production when the gate is unconfigured", async () => {
    delete process.env.WANDS_OPERATOR_PASSWORD;
    delete process.env.WANDS_SESSION_SECRET;
    vi.stubEnv("NODE_ENV", "production");

    const response = await proxy(request("/dashboard"));
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/login");
  });
});

describe("admin API behind the operator gate", () => {
  it("answers 401 to an unauthenticated export", async () => {
    const response = await proxy(request("/api/admin/waitlist/export"));
    expect(response.status).toBe(401);
    expect(passedThrough(response)).toBe(false);
  });

  it("answers 401 to a member session", async () => {
    const response = await proxy(
      request("/api/admin/waitlist/export", "wands.session_token=member-token"),
    );
    expect(response.status).toBe(401);
  });

  it("lets a signed-in operator through", async () => {
    const token = await createSessionToken();
    const response = await proxy(
      request("/api/admin/waitlist/export", `${SESSION_COOKIE}=${token ?? ""}`),
    );
    expect(passedThrough(response)).toBe(true);
  });

  it("answers 503 in production when the gate is unconfigured", async () => {
    delete process.env.WANDS_OPERATOR_PASSWORD;
    delete process.env.WANDS_SESSION_SECRET;
    vi.stubEnv("NODE_ENV", "production");

    const response = await proxy(request("/api/admin/waitlist/export"));
    expect(response.status).toBe(503);
  });
});

describe("tracking beacon", () => {
  it("is reachable without any session", async () => {
    const response = await proxy(request("/api/track"));
    expect(passedThrough(response)).toBe(true);
  });

  it("stays reachable in production when the operator gate is unconfigured", async () => {
    delete process.env.WANDS_OPERATOR_PASSWORD;
    delete process.env.WANDS_SESSION_SECRET;
    vi.stubEnv("NODE_ENV", "production");

    const response = await proxy(request("/api/track"));
    expect(passedThrough(response)).toBe(true);
    expect(response.status).not.toBe(503);
  });
});

describe("existing routes still behave", () => {
  it("keeps the trading console gated", async () => {
    for (const path of ["/portfolio", "/markets", "/bots", "/orders", "/risk", "/settings"]) {
      const response = await proxy(request(path));
      expect(response.status, path).toBe(307);
    }
  });

  it("keeps the member workspace on the customer gate", async () => {
    const response = await proxy(request("/app/quant-lab"));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/signin");
    expect(location.searchParams.get("next")).toBe("/app/quant-lab");
  });

  it("keeps the marketing site public", async () => {
    for (const path of ["/", "/pricing", "/features", "/about", "/privacy"]) {
      const response = await proxy(request(path));
      expect(passedThrough(response), path).toBe(true);
    }
  });

  it("covers every operator page prefix in the middleware matcher", () => {
    const matchers = config.matcher;
    for (const path of [
      "/dashboard/:path*",
      "/portfolio/:path*",
      "/markets/:path*",
      "/bots/:path*",
      "/orders/:path*",
      "/intelligence/:path*",
      "/strategy-lab/:path*",
      "/research/:path*",
      "/risk/:path*",
      "/connections/:path*",
      "/settings/:path*",
      "/app/:path*",
      "/api/:path*",
    ]) {
      expect(matchers, path).toContain(path);
    }
  });
});
