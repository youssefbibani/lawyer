import { testDatabaseUrl } from "./test-env.js";

// Must run before any server module reads the environment or creates the Prisma client.
process.env.DATABASE_URL = testDatabaseUrl();
Object.assign(process.env, {
  NODE_ENV: "test",
  BETTER_AUTH_SECRET: "test-secret-for-integration-tests-only-0123456789",
  BETTER_AUTH_URL: "http://localhost:8080",
  TRUSTED_ORIGINS: "http://localhost:8080",
  // Tests give every simulated client its own address through X-Forwarded-For.
  TRUST_PROXY: "true",
  REMINDER_WORKER: "false",
  SMTP_URL: "",
});
