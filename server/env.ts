import { z } from "zod";

/**
 * Server configuration, validated once at startup. Secrets only come from the environment
 * (never from the frontend bundle: the client build only sees VITE_* variables).
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:8080"),
  /** Extra comma-separated origins allowed to call the API with cookies (the BETTER_AUTH_URL origin is always allowed). */
  TRUSTED_ORIGINS: z.string().default(""),
  /** Optional SMTP connection string, e.g. smtps://user:pass@smtp.example.com:465 */
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z
    .string()
    .optional()
    .transform((v) => v?.trim() || "قصر العدالة <no-reply@example.tn>"),
  /** Chromium used to render PDF receipts: "bundled" (playwright install chromium), "chrome", "msedge" or an absolute path. */
  PDF_BROWSER: z
    .string()
    .optional()
    .transform((v) => v?.trim() || "bundled"),
  /** Serve the built SPA (dist/) from this server in production. */
  SERVE_STATIC: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  /** Trust X-Forwarded-For (only when running behind a reverse proxy you control). */
  TRUST_PROXY: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  REMINDER_WORKER: z
    .string()
    .optional()
    .transform((v) => v !== "false"),
  /**
   * Shared secret for the scheduled-job endpoints (GET /api/cron/*) used where no background worker can run
   * (serverless). Callers send `Authorization: Bearer <secret>`; Vercel Cron does this by itself. Unset = disabled.
   */
  CRON_SECRET: z
    .string()
    .optional()
    .transform((v) => v?.trim() || undefined)
    .refine((v) => !v || v.length >= 16, "CRON_SECRET must be at least 16 characters"),
});

export type Env = z.infer<typeof schema>;

/**
 * On Vercel the public address and the proxy setup are known, so a first deployment needs fewer variables:
 * the app's own address becomes BETTER_AUTH_URL (the production domain for Production, the deployment address
 * otherwise), the deployment address is a trusted origin (it is this same app), and the client address is
 * read from X-Forwarded-For, which Vercel sets itself. Anything set explicitly still wins.
 */
function withVercelDefaults(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (!source.VERCEL) return source;
  const host = source.VERCEL_ENV === "production" ? source.VERCEL_PROJECT_PRODUCTION_URL || source.VERCEL_URL : source.VERCEL_URL;
  return {
    ...source,
    BETTER_AUTH_URL: source.BETTER_AUTH_URL?.trim() || (host ? `https://${host}` : undefined),
    TRUSTED_ORIGINS: [source.TRUSTED_ORIGINS, source.VERCEL_URL && `https://${source.VERCEL_URL}`].filter(Boolean).join(","),
    TRUST_PROXY: source.TRUST_PROXY || "true",
  };
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(withVercelDefaults(source));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid server environment:\n${issues}`);
  }
  if (parsed.data.NODE_ENV === "production") {
    if (/dev-only|test-secret|e2e-secret|change-me/i.test(parsed.data.BETTER_AUTH_SECRET)) {
      throw new Error("Refusing to start in production with a development or placeholder BETTER_AUTH_SECRET.");
    }
    if (!parsed.data.BETTER_AUTH_URL.startsWith("https://")) {
      console.warn("[env] BETTER_AUTH_URL is not https: in production, session cookies are Secure-only and require HTTPS.");
    }
  }
  return parsed.data;
}

let cached: Env | undefined;
export function env(): Env {
  cached ??= loadEnv();
  return cached;
}

/** Origins allowed to send cookie-authenticated mutations: the public URL plus TRUSTED_ORIGINS. */
export function trustedOrigins(e: Env = env()): string[] {
  const listed = e.TRUSTED_ORIGINS.split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  return [...new Set([new URL(e.BETTER_AUTH_URL).origin, ...listed])];
}
