/** Read-only finance summary tools for the agent: payables (what we owe suppliers) and revenue
 * for a period. Both return server-computed figures plus the exact basis/period they used, so
 * the model never has to assemble a payable or revenue figure from search rows (2026-10:
 * "pending to pay" was answered from one open PO and missed approved vendor invoices).
 */
import { Prisma } from "@prisma/client";
import { PERMISSION_KEY, BILL_STATUS, PO_STATUS, INVOICE_STATUS, INVOICE_DOC_TYPE, CREDIT_NOTE_STATUS } from "@recd/shared";
import { prisma } from "../../lib/prisma";
import { splitPayment } from "../../services/paymentSplit";
import { settledFromAllocations } from "../../services/settlement";
import { ageingBucket, emptyAgeing } from "../../services/ageing";
import {
  PAYABLE_BILL_STATUSES, AWAITING_VERIFICATION_BILL_STATUSES, DEAD_BILL_STATUSES, isPayableStatus,
  summarizePayables as summarizePayablesShared, type PayableBillRow,
} from "../../services/payables";
import { LIST_LIMIT, listMeta } from "../listResult";
import { exclGstPortion, isoDateIST, istDayStart, sumMoney, normalizeLabel, resolveLookupFilter, validValuesList } from "./zanAppReadTools";
import type { AgentTool, AgentAuthContext } from "./types";

const DAY_MS = 86_400_000;

function forbidden(what: string) {
  return { error: `You don't have permission to view ${what}.` };
}

function hasAny(auth: AgentAuthContext, keys: string[]): boolean {
  return keys.some((k) => auth.permissions.has(k));
}

const money = (d: Prisma.Decimal | number | string | null | undefined): number => (d == null ? 0 : Number(d));

// --- Supplier name matching ---------------------------------------------------

const NAME_ABBREVIATIONS: Record<string, string> = {
  ent: "enterprises", ents: "enterprises", enterprise: "enterprises", entp: "enterprises", entps: "enterprises",
  pvt: "private", ltd: "limited", co: "company", corp: "corporation", inds: "industries", ind: "industries",
  engg: "engineering", eng: "engineering", intl: "international", bros: "brothers", mfg: "manufacturing",
  sys: "systems", tech: "technologies", "&": "and",
};
const NAME_NOISE = new Set(["m", "s", "ms", "the", "and"]);

/** Tokens for tolerant supplier matching: case/punctuation-insensitive, common abbreviations
 * expanded ("Selvam Ent." ~ "SELVAM ENTERPRISES"), "M/s" and "the" dropped. */
export function supplierNameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((t) => NAME_ABBREVIATIONS[t] ?? t)
    .filter((t) => !NAME_NOISE.has(t));
}

/** True when every query token is a prefix of some token of the supplier name (so "selvam",
 * "Selvam Ent", "selvam enterprises" and "SELVAM ENTERPRISES." all match "Selvam Enterprises"). */
export function supplierNameMatches(query: string, name: string): boolean {
  const q = supplierNameTokens(query);
  if (q.length === 0) return true;
  const n = supplierNameTokens(name);
  const joined = n.join("");
  return q.every((t) => n.some((w) => w.startsWith(t))) || joined.includes(q.join(""));
}

// --- Payables -----------------------------------------------------------------

// Payable statuses/outstanding/ageing live in services/payables.ts, shared with the Finance
// dashboard so the agent and the Outstanding payables KPI can never disagree.
export { PAYABLE_BILL_STATUSES, AWAITING_VERIFICATION_BILL_STATUSES, ageingBucket };
export type { PayableBillRow };
/** Open POs = issued and not yet fully received/closed - commitments, not payables. */
export const OPEN_PO_STATUSES: string[] = [PO_STATUS.ISSUED, PO_STATUS.PARTIALLY_RECEIVED];
/** POs that count as placed orders for the PO-vs-bills comparison (drafts/cancelled don't). */
const PLACED_PO_STATUSES: string[] = [PO_STATUS.ISSUED, PO_STATUS.PARTIALLY_RECEIVED, PO_STATUS.RECEIVED, PO_STATUS.CLOSED];

export const PAYABLES_BASIS =
  "Payables = vendor invoices (bills) in status verified, approved or partially_paid; outstanding = bill total (incl. GST) " +
  "minus vendor payments recorded against the bill - the same shared rule as the Finance dashboard 'Outstanding payables' " +
  "and the Payables ageing report (services/payables.ts). Vendor payments carry no TDS field, so no TDS is deducted; debit " +
  "notes are not netted (shown separately). Uploaded (not yet verified) bills are listed separately; rejected, cancelled, " +
  "deleted and paid bills are excluded. Open purchase orders are commitments, not payables, and are listed separately.";

/** Agent view of the shared payables summary: dates as IST yyyy-mm-dd. */
export function summarizePayables(bills: PayableBillRow[], now: Date, listLimit = LIST_LIMIT) {
  const s = summarizePayablesShared(bills, now, listLimit);
  return {
    ...s,
    dueList: s.dueList.map((b) => ({
      id: b.id, billNumber: b.billNumber, supplier: b.supplier, status: b.status,
      billDate: isoDateIST(b.billDate), dueDate: b.dueDate ? isoDateIST(b.dueDate) : null,
      total: b.total, paid: b.paid, outstanding: b.outstanding, daysPastDue: b.daysPastDue, ageingBucket: b.bucket,
    })),
  };
}

