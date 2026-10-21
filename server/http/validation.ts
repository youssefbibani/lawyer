import { z } from "zod";

import { isValidDate, isValidTime, isValidTimeZone } from "../lib/time.js";
import { CURRENCY_RE, MONEY_RE } from "../lib/money.js";
import { fromZod } from "./errors.js";

/** Parses with a schema and throws a 422 AppError (Arabic messages) on failure. */
export function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw fromZod(result.error);
  return result.data;
}

export const id = z.string().trim().min(1, "المعرّف مطلوب").max(64, "معرّف غير صالح").regex(/^[A-Za-z0-9_-]+$/, "معرّف غير صالح");

export const isoDate = z
  .string({ required_error: "التاريخ مطلوب", invalid_type_error: "تاريخ غير صالح" })
  .refine(isValidDate, "تاريخ غير صالح (الصيغة المطلوبة YYYY-MM-DD)");

export const hhmm = z
  .string({ required_error: "الساعة مطلوبة", invalid_type_error: "توقيت غير صالح" })
  .refine(isValidTime, "توقيت غير صالح (الصيغة المطلوبة HH:mm)");

export const moneyString = z
  .union([z.string(), z.number()], { invalid_type_error: "قيمة المبلغ غير صالحة" })
  .transform((v) => (typeof v === "number" ? String(v) : v.trim()))
  .refine((v) => MONEY_RE.test(v), "قيمة المبلغ غير صالحة (رقم موجب بثلاثة أرقام عشرية على الأكثر)")
  .refine((v) => Number(v) > 0, "يجب أن يكون المبلغ أكبر من صفر");

export const currency = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase())
  .refine((v) => CURRENCY_RE.test(v), "رمز العملة غير صالح (ثلاثة أحرف مثل TND)");

export const timeZone = z.string().trim().refine(isValidTimeZone, "المنطقة الزمنية غير معروفة");

export const version = z.number({ required_error: "رقم النسخة مطلوب", invalid_type_error: "رقم النسخة غير صالح" }).int().positive();

/** Optional free text: trimmed, "" becomes null. */
export const optionalText = (max: number) =>
  z
    .string()
    .max(max, `النص طويل جداً (الحد الأقصى ${max} حرفاً)`)
    .nullish()
    .transform((v) => {
      if (v === undefined) return undefined;
      const t = v?.trim() ?? "";
      return t.length ? t : null;
    });

export const requiredText = (max: number, message: string) =>
  z.string({ required_error: message, invalid_type_error: message }).trim().min(1, message).max(max, `النص طويل جداً (الحد الأقصى ${max} حرفاً)`);

export const optionalEmail = z
  .string()
  .trim()
  .max(200)
  .nullish()
  .transform((v) => (v ? v.toLowerCase() : v === undefined ? undefined : null))
  .refine((v) => v === undefined || v === null || z.string().email().safeParse(v).success, "البريد الإلكتروني غير صالح");

export const optionalPhone = optionalText(40).refine((v) => v === undefined || v === null || /^[+0-9 ()./-]{6,40}$/.test(v), "رقم الهاتف غير صالح");

export const pagination = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export function sortParam<const F extends string>(fields: readonly F[], fallback: `${F}:${"asc" | "desc"}`) {
  return z
    .string()
    .default(fallback)
    .refine((v) => {
      const [field, dir] = v.split(":");
      return fields.includes(field as F) && (dir === "asc" || dir === "desc");
    }, "معيار ترتيب غير مدعوم")
    .transform((v) => {
      const [field, dir] = v.split(":") as [F, "asc" | "desc"];
      return { field, dir };
    });
}

export const boolParam = z
  .enum(["true", "false"])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === "true"));

export function pageArgs(p: { page: number; pageSize: number }) {
  return { skip: (p.page - 1) * p.pageSize, take: p.pageSize };
}
