/** Formats a decimal money string ("1500.250") without converting it to a float. */
export function formatMoney(amount: string | null | undefined, currency = "TND"): string {
  const value = amount ?? "0";
  const negative = value.startsWith("-");
  const [int, dec = ""] = value.replace("-", "").split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = dec.replace(/0+$/, "");
  const unit = currency === "TND" ? "د.ت" : currency;
  return `${negative ? "-" : ""}${grouped}${fraction ? `.${dec.padEnd(3, "0").slice(0, 3)}` : ""} ${unit}`;
}

const toMillimes = (v: string) => {
  const negative = v.startsWith("-");
  const [int, dec = ""] = v.replace("-", "").split(".");
  const m = BigInt(int || "0") * 1000n + BigInt((dec + "000").slice(0, 3));
  return negative ? -m : m;
};

/** Exact sum of decimal money strings (integer millimes, no floating point). */
export function sumMoney(values: string[]): string {
  const total = values.reduce((acc, v) => acc + toMillimes(v), 0n);
  const abs = total < 0n ? -total : total;
  return `${total < 0n ? "-" : ""}${abs / 1000n}.${String(abs % 1000n).padStart(3, "0")}`;
}

export const isZeroOrLess = (v: string) => toMillimes(v) <= 0n;

/** Ratio of two decimal strings as a percentage (display only). */
export function percentOf(part: string, whole: string): number {
  const w = Number(whole);
  return w > 0 ? Math.round((Number(part) / w) * 100) : 0;
}

/** "YYYY-MM-DD" for a Date in the browser's calendar (inputs are local dates). */
export function todayISO(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
