import { defineConfig } from "vitest/config";

/**
 * Server integration tests: real HTTP requests through the Hono app against a real PostgreSQL
 * database (DATABASE_URL_TEST). Files run one after another; every test creates its own offices,
 * so no data is shared or deleted between tests.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["server/tests/**/*.test.ts"],
    globalSetup: "./server/tests/global-setup.ts",
    setupFiles: ["./server/tests/setup-env.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
