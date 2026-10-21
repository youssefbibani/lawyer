import { readFileSync } from "node:fs";

export const API_PORT = 3101;
export const WEB_PORT = 5174;
export const ORIGIN = `http://localhost:${WEB_PORT}`;

function fromDotEnv(key: string): string | undefined {
  try {
    const line = readFileSync(".env", "utf8")
      .split(/\r?\n/)
      .find((l) => l.startsWith(`${key}=`));
    return line?.slice(key.length + 1).trim();
  } catch {
    return undefined;
  }
}

/** Environment for the API server under test: always the TEST database, never development data. */
export function e2eEnv(): Record<string, string> {
  const db = process.env.DATABASE_URL_TEST ?? fromDotEnv("DATABASE_URL_TEST");
  if (!db || !/test/i.test(new URL(db).pathname)) throw new Error("E2E tests need DATABASE_URL_TEST pointing at a database whose name contains 'test'.");
  return {
    NODE_ENV: "test",
    DATABASE_URL: db,
    BETTER_AUTH_SECRET: "e2e-secret-for-browser-tests-only-0123456789",
    BETTER_AUTH_URL: ORIGIN,
    TRUSTED_ORIGINS: ORIGIN,
    PORT: String(API_PORT),
    TRUST_PROXY: "true",
    REMINDER_WORKER: "false",
    PDF_BROWSER: process.env.PDF_BROWSER ?? fromDotEnv("PDF_BROWSER") ?? "chrome",
    E2E_API_URL: `http://127.0.0.1:${API_PORT}`,
    E2E_ORIGIN: ORIGIN,
  };
}
