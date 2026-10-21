/**
 * Creates an office and its first administrator (public sign-up is disabled).
 *
 *   OFFICE_ADMIN_PASSWORD='…' npm run office:create -- --name "مكتب …" --slug my-office \
 *     --admin-name "…" --admin-email admin@example.tn
 *
 * The password is read from the OFFICE_ADMIN_PASSWORD environment variable so it never appears
 * in the shell history or the process list. It is never printed.
 */
import { parseArgs } from "node:util";

// Local development convenience: read .env when present (real environment variables win).
try {
  process.loadEnvFile(".env");
} catch {
  // No .env file (containers, CI): configuration comes from the environment.
}

const { prisma } = await import("../server/db.js");
const { createOffice } = await import("../server/services/offices.js");

const { values } = parseArgs({
  options: {
    name: { type: "string" },
    slug: { type: "string" },
    "admin-name": { type: "string" },
    "admin-email": { type: "string" },
    city: { type: "string" },
  },
});

const password = process.env.OFFICE_ADMIN_PASSWORD;
const missing = ["name", "slug", "admin-name", "admin-email"].filter((k) => !values[k as keyof typeof values]);
if (missing.length || !password) {
  console.error(`Missing: ${[...missing.map((m) => `--${m}`), ...(password ? [] : ["OFFICE_ADMIN_PASSWORD"])].join(", ")}`);
  process.exit(1);
}
if (!/^[a-z0-9-]{3,40}$/.test(values.slug!)) {
  console.error("--slug must be 3-40 characters: lowercase letters, digits and dashes.");
  process.exit(1);
}

try {
  const result = await createOffice({
    name: values.name!,
    slug: values.slug!,
    admin: { name: values["admin-name"]!, email: values["admin-email"]!.toLowerCase(), password },
    settings: values.city ? { city: values.city } : undefined,
  });
  console.info(`Office created (id ${result.organizationId}). The administrator can now sign in with ${values["admin-email"]}.`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
