// @vitest-environment node

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SESSION_COOKIE, createSessionToken } from "@/lib/auth/session";
import { middleware } from "@/middleware";

const PASSWORD = "correct horse battery staple";
const SECRET = "test-session-secret";

function request(cookie?: string) {
  return new NextRequest(new URL("http://localhost/api/wands/engine/status"), {
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
      request(`${SESSION_COOKIE}=${token ?? ""}`),
    );
    expect(passedThrough(response)).toBe(true);
  });

  it("rejects a request with no session", async () => {
    const response = await middleware(request());
    expect(response.status).toBe(401);
    expect(passedThrough(response)).toBe(false);
  });

  it("rejects a forged session cookie", async () => {
    const response = await middleware(request(`${SESSION_COOKIE}=v1.9999999999.forged`));
    expect(response.status).toBe(401);
  });

  it("rejects a session signed with another secret", async () => {
    const token = await createSessionToken();
    process.env.WANDS_SESSION_SECRET = "rotated-secret";
    const response = await middleware(request(`${SESSION_COOKIE}=${token ?? ""}`));
    expect(response.status).toBe(401);
  });

  it("fails closed in production when the gate is unconfigured", async () => {
    delete process.env.WANDS_OPERATOR_PASSWORD;
    vi.stubEnv("NODE_ENV", "production");
    const response = await middleware(request());
    expect(response.status).toBe(503);
    expect(passedThrough(response)).toBe(false);
  });

  it("stays open in development when the gate is unconfigured", async () => {
    delete process.env.WANDS_OPERATOR_PASSWORD;
    vi.stubEnv("NODE_ENV", "development");
    const response = await middleware(request());
    expect(passedThrough(response)).toBe(true);
  });
});
