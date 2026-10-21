import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { chromiumRenderer, setPdfRenderer } from "../services/receipt-pdf.js";
import { as, createCaseFor, createTestOffice, FAKE_PDF, idempotencyKey, login, prisma, useFakePdf, type TestOffice } from "./helpers.js";

let office: TestOffice;
let lawyer: ReturnType<typeof as>;

const pay = (agreementId: string, amount: string, extra: Record<string, unknown> = {}, key = idempotencyKey()) =>
  lawyer.post("/payments", { agreementId, amount, paidOn: "2026-02-10", method: "CASH", ...extra }, { "Idempotency-Key": key });

async function newAgreement(amount: string) {
  const c = await createCaseFor(office);
  const res = await lawyer.post("/fees", { caseId: c.id, amount, title: "أتعاب" });
  expect(res.status).toBe(201);
  return res.body;
}

beforeAll(async () => {
  useFakePdf();
  office = await createTestOffice();
  lawyer = as(await login(office.lawyer.email));
});

afterAll(() => useFakePdf());

describe("fee agreements and balances", () => {
  it("computes paid and remaining amounts exactly (millimes, no floating point)", async () => {
    const fee = await newAgreement("1000.5");
    expect(fee).toMatchObject({ amount: "1000.500", currency: "TND", paid: "0.000", remaining: "1000.500", settlement: "UNPAID" });
    expect((await pay(fee.id, "0.1")).status).toBe(201);
    expect((await pay(fee.id, "0.2")).status).toBe(201);
    const after = (await lawyer.get(`/fees/${fee.id}`)).body;
    expect(after.paid).toBe("0.300");
    expect(after.remaining).toBe("1000.200");
    expect(after.settlement).toBe("PARTIAL");
    const last = await pay(fee.id, "1000.200");
    expect(last.status).toBe(201);
    expect(last.body.agreement).toMatchObject({ remaining: "0.000", settlement: "PAID", status: "SETTLED" });
  });

  it("validates amounts and currency", async () => {
    const c = await createCaseFor(office);
    for (const amount of ["0", "-5", "1.2345", "abc", "", 12.5e20]) {
      expect((await lawyer.post("/fees", { caseId: c.id, amount })).status, String(amount)).toBe(422);
    }
    expect((await lawyer.post("/fees", { caseId: c.id, amount: "10", currency: "EURO" })).status).toBe(422);
    const eur = await lawyer.post("/fees", { caseId: c.id, amount: "10", currency: "eur" });
    expect(eur.body.currency).toBe("EUR");
  });

  it("replays a retried agreement creation (same Idempotency-Key) instead of duplicating it", async () => {
    const c = await createCaseFor(office);
    const key = idempotencyKey();
    const [first, retry] = await Promise.all([
      lawyer.post("/fees", { caseId: c.id, amount: "700" }, { "Idempotency-Key": key }),
      lawyer.post("/fees", { caseId: c.id, amount: "700" }, { "Idempotency-Key": key }),
    ]);
    expect([first.status, retry.status].sort()).toEqual([200, 201]);
    expect(first.body.id).toBe(retry.body.id);
    expect(await prisma.feeAgreement.count({ where: { caseId: c.id } })).toBe(1);
    const reused = await lawyer.post("/fees", { caseId: c.id, amount: "800" }, { "Idempotency-Key": key });
    expect(reused.status).toBe(409);
    expect(reused.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    // Without a key, two submissions are two agreements (the key is the client's way to say "same intent").
    expect((await lawyer.post("/fees", { caseId: c.id, amount: "700" })).status).toBe(201);
  });

  it("rejects overpayment with the exact remaining balance", async () => {
    const fee = await newAgreement("300");
    await pay(fee.id, "250");
    const over = await pay(fee.id, "50.001");
    expect(over.status).toBe(422);
    expect(over.body.error.code).toBe("OVERPAYMENT");
    expect(over.body.error.data.remaining).toBe("50.000");
    expect((await pay(fee.id, "50")).status).toBe(201);
    expect((await pay(fee.id, "1")).body.error.code).toBe("OVERPAYMENT");
  });

  it("refuses future payment dates and cheques without a reference", async () => {
    const fee = await newAgreement("100");
    expect((await pay(fee.id, "1", { paidOn: "2999-01-01" })).status).toBe(422);
    expect((await pay(fee.id, "1", { method: "CHECK" })).status).toBe(422);
  });

  it("refuses to lower an agreement below what was already received", async () => {
    const fee = await newAgreement("500");
    await pay(fee.id, "200");
    const current = (await lawyer.get(`/fees/${fee.id}`)).body;
    expect((await lawyer.patch(`/fees/${fee.id}`, { amount: "199.999", version: current.version })).status).toBe(422);
    const ok = await lawyer.patch(`/fees/${fee.id}`, { amount: "200", version: current.version });
    expect(ok.body).toMatchObject({ status: "SETTLED", remaining: "0.000" });
  });
});

describe("payments: idempotency and concurrency", () => {
  it("requires an Idempotency-Key and replays identical retries without a second payment", async () => {
    const fee = await newAgreement("900");
    const noKey = await lawyer.post("/payments", { agreementId: fee.id, amount: "100", paidOn: "2026-02-10", method: "CASH" });
    expect(noKey.status).toBe(400);
    expect(noKey.body.error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");

    const key = idempotencyKey();
    const first = await pay(fee.id, "100", {}, key);
    const retry = await pay(fee.id, "100", {}, key);
    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.headers.get("Idempotent-Replayed")).toBe("true");
    expect(retry.body.payment.id).toBe(first.body.payment.id);
    expect(retry.body.payment.receipt.number).toBe(first.body.payment.receipt.number);
    expect(await prisma.payment.count({ where: { agreementId: fee.id } })).toBe(1);

    const reused = await pay(fee.id, "200", {}, key);
    expect(reused.status).toBe(409);
    expect(reused.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("serialises concurrent payments so the agreement can never be overpaid", async () => {
    const fee = await newAgreement("1000");
    const results = await Promise.all(Array.from({ length: 6 }, () => pay(fee.id, "300")));
    const created = results.filter((r) => r.status === 201);
    const rejected = results.filter((r) => r.status === 422);
    expect(created).toHaveLength(3);
    expect(rejected).toHaveLength(3);
    rejected.forEach((r) => expect(r.body.error.code).toBe("OVERPAYMENT"));
    const final = (await lawyer.get(`/fees/${fee.id}`)).body;
    expect(final.paid).toBe("900.000");
    expect(final.remaining).toBe("100.000");
  });

  it("records concurrent retries of the same submission exactly once", async () => {
    const fee = await newAgreement("1000");
    const key = idempotencyKey();
    const results = await Promise.all(Array.from({ length: 5 }, () => pay(fee.id, "250", {}, key)));
    expect(results.every((r) => r.status === 201 || r.status === 200)).toBe(true);
    expect(new Set(results.map((r) => r.body.payment.id)).size).toBe(1);
    expect(await prisma.payment.count({ where: { agreementId: fee.id } })).toBe(1);
  });

  it("numbers receipts per office and year without gaps or duplicates, even under concurrency", async () => {
    const tmp = await createTestOffice();
    const tmpLawyer = as(await login(tmp.lawyer.email));
    const c = await createCaseFor(tmp);
    const fee = (await tmpLawyer.post("/fees", { caseId: c.id, amount: "10000" })).body;
    const results = await Promise.all(
      Array.from({ length: 8 }, () => tmpLawyer.post("/payments", { agreementId: fee.id, amount: "10", paidOn: "2026-02-10", method: "CASH" }, { "Idempotency-Key": idempotencyKey() })),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    const year = new Date().getFullYear();
    const numbers = results.map((r) => r.body.payment.receipt.number).sort();
    expect(numbers).toEqual(Array.from({ length: 8 }, (_, i) => `REC-${year}-${String(i + 1).padStart(6, "0")}`));
    // The other office's sequence is independent.
    const firstOfOther = await prisma.receipt.findFirst({ where: { organizationId: office.organizationId }, orderBy: { sequence: "asc" } });
    expect(firstOfOther?.sequence).toBe(1);
  });

  it("prevents recording the same cheque twice on one agreement", async () => {
    const fee = await newAgreement("1000");
    expect((await pay(fee.id, "100", { method: "CHECK", reference: "CHQ 001" })).status).toBe(201);
    const dup = await pay(fee.id, "100", { method: "CHECK", reference: "chq001" });
    expect(dup.status).toBe(409);
  });
});

describe("corrections are non-destructive", () => {
  it("voids a payment: receipt cancelled (kept), balance restored, the cheque can be recorded again", async () => {
    const fee = await newAgreement("400");
    const p = (await pay(fee.id, "400", { method: "CHECK", reference: "CHQ-9" })).body.payment;
    expect((await lawyer.get(`/fees/${fee.id}`)).body.status).toBe("SETTLED");
    const noReason = await lawyer.post(`/payments/${p.id}/void`, { reason: " " });
    expect(noReason.status).toBe(422);
    const voided = await lawyer.post(`/payments/${p.id}/void`, { reason: "خطأ في المبلغ" });
    expect(voided.status).toBe(200);
    expect(voided.body).toMatchObject({ status: "VOIDED", voidReason: "خطأ في المبلغ" });
    expect(voided.body.receipt).toMatchObject({ status: "CANCELLED", number: p.receipt.number });
    const fresh = (await lawyer.get(`/fees/${fee.id}`)).body;
    expect(fresh).toMatchObject({ status: "ACTIVE", paid: "0.000", remaining: "400.000" });
    expect((await lawyer.post(`/payments/${p.id}/void`, { reason: "مرة ثانية" })).status).toBe(409);
    expect((await pay(fee.id, "350", { method: "CHECK", reference: "CHQ-9" })).status).toBe(201);
    expect(await prisma.payment.count({ where: { agreementId: fee.id } })).toBe(2);
  });

  it("cannot cancel an agreement that still has recorded payments", async () => {
    const fee = await newAgreement("100");
    await pay(fee.id, "10");
    expect((await lawyer.post(`/fees/${fee.id}/cancel`, { reason: "x", version: fee.version })).status).toBe(409);
  });
});

describe("receipt PDFs", () => {
  it("stores the generated PDF once and serves it", async () => {
    const fee = await newAgreement("100");
    const p = (await pay(fee.id, "100")).body.payment;
    expect(p.receipt.pdf.available).toBe(true);
    expect(p.receipt.pdf.sha256).toMatch(/^[0-9a-f]{64}$/);
    const file = await lawyer.get(`/receipts/${p.receipt.id}/pdf`);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.compare(file.body, FAKE_PDF)).toBe(0);
  });

  it("reports a rendering failure honestly, keeps the receipt, and retries on demand", async () => {
    setPdfRenderer(async () => {
      throw new Error("browser unavailable");
    });
    const fee = await newAgreement("100");
    const res = await pay(fee.id, "60");
    expect(res.status).toBe(201);
    const receipt = res.body.payment.receipt;
    expect(receipt.number).toMatch(/^REC-\d{4}-\d{6}$/);
    expect(receipt.pdf).toMatchObject({ available: false, sha256: null });
    expect(receipt.pdf.error).toMatch(/browser unavailable/);
    const download = await lawyer.get(`/receipts/${receipt.id}/pdf`);
    expect(download.status).toBe(409);

    useFakePdf();
    const retried = await lawyer.post(`/receipts/${receipt.id}/pdf`);
    expect(retried.body.pdf).toMatchObject({ available: true, error: null });
    expect((await lawyer.get(`/receipts/${receipt.id}/pdf`)).status).toBe(200);
  });

  it("rejects a renderer that returns something other than a PDF", async () => {
    setPdfRenderer(async () => Buffer.from("<html>not a pdf</html>".repeat(10)));
    const fee = await newAgreement("100");
    const res = await pay(fee.id, "10");
    expect(res.body.payment.receipt.pdf.available).toBe(false);
    useFakePdf();
  });

  it("renders a real Arabic PDF with Chromium when a browser is available", async () => {
    setPdfRenderer(chromiumRenderer);
    const fee = await newAgreement("2500");
    const res = await pay(fee.id, "1250.75");
    const receipt = res.body.payment.receipt;
    if (!receipt.pdf.available) {
      // Explicitly reported (e.g. CI without Chrome): the test documents rather than hides it.
      console.warn(`[finance.test] Chromium PDF rendering unavailable here: ${receipt.pdf.error}`);
      return;
    }
    const file = await lawyer.get(`/receipts/${receipt.id}/pdf`);
    expect(file.body.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(file.body.length).toBeGreaterThan(5000);
  }, 60_000);
});

describe("database guarantees (direct SQL, bypassing the API)", () => {
  it("forbids editing or deleting payments and receipts, and rewriting the audit log", async () => {
    const fee = await newAgreement("100");
    const p = (await pay(fee.id, "10")).body.payment;
    await expect(prisma.$executeRaw`UPDATE payments SET amount = 1 WHERE id = ${p.id}`).rejects.toThrow(/immutable/);
    await expect(prisma.$executeRaw`DELETE FROM payments WHERE id = ${p.id}`).rejects.toThrow(/cannot be deleted/);
    await expect(prisma.$executeRaw`UPDATE receipts SET amount = 1 WHERE id = ${p.receipt.id}`).rejects.toThrow(/immutable/);
    await expect(prisma.$executeRaw`UPDATE receipts SET pdf = ${Buffer.from("x")} WHERE id = ${p.receipt.id}`).rejects.toThrow();
    await expect(prisma.$executeRaw`DELETE FROM receipts WHERE id = ${p.receipt.id}`).rejects.toThrow(/cannot be deleted/);
    await expect(prisma.$executeRaw`UPDATE audit_logs SET summary = 'x' WHERE "organizationId" = ${office.organizationId}`).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRaw`DELETE FROM audit_logs WHERE "organizationId" = ${office.organizationId}`).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRaw`UPDATE receipt_counters SET "lastValue" = 0 WHERE "organizationId" = ${office.organizationId}`).rejects.toThrow(/decreased/);
  });

  it("enforces amount and consistency checks at the database level", async () => {
    const fee = await newAgreement("100");
    await expect(prisma.$executeRaw`UPDATE fee_agreements SET amount = -1 WHERE id = ${fee.id}`).rejects.toThrow(/check/i);
    await expect(prisma.$executeRaw`UPDATE fee_agreements SET currency = 'tnd' WHERE id = ${fee.id}`).rejects.toThrow(/check/i);
  });

  it("writes an audit entry for each financial operation, without secrets", async () => {
    const fee = await newAgreement("100");
    const p = (await pay(fee.id, "10")).body.payment;
    await lawyer.post(`/payments/${p.id}/void`, { reason: "اختبار" });
    const entries = await prisma.auditLog.findMany({ where: { organizationId: office.organizationId, resourceId: { in: [fee.id, p.id] } }, orderBy: { createdAt: "asc" } });
    expect(entries.map((e) => e.operation)).toEqual(["fee.create", "payment.record", "payment.void"]);
    expect(entries.every((e) => e.actorId === office.lawyer.id && e.requestId)).toBe(true);
    expect(JSON.stringify(entries)).not.toMatch(/password|token|secret/i);
  });
});
