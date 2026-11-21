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

const fromMillimes = (m: bigint) => `${m < 0n ? "-" : ""}${(m < 0n ? -m : m) / 1000n}.${String((m < 0n ? -m : m) % 1000n).padStart(3, "0")}`;

/** Tunisian VAT on lawyer fees (percent). */
export const DEFAULT_VAT_RATE = 19;

/** HT → TTC preview, rounded half-up to the millime (same rule as the server). */
export function previewWithVat(ht: string, rate: number): { vat: string; total: string } {
  const h = toMillimes(ht);
  const total = (h * BigInt(100 + rate) + 50n) / 100n;
  return { vat: fromMillimes(total - h), total: fromMillimes(total) };
}

/** Splits an amount that includes VAT into HT and VAT (millimes; the parts add up exactly). */
export function previewSplitVat(ttc: string, rate: number): { ht: string; vat: string } {
  const t = toMillimes(ttc);
  const d = BigInt(100 + rate);
  const ht = (t * 200n + d) / (2n * d);
  return { ht: fromMillimes(ht), vat: fromMillimes(t - ht) };
}

/** Half of an amount, rounded half-up to the millime. */
export const halfOf = (amount: string) => fromMillimes((toMillimes(amount) + 1n) / 2n);

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
