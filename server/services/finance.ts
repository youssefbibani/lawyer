/**
 * Fees, payments and receipts.
 *
 * Recording a payment is one transaction: the fee agreement row is locked (SELECT … FOR UPDATE),
 * the remaining balance is recomputed from recorded payments, the payment is inserted, the
 * office's receipt counter for the year is incremented (gap-free: a rolled-back transaction
 * rolls the number back too) and the receipt is inserted with a frozen snapshot. The PDF is
 * rendered after commit; a rendering failure never hides that the receipt exists.
 *
 * Nothing financial is ever deleted or edited in place: payments are voided with a reason,
 * which cancels their receipt, and the correct payment is recorded again.
 */
import { Prisma } from "@prisma/client";
import { z } from "zod";

import {
  PAYMENT_METHODS,
  type FeeAgreementDetailDTO,
  type FeeAgreementDTO,
  type FinanceTotalsDTO,
  type Paginated,
  type PaymentDTO,
  type ReceiptDTO,
  type RecordPaymentResultDTO,
} from "../../shared/api.js";
import { prisma, type Tx } from "../db.js";
import type { Ctx } from "../http/context.js";
import { AppError, notFound, versionConflict } from "../http/errors.js";
import { currency, id, isoDate, moneyString, optionalText, pageArgs, pagination, parse, requiredText, version } from "../http/validation.js";
import { Decimal, money, parseMoney, sum } from "../lib/money.js";
import { dateOnly, formatDateOnly, todayIn } from "../lib/time.js";
import { audit } from "./audit.js";
import { assertCan, caseScope } from "./authorization.js";
import { agreementDTO, agreementInclude, paymentDTO, paymentInclude, receiptDTO, receiptSelect } from "./dto.js";
import { renderReceipt, type ReceiptSnapshot } from "./receipt-pdf.js";

// ——— Fee agreements ———

const agreementBody = z.object({
  caseId: id,
  clientId: id.optional(),
  title: optionalText(200),
  amount: moneyString,
  currency: currency.optional(),
  paymentTerms: optionalText(1000),
});

const agreementUpdate = z.object({ title: optionalText(200), amount: moneyString.optional(), paymentTerms: optionalText(1000), version });

const agreementList = pagination.extend({
  caseId: id.optional(),
  status: z.enum(["ACTIVE", "SETTLED", "CANCELLED"]).optional(),
});

const agreementScope = (ctx: Ctx): Prisma.FeeAgreementWhereInput => ({ organizationId: ctx.actor.organizationId, case: caseScope(ctx.actor) });

export async function listAgreements(ctx: Ctx, raw: unknown): Promise<Paginated<FeeAgreementDTO>> {
  assertCan(ctx, "finance:read");
  const q = parse(agreementList, raw);
  const where: Prisma.FeeAgreementWhereInput = { AND: [agreementScope(ctx), q.caseId ? { caseId: q.caseId } : {}, q.status ? { status: q.status } : {}] };
  const [total, rows] = await prisma.$transaction([
    prisma.feeAgreement.count({ where }),
    prisma.feeAgreement.findMany({ where, include: agreementInclude, orderBy: [{ createdAt: "desc" }, { id: "asc" }], ...pageArgs(q) }),
  ]);
  return { items: rows.map(agreementDTO), page: q.page, pageSize: q.pageSize, total };
}

export async function getAgreement(ctx: Ctx, agreementId: string): Promise<FeeAgreementDetailDTO> {
  assertCan(ctx, "finance:read");
  const a = await prisma.feeAgreement.findFirst({ where: { AND: [{ id: agreementId }, agreementScope(ctx)] }, include: agreementInclude });
  if (!a) throw notFound("اتفاق الأتعاب");
  const payments = await prisma.payment.findMany({ where: { agreementId, organizationId: ctx.actor.organizationId }, include: paymentInclude, orderBy: { createdAt: "desc" } });
  return { ...agreementDTO(a), payments: payments.map(paymentDTO) };
}