export interface PoVsBillsInput {
  supplierId: string;
  supplier: string;
  pos: { total: number; status: string; billedAgainst: number }[];
  bills: { total: number; paid: number; status: string }[];
}

/** Per vendor: PO value placed vs billed vs paid vs still owed vs open (unbilled) commitment. */
export function poVsBillsByVendor(rows: PoVsBillsInput[]) {
  return rows
    .map((r) => ({
      supplierId: r.supplierId,
      supplier: r.supplier,
      poCount: r.pos.length,
      poValue: sumMoney(r.pos.map((p) => p.total)),
      billCount: r.bills.length,
      billedTotal: sumMoney(r.bills.map((b) => b.total)),
      paidTotal: sumMoney(r.bills.map((b) => b.paid)),
      billBalance: sumMoney(r.bills.filter((b) => isPayableStatus(b.status)).map((b) => Math.max(sumMoney([b.total, -b.paid]), 0))),
      openPoCommitment: sumMoney(
        r.pos.filter((p) => OPEN_PO_STATUSES.includes(p.status)).map((p) => Math.max(sumMoney([p.total, -p.billedAgainst]), 0)),
      ),
    }))
    .filter((v) => v.poCount > 0 || v.billCount > 0)
    .sort((a, b) => b.billBalance - a.billBalance || b.poValue - a.poValue || a.supplier.localeCompare(b.supplier));
}

/** Resolves a supplier name typed by the user to supplier ids (tolerant matching). */
async function resolveSuppliers(query: string): Promise<{ ids: string[]; names: string[] } | { error: string; suppliers: string[] }> {
  const suppliers = await prisma.supplier.findMany({ select: { id: true, name: true } });
  const matched = suppliers.filter((s) => supplierNameMatches(query, s.name));
  if (matched.length === 0) {
    return {
      error: `No supplier matches "${query}". Check the spelling with search_suppliers before saying nothing is owed.`,
      suppliers: suppliers.map((s) => s.name).sort().slice(0, 50),
    };
  }
  return { ids: matched.map((s) => s.id), names: matched.map((s) => s.name) };
}

