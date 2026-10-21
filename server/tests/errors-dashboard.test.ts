import { Prisma } from "@prisma/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { as, call, createCaseFor, createTestOffice, idempotencyKey, login, prisma, useFakePdf, type TestOffice } from "./helpers.js";

let office: TestOffice;
let lawyer: ReturnType<typeof as>;
let cookie: string;

beforeAll(async () => {
  useFakePdf();
  office = await createTestOffice();
  cookie = await login(office.lawyer.email);
  lawyer = as(cookie);
});

afterEach(() => vi.restoreAllMocks());

/** Makes the next prisma.$transaction call fail, then restores the original (Prisma's client is a proxy). */
function failNextTransaction(error: unknown) {
  const client = prisma as unknown as { $transaction: unknown };
  const original = client.$transaction;
  client.$transaction = () => {
    client.$transaction = original;
    return Promise.reject(error);
  };
}

describe("structured errors", () => {
  it("answers 503 (not a fake success) when the database is unreachable", async () => {
    failNextTransaction(new Prisma.PrismaClientKnownRequestError("Can't reach database server", { code: "P1001", clientVersion: "6" }));
    const res = await lawyer.get("/cases");
    expect(res.status).toBe(503);
    expect(res.body.error).toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(res.body.error.message).toMatch(/قاعدة البيانات غير متاحة/);
  });

  it("hides internal details of unexpected failures behind a request id", async () => {
    failNextTransaction(new Error("secret internal detail at /srv/app.ts:42"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await lawyer.get("/clients");
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL");
    expect(JSON.stringify(res.body)).not.toContain("secret internal detail");
    expect(res.body.error.requestId).toBe(res.headers.get("x-request-id"));
    expect(errors).toHaveBeenCalled();
  });

  it("rejects malformed JSON, unsupported content types, oversized bodies and unknown routes", async () => {
    const bad = await call("POST", "/api/v1/clients", { cookie, body: "{not json", headers: { "Content-Type": "application/json" } });
    expect(bad.status).toBe(422);
    const form = await call("POST", "/api/v1/clients", { cookie, body: "fullName=x", headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    expect(form.status).toBe(422);
    const huge = await call("POST", "/api/v1/clients", { cookie, body: { type: "INDIVIDUAL", fullName: "x".repeat(1_100_000) } });
    expect(huge.status).toBe(413);
    const unknown = await lawyer.get("/nope");
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe("NOT_FOUND");
    expect((await lawyer.get("/cases/../../etc")).status).toBe(404);
  });

  it("sets protective headers on API responses", async () => {
    const res = await lawyer.get("/me");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  it("reports the database health honestly", async () => {
    const res = await call("GET", "/api/health");
    expect(res.body).toEqual({ status: "ok", database: "ok" });
  });
});

describe("dashboard", () => {
  it("summarises only what the user may see, with finance totals only for finance roles", async () => {
    const c = await createCaseFor(office);
    await lawyer.post("/hearings", { caseId: c.id, date: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10), time: "09:00", court: "c", type: "t", acknowledgeConflicts: true });
    const fee = (await lawyer.post("/fees", { caseId: c.id, amount: "1200" })).body;
    await lawyer.post("/payments", { agreementId: fee.id, amount: "200", paidOn: "2026-01-05", method: "CASH" }, { "Idempotency-Key": idempotencyKey() });

    const d = (await lawyer.get("/dashboard")).body;
    expect(d.activeCases).toBeGreaterThanOrEqual(1);
    expect(d.hearingsNext7Days.some((h: { caseId: string }) => h.caseId === c.id)).toBe(true);
    expect(d.outstanding).toEqual(expect.arrayContaining([expect.objectContaining({ currency: "TND" })]));
    expect(d.caseTypeDistribution.find((x: { type: string }) => x.type === "CIVIL").count).toBeGreaterThanOrEqual(1);

    const clerk = as(await login(office.clerk.email));
    const cd = (await clerk.get("/dashboard")).body;
    expect(cd.outstanding).toBeNull();
  });
});
