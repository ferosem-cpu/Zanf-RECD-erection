import { Prisma } from "@prisma/client";
import { PAYMENT_METHOD } from "@recd/shared";

/**
 * Splits a PaymentReceived into cash and TDS - the ONE place this rule lives. Two shapes
 * exist in the data:
 * - current: cash in `amount`, TDS withheld in `tdsAmount` (any real method);
 * - legacy method "tds" (PAYMENT_METHOD.TDS, "TDS Deducted" on the Payments page): the whole
 *   `amount` IS TDS and tdsAmount is normally 0. Such a row is TDS only, never cash.
 * Anything that sums only tdsAmount (TDS register, ledger TDS lines, agent totals) misses the
 * legacy rows, and anything that sums `amount` as cash counts them as money received.
 *
 * Note this is NOT the base for invoice settlement: allocations are always carved out of
 * `amount` (for either shape), with tdsAmount added pro-rata - see services/settlement.ts.
 */

/** Stored method key: trimmed + lowercased (the app only ever writes the lowercase PAYMENT_METHOD keys). */
export function normalizePaymentMethod(method: string | null | undefined): string {
  return String(method ?? "").trim().toLowerCase();
}

export function isLegacyTdsPayment(p: { method: string | null | undefined }): boolean {
  return normalizePaymentMethod(p.method) === PAYMENT_METHOD.TDS;
}

type DecimalLike = Prisma.Decimal | string | number | null | undefined;
const D = (n: DecimalLike): Prisma.Decimal =>
  n instanceof Prisma.Decimal ? n : new Prisma.Decimal(String(n ?? 0));

/** Decimal split for ledgers/reports. A legacy row that somehow also has tdsAmount set: both are TDS. */
export function splitPayment(p: { amount: DecimalLike; tdsAmount: DecimalLike; method: string | null | undefined }): {
  cash: Prisma.Decimal;
  tds: Prisma.Decimal;
} {
  const amount = D(p.amount);
  const tdsField = D(p.tdsAmount);
  return isLegacyTdsPayment(p)
    ? { cash: new Prisma.Decimal(0), tds: amount.plus(tdsField) }
    : { cash: amount, tds: tdsField };
}

/** Number form of splitPayment for the agent tools (null amounts count as 0). */
export function paymentCashAndTds(p: { amount: number | null; tdsAmount: number | null; method: string }): { cash: number; tds: number } {
  const { cash, tds } = splitPayment(p);
  return { cash: cash.toNumber(), tds: tds.toNumber() };
}

/** Prisma filter for "payments that carry any TDS" - current-form rows and legacy TDS-method rows. */
export const PAYMENT_HAS_TDS_WHERE: Prisma.PaymentReceivedWhereInput = {
  OR: [{ tdsAmount: { gt: 0 } }, { method: { equals: PAYMENT_METHOD.TDS, mode: "insensitive" } }],
};