const getPayables: AgentTool = {
  name: "get_payables",
  description:
    "What WE OWE suppliers/vendors: 'how much is pending to pay', 'payables', 'to whom do we owe', " +
    "'pending to be paid to vendor X'. Returns server-computed totalOutstanding, billCount, " +
    "overdueCount/overdueAmount, ageing buckets (current, 0-30, 31-60, 61-90, 90+ days past due), byVendor " +
    "(outstanding per supplier), byStatus and a dueList of open vendor invoices (most overdue first), over EVERY " +
    "verified/approved/partially paid vendor invoice - basis states the exact rule (same as the Finance dashboard). " +
    "Also returns, SEPARATELY, awaitingVerification (uploaded bills), poVsBills (per vendor: PO value vs billed vs " +
    "paid vs bill balance vs open PO commitment), openPurchaseOrders (commitments, not payables) and " +
    "unappliedAdvances. Use it for 'to whom?', 'ageing?', 'PO vs bills'. For individual bills by status " +
    "(Rejected, Paid, ...) use search_vendor_bills. Optional supplier filter is tolerant (case, punctuation, " +
    "'Ent.' = 'Enterprises', partial names).",
  inputSchema: {
    type: "object",
    properties: {
      supplier: { type: "string", description: "Optional supplier/vendor name (partial, any case, abbreviations ok)." },
    },
  },
  handler: async (input, auth) => {
    // Mirrors GET /finance/reports/payables (view_finance_dashboard) and GET /bills
    // (record/approve vendor invoice). Never for customers.
    if (auth.customerId) return forbidden("payables");
    if (!hasAny(auth, [PERMISSION_KEY.VIEW_FINANCE_DASHBOARD, PERMISSION_KEY.APPROVE_VENDOR_INVOICE, PERMISSION_KEY.RECORD_VENDOR_INVOICE])) {
      return forbidden("payables");
    }
    const supplierQuery = input.supplier ? String(input.supplier).trim() : "";
    let supplierIds: string[] | undefined;
    let matchedSuppliers: string[] | undefined;
    if (supplierQuery) {
      const resolved = await resolveSuppliers(supplierQuery);
      if ("error" in resolved) return resolved;
      supplierIds = resolved.ids;
      matchedSuppliers = resolved.names;
    }
    const bySupplier = supplierIds ? { supplierId: { in: supplierIds } } : {};
    const now = new Date();

    // Every live (not rejected/cancelled/deleted) bill: payables, awaiting verification and
    // the PO-vs-bills comparison all come from this one set.
    const [liveBills, placedPos, advances] = await Promise.all([
      prisma.bill.findMany({
        where: { ...bySupplier, status: { notIn: DEAD_BILL_STATUSES } },
        include: {
          supplier: { select: { name: true } },
          payments: { select: { amount: true } },
          debitNotes: { select: { amount: true } },
        },
        orderBy: { billDate: "asc" },
      }),
      prisma.purchaseOrder.findMany({
        where: { ...bySupplier, status: { in: PLACED_PO_STATUSES } },
        select: {
          id: true, poNumber: true, status: true, orderDate: true, total: true, supplierId: true, supplier: { select: { name: true } },
          bills: { where: { status: { notIn: DEAD_BILL_STATUSES } }, select: { total: true } },
        },
        orderBy: { orderDate: "asc" },
      }),
      prisma.paymentMade.findMany({
        where: { ...bySupplier, billId: null },
        select: { amount: true, supplierId: true, supplier: { select: { name: true } } },
      }),
    ]);

    const billRows = liveBills.map((b) => ({
      id: b.id, billNumber: b.billNumber, supplierId: b.supplierId, supplier: b.supplier.name, status: b.status,
      billDate: b.billDate, dueDate: b.dueDate, total: money(b.total),
      paid: sumMoney(b.payments.map((p) => money(p.amount))),
      debitNotes: sumMoney(b.debitNotes.map((d) => money(d.amount))),
    }));
    const summary = summarizePayables(billRows, now);
    const awaiting = billRows.filter((b) => AWAITING_VERIFICATION_BILL_STATUSES.includes(b.status));
    const openPos = placedPos.filter((po) => OPEN_PO_STATUSES.includes(po.status));

    const vendorRows = new Map<string, PoVsBillsInput>();
    const vendorRow = (id: string, name: string) => {
      const row = vendorRows.get(id) ?? { supplierId: id, supplier: name, pos: [], bills: [] };
      vendorRows.set(id, row);
      return row;
    };
    for (const po of placedPos) {
      vendorRow(po.supplierId, po.supplier.name).pos.push({ total: money(po.total), status: po.status, billedAgainst: sumMoney(po.bills.map((b) => money(b.total))) });
    }
    for (const b of billRows) vendorRow(b.supplierId, b.supplier).bills.push({ total: b.total, paid: b.paid, status: b.status });

    const advanceBySupplier = new Map<string, { supplier: string; amount: number }>();
    for (const a of advances) {
      const e = advanceBySupplier.get(a.supplierId) ?? { supplier: a.supplier.name, amount: 0 };
      e.amount = sumMoney([e.amount, money(a.amount)]);
      advanceBySupplier.set(a.supplierId, e);
    }
    const poRows = openPos.map((po) => {
      const billed = sumMoney(po.bills.map((b) => money(b.total)));
      return {
        id: po.id, poNumber: po.poNumber, supplier: po.supplier.name, status: po.status, orderDate: isoDateIST(po.orderDate),
        total: money(po.total), billedSoFar: billed, notYetBilled: Math.max(sumMoney([money(po.total), -billed]), 0),
      };
    });

    return {
      asOf: isoDateIST(now),
      basis: PAYABLES_BASIS,
      ...(matchedSuppliers ? { supplierFilter: supplierQuery, matchedSuppliers } : {}),
      ...summary,
      awaitingVerification: {
        note: "Uploaded but not yet verified in Finance > Vendor Invoices - not included in totalOutstanding until verified.",
        count: awaiting.length,
        total: sumMoney(awaiting.map((b) => b.total)),
        bills: awaiting.slice(0, LIST_LIMIT).map((b) => ({
          id: b.id, billNumber: b.billNumber, supplier: b.supplier, status: b.status, billDate: isoDateIST(b.billDate), total: b.total,
        })),
      },
      poVsBills: {
        note: "Per vendor: poValue = issued/received/closed POs; billedTotal/paidTotal = live vendor invoices; billBalance = what is still owed on payable bills; openPoCommitment = issued or partially received PO value not yet billed (a commitment, not a payable).",
        vendors: poVsBillsByVendor([...vendorRows.values()]).slice(0, 30),
      },
      openPurchaseOrders: {
        note: "COMMITMENTS, not payables: issued/partially received POs. A PO becomes payable only when the supplier's invoice is recorded and approved.",
        count: poRows.length,
        total: sumMoney(poRows.map((p) => p.total)),
        notYetBilled: sumMoney(poRows.map((p) => p.notYetBilled)),
        purchaseOrders: poRows.slice(0, LIST_LIMIT),
      },
      unappliedAdvances: {
        note: "Supplier advances paid but not yet applied to a bill (reduce what we will finally pay; not netted above).",
        total: sumMoney([...advanceBySupplier.values()].map((a) => a.amount)),
        bySupplier: [...advanceBySupplier.values()],
      },
    };
  },
};

// --- Vendor bills (read) --------------------------------------------------------

export const BILL_STATUS_OPTIONS = [
  { key: BILL_STATUS.UPLOADED, label: "Uploaded" },
  { key: BILL_STATUS.VERIFIED, label: "Verified" },
  { key: BILL_STATUS.APPROVED, label: "Approved" },
  { key: BILL_STATUS.PARTIALLY_PAID, label: "Partially Paid" },
  { key: BILL_STATUS.PAID, label: "Paid" },
  { key: BILL_STATUS.REJECTED, label: "Rejected" },
  { key: BILL_STATUS.CANCELLED, label: "Cancelled" },
  { key: BILL_STATUS.DELETED, label: "Deleted" },
];
const UNPAID_WORDS = new Set(["unpaid", "outstanding", "open", "due", "pending", "payable", "payables", "not paid"]);

