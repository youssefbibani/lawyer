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