/** Returns the agreement created earlier with this key (same request), or throws if the key was reused differently. */
async function agreementReplay(ctx: Ctx, key: string, input: z.infer<typeof agreementBody>): Promise<FeeAgreementDTO | null> {
  const existing = await prisma.feeAgreement.findUnique({
    where: { organizationId_idempotencyKey: { organizationId: ctx.actor.organizationId, idempotencyKey: key } },
    include: agreementInclude,
  });
  if (!existing) return null;
  const same =
    existing.caseId === input.caseId &&
    new Decimal(existing.amount).eq(parseMoney(input.amount)) &&
    existing.currency === (input.currency ?? ctx.actor.office.defaultCurrency) &&
    (input.clientId === undefined || existing.clientId === input.clientId);
  if (!same) throw new AppError("IDEMPOTENCY_KEY_REUSED", "مفتاح العملية مستعمل لاتفاق مختلف. أعد فتح النموذج وأعد المحاولة.");
  return agreementDTO(existing);
}

export async function createAgreement(ctx: Ctx, raw: unknown, idempotencyKey?: string): Promise<FeeAgreementDTO & { replayed?: boolean }> {
  assertCan(ctx, "finance:write");
  const input = parse(agreementBody, raw);
  if (idempotencyKey !== undefined && !IDEMPOTENCY_KEY_RE.test(idempotencyKey)) throw new AppError("VALIDATION_FAILED", "مفتاح العملية غير صالح.");
  if (idempotencyKey) {
    const replayed = await agreementReplay(ctx, idempotencyKey, input);
    if (replayed) return { ...replayed, replayed: true };
  }
  let created;
  try {
    created = await createAgreementTx(ctx, input, idempotencyKey);
  } catch (err) {
    if (idempotencyKey && err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const replayed = await agreementReplay(ctx, idempotencyKey, input);
      if (replayed) return { ...replayed, replayed: true };
    }
    throw err;
  }
  return agreementDTO(created);
}

async function createAgreementTx(ctx: Ctx, input: z.infer<typeof agreementBody>, idempotencyKey: string | undefined) {
  return prisma.$transaction(async (tx) => {
    const c = await tx.case.findFirst({ where: { AND: [{ id: input.caseId }, caseScope(ctx.actor)] }, include: { clients: { orderBy: { createdAt: "asc" } } } });
    if (!c) throw notFound("الملف");
    let clientId = input.clientId ?? null;
    if (clientId && !c.clients.some((cc) => cc.clientId === clientId)) throw new AppError("VALIDATION_FAILED", "الحريف المحدد غير مرتبط بهذا الملف.");
    if (!clientId && c.clients.length === 1) clientId = c.clients[0].clientId;
    const a = await tx.feeAgreement.create({
      data: {
        organizationId: ctx.actor.organizationId,
        caseId: c.id,
        clientId,
        title: input.title ?? null,
        amount: parseMoney(input.amount),
        currency: input.currency ?? ctx.actor.office.defaultCurrency,
        paymentTerms: input.paymentTerms ?? null,
        idempotencyKey: idempotencyKey ?? null,
        createdById: ctx.actor.userId,
      },
      include: agreementInclude,
    });
    await audit(tx, ctx, { resourceType: "fee_agreement", resourceId: a.id, caseId: c.id, operation: "fee.create", summary: `اتفاق أتعاب للملف ${c.reference}`, after: { amount: a.amount, currency: a.currency } });
    return a;
  });
}

/** Locks the agreement row for the rest of the transaction and returns it if the actor may see it. */
async function lockAgreement(tx: Tx, ctx: Ctx, agreementId: string) {
  await tx.$queryRaw`SELECT id FROM fee_agreements WHERE id = ${agreementId} AND "organizationId" = ${ctx.actor.organizationId} FOR UPDATE`;
  const a = await tx.feeAgreement.findFirst({
    where: { AND: [{ id: agreementId }, agreementScope(ctx)] },
    include: { case: { select: { id: true, reference: true, court: true, clients: { orderBy: { createdAt: "asc" }, take: 1, select: { clientId: true } } } }, client: true },
  });
  if (!a) throw notFound("اتفاق الأتعاب");
  return a;
}

async function paidTotal(tx: Tx, agreementId: string): Promise<Decimal> {
  const agg = await tx.payment.aggregate({ where: { agreementId, status: "RECORDED" }, _sum: { amount: true } });
  return new Decimal(agg._sum.amount ?? 0);
}