/** Status filter: keys or labels in any case, comma lists, and "unpaid"/"outstanding" = the
 * payable statuses. Unknown values are reported with the valid list. */
export function resolveBillStatusFilter(value: unknown): { statuses?: string[]; unknown: string[] } {
  const raw = Array.isArray(value) ? value.map(String) : value == null ? [] : String(value).split(",");
  const tokens = raw.map((t) => t.trim()).filter(Boolean);
  const statuses: string[] = [];
  const rest: string[] = [];
  for (const t of tokens) {
    if (UNPAID_WORDS.has(normalizeLabel(t))) statuses.push(...PAYABLE_BILL_STATUSES);
    else rest.push(t);
  }
  const resolved = resolveLookupFilter(rest, BILL_STATUS_OPTIONS);
  const all = [...new Set([...statuses, ...resolved.keys])];
  return { statuses: all.length > 0 ? all : undefined, unknown: resolved.unknown };
}

const searchVendorBills: AgentTool = {
  name: "search_vendor_bills",
  description:
    "Search VENDOR INVOICES / supplier bills (what suppliers billed us - Finance > Vendor Invoices). Filters: " +
    "supplier (tolerant: case, punctuation, 'Ent.' = 'Enterprises', partial), status (Uploaded, Verified, Approved, " +
    "Partially Paid, Paid, Rejected, Cancelled, Deleted - keys or labels, any case, comma list; 'unpaid' = verified + " +
    "approved + partially paid), billNumber, overdueOnly. Returns totalCount and totals {count, totalAmount, " +
    "taxableAmount, gstAmount, paid, outstanding} and byStatus over EVERY matching bill, plus up to 15 bills (overdue " +
    "first when overdueOnly, else newest): billNumber, supplier, status, billDate, dueDate, subtotal, taxAmount, total, " +
    "paid, balance, daysOverdue, rejectedReason. Deleted bills only appear when status=deleted.",
  inputSchema: {
    type: "object",
    properties: {
      supplier: { type: "string", description: "Optional supplier/vendor name." },
      status: { type: "string", description: "Optional status filter (see description)." },
      billNumber: { type: "string", description: "Optional bill / vendor invoice number (partial match)." },
      overdueOnly: { type: "boolean", description: "True = only unpaid (verified/approved/partially paid) bills past their due date." },
    },
  },
  handler: async (input, auth) => {
    // Same permissions as GET /bills (record/approve vendor invoice) or the payables report.
    if (auth.customerId) return forbidden("vendor invoices");
    if (!hasAny(auth, [PERMISSION_KEY.VIEW_FINANCE_DASHBOARD, PERMISSION_KEY.APPROVE_VENDOR_INVOICE, PERMISSION_KEY.RECORD_VENDOR_INVOICE])) {
      return forbidden("vendor invoices");
    }
    const filter = resolveBillStatusFilter(input.status);
    if (filter.unknown.length > 0) {
      return {
        error: `Unknown vendor invoice status ${filter.unknown.map((u) => `"${u}"`).join(", ")}. Tell the user the valid statuses instead of saying nothing matched.`,
        validStatuses: validValuesList(BILL_STATUS_OPTIONS),
      };
    }
    let supplierIds: string[] | undefined;
    let matchedSuppliers: string[] | undefined;
    if (input.supplier && String(input.supplier).trim()) {
      const resolved = await resolveSuppliers(String(input.supplier).trim());
      if ("error" in resolved) return resolved;
      supplierIds = resolved.ids;
      matchedSuppliers = resolved.names;
    }
    const overdueOnly = input.overdueOnly === true;
    const now = new Date();
    const statuses = overdueOnly ? (filter.statuses ?? PAYABLE_BILL_STATUSES).filter(isPayableStatus) : filter.statuses;
    const billNumber = input.billNumber ? String(input.billNumber).trim() : "";
    const bills = await prisma.bill.findMany({
      where: {
        status: statuses ? { in: statuses } : { not: BILL_STATUS.DELETED },
        ...(supplierIds ? { supplierId: { in: supplierIds } } : {}),
        ...(billNumber ? { billNumber: { contains: billNumber, mode: "insensitive" } } : {}),
      },
      include: { supplier: { select: { name: true } }, payments: { select: { amount: true } } },
      orderBy: { billDate: "desc" },
    });
    const rows = bills
      .map((b) => {
        const paid = sumMoney(b.payments.map((p) => money(p.amount)));
        const balance = isPayableStatus(b.status) ? Math.max(sumMoney([money(b.total), -paid]), 0) : 0;
        const { daysPastDue } = ageingBucket(b.dueDate ?? b.billDate, now);
        const overdue = isPayableStatus(b.status) && balance > 0 && !!b.dueDate && b.dueDate.getTime() < now.getTime();
        return {
          id: b.id, billNumber: b.billNumber, supplier: b.supplier.name, status: b.status,
          billDate: isoDateIST(b.billDate), dueDate: b.dueDate ? isoDateIST(b.dueDate) : null,
          subtotal: money(b.subtotal), taxAmount: money(b.taxAmount), total: money(b.total), paid, balance,
          overdue, daysOverdue: overdue ? daysPastDue : 0, rejectedReason: b.rejectedReason,
        };
      })
      .filter((r) => !overdueOnly || r.overdue);
    const listed = overdueOnly ? [...rows].sort((a, b) => b.daysOverdue - a.daysOverdue) : rows;
    const byStatus: Record<string, { count: number; totalAmount: number; outstanding: number }> = {};
    for (const r of rows) {
      const s = byStatus[r.status] ?? { count: 0, totalAmount: 0, outstanding: 0 };
      s.count += 1;
      s.totalAmount = sumMoney([s.totalAmount, r.total]);
      s.outstanding = sumMoney([s.outstanding, r.balance]);
      byStatus[r.status] = s;
    }
    return {
      ...listMeta(Math.min(listed.length, LIST_LIMIT), rows.length),
      ...(matchedSuppliers ? { matchedSuppliers } : {}),
      statusFilter: statuses ?? "all except deleted",
      totals: {
        count: rows.length,
        totalAmount: sumMoney(rows.map((r) => r.total)),
        taxableAmount: sumMoney(rows.map((r) => r.subtotal)),
        gstAmount: sumMoney(rows.map((r) => r.taxAmount)),
        paid: sumMoney(rows.map((r) => r.paid)),
        outstanding: sumMoney(rows.map((r) => r.balance)),
      },
      byStatus,
      bills: listed.slice(0, LIST_LIMIT),
    };
  },
};

