import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 8080,
    // The API server (npm run dev:server) runs on :3001. Proxying keeps the browser on one origin,
    // so session cookies stay first-party and SameSite=Lax.
    proxy: {
      "/api": { target: process.env.API_PROXY_TARGET ?? "http://127.0.0.1:3001", changeOrigin: false, xfwd: true },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/tests/setup.ts",
    css: true,
    // Server integration tests (real PostgreSQL) and Playwright e2e specs have their own runners.
    exclude: [...configDefaults.exclude, "server/**", "e2e/**"],
  },
});
