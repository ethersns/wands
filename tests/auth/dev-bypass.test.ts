// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { devBypassActive, devBypassState } from "@/lib/auth/dev-bypass";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("devBypassState", () => {
  it("is inactive when nothing is requested", () => {
    vi.stubEnv("WANDS_DEV_OPERATOR_BYPASS", "");
    expect(devBypassState()).toEqual({ active: false, reason: "not_requested" });
  });

  it("is inactive when the bypass is requested but the database is undeclared", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("WANDS_DEV_OPERATOR_BYPASS", "1");
    vi.stubEnv("WANDS_DATABASE_ENV", "");

    expect(devBypassState()).toEqual({
      active: false,
      reason: "database_not_declared_non_production",
    });
  });

  it("is inactive when the database is declared production", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("WANDS_DEV_OPERATOR_BYPASS", "1");
    vi.stubEnv("WANDS_DATABASE_ENV", "production");

    expect(devBypassActive()).toBe(false);
  });

  it("is inactive in a production build whatever else is set", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WANDS_DEV_OPERATOR_BYPASS", "1");
    vi.stubEnv("WANDS_DATABASE_ENV", "development");

    expect(devBypassState()).toEqual({ active: false, reason: "production_build" });
  });

  it("is inactive when the flag is set to anything other than 1", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("WANDS_DEV_OPERATOR_BYPASS", "true");
    vi.stubEnv("WANDS_DATABASE_ENV", "development");

    expect(devBypassActive()).toBe(false);
  });

  it("activates only when all three conditions hold", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("WANDS_DEV_OPERATOR_BYPASS", "1");
    vi.stubEnv("WANDS_DATABASE_ENV", "development");

    expect(devBypassState()).toEqual({ active: true });
  });

  it("accepts a database declared as test", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("WANDS_DEV_OPERATOR_BYPASS", "1");
    vi.stubEnv("WANDS_DATABASE_ENV", "test");

    expect(devBypassActive()).toBe(true);
  });
});