// --- Receivables --------------------------------------------------------------

export const RECEIVABLES_BASIS =
  "Receivables = invoices in status issued or partially_paid (proforma and tax invoices, exactly like the Finance " +
  "dashboard 'Outstanding receivables' and the Receivables ageing report). Per invoice: outstanding incl. GST = " +
  "invoice total incl. GST - issued credit notes against it (net floored at 0) - settled, where settled = receipts " +
  "allocated to the invoice + each receipt's TDS pro-rata (legacy 'TDS Deducted' receipts settle as TDS) - " +
  "services/settlement.ts, the app's single definition of 'paid'. Outstanding excl. GST = each invoice's outstanding " +
  "x its taxable share (subtotal / total) - the finance pages have no excl.-GST figure, so this apportionment is the " +
  "agent's documented basis; GST portion = incl. - excl. Unapplied customer advances are not netted (same as the " +
  "dashboard; the customer ledger's closing balance does net them). This is an as-of balance, not invoiced or collected " +
  "revenue for a period.";

export interface ReceivableInvoiceRow {
  id: string;
  invoiceNumber: string;
  docType: string;
  customerId: string;
  customer: string;
  issueDate: Date;
  dueDate: Date | null;
  subtotal: number;
  total: number;
  creditNoteTotal: number;
  settled: number;
}

