import { createHmac, randomBytes, randomUUID } from "node:crypto";

import { createApp } from "../app.js";
import { prisma } from "../db.js";
import { addUser, createOffice, systemCtx } from "../services/offices.js";
import { setPdfRenderer } from "../services/receipt-pdf.js";

export const app = createApp();
export const ORIGIN = "http://localhost:8080";
export const PASSWORD = "Test-Passw0rd-123";

/** A minimal valid PDF, used by default so most tests do not need a browser. */
export const FAKE_PDF = Buffer.from(`%PDF-1.4\n%${"x".repeat(120)}\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`, "latin1");
export function useFakePdf() {
  setPdfRenderer(async () => FAKE_PDF);
}

/**
 * A random client address. Better Auth's per-address counters live in the database and outlive a
 * test run, so tests only share an address when they pin one on purpose (e.g. the rate-limit test).
 */
export function freshIp(): string {
  const [a, b, c] = randomBytes(3);
  return `10.${a}.${b}.${c}`;
}

export interface Res<T = any> {
  status: number;
  body: T;
  headers: Headers;
}

export async function call<T = any>(
  method: string,
  path: string,
  options: { cookie?: string; body?: unknown; headers?: Record<string, string>; ip?: string; origin?: string | null } = {},
): Promise<Res<T>> {
  const headers: Record<string, string> = { "X-Forwarded-For": options.ip ?? freshIp(), ...options.headers };
  if (options.origin !== null) headers.Origin = options.origin ?? ORIGIN;
  if (options.cookie) headers.Cookie = options.cookie;
  let body: string | undefined;
  if (options.body !== undefined) {
    headers["Content-Type"] ??= "application/json";
    body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
  }
  const res = await app.request(path, { method, headers, body });
  const type = res.headers.get("content-type") ?? "";
  const parsed = type.includes("application/json") ? await res.json() : type.includes("pdf") ? Buffer.from(await res.arrayBuffer()) : await res.text();
  return { status: res.status, body: parsed as T, headers: res.headers };
}

/** Collects Set-Cookie values into a Cookie header (merging with a previous jar). */
export function cookieFrom(headers: Headers, previous = ""): string {
  const jar = new Map(previous.split("; ").filter(Boolean).map((p) => [p.split("=")[0], p] as const));
  for (const raw of headers.getSetCookie()) {
    const pair = raw.split(";")[0];
    const name = pair.split("=")[0];
    if (/max-age=0/i.test(raw) || pair.endsWith("=")) jar.delete(name);
    else jar.set(name, pair);
  }
  return [...jar.values()].join("; ");
}

export async function signIn(email: string, password = PASSWORD, ip = freshIp()): Promise<{ res: Res; cookie: string }> {
  const res = await call("POST", "/api/auth/sign-in/email", { body: { email, password }, ip });
  return { res, cookie: cookieFrom(res.headers) };
}

export async function login(email: string, password = PASSWORD): Promise<string> {
  const { res, cookie } = await signIn(email, password);
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return cookie;
}

/** An API client bound to a session cookie. */
export function as(cookie: string) {
  return {
    get: <T = any>(path: string) => call<T>("GET", `/api/v1${path}`, { cookie }),
    post: <T = any>(path: string, body: unknown = {}, headers?: Record<string, string>) => call<T>("POST", `/api/v1${path}`, { cookie, body, headers }),
    patch: <T = any>(path: string, body: unknown) => call<T>("PATCH", `/api/v1${path}`, { cookie, body }),
    put: <T = any>(path: string, body: unknown) => call<T>("PUT", `/api/v1${path}`, { cookie, body }),
    del: <T = any>(path: string, body: unknown = {}) => call<T>("DELETE", `/api/v1${path}`, { cookie, body }),
  };
}

export const uid = () => randomUUID().slice(0, 8);

export interface TestOffice {
  organizationId: string;
  slug: string;
  admin: { id: string; email: string };
  lawyer: { id: string; email: string };
  lawyer2: { id: string; email: string };
  clerk: { id: string; email: string };
}

/** A fresh office with an admin, two lawyers and a clerk. */
export async function createTestOffice(settings: Parameters<typeof createOffice>[0]["settings"] = {}): Promise<TestOffice> {
  const tag = uid();
  const slug = `t-${tag}`;
  const email = (who: string) => `${who}.${tag}@test.example`;
  const { organizationId, adminUserId } = await createOffice({ name: `مكتب اختبار ${tag}`, slug, admin: { name: `مدير ${tag}`, email: email("admin"), password: PASSWORD }, settings });
  const lawyer = await addUser(organizationId, { name: `محامٍ ${tag}`, email: email("lawyer"), password: PASSWORD, role: "lawyer" });
  const lawyer2 = await addUser(organizationId, { name: `محامية ${tag}`, email: email("lawyer2"), password: PASSWORD, role: "lawyer" });
  const clerk = await addUser(organizationId, { name: `كاتبة ${tag}`, email: email("clerk"), password: PASSWORD, role: "clerk" });
  return {
    organizationId,
    slug,
    admin: { id: adminUserId, email: email("admin") },
    lawyer: { id: lawyer, email: email("lawyer") },
    lawyer2: { id: lawyer2, email: email("lawyer2") },
    clerk: { id: clerk, email: email("clerk") },
  };
}

export async function ctxFor(office: TestOffice, who: "admin" | "lawyer" | "lawyer2" | "clerk") {
  return systemCtx(office[who].id, office.organizationId, "test");
}

/** Creates a case (through the API service) assigned to the office lawyer, staffed by the clerk. */
export async function createCaseFor(office: TestOffice, overrides: Record<string, unknown> = {}) {
  const { createCase } = await import("../services/cases.js");
  return createCase(await ctxFor(office, "lawyer"), {
    reference: `CC/${uid()}`,
    type: "CIVIL",
    court: "محكمة التعقيب",
    assignedLawyerId: office.lawyer.id,
    newClient: { type: "INDIVIDUAL", fullName: `حريف ${uid()}` },
    memberIds: [office.clerk.id],
    ...overrides,
  });
}

// ——— TOTP (RFC 6238) for two-factor tests ———

function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of input.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const bytes = bits.match(/.{8}/g) ?? [];
  return Buffer.from(bytes.map((b) => parseInt(b, 2)));
}

export function totp(secret: string, at = Date.now(), step = 30, digits = 6): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / step)));
  const hmac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(code).padStart(digits, "0");
}

export const idempotencyKey = () => `test-${randomBytes(8).toString("hex")}`;

export { prisma };
