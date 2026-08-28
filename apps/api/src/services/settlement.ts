import { Prisma } from "@prisma/client";
import { INVOICE_STATUS, CREDIT_NOTE_STATUS } from "@recd/shared";

const D = (n: number | string | Prisma.Decimal): Prisma.Decimal =>
  n instanceof Prisma.Decimal ? n : new Prisma.Decimal(String(n));
const ZERO = new Prisma.Decimal(0);

/**
 * Single source of truth for invoice status/outstanding math (docs/ACCOUNTING_LITE_PLAN.md
 * §5.1-§5.3). Moved here from routes/invoices.ts in Phase C so both invoices.ts and the new
 * payments.ts (and credit-notes.ts) share one implementation - previously each computed
 * "paid so far" as a raw sum of a payment's own `amount`, which stopped being correct once a
 * payment could be split across several invoices via PaymentAllocation, or carry TDS.
 */

// Invoice status/outstanding math is always computed against the NET total - the invoice's
// own total minus any ISSUED credit notes against it (draft/cancelled CNs have no effect,
// same convention as Invoice's own draft/cancelled states). This is the one extension point
// Phase A's ledger.ts already anticipated; nothing here changes what's stored on Invoice
// itself (total/status stay the gross document total + payment-derived status) - callers
// that need the net figure compute it via netInvoiceTotal() below rather than mutating total.
export async function issuedCreditNoteTotal(tx: Prisma.TransactionClient, invoiceId: string): Promise<Prisma.Decimal> {
  const notes = await tx.creditNote.findMany({
    where: { invoiceId, status: CREDIT_NOTE_STATUS.ISSUED },
    select: { total: true },
  });
  return notes.reduce((s, n) => s.plus(n.total), ZERO);
}

export function netInvoiceTotal(total: Prisma.Decimal, creditNoteTotal: Prisma.Decimal): Prisma.Decimal {
  const net = total.minus(creditNoteTotal);
  return net.isNegative() ? ZERO : net;
}

export function deriveInvoiceStatus(total: Prisma.Decimal, paid: Prisma.Decimal): string {
  if (total.isZero()) return INVOICE_STATUS.PAID;
  if (paid.isZero()) return INVOICE_STATUS.ISSUED;
  if (paid.greaterThanOrEqualTo(total)) return INVOICE_STATUS.PAID;
  return INVOICE_STATUS.PARTIALLY_PAID;
}

export type AllocationForSettlement = { amount: Prisma.Decimal | string; payment: { amount: Prisma.Decimal | string; tdsAmount: Prisma.Decimal | string } };

/**
 * How much of an invoice's value has actually been settled given an already-fetched list of
 * its allocations: the cash allocated, plus each allocating payment's TDS pro-rated by that
 * allocation's share of the payment's cash amount. (A payment's tdsAmount is never itself
 * allocated to an invoice - see paymentReceivedCreateSchema's refinements in @recd/shared -
 * so it has to be derived here.) Exported so routes that already need to list/join
 * allocations for other reasons (invoices.ts, financeDashboard.ts) can compute the same
 * settled figure without a second round-trip via settledAmountForInvoice below.
 */
export function settledFromAllocations(allocations: AllocationForSettlement[]): Prisma.Decimal {
  return allocations.reduce((sum, a) => {
    const allocAmount = D(a.amount);
    const paymentAmount = D(a.payment.amount);
    const tdsAmount = D(a.payment.tdsAmount);
    const tdsShare = paymentAmount.isZero() ? ZERO : tdsAmount.times(allocAmount).dividedBy(paymentAmount);
    return sum.plus(allocAmount).plus(tdsShare);
  }, ZERO);
}

/**
 * How much of an invoice's value has actually been settled - fetches the invoice's own
 * allocations first. Prefer settledFromAllocations directly when the caller already has
 * (or needs, for display) the allocation rows loaded.
 */
export async function settledAmountForInvoice(tx: Prisma.TransactionClient, invoiceId: string): Promise<Prisma.Decimal> {
  const allocations = await tx.paymentAllocation.findMany({
    where: { invoiceId },
    select: { amount: true, payment: { select: { amount: true, tdsAmount: true } } },
  });
  return settledFromAllocations(allocations);
}

export interface InvoiceSettlement {
  netTotal: Prisma.Decimal;
  settled: Prisma.Decimal;
  outstanding: Prisma.Decimal;
  status: string;
}

/**
 * Recomputes and persists one invoice's status from scratch (net total, cash+TDS settled,
 * outstanding) - the one place this math happens. Call after every payment create/update/
 * delete, allocation change, and credit note issue/cancel that touches this invoice. A
 * cancelled invoice is left alone (its status is a terminal dead end, never recomputed).
 */
export async function recomputeInvoiceSettlement(tx: Prisma.TransactionClient, invoiceId: string): Promise<InvoiceSettlement> {
  const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { total: true, status: true } });

  const [cnTotal, settled] = await Promise.all([
    issuedCreditNoteTotal(tx, invoiceId),
    settledAmountForInvoice(tx, invoiceId),
  ]);
  const netTotal = netInvoiceTotal(D(invoice.total), cnTotal);
  const outstanding = netTotal.minus(settled);

  if (invoice.status === INVOICE_STATUS.CANCELLED || invoice.status === INVOICE_STATUS.DRAFT) {
    return { netTotal, settled, outstanding, status: invoice.status };
  }

  const status = deriveInvoiceStatus(netTotal, settled);
  if (status !== invoice.status) {
    await tx.invoice.update({ where: { id: invoiceId }, data: { status } });
  }
  return { netTotal, settled, outstanding, status };
}