export function summarizeReceivables(rows: ReceivableInvoiceRow[], now: Date, listLimit = LIST_LIMIT) {
  const computed = rows.map((r) => {
    const net = Math.max(sumMoney([r.total, -r.creditNoteTotal]), 0);
    const outstandingInclGst = sumMoney([net, -r.settled]);
    const outstandingExclGst = exclGstPortion(outstandingInclGst, r.subtotal, r.total);
    const { bucket, daysPastDue } = ageingBucket(r.dueDate ?? r.issueDate, now);
    return { ...r, outstandingInclGst, outstandingExclGst, gstPortion: sumMoney([outstandingInclGst, -outstandingExclGst]), bucket, daysPastDue };
  });

  const ageing = emptyAgeing();
  const customers = new Map<string, { customerId: string; customer: string; invoiceCount: number; outstandingInclGst: number; outstandingExclGst: number; gstPortion: number }>();
  for (const r of computed) {
    if (r.outstandingInclGst > 0) ageing[r.bucket] = sumMoney([ageing[r.bucket], r.outstandingInclGst]);
    const c = customers.get(r.customerId) ?? { customerId: r.customerId, customer: r.customer, invoiceCount: 0, outstandingInclGst: 0, outstandingExclGst: 0, gstPortion: 0 };
    c.invoiceCount += 1;
    c.outstandingInclGst = sumMoney([c.outstandingInclGst, r.outstandingInclGst]);
    c.outstandingExclGst = sumMoney([c.outstandingExclGst, r.outstandingExclGst]);
    c.gstPortion = sumMoney([c.gstPortion, r.gstPortion]);
    customers.set(r.customerId, c);
  }
  const byDocType = (docType: string) => {
    const g = computed.filter((r) => r.docType === docType);
    return { count: g.length, outstandingInclGst: sumMoney(g.map((r) => r.outstandingInclGst)), outstandingExclGst: sumMoney(g.map((r) => r.outstandingExclGst)) };
  };
  const overdue = computed.filter((r) => r.daysPastDue > 0 && r.dueDate);
  const listed = [...computed].filter((r) => r.outstandingInclGst > 0).sort((a, b) => b.outstandingInclGst - a.outstandingInclGst);
  // Every overdue invoice with a balance, most overdue first (capped at 50 for the model).
  const overdueList = overdue
    .filter((r) => r.outstandingInclGst > 0)
    .sort((a, b) => b.daysPastDue - a.daysPastDue || b.outstandingInclGst - a.outstandingInclGst);

  return {
    totals: {
      invoiceCount: computed.length,
      outstandingInclGst: sumMoney(computed.map((r) => r.outstandingInclGst)),
      outstandingExclGst: sumMoney(computed.map((r) => r.outstandingExclGst)),
      gstPortion: sumMoney(computed.map((r) => r.gstPortion)),
      overdueCount: overdue.length,
      overdueInclGst: sumMoney(overdue.map((r) => r.outstandingInclGst)),
      overdueExclGst: sumMoney(overdue.map((r) => r.outstandingExclGst)),
    },
    byDocType: { tax_invoice: byDocType(INVOICE_DOC_TYPE.TAX_INVOICE), proforma: byDocType(INVOICE_DOC_TYPE.PROFORMA) },
    ageingInclGst: ageing,
    overdueInvoices: overdueList.slice(0, 50).map((r) => ({
      id: r.id, invoiceNumber: r.invoiceNumber, customer: r.customer,
      dueDate: isoDateIST(r.dueDate!), balanceInclGst: r.outstandingInclGst, balanceExclGst: r.outstandingExclGst, daysOverdue: r.daysPastDue,
    })),
    overdueListComplete: overdueList.length <= 50,
    byCustomer: [...customers.values()]
      .filter((c) => c.outstandingInclGst !== 0)
      .sort((a, b) => b.outstandingInclGst - a.outstandingInclGst || a.customer.localeCompare(b.customer)),
    complete: listed.length <= listLimit,
    invoices: listed.slice(0, listLimit).map((r) => ({
      id: r.id, invoiceNumber: r.invoiceNumber, docType: r.docType, customer: r.customer,
      issueDate: isoDateIST(r.issueDate), dueDate: r.dueDate ? isoDateIST(r.dueDate) : null,
      total: r.total, creditNoteTotal: r.creditNoteTotal, settled: r.settled,
      outstandingInclGst: r.outstandingInclGst, outstandingExclGst: r.outstandingExclGst, daysPastDue: r.daysPastDue,
    })),
  };
}

const getReceivables: AgentTool = {
  name: "get_receivables",
  description:
    "What CUSTOMERS OWE US now: 'total receivable', 'outstanding', 'receivable excluding GST', 'and including " +
    "GST?', 'who owes us most'. Returns an explicit asOf date, basis, and server-computed totals BOTH incl. GST " +
    "and excl. GST (plus the GST portion), overdue figures, byCustomer (incl./excl. GST per customer), byDocType " +
    "(tax invoice vs proforma), ageingInclGst (same buckets as the Finance Receivables ageing report), " +
    "overdueInvoices (every overdue invoice: number, customer, due date, balance incl./excl. GST, days overdue) " +
    "and the largest open invoices. Use it for 'ageing?', 'which are overdue?', 'who owes most?'. Call it again for every receivable follow-up " +
    "question - never reuse a number from an earlier answer.",
  inputSchema: {
    type: "object",
    properties: {
      customer: { type: "string", description: "Optional customer name (partial, any case)." },
    },
  },
  handler: async (input, auth) => {
    // Same permission as the Finance dashboard / Receivables report. Never for customers.
    if (auth.customerId || !hasAny(auth, [PERMISSION_KEY.VIEW_FINANCE_DASHBOARD, PERMISSION_KEY.MANAGE_INVOICES])) {
      return forbidden("receivables");
    }
    const customer = input.customer ? String(input.customer).trim() : "";
    const now = new Date();
    const invoices = await prisma.invoice.findMany({
      where: {
        status: { in: [INVOICE_STATUS.ISSUED, INVOICE_STATUS.PARTIALLY_PAID] },
        ...(customer ? { customer: { name: { contains: customer, mode: "insensitive" } } } : {}),
      },
      select: {
        id: true, invoiceNumber: true, docType: true, customerId: true, issueDate: true, dueDate: true, subtotal: true, total: true,
        customer: { select: { name: true } },
        paymentAllocations: { select: { amount: true, payment: { select: { amount: true, tdsAmount: true } } } },
        creditNotes: { where: { status: CREDIT_NOTE_STATUS.ISSUED }, select: { total: true } },
      },
    });
    const summary = summarizeReceivables(
      invoices.map((inv) => ({
        id: inv.id, invoiceNumber: inv.invoiceNumber, docType: inv.docType, customerId: inv.customerId, customer: inv.customer.name,
        issueDate: inv.issueDate, dueDate: inv.dueDate, subtotal: money(inv.subtotal), total: money(inv.total),
        creditNoteTotal: sumMoney(inv.creditNotes.map((c) => money(c.total))),
        settled: money(settledFromAllocations(inv.paymentAllocations)),
      })),
      now,
    );
    return {
      asOf: isoDateIST(now),
      basis: RECEIVABLES_BASIS,
      ...(customer ? { customerFilter: customer } : {}),
      ...summary,
      answerRule: "Say 'as of <asOf>' and whether each figure is incl. or excl. GST. This is an outstanding balance, not revenue.",
    };
  },
};

