import { execSync } from "node:child_process";

import { testDatabaseUrl } from "./test-env.js";

/** Applies pending migrations to the test database (non-destructive: never resets it). */
export default function setup() {
  const url = testDatabaseUrl();
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
}
