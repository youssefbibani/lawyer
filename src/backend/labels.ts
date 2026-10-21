import type {
  CaseStatus,
  CaseType,
  ClientType,
  HearingStatus,
  PaymentMethod,
  ReminderStatus,
  Role,
  SettlementStatus,
  TaskPriority,
  TaskRecurrence,
} from "../../shared/api";
import type { StatusTone } from "@/lib/status";

export const CASE_TYPE_LABELS: Record<CaseType, string> = {
  INHERITANCE: "نزاع ميراث",
  CIVIL: "قضية مدنية",
  CASSATION: "طعن تعقيبي",
  COMMERCIAL: "قضية تجارية",
  REAL_ESTATE: "قضية عقارية",
  CRIMINAL: "قضية جزائية",
  ADMINISTRATIVE: "قضية إدارية",
  LABOR: "نزاع شغلي",
  FAMILY: "أحوال شخصية",
  OTHER: "أخرى",
};

export const CASE_STATUS_LABELS: Record<CaseStatus, string> = { ACTIVE: "نشطة", POSTPONED: "مؤجلة", CLOSED: "منتهية" };

export function caseStatusToneOf(status: CaseStatus): StatusTone {
  return status === "ACTIVE" ? "success" : status === "POSTPONED" ? "gold" : "neutral";
}

export const CLIENT_TYPE_LABELS: Record<ClientType, string> = {
  INDIVIDUAL: "شخص طبيعي",
  COMPANY: "شركة",
  HEIRS: "ورثة",
  ADMINISTRATION: "إدارة / هيكل عمومي",
  OTHER: "أخرى",
};

export const ROLE_LABELS_AR: Record<Role, string> = { admin: "مدير المكتب", lawyer: "محامٍ", clerk: "كاتب(ة) المكتب" };

export const HEARING_STATUS_LABELS: Record<HearingStatus, string> = { SCHEDULED: "مبرمجة", HELD: "انعقدت", POSTPONED: "أُجّلت", CANCELLED: "أُلغيت" };

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: "نقداً",
  CHECK: "صك بنكي",
  BANK_TRANSFER: "تحويل بنكي",
  CARD: "بطاقة بنكية",
  MOBILE: "دفع عبر الهاتف",
  OTHER: "أخرى",
};

export const SETTLEMENT_LABELS: Record<SettlementStatus, string> = { PAID: "مسدّد", PARTIAL: "جزئي", UNPAID: "غير مدفوع" };

export function settlementTone(s: SettlementStatus): StatusTone {
  return s === "PAID" ? "success" : s === "PARTIAL" ? "gold" : "alert";
}

export const REMINDER_STATUS_LABELS: Record<ReminderStatus, string> = {
  PENDING: "مجدول",
  SENT: "أُرسل",
  FAILED: "فشل الإرسال",
  CANCELLED: "أُلغي",
  NOT_CONFIGURED: "لم يُرسل: الخدمة غير مهيأة",
};

/** The existing UI components use lower-case priority / recurrence keys. */
export const toUiPriority = (p: TaskPriority) => p.toLowerCase() as "high" | "medium" | "low";
export const fromUiPriority = (p: "high" | "medium" | "low") => p.toUpperCase() as TaskPriority;
export const toUiRecurrence = (r: TaskRecurrence) => r.toLowerCase() as "none" | "daily" | "weekly" | "monthly";
export const fromUiRecurrence = (r: "none" | "daily" | "weekly" | "monthly") => r.toUpperCase() as TaskRecurrence;

/** Arabic messages for Better Auth error codes. */
export const AUTH_ERROR_MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
  ACCOUNT_DISABLED: "هذا الحساب معطّل. تواصل مع مدير المكتب.",
  INVALID_PASSWORD: "كلمة المرور الحالية غير صحيحة.",
  PASSWORD_TOO_SHORT: "كلمة المرور قصيرة جداً (10 أحرف على الأقل).",
  PASSWORD_TOO_LONG: "كلمة المرور طويلة جداً.",
  INVALID_CODE: "الرمز غير صحيح أو انتهت صلاحيته.",
  INVALID_TWO_FACTOR_COOKIE: "انتهت مهلة التحقق. أعد تسجيل الدخول.",
  INVALID_TOKEN: "رابط إعادة التعيين غير صالح أو انتهت صلاحيته.",
  TOO_MANY_ATTEMPTS: "محاولات كثيرة. أعد المحاولة لاحقاً.",
  INVALID_EMAIL: "البريد الإلكتروني غير صالح.",
};
