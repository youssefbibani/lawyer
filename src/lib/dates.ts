import type { HearingUrgency } from "@/types";

/** Local calendar date as YYYY-MM-DD (never UTC-shifted). */
export function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Parses YYYY-MM-DD as a local date (new Date("YYYY-MM-DD") would be UTC). */
export function parseISODate(value: string): Date {
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function daysFromNow(days: number, now: Date = new Date()): string {
  return toISODate(addDays(startOfDay(now), days));
}

export function diffInDays(a: Date, b: Date): number {
  return Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / 86_400_000);
}

export function combineDateTime(date: string, time?: string): Date {
  const d = parseISODate(date);
  if (time) {
    const [h, min] = time.split(":").map(Number);
    d.setHours(h ?? 0, min ?? 0, 0, 0);
  }
  return d;
}

export function urgencyOf(date: string, now: Date = new Date()): HearingUrgency | "past" {
  const days = diffInDays(parseISODate(date), now);
  if (days < 0) return "past";
  if (days <= 2) return "urgent";
  if (days <= 7) return "week";
  return "later";
}

export const ARABIC_WEEKDAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

/** Sunday-first, same index as `Date#getDay()`. */
export const ARABIC_WEEKDAYS_SHORT = ["أحد", "إثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"];

export function weekdayName(date: Date | string): string {
  const d = typeof date === "string" ? parseISODate(date) : date;
  return ARABIC_WEEKDAYS[d.getDay()];
}

export function isSameISODate(a: string, b: string): boolean {
  return a.slice(0, 10) === b.slice(0, 10);
}
