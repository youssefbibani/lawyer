import { Prisma } from "@prisma/client";

/**
 * Exact decimal money. Amounts travel as strings ("1500.5" or "1500.500") and are stored as
 * numeric(14,3). Floating point is never used for money.
 */
export const Decimal = Prisma.Decimal;
export type Decimal = Prisma.Decimal;

export const MONEY_RE = /^(?:0|[1-9]\d{0,10})(?:\.\d{1,3})?$/;

export function parseMoney(value: string): Decimal {
  return new Decimal(value);
}

export function money(value: Decimal | number | string | null | undefined): string {
  return new Decimal(value ?? 0).toFixed(3);
}

export function sum(values: (Decimal | string | number)[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(new Decimal(v)), new Decimal(0));
}

export const CURRENCY_RE = /^[A-Z]{3}$/;

/** VAT rates in force in Tunisia (percent). Lawyer fees: 19. */
export const VAT_RATES = [0, 7, 13, 19] as const;

/** Total due including VAT: HT × (1 + rate/100), rounded to the millime. */
export function withVat(ht: Decimal | string, rate: Decimal | string | number): Decimal {
  return new Decimal(ht).times(new Decimal(100).plus(rate)).dividedBy(100).toDecimalPlaces(3, Decimal.ROUND_HALF_UP);
}

/** Splits an amount that includes VAT into its HT and VAT parts (millimes; HT + VAT = amount exactly). */
export function splitVat(ttc: Decimal | string, rate: Decimal | string | number): { ht: Decimal; vat: Decimal } {
  const total = new Decimal(ttc);
  const ht = total.times(100).dividedBy(new Decimal(100).plus(rate)).toDecimalPlaces(3, Decimal.ROUND_HALF_UP);
  return { ht, vat: total.minus(ht) };
}