export async function updateAgreement(ctx: Ctx, agreementId: string, raw: unknown): Promise<FeeAgreementDTO> {
  assertCan(ctx, "finance:write");
  const input = parse(agreementUpdate, raw);
  await prisma.$transaction(async (tx) => {
    const a = await lockAgreement(tx, ctx, agreementId);
    if (a.status === "CANCELLED") throw new AppError("CONFLICT", "اتفاق الأتعاب ملغى ولا يمكن تعديله.");
    const paid = await paidTotal(tx, agreementId);
    const amount = input.amount ? parseMoney(input.amount) : new Decimal(a.amount);
    if (amount.lt(paid)) throw new AppError("VALIDATION_FAILED", `لا يمكن أن يقل المبلغ المتفق عليه عن المبالغ المقبوضة (${money(paid)}).`);
    const result = await tx.feeAgreement.updateMany({
      where: { id: agreementId, organizationId: ctx.actor.organizationId, version: input.version },
      data: {
        title: input.title === undefined ? a.title : input.title,
        paymentTerms: input.paymentTerms === undefined ? a.paymentTerms : input.paymentTerms,
        amount,
        status: amount.eq(paid) ? "SETTLED" : "ACTIVE",
        version: { increment: 1 },
      },
    });
    if (result.count === 0) throw versionConflict();
    await audit(tx, ctx, {
      resourceType: "fee_agreement",
      resourceId: agreementId,
      caseId: a.caseId,
      operation: "fee.update",
      summary: `تعديل اتفاق الأتعاب للملف ${a.case.reference}`,
      before: { amount: a.amount },
      after: { amount },
    });
  });
  return agreementDTO(await prisma.feeAgreement.findUniqueOrThrow({ where: { id: agreementId }, include: agreementInclude }));
}

export async function cancelAgreement(ctx: Ctx, agreementId: string, raw: unknown): Promise<FeeAgreementDTO> {
  assertCan(ctx, "finance:write");
  const input = parse(z.object({ reason: requiredText(500, "يرجى ذكر سبب الإلغاء"), version }), raw);
  await prisma.$transaction(async (tx) => {
    const a = await lockAgreement(tx, ctx, agreementId);
    if (a.status === "CANCELLED") throw new AppError("CONFLICT", "اتفاق الأتعاب ملغى مسبقاً.");
    if ((await paidTotal(tx, agreementId)).gt(0)) throw new AppError("CONFLICT", "توجد دفعات مسجّلة على هذا الاتفاق: ألغِ الدفعات أولاً.");
    const result = await tx.feeAgreement.updateMany({ where: { id: agreementId, organizationId: ctx.actor.organizationId, version: input.version }, data: { status: "CANCELLED", version: { increment: 1 } } });
    if (result.count === 0) throw versionConflict();
    await audit(tx, ctx, { resourceType: "fee_agreement", resourceId: agreementId, caseId: a.caseId, operation: "fee.cancel", summary: `إلغاء اتفاق الأتعاب للملف ${a.case.reference}`, after: { reason: input.reason } });
  });
  return agreementDTO(await prisma.feeAgreement.findUniqueOrThrow({ where: { id: agreementId }, include: agreementInclude }));
}

export async function financeTotals(ctx: Ctx): Promise<FinanceTotalsDTO[]> {
  assertCan(ctx, "finance:read");
  const rows = await prisma.feeAgreement.findMany({ where: { AND: [agreementScope(ctx), { status: { not: "CANCELLED" } }] }, include: agreementInclude });
  const byCurrency = new Map<string, FeeAgreementDTO[]>();
  for (const dto of rows.map(agreementDTO)) byCurrency.set(dto.currency, [...(byCurrency.get(dto.currency) ?? []), dto]);
  return [...byCurrency.entries()].map(([cur, list]) => ({
    currency: cur,
    agreed: money(sum(list.map((a) => a.amount))),
    paid: money(sum(list.map((a) => a.paid))),
    remaining: money(sum(list.map((a) => a.remaining))),
    agreementCount: list.length,
    unsettledCount: list.filter((a) => a.settlement !== "PAID").length,
  }));
}

// ——— Payments ———

export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_.:-]{8,200}$/;

