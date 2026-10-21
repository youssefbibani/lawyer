import { execSync } from "node:child_process";

import { e2eEnv } from "./env";

/** Migrates the test database (non-destructive) and prepares a fresh office for this run. */
export default function globalSetup() {
  const env = { ...process.env, ...e2eEnv() };
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
  execSync("npx tsx e2e/prepare.ts", { env, stdio: "inherit" });
}
