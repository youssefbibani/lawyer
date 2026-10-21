import type { AuditOutcome, Prisma, PrismaClient } from "@prisma/client";

import type { Ctx } from "../http/context.js";
import type { Tx } from "../db.js";

const SECRET_KEYS = /pass(word)?|token|secret|backup|otp|totp|cookie|authorization|pdf/i;

/** Removes anything resembling a secret before a snapshot is written to the audit log. */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined || depth > 4) return value ?? null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    if (typeof (value as { toFixed?: unknown }).toFixed === "function" && "d" in (value as object)) {
      return (value as { toFixed: (n: number) => string }).toFixed(3);
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEYS.test(k)) continue;
      out[k] = redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

export interface AuditEntry {
  resourceType: string;
  resourceId?: string | null;
  operation: string;
  caseId?: string | null;
  summary?: string;
  before?: unknown;
  after?: unknown;
  outcome?: AuditOutcome;
}

/** Appends an audit entry inside the caller's transaction (the table is append-only). */
export async function audit(db: Tx | PrismaClient, ctx: Ctx, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      organizationId: ctx.actor.organizationId,
      actorId: ctx.actor.userId,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId ?? null,
      operation: entry.operation,
      outcome: entry.outcome ?? "SUCCESS",
      caseId: entry.caseId ?? null,
      summary: entry.summary?.slice(0, 300) ?? null,
      before: entry.before === undefined ? undefined : (redact(entry.before) as Prisma.InputJsonValue),
      after: entry.after === undefined ? undefined : (redact(entry.after) as Prisma.InputJsonValue),
      ipAddress: ctx.meta.ip,
      userAgent: ctx.meta.userAgent?.slice(0, 300) ?? null,
      requestId: ctx.meta.requestId,
    },
  });
}

/** Records an event that has no authenticated office context (e.g. sign-in failures). */
export async function auditAnonymous(
  db: PrismaClient,
  entry: AuditEntry & { organizationId?: string | null; actorId?: string | null; ip: string | null; userAgent: string | null; requestId: string },
): Promise<void> {
  await db.auditLog.create({
    data: {
      organizationId: entry.organizationId ?? null,
      actorId: entry.actorId ?? null,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId ?? null,
      operation: entry.operation,
      outcome: entry.outcome ?? "SUCCESS",
      summary: entry.summary ?? null,
      ipAddress: entry.ip,
      userAgent: entry.userAgent?.slice(0, 300) ?? null,
      requestId: entry.requestId,
    },
  });
}