const paymentBody = z
  .object({
    agreementId: id,
    amount: moneyString,
    paidOn: isoDate,
    method: z.enum(PAYMENT_METHODS, { errorMap: () => ({ message: "يرجى اختيار طريقة الدفع" }) }),
    reference: optionalText(100),
    notes: optionalText(500),
  })
  .refine((v) => !["CHECK", "BANK_TRANSFER"].includes(v.method) || !!v.reference, { message: "يرجى إدخال مرجع الصك أو التحويل", path: ["reference"] });

const referenceKey = (reference: string | null | undefined) => (reference ? reference.replace(/\s+/g, "").toUpperCase() : null);

async function loadPayment(paymentId: string) {
  return prisma.payment.findUniqueOrThrow({ where: { id: paymentId }, include: paymentInclude });
}

async function replay(ctx: Ctx, key: string, input: z.infer<typeof paymentBody>): Promise<RecordPaymentResultDTO | null> {
  const existing = await prisma.payment.findUnique({
    where: { organizationId_idempotencyKey: { organizationId: ctx.actor.organizationId, idempotencyKey: key } },
    include: paymentInclude,
  });
  if (!existing) return null;
  const same =
    existing.agreementId === input.agreementId &&
    new Decimal(existing.amount).eq(parseMoney(input.amount)) &&
    formatDateOnly(existing.paidOn) === input.paidOn &&
    existing.method === input.method &&
    (existing.reference ?? null) === (input.reference ?? null);
  if (!same) throw new AppError("IDEMPOTENCY_KEY_REUSED", "مفتاح العملية مستعمل لدفعة مختلفة. أعد فتح النموذج وأعد المحاولة.");
  const agreement = await prisma.feeAgreement.findFirst({ where: { AND: [{ id: existing.agreementId }, agreementScope(ctx)] }, include: agreementInclude });
  if (!agreement) throw notFound("الدفعة");
  return { payment: paymentDTO(existing), agreement: agreementDTO(agreement), replayed: true };
}

