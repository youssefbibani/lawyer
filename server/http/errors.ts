import { Prisma } from "@prisma/client";
import type { ZodError } from "zod";

import type { ApiErrorBody, ErrorCode } from "../../shared/api.js";

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NO_ACTIVE_OFFICE: 403,
  CSRF_REJECTED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  VERSION_CONFLICT: 409,
  HEARING_CONFLICT: 409,
  TASK_CONFLICT: 409,
  OVERPAYMENT: 422,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  IDEMPOTENCY_KEY_REUSED: 409,
  IMMUTABLE_RECORD: 409,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL: 500,
};

/** An expected failure with a stable code and an Arabic message that is safe to show. */
export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly options: { details?: { path: string; message: string }[]; data?: unknown } = {},
  ) {
    super(message);
    this.status = STATUS[code];
  }
}

export const notFound = (what = "العنصر") => new AppError("NOT_FOUND", `${what} غير موجود أو غير مصرّح لك بالوصول إليه.`);
export const forbidden = (message = "ليست لديك صلاحية القيام بهذه العملية.") => new AppError("FORBIDDEN", message);
export const versionConflict = () =>
  new AppError("VERSION_CONFLICT", "عدّل مستخدم آخر هذا السجل في الأثناء. أعد تحميل الصفحة ثم أعد المحاولة.");

export function fromZod(error: ZodError): AppError {
  const details = error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
  return new AppError("VALIDATION_FAILED", details[0]?.message ?? "البيانات المرسلة غير صالحة.", { details });
}

/** Maps database / Prisma failures to API errors without leaking SQL or internals. */
export function fromDatabase(err: unknown): AppError | null {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case "P2002":
        return new AppError("CONFLICT", "يوجد سجل مطابق مسبقاً (قيمة مكررة).", { data: { target: err.meta?.target } });
      case "P2003":
        return new AppError("VALIDATION_FAILED", "أحد العناصر المرتبطة غير موجود ضمن مكتبك.");
      case "P2025":
        return notFound();
      case "P2034":
        return new AppError("CONFLICT", "تعارضت العملية مع عملية متزامنة. أعد المحاولة.");
      case "P1001":
      case "P1002":
      case "P1008":
      case "P1017":
        return new AppError("SERVICE_UNAVAILABLE", "قاعدة البيانات غير متاحة حالياً. لم يُحفظ أي تغيير.");
      case "P2010": {
        // Raw query failure: inspect the PostgreSQL error code.
        const pg = String((err.meta as { code?: string } | undefined)?.code ?? "");
        return fromPgCode(pg, String(err.meta?.message ?? ""));
      }
    }
    const pgCode = String((err.meta as { code?: string } | undefined)?.code ?? "");
    if (pgCode) return fromPgCode(pgCode, err.message);
    return null;
  }
  if (err instanceof Prisma.PrismaClientInitializationError) {
    return new AppError("SERVICE_UNAVAILABLE", "قاعدة البيانات غير متاحة حالياً. لم يُحفظ أي تغيير.");
  }
  if (err instanceof Prisma.PrismaClientUnknownRequestError) {
    const match = /code: "?([0-9A-Z]{5})"?/.exec(err.message) ?? /SqlState\(E?([0-9A-Z]{5})\)/.exec(err.message);
    if (match) return fromPgCode(match[1], err.message);
    if (/append-only|immutable|write-once|cannot be (deleted|changed|reinstated|decreased)/.test(err.message)) {
      return new AppError("IMMUTABLE_RECORD", "هذا السجل غير قابل للتعديل أو الحذف (سجل محمي).");
    }
  }
  return null;
}

function fromPgCode(code: string, message: string): AppError | null {
  if (code === "23505") return new AppError("CONFLICT", "يوجد سجل مطابق مسبقاً (قيمة مكررة).");
  if (code === "23503") return new AppError("VALIDATION_FAILED", "أحد العناصر المرتبطة غير موجود ضمن مكتبك.");
  if (code === "23514") return new AppError("VALIDATION_FAILED", "القيم المرسلة تخالف قواعد سلامة البيانات.");
  if (code === "P0001" || /append-only|immutable|write-once/.test(message)) {
    return new AppError("IMMUTABLE_RECORD", "هذا السجل غير قابل للتعديل أو الحذف (سجل محمي).");
  }
  if (code === "40001" || code === "40P01") return new AppError("CONFLICT", "تعارضت العملية مع عملية متزامنة. أعد المحاولة.");
  return null;
}

export function errorBody(error: AppError, requestId?: string): ApiErrorBody {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.options.details ? { details: error.options.details } : {}),
      ...(error.options.data !== undefined ? { data: error.options.data } : {}),
      requestId,
    },
  };
}
