import { defineConfig, devices } from "@playwright/test";

import { API_PORT, ORIGIN, WEB_PORT, e2eEnv } from "./e2e/env";

/**
 * Browser end-to-end tests: the real API server (test database) behind the Vite dev server.
 * Uses the locally installed Chrome (PLAYWRIGHT_CHANNEL to override, e.g. "msedge").
 */
const channel = process.env.PLAYWRIGHT_CHANNEL ?? "chrome";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: ORIGIN,
    locale: "ar-TN",
    timezoneId: "Africa/Tunis",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel }, testIgnore: /mobile.spec.ts/ },
    { name: "mobile", use: { ...devices["Pixel 7"], channel }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: [
    {
      command: "npx tsx server/index.ts",
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      env: e2eEnv(),
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      url: ORIGIN,
      env: { API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}` },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
