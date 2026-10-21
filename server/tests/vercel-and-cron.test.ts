import { describe, expect, it } from "vitest";

import { loadEnv } from "../env.js";
import { call } from "./helpers.js";

const SECRET = process.env.CRON_SECRET!;

/** A minimal valid environment; `extra` adds or overrides variables. */
function source(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { NODE_ENV: "production", DATABASE_URL: "postgresql://user:pw@localhost:5432/db", BETTER_AUTH_SECRET: "k".repeat(40), ...extra } as NodeJS.ProcessEnv;
}

describe("environment on Vercel", () => {
  it("guesses nothing outside Vercel", () => {
    const e = loadEnv(source());
    expect(e.BETTER_AUTH_URL).toBe("http://localhost:8080");
    expect(e.TRUST_PROXY).toBe(false);
  });

  it("uses the production domain as the public address in Production", () => {
    const e = loadEnv(source({ VERCEL: "1", VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "lawyer.vercel.app", VERCEL_URL: "lawyer-abc123.vercel.app" }));
    expect(e.BETTER_AUTH_URL).toBe("https://lawyer.vercel.app");
  });

  it("uses the deployment address in a Preview", () => {
    const e = loadEnv(source({ VERCEL: "1", VERCEL_ENV: "preview", VERCEL_PROJECT_PRODUCTION_URL: "lawyer.vercel.app", VERCEL_URL: "lawyer-git-fix-team.vercel.app" }));
    expect(e.BETTER_AUTH_URL).toBe("https://lawyer-git-fix-team.vercel.app");
  });

  it("trusts the deployment's own address for cookie-authenticated requests, besides configured origins", () => {
    const e = loadEnv(source({ VERCEL: "1", VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "lawyer.vercel.app", VERCEL_URL: "lawyer-abc123.vercel.app", TRUSTED_ORIGINS: "https://office.example.tn" }));
    expect(e.TRUSTED_ORIGINS.split(",")).toEqual(["https://office.example.tn", "https://lawyer-abc123.vercel.app"]);
  });

  it("reads the visitor's address from X-Forwarded-For by default (Vercel sets it)", () => {
    expect(loadEnv(source({ VERCEL: "1", VERCEL_URL: "x.vercel.app" })).TRUST_PROXY).toBe(true);
  });

  it("lets explicit settings win", () => {
    const e = loadEnv(source({ VERCEL: "1", VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "lawyer.vercel.app", BETTER_AUTH_URL: "https://office.example.tn", TRUST_PROXY: "false" }));
    expect(e.BETTER_AUTH_URL).toBe("https://office.example.tn");
    expect(e.TRUST_PROXY).toBe(false);
  });

  it("treats empty values as not set", () => {
    const e = loadEnv(source({ VERCEL: "1", VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "lawyer.vercel.app", BETTER_AUTH_URL: "", TRUST_PROXY: "" }));
    expect(e.BETTER_AUTH_URL).toBe("https://lawyer.vercel.app");
    expect(e.TRUST_PROXY).toBe(true);
  });

  it("CRON_SECRET: empty disables the endpoint, a short one is rejected", () => {
    expect(loadEnv(source({ CRON_SECRET: "" })).CRON_SECRET).toBeUndefined();
    expect(loadEnv(source({ CRON_SECRET: "a-long-enough-secret-value" })).CRON_SECRET).toBe("a-long-enough-secret-value");
    expect(() => loadEnv(source({ CRON_SECRET: "too-short" }))).toThrow(/CRON_SECRET must be at least 16 characters/);
  });
});

describe("scheduled reminder delivery endpoint", () => {
  it("answers 404 (it does not advertise itself) without the secret", async () => {
    const res = await call("GET", "/api/cron/reminders");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("answers 404 for a wrong secret, whatever its length", async () => {
    for (const wrong of ["Bearer wrong", `Bearer ${SECRET}x`, `Bearer ${SECRET.slice(0, -1)}`, SECRET, "Bearer "]) {
      expect((await call("GET", "/api/cron/reminders", { headers: { Authorization: wrong } })).status).toBe(404);
    }
  });

  it("does not accept the secret in the URL", async () => {
    expect((await call("GET", `/api/cron/reminders?secret=${SECRET}`)).status).toBe(404);
  });

  it("runs the delivery and reports what it did when the secret is right", async () => {
    const res = await call("GET", "/api/cron/reminders", { headers: { Authorization: `Bearer ${SECRET}` } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      processed: expect.any(Number),
      sent: expect.any(Number),
      failed: expect.any(Number),
      notConfigured: expect.any(Number),
      cancelled: expect.any(Number),
    });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
