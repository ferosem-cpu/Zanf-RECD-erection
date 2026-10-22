import { Prisma } from "@prisma/client";

/**
 * Vendor payment TDS - the ONE place the rule lives (vendor-side mirror of paymentSplit.ts /
 * settlement.ts for customer receipts).
 *
 * Bills never carry TDS themselves: Bill.total is the supplier's invoice value incl. GST. TDS
 * is recorded only on the PaymentMade that pays the bill: `amount` = cash sent to the supplier,
 * `tdsAmount` = tax we withheld from them and remit to the government. Both settle the bill:
 *   settled(bill) = sum over its payments of (amount + tdsAmount)
 *   balance(bill) = total - settled
 * So each rupee is counted once: as cash (supplier ledger "payment_made" line) or as TDS
 * (supplier ledger "tds" line + the TDS register's "deducted by us" section), never both.
 * An advance (billId null) can carry no TDS - TDS is tied to the bill it is deducted from.
 */

type DecimalLike = Prisma.Decimal | string | number | null | undefined;
const D = (n: DecimalLike): Prisma.Decimal =>
  n instanceof Prisma.Decimal ? n : new Prisma.Decimal(String(n ?? 0));
const ZERO = new Prisma.Decimal(0);
/** Rounding slack used throughout the bill payment routes. */
const EPS = new Prisma.Decimal("0.01");

export interface VendorPaymentLike {
  amount: DecimalLike;
  tdsAmount?: DecimalLike;
}

/** Cash + TDS this one payment settles. A null tdsAmount (pre-migration row) counts as 0. */
export function vendorPaymentSettles(p: VendorPaymentLike): Prisma.Decimal {
  return D(p.amount).plus(D(p.tdsAmount));
}

/** Totals over a bill's payments: cash paid, TDS deducted, and what they settle together. */
export function billPaymentTotals(payments: VendorPaymentLike[]): { cash: Prisma.Decimal; tds: Prisma.Decimal; settled: Prisma.Decimal } {
  const cash = payments.reduce((s, p) => s.plus(D(p.amount)), ZERO);
  const tds = payments.reduce((s, p) => s.plus(D(p.tdsAmount)), ZERO);
  return { cash, tds, settled: cash.plus(tds) };
}

export function billBalance(total: DecimalLike, payments: VendorPaymentLike[]): Prisma.Decimal {
  return D(total).minus(billPaymentTotals(payments).settled);
}

export type VendorPaymentPlan =
  | { ok: true; appliedCash: Prisma.Decimal; tds: Prisma.Decimal; advanceCash: Prisma.Decimal }
  | { ok: false; error: string };

/**
 * Splits a new payment (cash + TDS) against a bill's outstanding balance, for the general
 * POST /bills/payments route. TDS is applied to the bill in full and must fit in the
 * outstanding balance; cash covers the rest, and any cash beyond that becomes a separate
 * supplier advance (which carries no TDS). With no bill, all cash is an advance and TDS must be 0.
 * When `allowAdvance` is false (POST /bills/:id/payments) any excess is an error instead.
 */
export function planVendorPayment(input: {
  outstanding: DecimalLike | null;
  cash: DecimalLike;
  tds?: DecimalLike;
  allowAdvance?: boolean;
}): VendorPaymentPlan {
  const cash = D(input.cash);
  const tds = D(input.tds);
  const allowAdvance = input.allowAdvance ?? true;
  if (cash.isNegative() || tds.isNegative()) return { ok: false, error: "Amounts cannot be negative" };
  if (input.outstanding == null) {
    if (tds.greaterThan(0)) return { ok: false, error: "TDS must be tied to a bill - an advance carries no TDS" };
    return { ok: true, appliedCash: ZERO, tds: ZERO, advanceCash: cash };
  }
  const outstanding = Prisma.Decimal.max(D(input.outstanding), ZERO);
  if (tds.greaterThan(outstanding.plus(EPS))) {
    return { ok: false, error: `TDS (Rs ${tds.toFixed(2)}) exceeds the bill's outstanding balance (Rs ${outstanding.toFixed(2)})` };
  }
  const cashRoom = Prisma.Decimal.max(outstanding.minus(tds), ZERO);
  const appliedCash = Prisma.Decimal.min(cash, cashRoom);
  const advanceCash = cash.minus(appliedCash);
  if (!allowAdvance && advanceCash.greaterThan(EPS)) {
    return { ok: false, error: "Payment plus TDS exceeds the outstanding balance" };
  }
  return { ok: true, appliedCash, tds, advanceCash: advanceCash.greaterThan(EPS) ? advanceCash : ZERO };
}

/**
 * Validates an edit of an existing payment's TDS (PATCH /bills/payments/:id). `otherSettled` is
 * what the bill's other payments settle. Returns the error message, or null when the new TDS fits.
 */
export function vendorTdsEditError(input: {
  billTotal: DecimalLike | null;
  otherSettled: DecimalLike;
  cash: DecimalLike;
  newTds: DecimalLike;
}): string | null {
  const newTds = D(input.newTds);
  if (newTds.isNegative()) return "TDS cannot be negative";
  if (input.billTotal == null) return newTds.greaterThan(0) ? "TDS must be tied to a bill - an advance carries no TDS" : null;
  const settled = D(input.otherSettled).plus(D(input.cash)).plus(newTds);
  if (settled.greaterThan(D(input.billTotal).plus(EPS))) {
    return `Cash plus TDS would settle Rs ${settled.toFixed(2)}, more than the bill total (Rs ${D(input.billTotal).toFixed(2)})`;
  }
  return null;
}
