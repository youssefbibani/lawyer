/**
 * Time-zone aware conversions. Hearings and timed tasks are entered as a wall-clock date + time
 * in the office time zone (Africa/Tunis by default) and stored as an absolute UTC instant.
 * Date-only values ("YYYY-MM-DD") are stored as SQL DATE and never acquire an invented time.
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

export function isValidTime(value: string): boolean {
  return TIME_RE.test(value);
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(tz, f);
  }
  return f;
}

function wallClockParts(instant: Date, tz: string) {
  const parts = Object.fromEntries(formatter(tz).formatToParts(instant).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Offset of `tz` from UTC at `instant`, in milliseconds (positive east of Greenwich). */
function offsetAt(instant: Date, tz: string): number {
  const p = wallClockParts(instant, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * Converts a wall-clock date + time in `tz` to the UTC instant. Returns null for a local time
 * that does not exist (e.g. inside a daylight-saving gap) instead of silently shifting it.
 */
export function zonedToUtc(date: string, time: string, tz: string): Date | null {
  if (!isValidDate(date) || !isValidTime(time)) return null;
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  let candidate = new Date(naive - offsetAt(new Date(naive), tz));
  // Re-evaluate once with the offset at the candidate instant (handles offset changes).
  candidate = new Date(naive - offsetAt(candidate, tz));
  const back = utcToZoned(candidate, tz);
  if (back.date !== date || back.time !== time) return null;
  return candidate;
}

export function utcToZoned(instant: Date, tz: string): { date: string; time: string } {
  const p = wallClockParts(instant, tz);
  const pad = (n: number) => String(n).padStart(2, "0");
  return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, time: `${pad(p.hour)}:${pad(p.minute)}` };
}

/** Today's calendar date in `tz`. */
export function todayIn(tz: string, now: Date = new Date()): string {
  return utcToZoned(now, tz).date;
}

/** [start, end) UTC instants covering the calendar day `date` in `tz`. */
export function dayRange(date: string, tz: string): { start: Date; end: Date } {
  const start = zonedToUtc(date, "00:00", tz) ?? new Date(`${date}T00:00:00Z`);
  const end = zonedToUtc(addDaysToDate(date, 1), "00:00", tz) ?? new Date(start.getTime() + 86_400_000);
  return { start, end };
}

/** SQL DATE <-> "YYYY-MM-DD". Prisma represents DATE columns as UTC midnight. */
export function dateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function formatDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function addDaysToDate(date: string, days: number): string {
  const d = dateOnly(date);
  d.setUTCDate(d.getUTCDate() + days);
  return formatDateOnly(d);
}

export function addMonthsToDate(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return formatDateOnly(target);
}
