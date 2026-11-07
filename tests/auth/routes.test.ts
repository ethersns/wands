// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  CUSTOMER_PREFIXES,
  OPERATOR_PREFIXES,
  PUBLIC_API_PREFIXES,
  isApiPath,
  routeTier,
} from "@/lib/auth/routes";

describe("operator tier", () => {
  it("claims every console page and every engine endpoint", () => {
    for (const prefix of OPERATOR_PREFIXES) {
      expect(routeTier(prefix), prefix).toBe("operator");
      expect(routeTier(`${prefix}/nested`), prefix).toBe("operator");
    }
  });

  it("does not claim a path that merely shares a name prefix", () => {
    // `/settings-export` is not `/settings`.
    expect(routeTier("/settings-export")).toBe("public");
    expect(routeTier("/dashboardish")).toBe("public");
  });
});

describe("public API tier", () => {
  it("classifies every declared public endpoint as public", () => {
    for (const prefix of PUBLIC_API_PREFIXES) {
      expect(routeTier(prefix), prefix).toBe("public");
    }
  });

  it("never declares the whole API surface public", () => {
    expect(PUBLIC_API_PREFIXES).not.toContain("/api");
    expect(routeTier("/api")).toBe("denied");
  });
});

describe("customer tier", () => {
  it("classifies every subscriber surface as customer", () => {
    for (const prefix of CUSTOMER_PREFIXES) {
      expect(routeTier(prefix), prefix).toBe("customer");
    }
  });
});

describe("deny by default for APIs", () => {
  it("denies an API route that no list claims", () => {
    expect(routeTier("/api/internal/keys")).toBe("denied");
    expect(routeTier("/api/admin/users")).toBe("denied");
    expect(routeTier("/api")).toBe("denied");
  });

  it("still lets an unclassified page through, so marketing can grow", () => {
    expect(routeTier("/blog/2026-outlook")).toBe("public");
    expect(routeTier("/careers")).toBe("public");
  });
});

describe("tier lists stay disjoint", () => {
  const lists = {
    operator: OPERATOR_PREFIXES,
    customer: CUSTOMER_PREFIXES,
    publicApi: PUBLIC_API_PREFIXES,
  } as const;

  it("never classifies one path into two tiers", () => {
    for (const [name, prefixes] of Object.entries(lists)) {
      for (const prefix of prefixes) {
        const tier = routeTier(prefix);
        const expected =
          name === "publicApi" ? "public" : (name as "operator" | "customer");
        expect(tier, `${prefix} from ${name}`).toBe(expected);
      }
    }
  });
});

describe("isApiPath", () => {
  it("recognises the API namespace and nothing else", () => {
    expect(isApiPath("/api")).toBe(true);
    expect(isApiPath("/api/wands/engine/status")).toBe(true);
    expect(isApiPath("/apix")).toBe(false);
    expect(isApiPath("/pricing")).toBe(false);
  });
});
