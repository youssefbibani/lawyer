/**
 * Prints the tables Better Auth expects for this project's configuration (core + organization +
 * two-factor + database rate limiting), so the Prisma schema can be checked against them.
 *   npx tsx scripts/print-auth-tables.ts
 */
import { getAuthTables } from "better-auth/db";

process.env.DATABASE_URL ??= "postgresql://localhost/unused";
process.env.BETTER_AUTH_SECRET ??= "dev-only-secret-for-schema-inspection-000000";

const { authOptions } = await import("../server/auth.js");
const tables = getAuthTables(authOptions());
for (const [key, table] of Object.entries(tables)) {
  console.log(`\n## ${key} → model "${table.modelName}"`);
  for (const [field, attr] of Object.entries(table.fields)) {
    const a = attr as { type: unknown; required?: boolean; unique?: boolean; references?: { model: string; field: string; onDelete?: string }; fieldName?: string; defaultValue?: unknown; index?: boolean };
    console.log(
      `  ${a.fieldName ?? field}: ${JSON.stringify(a.type)}${a.required === false ? "?" : ""}${a.unique ? " @unique" : ""}${a.index ? " @index" : ""}${a.references ? ` -> ${a.references.model}.${a.references.field} (${a.references.onDelete ?? "cascade"})` : ""}${a.defaultValue !== undefined ? " (default)" : ""}`,
    );
  }
}
