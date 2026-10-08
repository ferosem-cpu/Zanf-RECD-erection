/** Read-only finance summary tools for the agent: payables (what we owe suppliers) and revenue
 * for a period. Both return server-computed figures plus the exact basis/period they used, so
 * the model never has to assemble a payable or revenue figure from search rows (2026-10:
 * "pending to pay" was answered from one open PO and missed approved vendor invoices).
 */
import { Prisma } from "@prisma/client";
import { PERMISSION_KEY, BILL_STATUS, PO_STATUS, INVOICE_STATUS, INVOICE_DOC_TYPE, CREDIT_NOTE_STATUS } from "@recd/shared";
import { prisma } from "../../lib/prisma";
import { splitPayment } from "../../services/paymentSplit";
import { LIST_LIMIT } from "../listResult";
import { isoDateIST, istDayStart, sumMoney } from "./zanAppReadTools";
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

/** A bill is a payable once approved, until fully paid - the finance dashboard's definition
 * (routes/financeDashboard.ts). Uploaded/verified bills are awaiting approval (reported
 * separately); rejected/cancelled ones never were a liability. */
export const PAYABLE_BILL_STATUSES: string[] = [BILL_STATUS.APPROVED, BILL_STATUS.PARTIALLY_PAID];
export const AWAITING_APPROVAL_BILL_STATUSES: string[] = [BILL_STATUS.UPLOADED, BILL_STATUS.VERIFIED];
/** Open POs = issued and not yet fully received/closed - commitments, not payables. */
export const OPEN_PO_STATUSES: string[] = [PO_STATUS.ISSUED, PO_STATUS.PARTIALLY_RECEIVED];

export const PAYABLES_BASIS =
  "Payables = vendor invoices (bills) in status approved or partially_paid, outstanding = bill total (incl. GST) " +
  "minus vendor payments recorded against the bill - the same rule as the Finance dashboard 'Outstanding payables' " +
  "and the Payables ageing report. Vendor payments carry no TDS field, so no TDS is deducted; debit notes are not " +
  "netted (shown separately). Bills awaiting approval (uploaded/verified) are NOT payables yet and rejected/cancelled " +
  "bills are excluded. Open purchase orders are commitments, not payables, and are listed separately.";

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

type AgeingBucket = "current" | "days0_30" | "days31_60" | "days61_90" | "days90Plus";

/** Same buckets/anchor as GET /finance/reports/payables: days past due date (or bill date). */
export function ageingBucket(anchor: Date, now: Date): { bucket: AgeingBucket; daysPastDue: number } {
  const days = Math.floor((now.getTime() - anchor.getTime()) / DAY_MS);
  const bucket: AgeingBucket = days <= 0 ? "current" : days <= 30 ? "days0_30" : days <= 60 ? "days31_60" : days <= 90 ? "days61_90" : "days90Plus";
  return { bucket, daysPastDue: Math.max(days, 0) };
}

const emptyAgeing = (): Record<AgeingBucket, number> => ({ current: 0, days0_30: 0, days31_60: 0, days61_90: 0, days90Plus: 0 });

export function summarizePayables(bills: PayableBillRow[], now: Date, listLimit = LIST_LIMIT) {
  const open = bills
    .map((b) => {
      const outstanding = sumMoney([b.total, -b.paid]);
      const { bucket, daysPastDue } = ageingBucket(b.dueDate ?? b.billDate, now);
      return { ...b, outstanding, bucket, daysPastDue };
    })
    .filter((b) => b.outstanding > 0);

  const ageing = emptyAgeing();
  const vendors = new Map<string, { supplierId: string; supplier: string; billCount: number; outstanding: number; ageing: Record<AgeingBucket, number> }>();
  for (const b of open) {
    ageing[b.bucket] = sumMoney([ageing[b.bucket], b.outstanding]);
    const v = vendors.get(b.supplierId) ?? { supplierId: b.supplierId, supplier: b.supplier, billCount: 0, outstanding: 0, ageing: emptyAgeing() };
    v.billCount += 1;
    v.outstanding = sumMoney([v.outstanding, b.outstanding]);
    v.ageing[b.bucket] = sumMoney([v.ageing[b.bucket], b.outstanding]);
    vendors.set(b.supplierId, v);
  }
  // Due list: most overdue first, then by due/bill date.
  const due = [...open].sort((a, b) => b.daysPastDue - a.daysPastDue || (a.dueDate ?? a.billDate).getTime() - (b.dueDate ?? b.billDate).getTime());

  return {
    totalOutstanding: sumMoney(open.map((b) => b.outstanding)),
    billCount: open.length,
    vendorCount: vendors.size,
    overdueCount: open.filter((b) => b.daysPastDue > 0).length,
    overdueAmount: sumMoney(open.filter((b) => b.daysPastDue > 0).map((b) => b.outstanding)),
    debitNotesAgainstOpenBills: sumMoney(open.map((b) => b.debitNotes)),
    ageing,
    byVendor: [...vendors.values()].sort((a, b) => b.outstanding - a.outstanding || a.supplier.localeCompare(b.supplier)),
    complete: due.length <= listLimit,
    dueList: due.slice(0, listLimit).map((b) => ({
      id: b.id, billNumber: b.billNumber, supplier: b.supplier, status: b.status,
      billDate: isoDateIST(b.billDate), dueDate: b.dueDate ? isoDateIST(b.dueDate) : null,
      total: b.total, paid: b.paid, outstanding: b.outstanding, daysPastDue: b.daysPastDue, ageingBucket: b.bucket,
    })),
  };
}

