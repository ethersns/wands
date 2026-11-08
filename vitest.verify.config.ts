import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Config for the one-off live-database verification. Kept separate from
 * `vitest.config.ts` so the normal suite never depends on a database.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["scripts/verify-member-admin.test.ts"],
    testTimeout: 60_000,
    fileParallelism: false,
  },
});