export async function recordPayment(ctx: Ctx, raw: unknown, idempotencyKey: string | undefined): Promise<RecordPaymentResultDTO> {
  assertCan(ctx, "payment:record");
  if (!idempotencyKey) throw new AppError("IDEMPOTENCY_KEY_REQUIRED", "طلب تسجيل الدفعة يجب أن يتضمن مفتاح عملية (Idempotency-Key).");
  if (!IDEMPOTENCY_KEY_RE.test(idempotencyKey)) throw new AppError("VALIDATION_FAILED", "مفتاح العملية غير صالح.");
  const input = parse(paymentBody, raw);
  const tz = ctx.actor.office.timeZone;
  const today = todayIn(tz);
  if (input.paidOn > today) throw new AppError("VALIDATION_FAILED", "تاريخ الدفع لا يمكن أن يكون في المستقبل.", { details: [{ path: "paidOn", message: "تاريخ في المستقبل" }] });

  const replayed = await replay(ctx, idempotencyKey, input);
  if (replayed) return replayed;

  let paymentId: string;
  let receiptId: string;
  try {
    ({ paymentId, receiptId } = await prisma.$transaction(
      async (tx) => {
        const a = await lockAgreement(tx, ctx, input.agreementId);
        if (a.status === "CANCELLED") throw new AppError("CONFLICT", "اتفاق الأتعاب ملغى.");
        const amount = parseMoney(input.amount);
        const paid = await paidTotal(tx, a.id);
        const remaining = new Decimal(a.amount).minus(paid);
        if (remaining.lte(0)) throw new AppError("OVERPAYMENT", "هذه الأتعاب مسدّدة بالكامل.", { data: { remaining: money(0) } });
        if (amount.gt(remaining)) {
          throw new AppError("OVERPAYMENT", `المبلغ يتجاوز المتبقي المستحق (${money(remaining)} ${a.currency}).`, { data: { remaining: money(remaining) } });
        }
        const payment = await tx.payment.create({
          data: {
            organizationId: ctx.actor.organizationId,
            agreementId: a.id,
            amount,
            currency: a.currency,
            paidOn: dateOnly(input.paidOn),
            method: input.method,
            reference: input.reference ?? null,
            referenceKey: referenceKey(input.reference),
            notes: input.notes ?? null,
            idempotencyKey,
            createdById: ctx.actor.userId,
          },
        });

        const year = Number(today.slice(0, 4));
        const [{ lastValue }] = await tx.$queryRaw<{ lastValue: number }[]>`
          INSERT INTO receipt_counters ("organizationId", "year", "lastValue") VALUES (${ctx.actor.organizationId}, ${year}, 1)
          ON CONFLICT ("organizationId", "year") DO UPDATE SET "lastValue" = receipt_counters."lastValue" + 1
          RETURNING "lastValue"`;
        const number = `REC-${year}-${String(lastValue).padStart(6, "0")}`;

        const settings = await tx.officeSettings.findUniqueOrThrow({ where: { organizationId: ctx.actor.organizationId } });
        const clientId = a.clientId ?? a.case.clients[0]?.clientId ?? null;
        const client = a.client ?? (clientId ? await tx.client.findUnique({ where: { id: clientId } }) : null);
        const paidAfter = paid.plus(amount);
        const snapshot: ReceiptSnapshot = {
          number,
          issuedOn: today,
          office: {
            legalName: settings.legalName,
            address: settings.address,
            city: settings.city,
            phone: settings.phone,
            email: settings.email,
            taxId: settings.taxId,
            barRegistration: settings.barRegistration,
          },
          client: client ? { fullName: client.fullName, nationalId: client.nationalId } : null,
          case: { reference: a.case.reference, court: a.case.court },
          payment: { amount: money(amount), currency: a.currency, paidOn: input.paidOn, method: input.method, reference: input.reference ?? null, notes: input.notes ?? null },
          agreement: { title: a.title, amount: money(a.amount), paidAfter: money(paidAfter), remainingAfter: money(new Decimal(a.amount).minus(paidAfter)) },
          issuedBy: { name: ctx.actor.name },
        };
        const receipt = await tx.receipt.create({
          data: {
            organizationId: ctx.actor.organizationId,
            number,
            year,
            sequence: lastValue,
            paymentId: payment.id,
            caseId: a.caseId,
            clientId,
            amount,
            currency: a.currency,
            issuedOn: dateOnly(today),
            issuedById: ctx.actor.userId,
            snapshot: snapshot as unknown as Prisma.InputJsonValue,
          },
        });
        if (paidAfter.gte(a.amount)) {
          await tx.feeAgreement.update({ where: { id: a.id }, data: { status: "SETTLED", version: { increment: 1 } } });
        }
        await audit(tx, ctx, {
          resourceType: "payment",
          resourceId: payment.id,
          caseId: a.caseId,
          operation: "payment.record",
          summary: `تسجيل دفعة وإصدار الوصل ${number}`,
          after: { amount, currency: a.currency, method: input.method, receipt: number },
        });
        return { paymentId: payment.id, receiptId: receipt.id };
      },
      { timeout: 15_000 },
    ));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const target = String(err.meta?.target ?? "");
      if (target.includes("idempotencyKey")) {
        const again = await replay(ctx, idempotencyKey, input);
        if (again) return again;
      }
      if (target.includes("referenceKey")) throw new AppError("CONFLICT", "يوجد دفعة مسجّلة بنفس مرجع الصك أو التحويل على هذا الاتفاق.");
    }
    throw err;
  }

  await generateReceiptPdf(receiptId);
  const payment = await loadPayment(paymentId);
  const agreement = await prisma.feeAgreement.findUniqueOrThrow({ where: { id: payment.agreementId }, include: agreementInclude });
  return { payment: paymentDTO(payment), agreement: agreementDTO(agreement), replayed: false };
}

/** Renders and stores the PDF once. Failures are recorded on the receipt and reported, never hidden. */
export async function generateReceiptPdf(receiptId: string): Promise<{ ok: boolean; error?: string }> {
  const r = await prisma.receipt.findUniqueOrThrow({ where: { id: receiptId }, select: { pdfSha256: true, snapshot: true } });
  if (r.pdfSha256) return { ok: true };
  try {
    const { pdf, sha256 } = await renderReceipt(r.snapshot as unknown as ReceiptSnapshot);
    // Write-once: only fills an empty PDF slot (a trigger also enforces it).
    await prisma.receipt.updateMany({ where: { id: receiptId, pdfSha256: null }, data: { pdf, pdfSha256: sha256, pdfGeneratedAt: new Date(), pdfError: null } });
    return { ok: true };
  } catch (err) {
    const error = (err instanceof Error ? err.message : "PDF rendering failed").slice(0, 300);
    console.error(`[receipts] PDF generation failed for ${receiptId}: ${error}`);
    await prisma.receipt.updateMany({ where: { id: receiptId, pdfSha256: null }, data: { pdfError: error } }).catch(() => undefined);
    return { ok: false, error };
  }
}

