/**
 * Resolves the TEST database and refuses anything that looks like the development or production
 * database: integration tests write data.
 */
export function testDatabaseUrl(): string {
  try {
    process.loadEnvFile(".env");
  } catch {
    // No .env file: variables come from the environment (CI).
  }
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error("DATABASE_URL_TEST is not set. Point it at a dedicated, disposable test database.");
  if (url === process.env.DATABASE_URL && !process.env.CI) throw new Error("DATABASE_URL_TEST must differ from DATABASE_URL.");
  const dbName = new URL(url).pathname.replace(/^\//, "");
  if (!/test/i.test(dbName)) throw new Error(`Refusing to run integration tests against "${dbName}": the test database name must contain "test".`);
  return url;
}
