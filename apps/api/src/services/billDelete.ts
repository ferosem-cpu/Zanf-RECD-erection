import { BILL_STATUS } from "@recd/shared";

/**
 * Removing a REJECTED vendor invoice so its number can be entered again (e.g. a typo'd bill
 * that was rejected). Bill has a DB unique index on (supplierId, billNumber), and deleting the
 * row would cascade away its BillAuditLog, so instead of a hard delete the bill is archived:
 * status -> "deleted", billNumber renamed to a unique archived form, audit entry added. No
 * schema change is needed and the trail (who/when/why, scan, original number) survives.
 *
 * Financially safe because a rejected bill never reaches the ledger, payables, GSTR-3B ITC or
 * site costs (all filter on verified/approved/partially_paid/paid or a subset), and payments can only be recorded on
 * approved bills. Anything that did post (payments, applied advances, debit notes) blocks it.
 */
export interface BillForDelete {
  status: string;
  billNumber: string;
  paymentCount: number;
  debitNoteCount: number;
}

export function rejectedBillDeleteBlocker(bill: BillForDelete): string | null {
  if (bill.status !== BILL_STATUS.REJECTED) return "Only a rejected vendor invoice can be deleted.";
  if (bill.paymentCount > 0) return "This vendor invoice has payments recorded against it and cannot be deleted.";
  if (bill.debitNoteCount > 0) return "This vendor invoice has debit notes against it and cannot be deleted.";
  return null;
}

/** "TXIN0933/26-27" -> "TXIN0933/26-27 [deleted 2026-10-08 ab12cd34]": unique per bill id, still
 * readable, and never equal to a real number, so the original becomes free again. */
export function archivedBillNumber(billNumber: string, billId: string, when: Date): string {
  return `${billNumber} [deleted ${when.toISOString().slice(0, 10)} ${billId.slice(-8)}]`;
}

/** Message for POST /bills when the number is taken: points at the rejected bill if that's the cause. */
export function duplicateBillNumberMessage(existingStatus: string): string {
  return existingStatus === BILL_STATUS.REJECTED
    ? "A rejected vendor invoice with this number already exists for this supplier. Open it and use 'Delete rejected invoice' to free the number, then add it again."
    : "A bill with this number already exists for this supplier";
}