// --- Revenue ------------------------------------------------------------------

/** Indian financial year: Apr-Mar. Q1 Apr-Jun, Q2 Jul-Sep, Q3 Oct-Dec, Q4 Jan-Mar. */
export function indianFyQuarter(ymd: string): { fy: string; quarter: 1 | 2 | 3 | 4; from: string; to: string } {
  const [y, m] = ymd.split("-").map(Number);
  const fyStart = m >= 4 ? y : y - 1;
  const quarter = (m >= 4 ? Math.floor((m - 4) / 3) + 1 : 4) as 1 | 2 | 3 | 4;
  const startMonth = [4, 7, 10, 1][quarter - 1];
  const startYear = quarter === 4 ? fyStart + 1 : fyStart;
  const endMonth = startMonth + 2;
  const lastDay = new Date(Date.UTC(startYear, endMonth, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    fy: `${fyStart}-${String(fyStart + 1).slice(-2)}`,
    quarter,
    from: `${startYear}-${pad(startMonth)}-01`,
    to: `${startYear}-${pad(endMonth)}-${pad(lastDay)}`,
  };
}

export type RevenuePeriod = { label: string; from: string; to: string };

const shiftDays = (ymd: string, days: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** Resolves a named period (IST calendar) or an explicit from/to to inclusive yyyy-mm-dd dates. */
export function resolveRevenuePeriod(input: { period?: unknown; from?: unknown; to?: unknown }, todayIST: string): RevenuePeriod | { error: string } {
  const from = input.from ? String(input.from).trim() : "";
  const to = input.to ? String(input.to).trim() : "";
  if (from || to) {
    if (!istDayStart(from) || !istDayStart(to)) return { error: "from and to must both be dates in YYYY-MM-DD format." };
    if (from > to) return { error: "from must be on or before to." };
    return { label: `${from} to ${to}`, from, to };
  }
  const period = String(input.period ?? "this_quarter").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const q = indianFyQuarter(todayIST);
  const fyStartYear = Number(q.fy.slice(0, 4));
  const pad = (n: number) => String(n).padStart(2, "0");
  switch (period) {
    case "this_quarter":
    case "current_quarter":
      return { label: `FY ${q.fy} Q${q.quarter} (current quarter)`, from: q.from, to: q.to };
    case "last_quarter":
    case "previous_quarter": {
      const p = indianFyQuarter(shiftDays(q.from, -1));
      return { label: `FY ${p.fy} Q${p.quarter} (previous quarter)`, from: p.from, to: p.to };
    }
    case "this_month":
    case "current_month": {
      const [y, m] = todayIST.split("-").map(Number);
      return { label: `${todayIST.slice(0, 7)} (current month)`, from: `${y}-${pad(m)}-01`, to: shiftDays(`${m === 12 ? y + 1 : y}-${pad(m === 12 ? 1 : m + 1)}-01`, -1) };
    }
    case "last_month":
    case "previous_month": {
      const end = shiftDays(`${todayIST.slice(0, 7)}-01`, -1);
      return { label: `${end.slice(0, 7)} (previous month)`, from: `${end.slice(0, 7)}-01`, to: end };
    }
    case "this_fy":
    case "this_year":
    case "current_fy":
      return { label: `FY ${q.fy} (current financial year)`, from: `${fyStartYear}-04-01`, to: `${fyStartYear + 1}-03-31` };
    case "last_fy":
    case "previous_fy":
      return { label: `FY ${fyStartYear - 1}-${String(fyStartYear).slice(-2)} (previous financial year)`, from: `${fyStartYear - 1}-04-01`, to: `${fyStartYear}-03-31` };
    default:
      return { error: `Unknown period "${input.period}". Use this_quarter, last_quarter, this_month, last_month, this_fy, last_fy, or from/to dates.` };
  }
}

export interface RevenueInvoiceRow { subtotal: number; gst: number; total: number }
export interface RevenuePaymentRow { amount: number; tdsAmount: number; method: string }

/** Invoiced = issued tax invoices dated in the period (taxable value excl. GST), less issued
 * credit notes dated in the period. Collected = payments received in the period, cash only
 * (legacy "TDS Deducted" rows and tdsAmount are TDS, not cash) - the Finance dashboard's
 * "Revenue" bars. */
export function summarizeRevenue(invoices: RevenueInvoiceRow[], creditNotes: RevenueInvoiceRow[], payments: RevenuePaymentRow[]) {
  const sum = (rows: RevenueInvoiceRow[], k: keyof RevenueInvoiceRow) => sumMoney(rows.map((r) => r[k]));
  const inv = { taxable: sum(invoices, "subtotal"), gst: sum(invoices, "gst"), gross: sum(invoices, "total") };
  const cn = { taxable: sum(creditNotes, "subtotal"), gst: sum(creditNotes, "gst"), gross: sum(creditNotes, "total") };
  const split = payments.map((p) => splitPayment(p));
  return {
    invoiced: {
      basis: "Issued tax invoices (issued, partially paid or paid; drafts, cancelled and proforma invoices excluded) by invoice date, net of issued credit notes dated in the same period.",
      invoiceCount: invoices.length,
      creditNoteCount: creditNotes.length,
      netExclGst: sumMoney([inv.taxable, -cn.taxable]),
      netGst: sumMoney([inv.gst, -cn.gst]),
      netInclGst: sumMoney([inv.gross, -cn.gross]),
      invoicedExclGst: inv.taxable,
      creditNotesExclGst: cn.taxable,
    },
    collected: {
      basis: "Payments received in the period, cash actually received (GST-inclusive as paid; TDS excluded) - the same basis as the Finance dashboard's 'Revenue' chart.",
      paymentCount: payments.length,
      cashReceived: sumMoney(split.map((s) => Number(s.cash))),
      tdsDeducted: sumMoney(split.map((s) => Number(s.tds))),
    },
  };
}

const getRevenueSummary: AgentTool = {
  name: "get_revenue_summary",
  description:
    "Revenue / sales / turnover / collections for a period ('revenue this quarter', 'sales last month', " +
    "'turnover this FY'). Periods use the Indian financial year (Apr-Mar; Q1 Apr-Jun, Q2 Jul-Sep, Q3 Oct-Dec, " +
    "Q4 Jan-Mar) in IST. Returns the exact period dates and two server-computed figures, each with its basis: " +
    "invoiced (issued tax invoices by invoice date, excl. GST, net of credit notes - plus incl.-GST figures) and " +
    "collected (cash received, the Finance dashboard 'Revenue' basis). Quote these, never add up invoice/payment rows.",
  inputSchema: {
    type: "object",
    properties: {
      period: { type: "string", description: "this_quarter (default) | last_quarter | this_month | last_month | this_fy | last_fy" },
      from: { type: "string", description: "Optional explicit start date YYYY-MM-DD (use with to; overrides period)." },
      to: { type: "string", description: "Optional explicit end date YYYY-MM-DD, inclusive." },
    },
  },
  handler: async (input, auth) => {
    // Same permission as the Finance dashboard / monthly-revenue report. Never for customers.
    if (auth.customerId || !auth.permissions.has(PERMISSION_KEY.VIEW_FINANCE_DASHBOARD)) return forbidden("revenue figures");
    const period = resolveRevenuePeriod(input, isoDateIST(new Date()));
    if ("error" in period) return period;
    const range = { gte: istDayStart(period.from)!, lt: new Date(istDayStart(period.to)!.getTime() + DAY_MS) };

    const [invoices, creditNotes, payments, proformaCount] = await Promise.all([
      prisma.invoice.findMany({
        where: {
          docType: INVOICE_DOC_TYPE.TAX_INVOICE,
          status: { in: [INVOICE_STATUS.ISSUED, INVOICE_STATUS.PARTIALLY_PAID, INVOICE_STATUS.PAID] },
          issueDate: range,
        },
        select: { subtotal: true, cgstAmount: true, sgstAmount: true, igstAmount: true, total: true },
      }),
      prisma.creditNote.findMany({
        where: { status: CREDIT_NOTE_STATUS.ISSUED, issueDate: range },
        select: { subtotal: true, cgstAmount: true, sgstAmount: true, igstAmount: true, total: true },
      }),
      prisma.paymentReceived.findMany({ where: { receivedDate: range }, select: { amount: true, tdsAmount: true, method: true } }),
      prisma.invoice.count({
        where: { docType: INVOICE_DOC_TYPE.PROFORMA, status: { notIn: [INVOICE_STATUS.DRAFT, INVOICE_STATUS.CANCELLED] }, issueDate: range },
      }),
    ]);
    const doc = (d: { subtotal: Prisma.Decimal; cgstAmount: Prisma.Decimal; sgstAmount: Prisma.Decimal; igstAmount: Prisma.Decimal; total: Prisma.Decimal }) => ({
      subtotal: money(d.subtotal),
      gst: sumMoney([money(d.cgstAmount), money(d.sgstAmount), money(d.igstAmount)]),
      total: money(d.total),
    });
    return {
      period: { ...period, timezone: "IST", financialYearRule: "Indian FY Apr-Mar; Q1 Apr-Jun, Q2 Jul-Sep, Q3 Oct-Dec, Q4 Jan-Mar" },
      ...summarizeRevenue(
        invoices.map(doc),
        creditNotes.map(doc),
        payments.map((p) => ({ amount: money(p.amount), tdsAmount: money(p.tdsAmount), method: p.method })),
      ),
      proformaInvoicesInPeriod: { count: proformaCount, note: "Proforma invoices are not revenue and are excluded." },
      answerRule: "State the period dates and the basis of every figure you quote (invoiced excl. GST net of credit notes, and/or cash collected).",
    };
  },
};

export const zanAppFinanceTools: AgentTool[] = [getReceivables, getPayables, searchVendorBills, getRevenueSummary];
