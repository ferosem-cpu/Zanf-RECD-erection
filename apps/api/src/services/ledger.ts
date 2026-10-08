import { Prisma } from "@prisma/client";
import { INVOICE_STATUS, BILL_STATUS, CREDIT_NOTE_STATUS } from "@recd/shared";
import { prisma } from "../lib/prisma";
import { isLegacyTdsPayment, splitPayment } from "./paymentSplit";
import { PAYABLE_BILL_STATUSES } from "./payables";

const D = (n: number | string | Prisma.Decimal): Prisma.Decimal =>
  n instanceof Prisma.Decimal ? n : new Prisma.Decimal(String(n));
const ZERO = new Prisma.Decimal(0);

export type LedgerEntryType = "opening_balance" | "invoice" | "payment" | "tds" | "credit_note" | "bill" | "payment_made";

export interface LedgerEntry {
  /** null only for an undated opening-balance row on an account with no movements. */
  date: Date | null;
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

export interface RawMovement {
  date: Date;
  type: LedgerEntryType;
  refNumber: string;
  refId: string | null;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
}

type LedgerEntryInput = Omit<LedgerEntry, "runningBalance">;

/** An undated (opening-balance) row sorts before everything. */
function sortTime(e: { date: Date | null }): number {
  return e.date ? e.date.getTime() : Number.NEGATIVE_INFINITY;
}

/**
 * Pure query composition, no new tables (see docs/ACCOUNTING_LITE_PLAN.md par.5.2). Merges the
 * account's opening balance with every dated movement, computes a running balance across the
 * FULL history (so the balance math is correct regardless of the requested range), then slices
 * the entries down to [from, to] for display. Debit = party owes us more; credit = they owe
 * less (or we owe them, once the balance goes negative).
 */
export function buildStatement(
  partyId: string,
  partyName: string,
  openingBalance: Prisma.Decimal,
  openingBalanceDate: Date | null,
  movements: RawMovement[],
  from?: Date,
  to?: Date,
): LedgerStatement {
  // An undated opening balance sorts before everything (so it is always carried into a range);
  // only for display is it dated at the first movement - never the 1970 epoch.
  const openingRow: LedgerEntryInput = {
    date: openingBalanceDate,
    type: "opening_balance",
    refNumber: "Opening balance",
    refId: null,
    debit: openingBalance.gte(0) ? openingBalance : ZERO,
    credit: openingBalance.lt(0) ? openingBalance.negated() : ZERO,
  };
  const all: LedgerEntryInput[] = [openingRow, ...movements].sort((a, b) => sortTime(a) - sortTime(b));

  let running = ZERO;
  const withRunning: LedgerEntry[] = all.map((m) => {
    running = running.plus(m.debit).minus(m.credit);
    return { ...m, runningBalance: running };
  });

  // Balance carried into the range: the running balance as of the last entry strictly before `from`.
  let rangeOpening = ZERO;
  if (from) {
    for (const e of withRunning) {
      if (sortTime(e) < from.getTime()) rangeOpening = e.runningBalance;
      else break;
    }
  }

  // Balance as of `to` (or "now"/full history if unset): the running balance of the last entry
  // at or before `to`.
  let closingBalance = ZERO;
  for (const e of withRunning) {
    if (to && sortTime(e) > to.getTime()) break;
    closingBalance = e.runningBalance;
  }

  const firstMovementDate = withRunning.find((e) => e.type !== "opening_balance")?.date ?? null;
  const entries = withRunning
    .filter((e) => {
      if (e.type === "opening_balance") return !from; // only show the real row when viewing full history
      if (from && sortTime(e) < from.getTime()) return false;
      if (to && sortTime(e) > to.getTime()) return false;
      return true;
    })
    .map((e) => (e.type === "opening_balance" && !e.date ? { ...e, date: firstMovementDate } : e));

  return {
    partyId,
    partyName,
    openingBalance: from ? rangeOpening : ZERO,
    entries,
    closingBalance,
  };
}

export interface LedgerPayment {
  id: string;
  amount: Prisma.Decimal | string | number;
  tdsAmount: Prisma.Decimal | string | number;
  method: string;
  receivedDate: Date;
  invoice: { invoiceNumber: string } | null;
  allocations: { invoice: { invoiceNumber: string } }[];
}

/** Best-effort human label for a payment's ref column: the legacy single invoice, the
 * allocated invoice(s), or a generic label for an unallocated advance. */
function paymentRefLabel(p: LedgerPayment): string {
  if (p.invoice) return p.invoice.invoiceNumber;
  if (p.allocations.length === 1) return p.allocations[0].invoice.invoiceNumber;
  if (p.allocations.length > 1) return p.allocations.map((a) => a.invoice.invoiceNumber).join(", ");
  return "Advance";
}

/** Credit movements for received payments, split by paymentSplit: a "payment" line for the
 * cash and a "tds" line for the TDS. A legacy "TDS Deducted" row is all TDS, so it appears
 * once, as a tds line - never also as cash. Total credit per payment = amount + tdsAmount. */
export function customerPaymentMovements(payments: LedgerPayment[]): RawMovement[] {
  return payments.flatMap((p) => {
    const { cash, tds } = splitPayment(p);
    const label = paymentRefLabel(p);
    const out: RawMovement[] = [];
    if (!isLegacyTdsPayment(p)) {
      out.push({ date: p.receivedDate, type: "payment", refNumber: label, refId: p.id, debit: ZERO, credit: cash });
    }
    if (tds.gt(ZERO)) {
      out.push({ date: p.receivedDate, type: "tds", refNumber: `TDS - ${label}`, refId: p.id, debit: ZERO, credit: tds });
    }
    return out;
  });
}

/** Issued docs only (never drafts/cancelled) - an unissued or cancelled invoice isn't a real debt. */
const INVOICE_LEDGER_STATUSES = [INVOICE_STATUS.ISSUED, INVOICE_STATUS.PARTIALLY_PAID, INVOICE_STATUS.PAID];
/** Must match payables (services/payables.ts): a bill is a liability from Verified on. Paid bills
 * stay too - their payments are in the ledger, so dropping the bill would leave a false advance.
 * Uploaded (unverified), rejected, cancelled and deleted bills never post. */
export const BILL_LEDGER_STATUSES: string[] = [...PAYABLE_BILL_STATUSES, BILL_STATUS.PAID];

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
  // advance, or split across several invoices via PaymentAllocation; see ACCOUNTING_LITE_PLAN Â§5.2).
  const payments = await prisma.paymentReceived.findMany({
    where: { customerId },
    select: {
      id: true,
      amount: true,
      tdsAmount: true,
      method: true,
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

  const movements: RawMovement[] = [
    ...invoices.map((inv): RawMovement => ({
      date: inv.issueDate,
      type: "invoice",
      refNumber: inv.invoiceNumber,
      refId: inv.id,
      debit: D(inv.total),
      credit: ZERO,
    })),
    ...customerPaymentMovements(payments),
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