const paymentList = pagination.extend({
  agreementId: id.optional(),
  caseId: id.optional(),
  status: z.enum(["RECORDED", "VOIDED"]).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

const paymentScope = (ctx: Ctx): Prisma.PaymentWhereInput => ({ organizationId: ctx.actor.organizationId, agreement: agreementScope(ctx) });

export async function listPayments(ctx: Ctx, raw: unknown): Promise<Paginated<PaymentDTO>> {
  assertCan(ctx, "finance:read");
  const q = parse(paymentList, raw);
  const paidOn: Prisma.DateTimeFilter = {};
  if (q.from) paidOn.gte = dateOnly(q.from);
  if (q.to) paidOn.lte = dateOnly(q.to);
  const where: Prisma.PaymentWhereInput = {
    AND: [paymentScope(ctx), q.agreementId ? { agreementId: q.agreementId } : {}, q.caseId ? { agreement: { caseId: q.caseId } } : {}, q.status ? { status: q.status } : {}, q.from || q.to ? { paidOn } : {}],
  };
  const [total, rows] = await prisma.$transaction([
    prisma.payment.count({ where }),
    prisma.payment.findMany({ where, include: paymentInclude, orderBy: [{ createdAt: "desc" }, { id: "asc" }], ...pageArgs(q) }),
  ]);
  return { items: rows.map(paymentDTO), page: q.page, pageSize: q.pageSize, total };
}

export async function getPayment(ctx: Ctx, paymentId: string): Promise<PaymentDTO> {
  assertCan(ctx, "finance:read");
  const p = await prisma.payment.findFirst({ where: { AND: [{ id: paymentId }, paymentScope(ctx)] }, include: paymentInclude });
  if (!p) throw notFound("الدفعة");
  return paymentDTO(p);
}

export async function voidPayment(ctx: Ctx, paymentId: string, raw: unknown): Promise<PaymentDTO> {
  assertCan(ctx, "payment:void");
  const input = parse(z.object({ reason: requiredText(500, "يرجى ذكر سبب إلغاء الدفعة") }), raw);
  await prisma.$transaction(async (tx) => {
    const p = await tx.payment.findFirst({ where: { AND: [{ id: paymentId }, paymentScope(ctx)] }, include: { receipt: true } });
    if (!p) throw notFound("الدفعة");
    const a = await lockAgreement(tx, ctx, p.agreementId);
    const now = new Date();
    const result = await tx.payment.updateMany({
      where: { id: paymentId, organizationId: ctx.actor.organizationId, status: "RECORDED" },
      data: { status: "VOIDED", voidedAt: now, voidedById: ctx.actor.userId, voidReason: input.reason, referenceKey: null },
    });
    if (result.count === 0) throw new AppError("CONFLICT", "هذه الدفعة ملغاة مسبقاً.");
    if (p.receipt && p.receipt.status === "ISSUED") {
      await tx.receipt.update({ where: { id: p.receipt.id }, data: { status: "CANCELLED", cancelledAt: now, cancelledById: ctx.actor.userId, cancelReason: `إلغاء الدفعة: ${input.reason}` } });
    }
    if (a.status === "SETTLED") await tx.feeAgreement.update({ where: { id: a.id }, data: { status: "ACTIVE", version: { increment: 1 } } });
    await audit(tx, ctx, {
      resourceType: "payment",
      resourceId: paymentId,
      caseId: a.caseId,
      operation: "payment.void",
      summary: `إلغاء دفعة${p.receipt ? ` والوصل ${p.receipt.number}` : ""}`,
      before: { status: "RECORDED", amount: p.amount },
      after: { status: "VOIDED", reason: input.reason },
    });
  });
  return getPayment(ctx, paymentId);
}

// ——— Receipts ———

const receiptList = pagination.extend({
  caseId: id.optional(),
  status: z.enum(["ISSUED", "CANCELLED"]).optional(),
  number: z.string().trim().max(40).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

const receiptScope = (ctx: Ctx): Prisma.ReceiptWhereInput => ({ organizationId: ctx.actor.organizationId, case: caseScope(ctx.actor) });

export async function listReceipts(ctx: Ctx, raw: unknown): Promise<Paginated<ReceiptDTO>> {
  assertCan(ctx, "finance:read");
  const q = parse(receiptList, raw);
  const issuedOn: Prisma.DateTimeFilter = {};
  if (q.from) issuedOn.gte = dateOnly(q.from);
  if (q.to) issuedOn.lte = dateOnly(q.to);
  const where: Prisma.ReceiptWhereInput = {
    AND: [
      receiptScope(ctx),
      q.caseId ? { caseId: q.caseId } : {},
      q.status ? { status: q.status } : {},
      q.number ? { number: { contains: q.number.toUpperCase() } } : {},
      q.from || q.to ? { issuedOn } : {},
    ],
  };
  const [total, rows] = await prisma.$transaction([
    prisma.receipt.count({ where }),
    prisma.receipt.findMany({ where, select: receiptSelect, orderBy: [{ year: "desc" }, { sequence: "desc" }], ...pageArgs(q) }),
  ]);
  return { items: rows.map(receiptDTO), page: q.page, pageSize: q.pageSize, total };
}

export async function getReceipt(ctx: Ctx, receiptId: string): Promise<ReceiptDTO> {
  assertCan(ctx, "finance:read");
  const r = await prisma.receipt.findFirst({ where: { AND: [{ id: receiptId }, receiptScope(ctx)] }, select: receiptSelect });
  if (!r) throw notFound("الوصل");
  return receiptDTO(r);
}

/** The stored PDF for an issued receipt; for a cancelled one, a freshly rendered copy stamped «ملغى». */
export async function receiptPdf(ctx: Ctx, receiptId: string): Promise<{ pdf: Buffer; filename: string; status: "ISSUED" | "CANCELLED" }> {
  assertCan(ctx, "finance:read");
  const r = await prisma.receipt.findFirst({
    where: { AND: [{ id: receiptId }, receiptScope(ctx)] },
    select: { number: true, status: true, pdf: true, pdfError: true, snapshot: true, cancelledAt: true, cancelReason: true },
  });
  if (!r) throw notFound("الوصل");
  if (r.status === "CANCELLED") {
    try {
      const { pdf } = await renderReceipt(r.snapshot as unknown as ReceiptSnapshot, { cancelled: { at: r.cancelledAt!.toISOString(), reason: r.cancelReason ?? "" } });
      return { pdf, filename: `${r.number}-cancelled.pdf`, status: "CANCELLED" };
    } catch {
      throw new AppError("SERVICE_UNAVAILABLE", "تعذّر توليد نسخة PDF للوصل الملغى حالياً.");
    }
  }
  if (!r.pdf) {
    throw new AppError("CONFLICT", r.pdfError ? "لم يُولَّد ملف PDF لهذا الوصل بسبب خطأ تقني. أعد محاولة التوليد." : "ملف PDF لهذا الوصل غير متوفر بعد.", {
      data: { pdfError: r.pdfError },
    });
  }
  return { pdf: Buffer.from(r.pdf), filename: `${r.number}.pdf`, status: "ISSUED" };
}

export async function retryReceiptPdf(ctx: Ctx, receiptId: string): Promise<ReceiptDTO> {
  assertCan(ctx, "payment:record");
  const r = await getReceipt(ctx, receiptId);
  if (r.status !== "ISSUED") throw new AppError("CONFLICT", "لا يُولَّد ملف PDF أصلي لوصل ملغى.");
  if (!r.pdf.available) {
    const result = await generateReceiptPdf(receiptId);
    await audit(prisma, ctx, { resourceType: "receipt", resourceId: receiptId, caseId: r.caseId, operation: "receipt.pdf.retry", outcome: result.ok ? "SUCCESS" : "FAILURE", summary: `إعادة توليد PDF للوصل ${r.number}` });
  }
  return getReceipt(ctx, receiptId);
}
