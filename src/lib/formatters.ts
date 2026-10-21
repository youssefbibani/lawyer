import { parseISODate } from "@/lib/dates";

const arabicDigits = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];

export function toArabicDigits(value: string | number): string {
  return String(value).replace(/[0-9]/g, (d) => arabicDigits[Number(d)]);
}

export function formatCurrency(amount: number): string {
  return `${amount.toLocaleString("en-US")} د.ت`;
}

export function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}

export const arabicMonths = [
  "جانفي",
  "فيفري",
  "مارس",
  "أفريل",
  "ماي",
  "جوان",
  "جويلية",
  "أوت",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];

/** Date-only strings are parsed as local dates; full timestamps keep their time zone. */
function toDate(date: Date | string): Date {
  if (typeof date !== "string") return date;
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? parseISODate(date) : new Date(date);
}

export function formatArabicDate(date: Date | string): string {
  const d = toDate(date);
  const day = d.getDate().toString().padStart(2, "0");
  const month = arabicMonths[d.getMonth()];
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
}

export function formatArabicDateShort(date: Date | string): string {
  const d = toDate(date);
  const day = d.getDate().toString().padStart(2, "0");
  const month = (d.getMonth() + 1).toString().padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

export function formatTime(date: Date | string): string {
  const d = toDate(date);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** "اليوم", "غداً", "بعد 3 أيام"… falling back to the full date. */
export function formatRelativeDay(date: string, now: Date = new Date()): string {
  const d = toDate(date);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return "اليوم";
  if (diff === 1) return "غداً";
  if (diff === -1) return "أمس";
  if (diff > 1 && diff <= 6) return `بعد ${diff} أيام`;
  if (diff < -1 && diff >= -6) return `منذ ${-diff} أيام`;
  return formatArabicDate(d);
}
