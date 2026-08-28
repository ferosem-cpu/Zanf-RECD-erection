import { Prisma } from "@prisma/client";
import { INVOICE_STATUS, BILL_STATUS, CREDIT_NOTE_STATUS } from "@recd/shared";
import { prisma } from "../lib/prisma";

const D = (n: number | string | Prisma.Decimal): Prisma.Decimal =>
  n instanceof Prisma.Decimal ? n : new Prisma.Decimal(String(n));
const ZERO = new Prisma.Decimal(0);

export type LedgerEntryType = "opening_balance" | "invoice" | "payment" | "tds" | "credit_note" | "bill" | "payment_made";

export interface LedgerEntry {
  date: Date;
  type: LedgerEntryType;
  refNumber: string;
  refId: string | null;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
  runningBalance: Prisma.Decimal;
}

export interface LedgerStatement {
  partyId: string;
  partyName: string;
  /** Balance carried into the start of the requested range (0 if no `from` given, since the
   * true account-opening-balance row is included as its own entry in that case). */
  openingBalance: Prisma.Decimal;
  entries: LedgerEntry[];
  closingBalance: Prisma.Decimal;
}

interface RawMovement {
  date: Date;
  type: LedgerEntryType;
  refNumber: string;
  refId: string | null;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
}

/**
 * Pure query composition, no new tables (see docs/ACCOUNTING_LITE_PLAN.md par.5.2). Merges the
 * account's opening balance with every dated movement, computes a running balance across the
 * FULL history (so the balance math is correct regardless of the requested range), then slices
 * the entries down to [from, to] for display. Debit = party owes us more; credit = they owe
 * less (or we owe them, once the balance goes negative).
 */
function buildStatement(
  partyId: string,
  partyName: string,
  openingBalance: Prisma.Decimal,
  openingBalanceDate: Date | null,
  movements: RawMovement[],
  from?: Date,
  to?: Date,
): LedgerStatement {
  const openingRow: RawMovement = {
    date: openingBalanceDate ?? new Date(0),
    type: "opening_balance",
    refNumber: "Opening balance",
    refId: null,
    debit: openingBalance.gte(0) ? openingBalance : ZERO,
    credit: openingBalance.lt(0) ? openingBalance.negated() : ZERO,
  };
  const all: RawMovement[] = [openingRow, ...movements].sort((a, b) => a.date.getTime() - b.date.getTime());

  let running = ZERO;
  const withRunning: LedgerEntry[] = all.map((m) => {
    running = running.plus(m.debit).minus(m.credit);
    return { ...m, runningBalance: running };
  });

  // Balance carried into the range: the running balance as of the last entry strictly before `from`.
  let rangeOpening = ZERO;
  if (from) {
    for (const e of withRunning) {
      if (e.date.getTime() < from.getTime()) rangeOpening = e.runningBalance;
      else break;
    }
  }

  // Balance as of `to` (or "now"/full history if unset): the running balance of the last entry
  // at or before `to`.
  let closingBalance = ZERO;
  for (const e of withRunning) {
    if (to && e.date.getTime() > to.getTime()) break;
    closingBalance = e.runningBalance;
  }

  const entries = withRunning.filter((e) => {
    if (e.type === "opening_balance") return !from; // only show the real row when viewing full history
    if (from && e.date.getTime() < from.getTime()) return false;
    if (to && e.date.getTime() > to.getTime()) return false;
    return true;
  });

  return {
    partyId,
    partyName,
    openingBalance: from ? rangeOpening : ZERO,
    entries,
    closingBalance,
  };
}

/** Issued docs only (never drafts/cancelled) - an unissued or cancelled invoice isn't a real debt. */
const INVOICE_LEDGER_STATUSES = [INVOICE_STATUS.ISSUED, INVOICE_STATUS.PARTIALLY_PAID, INVOICE_STATUS.PAID];
/** Bills not yet approved aren't a confirmed liability; rejected/cancelled ones never were. */
const BILL_LEDGER_STATUSES = [BILL_STATUS.APPROVED, BILL_STATUS.PARTIALLY_PAID, BILL_STATUS.PAID];

