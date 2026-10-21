/** Prisma row → API DTO mappers, with the matching `include` shapes. */
import { Prisma } from "@prisma/client";

import type {
  CaseSummaryDTO,
  ClientDTO,
  FeeAgreementDTO,
  HearingDTO,
  PaymentDTO,
  PersonRef,
  ReceiptDTO,
  ReminderDTO,
  Role,
  SettlementStatus,
  TaskDTO,
} from "../../shared/api.js";
import { Decimal, money, sum } from "../lib/money.js";
import { formatDateOnly, utcToZoned } from "../lib/time.js";

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

const memberPerson = { select: { userId: true, user: { select: { name: true } } } } as const;
const person = (m: { userId: string; user: { name: string } }): PersonRef => ({ userId: m.userId, name: m.user.name });
const userPerson = (u: { id: string; name: string }): PersonRef => ({ userId: u.id, name: u.name });

// ——— Clients ———

export const clientInclude = { _count: { select: { cases: true } } } satisfies Prisma.ClientInclude;
type ClientRow = Prisma.ClientGetPayload<{ include: typeof clientInclude }>;

export function clientDTO(c: ClientRow): ClientDTO {
  return {
    id: c.id,
    type: c.type,
    fullName: c.fullName,
    phone: c.phone,
    email: c.email,
    address: c.address,
    nationalId: c.nationalId,
    notes: c.notes,
    archivedAt: iso(c.archivedAt),
    version: c.version,
    caseCount: c._count.cases,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

// ——— Cases ———

export function caseSummaryInclude(now: Date) {
  return {
    assignedLawyer: memberPerson,
    clients: { orderBy: { createdAt: "asc" }, include: { client: { select: { id: true, fullName: true } } } },
    hearings: { where: { status: "SCHEDULED", startsAt: { gte: now } }, orderBy: { startsAt: "asc" }, take: 1, select: { id: true, startsAt: true, timeZone: true } },
  } satisfies Prisma.CaseInclude;
}
type CaseSummaryRow = Prisma.CaseGetPayload<{ include: ReturnType<typeof caseSummaryInclude> }>;

export function caseSummaryDTO(c: CaseSummaryRow): CaseSummaryDTO {
  const next = c.hearings[0];
  return {
    id: c.id,
    reference: c.reference,
    type: c.type,
    status: c.status,
    court: c.court,
    chamber: c.chamber,
    openedOn: formatDateOnly(c.openedOn),
    closedOn: c.closedOn ? formatDateOnly(c.closedOn) : null,
    assignedLawyer: person(c.assignedLawyer),
    clients: c.clients.map((cc) => ({ id: cc.client.id, fullName: cc.client.fullName, role: cc.role })),
    nextHearing: next ? { id: next.id, startsAt: next.startsAt.toISOString(), ...utcToZoned(next.startsAt, next.timeZone) } : null,
    version: c.version,
    updatedAt: c.updatedAt.toISOString(),
  };
}

export const memberRole = (role: string) => role as Role;

// ——— Hearings ———

export const hearingInclude = {
  case: {
    select: {
      id: true,
      reference: true,
      assignedLawyer: memberPerson,
      clients: { orderBy: { createdAt: "asc" }, take: 3, include: { client: { select: { fullName: true } } } },
    },
  },
} satisfies Prisma.HearingInclude;
type HearingRow = Prisma.HearingGetPayload<{ include: typeof hearingInclude }>;

export const clientNames = (clients: { client: { fullName: string } }[]) => clients.map((c) => c.client.fullName).join("، ");

export function hearingDTO(h: HearingRow): HearingDTO {
  const local = utcToZoned(h.startsAt, h.timeZone);
  return {
    id: h.id,
    caseId: h.case.id,
    caseReference: h.case.reference,
    clientName: clientNames(h.case.clients),
    assignedLawyer: person(h.case.assignedLawyer),
    startsAt: h.startsAt.toISOString(),
    date: local.date,
    time: local.time,
    timeZone: h.timeZone,
    durationMinutes: h.durationMinutes,
    court: h.court,
    chamber: h.chamber,
    room: h.room,
    type: h.type,
    status: h.status,
    notes: h.notes,
    version: h.version,
    createdAt: h.createdAt.toISOString(),
    updatedAt: h.updatedAt.toISOString(),
  };
}

// ——— Finance ———

export const agreementInclude = {
  case: { select: { id: true, reference: true } },
  client: { select: { id: true, fullName: true } },
  payments: { where: { status: "RECORDED" }, select: { amount: true, paidOn: true } },
  _count: { select: { payments: true } },
} satisfies Prisma.FeeAgreementInclude;
type AgreementRow = Prisma.FeeAgreementGetPayload<{ include: typeof agreementInclude }>;

export function settlementOf(amount: Decimal, paid: Decimal): SettlementStatus {
  if (paid.gte(amount)) return "PAID";
  return paid.gt(0) ? "PARTIAL" : "UNPAID";
}

export function agreementDTO(a: AgreementRow): FeeAgreementDTO {
  const paid = sum(a.payments.map((p) => p.amount));
  const remaining = Decimal.max(new Decimal(a.amount).minus(paid), 0);
  const last = a.payments.reduce<Date | null>((acc, p) => (!acc || p.paidOn > acc ? p.paidOn : acc), null);
  return {
    id: a.id,
    caseId: a.case.id,
    caseReference: a.case.reference,
    client: a.client,
    title: a.title,
    amount: money(a.amount),
    currency: a.currency,
    paymentTerms: a.paymentTerms,
    status: a.status,
    paid: money(paid),
    remaining: money(remaining),
    settlement: settlementOf(new Decimal(a.amount), paid),
    lastPaymentOn: last ? formatDateOnly(last) : null,
    paymentCount: a._count.payments,
    version: a.version,
    createdAt: a.createdAt.toISOString(),
  };
}

export const receiptSelect = {
  id: true,
  number: true,
  paymentId: true,
  caseId: true,
  amount: true,
  currency: true,
  issuedOn: true,
  status: true,
  cancelledAt: true,
  cancelReason: true,
  pdfSha256: true,
  pdfGeneratedAt: true,
  pdfError: true,
  snapshot: true,
  createdAt: true,
  case: { select: { reference: true } },
} satisfies Prisma.ReceiptSelect;
type ReceiptRow = Prisma.ReceiptGetPayload<{ select: typeof receiptSelect }>;

export function receiptDTO(r: ReceiptRow): ReceiptDTO {
  const snap = (r.snapshot ?? {}) as { client?: { fullName?: string } | null };
  return {
    id: r.id,
    number: r.number,
    paymentId: r.paymentId,
    caseId: r.caseId,
    caseReference: r.case.reference,
    clientName: snap.client?.fullName ?? null,
    amount: money(r.amount),
    currency: r.currency,
    issuedOn: formatDateOnly(r.issuedOn),
    status: r.status,
    cancelledAt: iso(r.cancelledAt),
    cancelReason: r.cancelReason,
    pdf: { available: !!r.pdfSha256, sha256: r.pdfSha256, generatedAt: iso(r.pdfGeneratedAt), error: r.pdfError },
    createdAt: r.createdAt.toISOString(),
  };
}

export const paymentInclude = {
  agreement: { select: { id: true, caseId: true, case: { select: { reference: true } } } },
  createdBy: { select: { id: true, name: true } },
  receipt: { select: receiptSelect },
} satisfies Prisma.PaymentInclude;
type PaymentRow = Prisma.PaymentGetPayload<{ include: typeof paymentInclude }>;

export function paymentDTO(p: PaymentRow): PaymentDTO {
  return {
    id: p.id,
    agreementId: p.agreementId,
    caseId: p.agreement.caseId,
    caseReference: p.agreement.case.reference,
    amount: money(p.amount),
    currency: p.currency,
    paidOn: formatDateOnly(p.paidOn),
    method: p.method,
    reference: p.reference,
    notes: p.notes,
    status: p.status,
    recordedBy: userPerson(p.createdBy),
    createdAt: p.createdAt.toISOString(),
    voidedAt: iso(p.voidedAt),
    voidReason: p.voidReason,
    receipt: p.receipt ? receiptDTO(p.receipt) : null,
  };
}

// ——— Tasks & reminders ———

export const reminderInclude = {
  recipient: memberPerson,
  task: { select: { title: true } },
  hearing: { select: { type: true, case: { select: { reference: true } } } },
} satisfies Prisma.ReminderInclude;
type ReminderRow = Prisma.ReminderGetPayload<{ include: typeof reminderInclude }>;

export function reminderTitle(r: { task: { title: string } | null; hearing: { type: string; case: { reference: string } } | null }) {
  if (r.task) return r.task.title;
  if (r.hearing) return `${r.hearing.type} — ${r.hearing.case.reference}`;
  return "تذكير";
}

export function reminderDTO(r: ReminderRow): ReminderDTO {
  return {
    id: r.id,
    channel: r.channel,
    status: r.status,
    scheduledAt: r.scheduledAt.toISOString(),
    attempts: r.attempts,
    lastError: r.lastError,
    deliveredAt: iso(r.deliveredAt),
    readAt: iso(r.readAt),
    taskId: r.taskId,
    hearingId: r.hearingId,
    title: reminderTitle(r),
    recipient: person(r.recipient),
  };
}

export const taskInclude = {
  case: { select: { id: true, reference: true, clients: { orderBy: { createdAt: "asc" }, take: 2, include: { client: { select: { fullName: true } } } } } },
  assignee: memberPerson,
  createdBy: { select: { id: true, name: true } },
  reminders: { orderBy: { scheduledAt: "asc" }, include: reminderInclude },
} satisfies Prisma.TaskInclude;
type TaskRow = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;

export function taskDTO(t: TaskRow): TaskDTO {
  return {
    id: t.id,
    kind: t.kind,
    title: t.title,
    description: t.description,
    case: t.case ? { id: t.case.id, reference: t.case.reference, clientName: clientNames(t.case.clients) } : null,
    hearingId: t.hearingId,
    assignee: person(t.assignee),
    dueDate: t.dueDate ? formatDateOnly(t.dueDate) : null,
    dueTime: t.dueTime,
    dueAt: iso(t.dueAt),
    priority: t.priority,
    status: t.status,
    recurrence: t.recurrence,
    notifyInApp: t.notifyInApp,
    notifyEmail: t.notifyEmail,
    completedAt: iso(t.completedAt),
    createdBy: userPerson(t.createdBy),
    createdAt: t.createdAt.toISOString(),
    version: t.version,
    reminders: t.reminders.map(reminderDTO),
  };
}
