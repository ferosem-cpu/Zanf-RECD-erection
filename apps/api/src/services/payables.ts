import { BILL_STATUS } from "@recd/shared";
import { documentAgeing, emptyAgeing } from "./ageing";

/**
 * The ONE definition of "payable" (what we owe suppliers), shared by the Finance dashboard
 * (Outstanding payables KPI + Payables ageing report) and the agent's get_payables /
 * search_vendor_bills tools. A vendor invoice is a payable once it is verified, approved or
 * partially paid, until it is fully paid. Uploaded bills are not yet checked; rejected,
 * cancelled and deleted bills never were a liability; paid bills are settled.
 * (Until 2026-10 the dashboard only counted approved + partially_paid, so verified bills -
 * e.g. three unpaid Platino bills - were missing from "Outstanding payables".)
 * Outstanding = bill total (incl. GST) - vendor payments recorded against the bill. Vendor
 * payments carry no TDS field, so nothing else is deducted.
 */
export const PAYABLE_BILL_STATUSES: string[] = [BILL_STATUS.VERIFIED, BILL_STATUS.APPROVED, BILL_STATUS.PARTIALLY_PAID];
export const AWAITING_VERIFICATION_BILL_STATUSES: string[] = [BILL_STATUS.UPLOADED];
/** Bills that are dead ends - never counted anywhere as purchases. */
export const DEAD_BILL_STATUSES: string[] = [BILL_STATUS.REJECTED, BILL_STATUS.CANCELLED, BILL_STATUS.DELETED];

type Num = number | string | { toString(): string } | null | undefined;
const n = (v: Num): number => (v == null ? 0 : Number(v.toString()));
const money = (values: number[]): number => values.reduce((p, v) => p + Math.round(v * 100), 0) / 100;

export function isPayableStatus(status: string): boolean {
  return PAYABLE_BILL_STATUSES.includes(status);
}

export function billOutstanding(total: Num, payments: { amount: Num }[]): number {
  return money([n(total), ...payments.map((p) => -n(p.amount))]);
}

export interface PayableBillRow {
  id: string;
  billNumber: string;
  supplierId: string;
  supplier: string;
  status: string;
  billDate: Date;
  dueDate: Date | null;
  total: number;
  paid: number;
  debitNotes: number;
}

/** Totals, per-vendor, ageing (Finance report buckets) and a most-overdue-first due list over
 * the payable bills passed in. Bills with no balance left drop out. */
export function summarizePayables(bills: PayableBillRow[], now: Date, listLimit = 15) {
  const open = bills
    .filter((b) => isPayableStatus(b.status))
    .map((b) => {
      const outstanding = money([b.total, -b.paid]);
      return { ...b, outstanding, ...documentAgeing(b.dueDate, b.billDate, now) };
    })
    .filter((b) => b.outstanding > 0);

  const ageing = emptyAgeing();
  const vendors = new Map<string, { supplierId: string; supplier: string; billCount: number; outstanding: number; ageing: ReturnType<typeof emptyAgeing> }>();
  for (const b of open) {
    ageing[b.bucket] = money([ageing[b.bucket], b.outstanding]);
    const v = vendors.get(b.supplierId) ?? { supplierId: b.supplierId, supplier: b.supplier, billCount: 0, outstanding: 0, ageing: emptyAgeing() };
    v.billCount += 1;
    v.outstanding = money([v.outstanding, b.outstanding]);
    v.ageing[b.bucket] = money([v.ageing[b.bucket], b.outstanding]);
    vendors.set(b.supplierId, v);
  }
  const byStatus: Record<string, { count: number; outstanding: number }> = {};
  for (const b of open) {
    const s = byStatus[b.status] ?? { count: 0, outstanding: 0 };
    s.count += 1;
    s.outstanding = money([s.outstanding, b.outstanding]);
    byStatus[b.status] = s;
  }
  // Overdue first (most days past due first), then the rest by due date / bill date.
  const due = [...open].sort(
    (a, b) => Number(b.overdue) - Number(a.overdue) || (b.daysPastDue ?? 0) - (a.daysPastDue ?? 0) || (a.dueDate ?? a.billDate).getTime() - (b.dueDate ?? b.billDate).getTime(),
  );
  // Only bills with a due date before today are overdue; no due date is never overdue.
  const overdue = open.filter((b) => b.overdue);
  const noDueDate = open.filter((b) => b.dueStatus === "no_due_date");

  return {
    totalOutstanding: money(open.map((b) => b.outstanding)),
    billCount: open.length,
    vendorCount: vendors.size,
    overdueCount: overdue.length,
    overdueAmount: money(overdue.map((b) => b.outstanding)),
    noDueDateCount: noDueDate.length,
    noDueDateAmount: money(noDueDate.map((b) => b.outstanding)),
    debitNotesAgainstOpenBills: money(open.map((b) => b.debitNotes)),
    byStatus,
    ageing,
    byVendor: [...vendors.values()].sort((a, b) => b.outstanding - a.outstanding || a.supplier.localeCompare(b.supplier)),
    complete: due.length <= listLimit,
    dueList: due.slice(0, listLimit),
  };
}