export async function buildCustomerLedger(customerId: string, from?: Date, to?: Date): Promise<LedgerStatement> {
  const customer = await prisma.customer.findUniqueOrThrow({
    where: { id: customerId },
    select: { id: true, name: true, openingBalance: true, openingBalanceDate: true },
  });

  const invoices = await prisma.invoice.findMany({
    where: { customerId, status: { in: INVOICE_LEDGER_STATUSES } },
    select: { id: true, invoiceNumber: true, issueDate: true, total: true },
  });
  // Direct customerId query - invoiceId/invoice is now optional (payment may be an unallocated
  // advance, or split across several invoices via PaymentAllocation; see ACCOUNTING_LITE_PLAN §5.2).
  const payments = await prisma.paymentReceived.findMany({
    where: { customerId },
    select: {
      id: true,
      amount: true,
      tdsAmount: true,
      receivedDate: true,
      invoice: { select: { invoiceNumber: true } },
      allocations: { select: { invoice: { select: { invoiceNumber: true } } } },
    },
  });
  // Issued credit notes reduce what the customer owes - a credit movement, same direction
  // as a payment. Draft/cancelled notes have no accounting effect (see credit-notes.ts).
  const creditNotes = await prisma.creditNote.findMany({
    where: { customerId, status: CREDIT_NOTE_STATUS.ISSUED },
    select: { id: true, noteNumber: true, issueDate: true, total: true },
  });

  /** Best-effort human label for a payment's ref column: the legacy single invoice, the
   * allocated invoice(s), or a generic label for an unallocated advance. */
  const paymentRefLabel = (p: (typeof payments)[number]): string => {
    if (p.invoice) return p.invoice.invoiceNumber;
    if (p.allocations.length === 1) return p.allocations[0].invoice.invoiceNumber;
    if (p.allocations.length > 1) return p.allocations.map((a) => a.invoice.invoiceNumber).join(", ");
    return "Advance";
  };

  const movements: RawMovement[] = [
    ...invoices.map((inv): RawMovement => ({
      date: inv.issueDate,
      type: "invoice",
      refNumber: inv.invoiceNumber,
      refId: inv.id,
      debit: D(inv.total),
      credit: ZERO,
    })),
    ...payments.map((p): RawMovement => ({
      date: p.receivedDate,
      type: "payment",
      refNumber: paymentRefLabel(p),
      refId: p.id,
      debit: ZERO,
      credit: D(p.amount),
    })),
    ...payments
      .filter((p) => D(p.tdsAmount).gt(ZERO))
      .map((p): RawMovement => ({
        date: p.receivedDate,
        type: "tds",
        refNumber: `TDS - ${paymentRefLabel(p)}`,
        refId: p.id,
        debit: ZERO,
        credit: D(p.tdsAmount),
      })),
    ...creditNotes.map((cn): RawMovement => ({
      date: cn.issueDate,
      type: "credit_note",
      refNumber: cn.noteNumber,
      refId: cn.id,
      debit: ZERO,
      credit: D(cn.total),
    })),
  ];

  return buildStatement(customer.id, customer.name, D(customer.openingBalance), customer.openingBalanceDate, movements, from, to);
}

/**
 * Supplier side mirrors the customer ledger from Bills + PaymentMade. Purchase Orders are
 * NOT ledger entries - a PO is a commitment, not a liability, until a Bill actually arrives.
 */
export async function buildSupplierLedger(supplierId: string, from?: Date, to?: Date): Promise<LedgerStatement> {
  const supplier = await prisma.supplier.findUniqueOrThrow({
    where: { id: supplierId },
    select: { id: true, name: true, openingBalance: true, openingBalanceDate: true },
  });

  const bills = await prisma.bill.findMany({
    where: { supplierId, status: { in: BILL_LEDGER_STATUSES } },
    select: { id: true, billNumber: true, billDate: true, total: true },
  });
  const payments = await prisma.paymentMade.findMany({
    where: { supplierId },
    select: { id: true, amount: true, paidDate: true, bill: { select: { billNumber: true } } },
  });

  const movements: RawMovement[] = [
    ...bills.map((b): RawMovement => ({
      date: b.billDate,
      type: "bill",
      refNumber: b.billNumber,
      refId: b.id,
      debit: D(b.total),
      credit: ZERO,
    })),
    ...payments.map((p): RawMovement => ({
      date: p.paidDate,
      type: "payment_made",
      refNumber: p.bill?.billNumber ?? "Payment / advance",
      refId: p.id,
      debit: ZERO,
      credit: D(p.amount),
    })),
  ];

  return buildStatement(supplier.id, supplier.name, D(supplier.openingBalance), supplier.openingBalanceDate, movements, from, to);
}