const getPayables: AgentTool = {
  name: "get_payables",
  description:
    "What WE OWE suppliers/vendors: 'how much is pending to pay', 'payables', 'to whom do we owe', " +
    "'pending to be paid to vendor X'. Returns server-computed totalOutstanding, billCount, " +
    "overdueCount/overdueAmount, ageing buckets (current, 0-30, 31-60, 61-90, 90+ days past due), byVendor " +
    "(outstanding per supplier) and a dueList of open vendor invoices (most overdue first), over EVERY " +
    "approved/partially paid vendor invoice - basis states the exact rule. Also returns, SEPARATELY, " +
    "awaitingApproval (uploaded/verified bills - not payable yet), openPurchaseOrders (commitments, not " +
    "payables) and unappliedAdvances (money already paid ahead to a supplier). Optional supplier filter is " +
    "tolerant (case, punctuation, 'Ent.' = 'Enterprises', partial names).",
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
      const suppliers = await prisma.supplier.findMany({ select: { id: true, name: true } });
      const matched = suppliers.filter((s) => supplierNameMatches(supplierQuery, s.name));
      if (matched.length === 0) {
        return {
          error: `No supplier matches "${supplierQuery}". Check the spelling with search_suppliers before saying nothing is owed.`,
          suppliers: suppliers.map((s) => s.name).sort().slice(0, 50),
        };
      }
      supplierIds = matched.map((s) => s.id);
      matchedSuppliers = matched.map((s) => s.name);
    }
    const bySupplier = supplierIds ? { supplierId: { in: supplierIds } } : {};
    const now = new Date();

    const [bills, awaiting, openPos, advances] = await Promise.all([
      prisma.bill.findMany({
        where: { ...bySupplier, status: { in: PAYABLE_BILL_STATUSES } },
        include: {
          supplier: { select: { name: true } },
          payments: { select: { amount: true } },
          debitNotes: { select: { amount: true } },
        },
      }),
      prisma.bill.findMany({
        where: { ...bySupplier, status: { in: AWAITING_APPROVAL_BILL_STATUSES } },
        select: { id: true, billNumber: true, status: true, billDate: true, total: true, supplier: { select: { name: true } } },
        orderBy: { billDate: "asc" },
      }),
      prisma.purchaseOrder.findMany({
        where: { ...bySupplier, status: { in: OPEN_PO_STATUSES } },
        select: {
          id: true, poNumber: true, status: true, orderDate: true, total: true, supplier: { select: { name: true } },
          bills: { where: { status: { notIn: [BILL_STATUS.REJECTED, BILL_STATUS.CANCELLED] } }, select: { total: true } },
        },
        orderBy: { orderDate: "asc" },
      }),
      prisma.paymentMade.findMany({
        where: { ...bySupplier, billId: null },
        select: { amount: true, supplierId: true, supplier: { select: { name: true } } },
      }),
    ]);

    const summary = summarizePayables(
      bills.map((b) => ({
        id: b.id, billNumber: b.billNumber, supplierId: b.supplierId, supplier: b.supplier.name, status: b.status,
        billDate: b.billDate, dueDate: b.dueDate, total: money(b.total),
        paid: sumMoney(b.payments.map((p) => money(p.amount))),
        debitNotes: sumMoney(b.debitNotes.map((d) => money(d.amount))),
      })),
      now,
    );

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
      awaitingApproval: {
        note: "Recorded but not yet approved in Finance > Vendor Invoices - not payable until approved; not included in totalOutstanding.",
        count: awaiting.length,
        total: sumMoney(awaiting.map((b) => money(b.total))),
        bills: awaiting.slice(0, LIST_LIMIT).map((b) => ({
          id: b.id, billNumber: b.billNumber, supplier: b.supplier.name, status: b.status, billDate: isoDateIST(b.billDate), total: money(b.total),
        })),
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

export const zanAppFinanceTools: AgentTool[] = [getPayables, getRevenueSummary];
