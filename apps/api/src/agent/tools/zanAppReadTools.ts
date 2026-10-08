/** Read-only Zan-APP data tools for the in-app agent (§56 plan in HANDOVER.md, "Part A").
 * Each tool mirrors the permission logic of the equivalent REST route (see apps/api/src/routes)
 * rather than re-deriving it, and returns lightweight summaries - use get_document_detail for
 * full line-item drill-down on a specific document. All money fields are returned as plain
 * numbers (2dp) for the LLM to reason over; this is NOT used for anything that writes back to
 * the DB, so Decimal precision loss here is safe.
 */
import { Prisma } from "@prisma/client";
import { PERMISSION_KEY, CREDIT_NOTE_STATUS, STAGE_KEY, PAYMENT_METHOD } from "@recd/shared";
import { prisma } from "../../lib/prisma";
import { buildCustomerLedger } from "../../services/ledger";
import { settledFromAllocations, netInvoiceTotal } from "../../services/settlement";
import { paymentCashAndTds, normalizePaymentMethod } from "../../services/paymentSplit";
import { LIST_LIMIT, listMeta, listPage } from "../listResult";
import type { AgentTool, AgentAuthContext } from "./types";

const RESULT_LIMIT = LIST_LIMIT;

function forbidden(what: string) {
  return { error: `You don't have permission to view ${what}.` };
}

function hasAny(auth: AgentAuthContext, keys: string[]): boolean {
  return keys.some((k) => auth.permissions.has(k));
}

function num(d: Prisma.Decimal | null | undefined): number | null {
  return d == null ? null : Number(d);
}

/** Sums 2dp money values in whole paise so totals can't drift from float addition. */
export function sumMoney(values: Array<number | null | undefined>): number {
  return values.reduce<number>((paise, v) => paise + Math.round((v ?? 0) * 100), 0) / 100;
}

/** Business dates are Indian time (IST = UTC+5:30, no DST). A date-only value saved as UTC
 * midnight and one saved as IST midnight (18:30Z the day before) both land on the right day. */
const IST_OFFSET_MS = 330 * 60_000;

export function isoDateIST(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Start of a yyyy-mm-dd day in IST, or undefined if the string isn't a valid date. */
export function istDayStart(ymd: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return undefined;
  const d = new Date(`${ymd}T00:00:00+05:30`);
  return Number.isNaN(d.getTime()) || isoDateIST(d) !== ymd ? undefined : d;
}

type StatusGroup = { status: string; _count: { _all: number }; _sum?: { total?: Prisma.Decimal | null } };

/** Count (and value, where the model has a total) per status over the FULL filtered set. */
export function statusBreakdown(groups: StatusGroup[]) {
  const byStatus: Record<string, { count: number; totalValue?: number }> = {};
  for (const g of [...groups].sort((a, b) => a.status.localeCompare(b.status))) {
    byStatus[g.status] = g._sum ? { count: g._count._all, totalValue: sumMoney([num(g._sum.total ?? null)]) } : { count: g._count._all };
  }
  const totalCount = groups.reduce((s, g) => s + g._count._all, 0);
  const totalValue = groups.some((g) => g._sum) ? sumMoney(groups.map((g) => num(g._sum?.total ?? null))) : undefined;
  return { totalCount, ...(totalValue !== undefined ? { totalValue } : {}), byStatus };
}

const searchCustomers: AgentTool = {
  name: "search_customers",
  description:
    "Search customers by name. Returns id, name, GSTIN, state, and contact person(s). Use " +
    "this to resolve a customer name to an id before creating/looking up their documents.",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string", description: "Name (or partial name) to search for." } },
  },
  handler: async (input, auth) => {
    if (!hasAny(auth, [PERMISSION_KEY.MANAGE_ORDERS, PERMISSION_KEY.MANAGE_QUOTATIONS, PERMISSION_KEY.MANAGE_INVOICES]))
      return forbidden("customers");
    const query = input.query ? String(input.query) : undefined;
    const where: Prisma.CustomerWhereInput = query ? { name: { contains: query, mode: "insensitive" } } : {};
    const [customers, totalCount] = await Promise.all([
      prisma.customer.findMany({
        where,
        include: { contacts: { select: { name: true, phone: true, email: true } } },
        orderBy: { name: "asc" },
        take: RESULT_LIMIT,
      }),
      prisma.customer.count({ where }),
    ]);
    return listPage(
      customers.map((c) => ({
        id: c.id, name: c.name, gstin: c.gstin, state: c.state,
        contacts: c.contacts,
      })),
      totalCount,
    );
  },
};

const searchVendors: AgentTool = {
  name: "search_vendors",
  description:
    "Search external erection-subcontractor vendors by name. Returns id, name, status " +
    "(pending/approved/rejected), contact details, and how many sites/members they have.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Name (or partial name) to search for." },
      status: { type: "string", description: "Optional filter: pending | approved | rejected" },
    },
  },
  handler: async (input, auth) => {
    if (!auth.permissions.has(PERMISSION_KEY.MANAGE_VENDORS)) return forbidden("vendors");
    const query = input.query ? String(input.query) : undefined;
    const status = input.status ? String(input.status) : undefined;
    const where: Prisma.VendorWhereInput = {
      ...(query ? { name: { contains: query, mode: "insensitive" } } : {}),
      ...(status ? { status } : {}),
    };
    const [vendors, totalCount] = await Promise.all([
      prisma.vendor.findMany({
        where,
        include: { _count: { select: { members: true, sites: true } } },
        orderBy: [{ status: "asc" }, { name: "asc" }],
        take: RESULT_LIMIT,
      }),
      prisma.vendor.count({ where }),
    ]);
    return listPage(
      vendors.map((v) => ({
        id: v.id, name: v.name, status: v.status, contactName: v.contactName,
        contactEmail: v.contactEmail, contactPhone: v.contactPhone, address: v.address,
        memberCount: v._count.members, siteCount: v._count.sites, approvedAt: v.approvedAt,
      })),
      totalCount,
    );
  },
};

/** Suppliers (material/service sellers we raise POs to) are a DIFFERENT table from vendors
 * (erection subcontractors). Before this tool existed the agent could only call
 * search_vendors, found nothing, and dead-ended when asked to raise a PO (2026-09-28). */
const searchSuppliers: AgentTool = {
  name: "search_suppliers",
  description:
    "Search SUPPLIERS - the companies we buy material/services from and raise purchase orders " +
    "to (NOT erection vendors; use this, not search_vendors, before create_purchase_order or " +
    "create_vendor_invoice). Matches name, GSTIN or city. Returns id, name, GSTIN, state, full " +
    "address and contact details.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Name, GSTIN or city (partial match). Omit to list suppliers." },
    },
  },
  handler: async (input, auth) => {
    if (!hasAny(auth, [PERMISSION_KEY.MANAGE_PURCHASE_ORDERS, PERMISSION_KEY.VIEW_LEDGERS])) return forbidden("suppliers");
    const query = input.query ? String(input.query).trim() : "";
    const where: Prisma.SupplierWhereInput = query
      ? {
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { gstin: { contains: query, mode: "insensitive" } },
            { city: { contains: query, mode: "insensitive" } },
          ],
        }
      : {};
    const [suppliers, totalCount] = await Promise.all([
      prisma.supplier.findMany({ where, orderBy: { name: "asc" }, take: RESULT_LIMIT }),
      prisma.supplier.count({ where }),
    ]);
    return listPage(
      suppliers.map((s) => ({
        id: s.id, name: s.name, gstin: s.gstin, state: s.state,
        address: [s.address, s.addressLine2, [s.city, s.pincode].filter(Boolean).join(" - ")].filter(Boolean).join(", ") || null,
        contactName: s.contactName, contactPhone: s.contactPhone, contactEmail: s.contactEmail, isActive: s.isActive,
      })),
      totalCount,
    );
  },
};

const searchQuotations: AgentTool = {
  name: "search_quotations",
  description:
    "Search quotations by quote number or customer name. Returns id, quoteNumber, customer, " +
    "status, issueDate, validUntil, and total. Use get_document_detail for line items. " +
    "totalCount, totalValue and byStatus cover ALL matching quotations, not just the listed rows.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Quote number or customer name (partial match)." },
      status: { type: "string", description: "Optional filter: draft | sent | accepted | rejected | expired | converted" },
    },
  },
  handler: async (input, auth) => {
    if (!auth.permissions.has(PERMISSION_KEY.MANAGE_QUOTATIONS)) return forbidden("quotations");
    const query = input.query ? String(input.query) : undefined;
    const status = input.status ? String(input.status) : undefined;
    const where: Prisma.QuotationWhereInput = {
      ...(status ? { status } : {}),
      ...(query
        ? { OR: [{ quoteNumber: { contains: query, mode: "insensitive" } }, { customer: { name: { contains: query, mode: "insensitive" } } }] }
        : {}),
    };
    const [quotations, groups] = await Promise.all([
      prisma.quotation.findMany({
        where,
        include: { customer: { select: { name: true } } },
        orderBy: { quoteNumber: "asc" },
        take: RESULT_LIMIT,
      }),
      prisma.quotation.groupBy({ by: ["status"], where, _count: { _all: true }, _sum: { total: true } }),
    ]);
    const summary = statusBreakdown(groups);
    return {
      ...listMeta(quotations.length, summary.totalCount),
      totalValue: summary.totalValue,
      byStatus: summary.byStatus,
      results: quotations.map((q) => ({
        id: q.id, quoteNumber: q.quoteNumber, customer: q.customer.name, status: q.status,
        issueDate: q.issueDate, validUntil: q.validUntil, total: num(q.total),
      })),
    };
  },
};

/** Same definition as the finance dashboard (routes/financeDashboard.ts /summary): an
 * issued/partially_paid invoice whose dueDate is set and earlier than now. Drafts, paid and
 * cancelled invoices are never overdue; no balance > 0 filter (the dashboard has none). */
export const OVERDUE_INVOICE_STATUSES = ["issued", "partially_paid"];

/** Receivable = issued/partially_paid, the statuses the finance dashboard's
 * outstandingReceivables sums. Drafts and cancelled invoices are not owed; paid ones are settled. */
export const RECEIVABLE_INVOICE_STATUSES = ["issued", "partially_paid"];

/** Words models use for "not fully paid yet" - none is a stored status. */
const RECEIVABLE_STATUS_ALIASES = new Set(["unpaid", "outstanding", "open", "receivable", "due", "pending"]);

/** Models often pass status="overdue"; it is not a stored status, so treat it as the flag.
 * status may also be a comma-separated list ("issued,partially_paid") or an array. */
export function resolveInvoiceFilter(input: Record<string, unknown>): { overdueOnly: boolean; statuses?: string[] } {
  const raw = Array.isArray(input.status) ? input.status.map(String) : input.status ? String(input.status).split(",") : [];
  const tokens = raw.map((s) => s.trim().toLowerCase().replace(/[\s-]+/g, "_")).filter(Boolean);
  const overdueOnly = input.overdueOnly === true || tokens.includes("overdue");
  const statuses = [
    ...new Set(tokens.flatMap((t) => (t === "overdue" ? [] : RECEIVABLE_STATUS_ALIASES.has(t) ? RECEIVABLE_INVOICE_STATUSES : [t]))),
  ];
  return { overdueOnly, statuses: statuses.length > 0 ? statuses : undefined };
}

export function invoiceStatusWhere(filter: { overdueOnly: boolean; statuses?: string[] }, now: Date): Prisma.InvoiceWhereInput {
  const { statuses } = filter;
  if (!filter.overdueOnly) {
    if (!statuses) return {};
    return statuses.length === 1 ? { status: statuses[0] } : { status: { in: statuses } };
  }
  // An explicit status can only narrow the overdue set (status="paid" + overdueOnly = nothing).
  const overdueStatuses = statuses ? OVERDUE_INVOICE_STATUSES.filter((s) => statuses.includes(s)) : OVERDUE_INVOICE_STATUSES;
  return { status: { in: overdueStatuses }, dueDate: { lt: now } };
}

export interface InvoiceSummaryRow {
  status: string;
  dueDate: Date | null;
  total: number | null;
  creditNoteTotal: number | null;
  netTotal: number | null;
  amountPaid: number | null;
  balance: number | null;
  overdue: boolean;
}

/** Totals over EVERY row passed in (the full filtered set); only the first `listLimit` are
 * listed. Overdue lists are sorted by due date (oldest first); others keep the given order.
 * outstandingBalance only counts receivable invoices, like the finance dashboard - a draft's
 * or cancelled invoice's "balance" is not money anyone owes. */
export function summarizeInvoices<T extends InvoiceSummaryRow>(rows: T[], listLimit: number, opts: { overdueOnly: boolean }) {
  const ordered = opts.overdueOnly ? [...rows].sort((a, b) => (a.dueDate?.getTime() ?? 0) - (b.dueDate?.getTime() ?? 0)) : rows;
  const listed = ordered.slice(0, listLimit);
  const receivable = rows.filter((r) => RECEIVABLE_INVOICE_STATUSES.includes(r.status));
  const overdue = rows.filter((r) => r.overdue);

  const byStatus: Record<string, { count: number; totalAmount: number; balance: number }> = {};
  for (const status of [...new Set(rows.map((r) => r.status))].sort()) {
    const group = rows.filter((r) => r.status === status);
    byStatus[status] = { count: group.length, totalAmount: sumMoney(group.map((r) => r.total)), balance: sumMoney(group.map((r) => r.balance)) };
  }

  return {
    ...listMeta(listed.length, rows.length),
    totals: {
      count: rows.length,
      totalAmount: sumMoney(rows.map((r) => r.total)),
      creditNoteTotal: sumMoney(rows.map((r) => r.creditNoteTotal)),
      netTotal: sumMoney(rows.map((r) => r.netTotal)),
      amountPaid: sumMoney(rows.map((r) => r.amountPaid)),
      outstandingBalance: sumMoney(receivable.map((r) => r.balance)),
      overdueCount: overdue.length,
      overdueBalance: sumMoney(overdue.map((r) => r.balance)),
    },
    byStatus,
    // Kept from the first overdue fix so older prompts/threads still find these fields.
    ...(opts.overdueOnly
      ? { overdueCount: rows.length, totalOverdueBalance: sumMoney(rows.map((r) => r.balance)), listed: listed.length }
      : {}),
    invoices: listed,
  };
}

const searchInvoices: AgentTool = {
  name: "search_invoices",
  description:
    "Search invoices (proforma or tax invoice) by invoice number or customer name. Lists up to " +
    "15 rows: id, invoiceNumber, docType, customer, status, issueDate, dueDate, total, " +
    "creditNoteTotal (sum of issued credit notes against it), netTotal, amountPaid, balance " +
    "(net of credit notes, after allocated payments and pro-rated TDS), and whether it's " +
    "overdue. ALWAYS also returns totalCount, totals {count, totalAmount, creditNoteTotal, " +
    "netTotal, amountPaid, outstandingBalance (issued + partially_paid only, same as the finance " +
    "dashboard), overdueCount, overdueBalance} and byStatus, all computed over EVERY matching " +
    "invoice - quote these for 'how many'/'how much', never add up rows. 'overdue' is NOT a " +
    "status - for overdue invoices set overdueOnly=true. For unpaid / partly paid / outstanding " +
    "invoices use status='issued,partially_paid'. Use get_document_detail for line " +
    "items/payments/credit notes.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Invoice number or customer name (partial match)." },
      status: {
        type: "string",
        description: "Optional filter: draft | issued | partially_paid | paid | cancelled, or several comma-separated (e.g. 'issued,partially_paid' for unpaid/outstanding invoices).",
      },
      overdueOnly: { type: "boolean", description: "True = only issued/partially_paid invoices past their due date. Use this for anything about overdue invoices." },
    },
  },
  handler: async (input, auth) => {
    if (!auth.permissions.has(PERMISSION_KEY.MANAGE_INVOICES)) return forbidden("invoices");
    const query = input.query ? String(input.query) : undefined;
    const filter = resolveInvoiceFilter(input);
    const { overdueOnly } = filter;
    const now = new Date();
    // No take: totals must cover every matching invoice (like the finance dashboard); only
    // the listed rows are capped, in summarizeInvoices.
    const invoices = await prisma.invoice.findMany({
      where: {
        ...invoiceStatusWhere(filter, now),
        ...(query
          ? { OR: [{ invoiceNumber: { contains: query, mode: "insensitive" } }, { customer: { name: { contains: query, mode: "insensitive" } } }] }
          : {}),
      },
      include: {
        customer: { select: { name: true } },
        // paymentAllocations (not the legacy `payments` relation) is the complete picture
        // since Phase C - a payment split across invoices or carrying TDS would otherwise
        // be undercounted here, same fix already applied to the REST routes.
        paymentAllocations: { select: { amount: true, payment: { select: { amount: true, tdsAmount: true } } } },
        creditNotes: { where: { status: CREDIT_NOTE_STATUS.ISSUED }, select: { total: true } },
      },
      orderBy: overdueOnly ? { dueDate: "asc" } : { invoiceNumber: "asc" },
    });
    const rows = invoices.map((inv) => {
      const paid = settledFromAllocations(inv.paymentAllocations);
      const cnTotal = inv.creditNotes.reduce((s, cn) => s.plus(cn.total), new Prisma.Decimal(0));
      const netTotal = netInvoiceTotal(new Prisma.Decimal(inv.total), cnTotal);
      const balance = netTotal.minus(paid);
      const overdue = OVERDUE_INVOICE_STATUSES.includes(inv.status) && !!inv.dueDate && inv.dueDate.getTime() < now.getTime();
      return {
        id: inv.id,
        invoiceNumber: inv.status === "draft" ? `DRAFT-${inv.id}` : inv.invoiceNumber,
        docType: inv.docType, customer: inv.customer.name, status: inv.status,
        issueDate: inv.issueDate, dueDate: inv.dueDate, total: num(inv.total),
        creditNoteTotal: num(cnTotal), netTotal: num(netTotal), amountPaid: num(paid), balance: num(balance), overdue,
      };
    });
    return summarizeInvoices(rows, RESULT_LIMIT, { overdueOnly });
  },
};

const searchPurchaseOrders: AgentTool = {
  name: "search_purchase_orders",
  description:
    "Search purchase orders by PO number or supplier name. Returns id, poNumber, supplier, " +
    "status, orderDate, expectedDate, and total. Use get_document_detail for line items. " +
    "totalCount, totalValue and byStatus cover ALL matching POs, not just the listed rows.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "PO number or supplier name (partial match)." },
      status: { type: "string", description: "Optional filter: draft | issued | partially_received | received | cancelled | closed" },
    },
  },
  handler: async (input, auth) => {
    if (!auth.permissions.has(PERMISSION_KEY.MANAGE_PURCHASE_ORDERS)) return forbidden("purchase orders");
    const query = input.query ? String(input.query) : undefined;
    const status = input.status ? String(input.status) : undefined;
    const where: Prisma.PurchaseOrderWhereInput = {
      ...(status ? { status } : {}),
      ...(query
        ? { OR: [{ poNumber: { contains: query, mode: "insensitive" } }, { supplier: { name: { contains: query, mode: "insensitive" } } }] }
        : {}),
    };
    const [pos, groups] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where,
        include: { supplier: { select: { name: true } } },
        orderBy: { poNumber: "asc" },
        take: RESULT_LIMIT,
      }),
      prisma.purchaseOrder.groupBy({ by: ["status"], where, _count: { _all: true }, _sum: { total: true } }),
    ]);
    const summary = statusBreakdown(groups);
    return {
      ...listMeta(pos.length, summary.totalCount),
      totalValue: summary.totalValue,
      byStatus: summary.byStatus,
      results: pos.map((po) => ({
        id: po.id, poNumber: po.poNumber, supplier: po.supplier.name, status: po.status,
        orderDate: po.orderDate, expectedDate: po.expectedDate, total: num(po.total),
      })),
    };
  },
};

const searchExpenses: AgentTool = {
  name: "search_expenses",
  description:
    "Search the expense book (non-PO spend: fuel, travel, site consumables, misc) by " +
    "description or category. Returns id, description, category, amount, date, method, site. " +
    "totalCount and totalAmount cover ALL matching expenses, not just the listed rows.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Text to match against the description." },
      categoryKey: { type: "string", description: "Optional category key filter, e.g. 'material', 'transport'." },
    },
  },
  handler: async (input, auth) => {
    if (!auth.permissions.has(PERMISSION_KEY.MANAGE_EXPENSES)) return forbidden("expenses");
    const query = input.query ? String(input.query) : undefined;
    const categoryKey = input.categoryKey ? String(input.categoryKey) : undefined;
    const where: Prisma.ExpenseWhereInput = {
      ...(query ? { description: { contains: query, mode: "insensitive" } } : {}),
      ...(categoryKey ? { category: { key: categoryKey } } : {}),
    };
    const [expenses, agg] = await Promise.all([
      prisma.expense.findMany({
        where,
        include: { category: { select: { label: true } }, site: { select: { address: true } } },
        orderBy: { expenseDate: "desc" },
        take: RESULT_LIMIT,
      }),
      prisma.expense.aggregate({ where, _count: { _all: true }, _sum: { amount: true } }),
    ]);
    return {
      ...listMeta(expenses.length, agg._count._all),
      totalAmount: sumMoney([num(agg._sum.amount)]),
      results: expenses.map((e) => ({
        id: e.id, description: e.description, category: e.category.label, amount: num(e.amount),
        expenseDate: e.expenseDate, method: e.method, site: e.site?.address ?? null,
      })),
    };
  },
};

/** Order has no status column, and nothing in the app (Orders list, dashboards) labels an
 * order open/closed - the only lifecycle it has is its site's SITC stage (StageDefinition rows,
 * ordered by sequenceOrder; the customer portal treats every stage up to the current one as
 * done). Business rule: an order is open until its site reaches the Commissioned stage (or any
 * later one, e.g. customer sign-off); no site yet = open. `closedFromSeq` is the sequenceOrder
 * of that cutoff stage - see resolveOpenCutoff. */
export function isOrderOpen(stageSeq: number | null, closedFromSeq: number | null): boolean {
  if (stageSeq == null || closedFromSeq == null) return true;
  return stageSeq < closedFromSeq;
}

export function orderOpenWhere(closedFromSeq: number): Prisma.OrderWhereInput {
  return {
    OR: [{ site: { is: null } }, { site: { is: { currentStage: { sequenceOrder: { lt: closedFromSeq } } } } }],
  };
}

type StageRef = { label: string; sequenceOrder: number } | null;

/** Picks the stage from which an order counts as closed: the Commissioned stage (looked up by
 * key/label at runtime, since stages are DB rows). If it isn't configured, falls back to the
 * final stage and says so; with no stages at all every order is open. */
export function resolveOpenCutoff(commissioned: StageRef, finalStage: StageRef): { closedFromSeq: number | null; openDefinition: string } {
  const base = "Order has no status field.";
  if (commissioned) {
    return {
      closedFromSeq: commissioned.sequenceOrder,
      openDefinition: `${base} An order is open until its site reaches the "${commissioned.label}" SITC stage or any later stage; an order with no site yet is open.`,
    };
  }
  if (finalStage) {
    return {
      closedFromSeq: finalStage.sequenceOrder,
      openDefinition: `${base} No "Commissioned" SITC stage is configured, so as a fallback an order is open until its site reaches the final stage ("${finalStage.label}"); an order with no site yet is open.`,
    };
  }
  return { closedFromSeq: null, openDefinition: "No SITC stages are configured, so every order counts as open." };
}

export interface OrderSummaryRow {
  value: number | null;
  quantity: number;
  product: string;
  lineItems: { product: string; quantity: number }[];
  stage: { label: string; sequenceOrder: number } | null;
}

/** Counts, value and units over EVERY matching order (not just the listed page). Order.value
 * is the whole order's value (all its products), so line items add units but never value. */
export function summarizeOrders(rows: OrderSummaryRow[], closedFromSeq: number | null) {
  const units = new Map<string, number>();
  const stages = new Map<string, { stage: string; sequenceOrder: number; count: number; values: Array<number | null> }>();
  const open: OrderSummaryRow[] = [];
  for (const r of rows) {
    for (const item of [{ product: r.product, quantity: r.quantity }, ...r.lineItems]) {
      units.set(item.product, (units.get(item.product) ?? 0) + item.quantity);
    }
    const stage = r.stage?.label ?? "No site yet";
    const entry = stages.get(stage) ?? { stage, sequenceOrder: r.stage?.sequenceOrder ?? 0, count: 0, values: [] };
    entry.count += 1;
    entry.values.push(r.value);
    stages.set(stage, entry);
    if (isOrderOpen(r.stage?.sequenceOrder ?? null, closedFromSeq)) open.push(r);
  }
  return {
    count: rows.length,
    totalValue: sumMoney(rows.map((r) => r.value)),
    ordersWithoutValue: rows.filter((r) => r.value == null).length,
    totalUnits: [...units.values()].reduce((s, n) => s + n, 0),
    unitsByProduct: [...units.entries()]
      .map(([product, n]) => ({ product, units: n }))
      .sort((a, b) => b.units - a.units || a.product.localeCompare(b.product)),
    openCount: open.length,
    openValue: sumMoney(open.map((r) => r.value)),
    completedCount: rows.length - open.length,
    byStage: [...stages.values()]
      .sort((a, b) => a.sequenceOrder - b.sequenceOrder)
      .map((s) => ({ stage: s.stage, count: s.count, value: sumMoney(s.values) })),
  };
}

const searchOrdersAndSites: AgentTool = {
  name: "search_orders_and_sites",
  description:
    "Search sales orders (and their site's SITC progress) by order number, customer name, " +
    "site/end-client company name (e.g. 'BPCL', 'VRL'), site address/location (e.g. " +
    "'Belgaum', 'Bangalore'), or product name/model/rating (e.g. 'RECD-500', '500', " +
    "'500 KVA') - matches any of these, not just order number or customer. Omit query to " +
    "cover every order. Lists up to 15 orders (newest first): id, orderNumber, customer, " +
    "product, quantity, additionalLineItems (extra products on the same order - an order can " +
    "carry more than one RECD/product), order value, dispatch dates, open (true until the site " +
    "reaches the Commissioned SITC stage or later), and - if a site exists - its address, end-client company " +
    "name, current SITC stage, assigned engineer, and erection vendor. ALWAYS also returns " +
    "totalCount and totals {count, totalValue, ordersWithoutValue, totalUnits, unitsByProduct, " +
    "openCount, openValue, completedCount, byStage} computed over EVERY matching order - quote " +
    "these for any 'how many orders/units' or 'total order value' question, never add up the " +
    "listed rows. For open/pending/in-progress orders set openOnly=true (Order has no status " +
    "field; see openDefinition in the result). Use this for any 'how many/which sites are in " +
    "<place>' question - there's no separate stock/inventory-by-location feature, so this " +
    "order/site list is the closest thing to it. When called by a customer, this is " +
    "automatically scoped to only " +
    "their own orders/sites - they can search within their own records but never see anyone " +
    "else's, and searching for another company's name simply returns no results.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Order number, customer name, site company name, or site address/location (partial match)." },
      openOnly: { type: "boolean", description: "True = only open orders: no site yet, or the site has not yet reached the Commissioned SITC stage (commissioned / customer sign-off = closed)." },
      stageKey: { type: "string", description: "Optional: only orders whose site is currently at this SITC stage key, e.g. dispatched, installing, commissioned, customer_signoff." },
    },
  },
  handler: async (input, auth) => {
    const query = input.query ? String(input.query) : undefined;
    const openOnly = input.openOnly === true;
    const stageKey = input.stageKey ? String(input.stageKey).trim() : undefined;
    const searchClauses: Prisma.OrderWhereInput = query
      ? {
          OR: [
            { orderNumber: { contains: query, mode: "insensitive" } },
            { customer: { name: { contains: query, mode: "insensitive" } } },
            { site: { is: { address: { contains: query, mode: "insensitive" } } } },
            { site: { is: { companyName: { contains: query, mode: "insensitive" } } } },
            { product: { is: { name: { contains: query, mode: "insensitive" } } } },
            { product: { is: { model: { contains: query, mode: "insensitive" } } } },
            { product: { is: { ratingSpec: { contains: query, mode: "insensitive" } } } },
            { lineItems: { some: { product: { is: { name: { contains: query, mode: "insensitive" } } } } } },
            { lineItems: { some: { product: { is: { model: { contains: query, mode: "insensitive" } } } } } },
            { lineItems: { some: { product: { is: { ratingSpec: { contains: query, mode: "insensitive" } } } } } },
          ],
        }
      : {};

    const filters: Prisma.OrderWhereInput[] = [searchClauses];
    if (auth.customerId) {
      // A customer's own id comes from their authenticated session (middleware/auth.ts), never
      // from tool input, so this scoping can't be bypassed by anything the model or user types.
      if (!auth.permissions.has(PERMISSION_KEY.VIEW_SITE_STATUS)) return forbidden("your sites");
      filters.unshift({ customerId: auth.customerId });
    } else {
      if (!auth.permissions.has(PERMISSION_KEY.MANAGE_ORDERS)) return forbidden("orders");
    }

    // Stages are DB rows, so the Commissioned cutoff is read by key/label, not hard-coded
    // (sequenceOrder 11 in the seed, just before customer_signoff).
    const [commissionedStage, finalStage] = await Promise.all([
      prisma.stageDefinition.findFirst({
        where: { OR: [{ key: STAGE_KEY.COMMISSIONED }, { label: { equals: "Commissioned", mode: "insensitive" } }] },
        orderBy: { sequenceOrder: "asc" },
        select: { label: true, sequenceOrder: true },
      }),
      prisma.stageDefinition.findFirst({
        orderBy: { sequenceOrder: "desc" },
        select: { label: true, sequenceOrder: true },
      }),
    ]);
    const { closedFromSeq, openDefinition } = resolveOpenCutoff(commissionedStage, finalStage);
    if (openOnly && closedFromSeq != null) filters.push(orderOpenWhere(closedFromSeq));
    if (stageKey) filters.push({ site: { is: { currentStage: { key: stageKey } } } });
    const where: Prisma.OrderWhereInput = { AND: filters };

    const productLabel = (p: { name: string; model: string }) => `${p.name} (${p.model})`;
    const [orders, allMatching] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          customer: { select: { name: true } },
          product: { select: { name: true, model: true } },
          lineItems: { include: { product: { select: { name: true, model: true } } } },
          site: { include: { currentStage: true, assignedEngineer: { select: { name: true } }, vendor: { select: { name: true } } } },
        },
        orderBy: { createdAt: "desc" },
        take: RESULT_LIMIT,
      }),
      // Slim copy of the FULL filtered set, only for the totals.
      prisma.order.findMany({
        where,
        select: {
          value: true,
          quantity: true,
          product: { select: { name: true, model: true } },
          lineItems: { select: { quantity: true, product: { select: { name: true, model: true } } } },
          site: { select: { currentStage: { select: { label: true, sequenceOrder: true } } } },
        },
      }),
    ]);

    const totals = summarizeOrders(
      allMatching.map((o) => ({
        value: num(o.value),
        quantity: o.quantity,
        product: productLabel(o.product),
        lineItems: o.lineItems.map((li) => ({ product: productLabel(li.product), quantity: li.quantity })),
        stage: o.site ? o.site.currentStage : null,
      })),
      closedFromSeq,
    );

    return {
      ...listMeta(orders.length, allMatching.length),
      openDefinition,
      totals,
      orders: orders.map((o) => ({
        id: o.id, orderNumber: o.orderNumber, customer: o.customer.name,
        product: productLabel(o.product), quantity: o.quantity,
        additionalLineItems: o.lineItems.map((li) => ({
          product: productLabel(li.product), quantity: li.quantity,
        })),
        value: num(o.value),
        orderDate: o.orderDate, promisedDeliveryDate: o.promisedDeliveryDate, actualDispatchDate: o.actualDispatchDate,
        open: isOrderOpen(o.site?.currentStage.sequenceOrder ?? null, closedFromSeq),
        site: o.site
          ? {
              id: o.site.id,
              address: o.site.address,
              companyName: o.site.companyName,
              currentStage: o.site.currentStage.label,
              assignedEngineer: o.site.assignedEngineer?.name ?? null,
              vendor: o.site.vendor?.name ?? null,
            }
          : null,
      })),
    };
  },
};

const searchSiteStatusUpdates: AgentTool = {
  name: "search_site_status_updates",
  description:
    "List the SITC timeline entries (status-update history) already posted for a site - the " +
    "read-only counterpart to create_site_status_update. Resolve siteId first with " +
    "search_orders_and_sites (use the site's own \"id\" field, not the order's id). Returns " +
    "each entry's stage, status, comment, who posted it, and when, most recent first. Use " +
    "this whenever asked to view/summarise/recall past updates for a site, or to check the " +
    "current/last-logged stage before calling create_site_status_update.",
  inputSchema: {
    type: "object",
    properties: {
      siteId: { type: "string", description: "Site id, from search_orders_and_sites' site.id field (not the order id)." },
    },
    required: ["siteId"],
  },
  handler: async (input, auth) => {
    const siteId = String(input.siteId ?? "").trim();
    if (!siteId) return { error: "siteId is required - look it up with search_orders_and_sites first." };

    const site = await prisma.site.findUnique({
      where: { id: siteId },
      include: { order: { select: { customerId: true, orderNumber: true } } },
    });
    if (!site) return { error: `No site found with id ${siteId}. Use search_orders_and_sites first.` };

    if (auth.customerId) {
      // A customer's own id comes from their authenticated session, never tool input - they
      // can only ever view their own site's timeline.
      if (!auth.permissions.has(PERMISSION_KEY.VIEW_SITE_STATUS)) return forbidden("site status updates");
      if (site.order.customerId !== auth.customerId) return forbidden("this site's status updates");
    } else {
      if (!hasAny(auth, [PERMISSION_KEY.VIEW_SITE_STATUS, PERMISSION_KEY.CHANGE_SITE_STATUS, PERMISSION_KEY.MANAGE_ORDERS]))
        return forbidden("site status updates");
      // Vendor isolation, mirroring create_site_status_update: an erection vendor's engineers
      // only see updates for sites assigned to their own vendor.
      if (auth.vendorId && site.vendorId !== auth.vendorId) return forbidden("this site's status updates");
    }

    const [events, totalCount] = await Promise.all([
      prisma.siteStageEvent.findMany({
        where: { siteId },
        include: {
          stageDefinition: { select: { label: true } },
          statusOption: { select: { label: true } },
          createdBy: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: RESULT_LIMIT,
      }),
      prisma.siteStageEvent.count({ where: { siteId } }),
    ]);

    return {
      ...listMeta(events.length, totalCount),
      site: site.companyName ?? site.address,
      orderNumber: site.order.orderNumber,
      updates: events.map((e) => ({
        id: e.id,
        stage: e.stageDefinition.label,
        status: e.statusOption.label,
        comment: e.comment,
        postedBy: e.createdBy.name,
        postedAt: e.createdAt,
      })),
    };
  },
};

const searchWorkOrders: AgentTool = {
  name: "search_work_orders",
  description:
    "Search internal work orders (field-crew task dispatch) by title or work order number. " +
    "Returns id, workOrderNumber, title, taskType, status, assignedTo, scheduledDate, site. " +
    "totalCount and byStatus cover ALL matching work orders, not just the listed rows.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Title or work order number (partial match)." },
      status: { type: "string", description: "Optional filter: draft | assigned | in_progress | completed | cancelled" },
    },
  },
  handler: async (input, auth) => {
    if (!hasAny(auth, [PERMISSION_KEY.MANAGE_WORK_ORDERS, PERMISSION_KEY.ACT_ASSIGNED_WORK_ORDERS])) return forbidden("work orders");
    const query = input.query ? String(input.query) : undefined;
    const status = input.status ? String(input.status) : undefined;
    const where: Prisma.WorkOrderWhereInput = auth.permissions.has(PERMISSION_KEY.MANAGE_WORK_ORDERS) ? {} : { assignedToId: auth.userId };
    if (status) where.status = status;
    if (query) where.OR = [{ title: { contains: query, mode: "insensitive" } }, { workOrderNumber: { contains: query, mode: "insensitive" } }];
    const [workOrders, groups] = await Promise.all([
      prisma.workOrder.findMany({
        where,
        include: { site: { include: { order: { include: { customer: { select: { name: true } } } } } }, assignedTo: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: RESULT_LIMIT,
      }),
      prisma.workOrder.groupBy({ by: ["status"], where, _count: { _all: true } }),
    ]);
    const summary = statusBreakdown(groups);
    return {
      ...listMeta(workOrders.length, summary.totalCount),
      byStatus: summary.byStatus,
      results: workOrders.map((w) => ({
        id: w.id, workOrderNumber: w.workOrderNumber, title: w.title, taskType: w.taskType, status: w.status,
        assignedTo: w.assignedTo?.name ?? null, scheduledDate: w.scheduledDate,
        customer: w.site.order.customer.name,
      })),
    };
  },
};

const searchComplaints: AgentTool = {
  name: "search_complaints",
  description:
    "Search customer complaints by ticket number or customer name. Returns id, ticketNumber, " +
    "customer, category, severity, status, assignedTo. totalCount and byStatus cover ALL " +
    "matching complaints, not just the listed rows.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Ticket number or customer name (partial match)." },
      status: { type: "string", description: "Optional filter: open | in_progress | resolved | closed (see COMPLAINT_STATUS)" },
    },
  },
  handler: async (input, auth) => {
    if (
      !hasAny(auth, [
        PERMISSION_KEY.MANAGE_COMPLAINTS,
        PERMISSION_KEY.VIEW_COMPLAINTS_OVERVIEW,
        PERMISSION_KEY.ACT_ASSIGNED_COMPLAINTS,
      ])
    )
      return forbidden("complaints");
    const query = input.query ? String(input.query) : undefined;
    const status = input.status ? String(input.status) : undefined;
    const where: Prisma.ComplaintWhereInput = {};
    if (!auth.permissions.has(PERMISSION_KEY.MANAGE_COMPLAINTS) && !auth.permissions.has(PERMISSION_KEY.VIEW_COMPLAINTS_OVERVIEW)) {
      where.assignedToId = auth.userId;
    }
    if (status) where.status = status;
    if (query) where.OR = [{ ticketNumber: { contains: query, mode: "insensitive" } }, { customer: { name: { contains: query, mode: "insensitive" } } }];
    const [complaints, groups] = await Promise.all([
      prisma.complaint.findMany({
        where,
        include: { customer: { select: { name: true } }, assignedTo: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: RESULT_LIMIT,
      }),
      prisma.complaint.groupBy({ by: ["status"], where, _count: { _all: true } }),
    ]);
    const summary = statusBreakdown(groups);
    return {
      ...listMeta(complaints.length, summary.totalCount),
      byStatus: summary.byStatus,
      results: complaints.map((c) => ({
        id: c.id, ticketNumber: c.ticketNumber, customer: c.customer.name, category: c.category,
        severity: c.severity, status: c.status, assignedTo: c.assignedTo?.name ?? null,
      })),
    };
  },
};

const searchSavedItems: AgentTool = {
  name: "search_saved_items",
  description:
    "Search the company's saved/standard billing items (reusable line items like 'Installation " +
    "labour' or 'Crane hire', each with a standard price and HSN code) - returns id, name, " +
    "hsnCode, standardPrice, taxRatePct. Call this before drafting a quotation, invoice, or " +
    "purchase order, and offer matching items to the user by name and price rather than " +
    "inventing line items yourself.",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string", description: "Name (or partial name) to search for. Omit to list all standard items." } },
  },
  handler: async (input, auth) => {
    if (!hasAny(auth, [PERMISSION_KEY.MANAGE_QUOTATIONS, PERMISSION_KEY.MANAGE_INVOICES, PERMISSION_KEY.MANAGE_PURCHASE_ORDERS]))
      return forbidden("saved items");
    const query = input.query ? String(input.query) : undefined;
    const where: Prisma.SavedLineItemWhereInput = {
      active: true,
      ...(query ? { name: { contains: query, mode: "insensitive" } } : {}),
    };
    const [items, totalCount] = await Promise.all([
      prisma.savedLineItem.findMany({ where, orderBy: { name: "asc" }, take: RESULT_LIMIT }),
      prisma.savedLineItem.count({ where }),
    ]);
    return listPage(
      items.map((i) => ({
        id: i.id, name: i.name, hsnCode: i.hsnCode, standardPrice: num(i.standardPrice), taxRatePct: num(i.taxRatePct),
      })),
      totalCount,
    );
  },
};

const getCustomerPricing: AgentTool = {
  name: "get_customer_pricing",
  description:
    "Look up one customer's negotiated prices - both for RECD products and for saved/standard " +
    "billing items - which may differ from the company-wide standard price. Call this once the " +
    "customer for a quotation or invoice is resolved, and prefer these prices over the generic " +
    "standard price when offering items to the user, calling out when a customer's rate differs " +
    "from the standard one.",
  inputSchema: {
    type: "object",
    properties: { customerId: { type: "string", description: "Customer id, from search_customers." } },
    required: ["customerId"],
  },
  handler: async (input, auth) => {
    if (!hasAny(auth, [PERMISSION_KEY.MANAGE_QUOTATIONS, PERMISSION_KEY.MANAGE_INVOICES, PERMISSION_KEY.MANAGE_PURCHASE_ORDERS]))
      return forbidden("customer pricing");
    const customerId = String(input.customerId ?? "");
    if (!customerId) return { error: "customerId is required." };

    const [productPrices, savedItemPrices] = await Promise.all([
      prisma.customerProductPrice.findMany({ where: { customerId }, include: { product: { select: { name: true, model: true } } } }),
      prisma.customerSavedItemPrice.findMany({ where: { customerId }, include: { savedItem: { select: { name: true, standardPrice: true } } } }),
    ]);

    return {
      products: productPrices.map((p) => ({ productId: p.productId, productName: `${p.product.name} (${p.product.model})`, price: num(p.price) })),
      savedItems: savedItemPrices.map((p) => ({
        savedItemId: p.savedItemId,
        name: p.savedItem.name,
        standardPrice: num(p.savedItem.standardPrice),
        customerPrice: num(p.price),
      })),
    };
  },
};

const searchProducts: AgentTool = {
  name: "search_products",
  description:
    "Search the RECD product catalog by name, model, or rating spec (e.g. 'RECD-500', '500', " +
    "'625 kVA'). Returns id, name, model, rating spec, capacity (kVA), warranty, shape, " +
    "dimensions, and weight (weightKg) - this is the only tool that has weight/dimensions/shape, " +
    "so use it directly for any question about a product's specs instead of assuming the data " +
    "doesn't exist. Omit the query to list the whole catalog.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Name, model, or rating spec to search for (partial match). Omit to list all products.",
      },
    },
  },
  handler: async (input, auth) => {
    if (!auth.permissions.has(PERMISSION_KEY.MANAGE_ORDERS)) return forbidden("products");
    const query = input.query ? String(input.query) : undefined;
    const where: Prisma.ProductWhereInput = query
      ? {
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { model: { contains: query, mode: "insensitive" } },
            { ratingSpec: { contains: query, mode: "insensitive" } },
          ],
        }
      : {};
    const [products, totalCount] = await Promise.all([
      prisma.product.findMany({ where, orderBy: { model: "asc" }, take: RESULT_LIMIT }),
      prisma.product.count({ where }),
    ]);
    return listPage(
      products.map((p) => ({
        id: p.id, name: p.name, model: p.model, ratingSpec: p.ratingSpec,
        capacityKva: num(p.capacityKva), warrantyMonths: p.warrantyMonths,
        shape: p.shape, dimensions: p.dimensions, weightKg: num(p.weightKg),
        silencerType: p.silencerType,
      })),
      totalCount,
    );
  },
};

const getCustomerLedger: AgentTool = {
  name: "get_customer_ledger",
  description:
    "Get one customer's running account statement (Accounting-Lite Phase A) - a date-ordered " +
    "list of every issued invoice (debit), payment received including TDS (credit), and " +
    "issued credit note (credit) against them, with a running balance and an opening/closing " +
    "balance for the range. A positive closing balance means the customer owes us that much; " +
    "negative means we're holding an unallocated advance from them. Resolve the customerId " +
    "with search_customers first. Omit from/to for the full history.",
  inputSchema: {
    type: "object",
    properties: {
      customerId: { type: "string", description: "Customer id, from search_customers." },
      from: { type: "string", description: "Optional start date, YYYY-MM-DD." },
      to: { type: "string", description: "Optional end date, YYYY-MM-DD." },
    },
    required: ["customerId"],
  },
  handler: async (input, auth) => {
    if (!auth.permissions.has(PERMISSION_KEY.VIEW_LEDGERS)) return forbidden("ledgers");
    const customerId = String(input.customerId ?? "");
    if (!customerId) return { error: "customerId is required." };
    const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, name: true } });
    if (!customer) return { error: `No customer found with id ${customerId}.` };
    const from = input.from ? new Date(String(input.from)) : undefined;
    const to = input.to ? new Date(String(input.to)) : undefined;
    const statement = await buildCustomerLedger(customerId, from, to);
    // Unambiguous yyyy-mm-dd (IST) dates instead of UTC timestamps the model misreads.
    return { customer: customer.name, ...statement, entries: statement.entries.map((e) => ({ ...e, date: e.date ? isoDateIST(e.date) : null })) };
  },
};

const searchCreditNotes: AgentTool = {
  name: "search_credit_notes",
  description:
    "Search GST credit notes (Accounting-Lite Phase B) by note number, invoice number, or " +
    "customer name. Returns id, noteNumber, status, reason, invoice it's against, customer, " +
    "issueDate, and total. Use get_document_detail (docType 'invoice') on the invoice to see " +
    "all credit notes issued against it alongside its payment history. totalCount, totalValue " +
    "and byStatus cover ALL matching credit notes (only issued ones reduce what is owed).",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Note number, invoice number, or customer name (partial match)." },
      status: { type: "string", description: "Optional filter: draft | issued | cancelled" },
    },
  },
  handler: async (input, auth) => {
    if (!auth.permissions.has(PERMISSION_KEY.MANAGE_CREDIT_NOTES)) return forbidden("credit notes");
    const query = input.query ? String(input.query) : undefined;
    const status = input.status ? String(input.status) : undefined;
    const where: Prisma.CreditNoteWhereInput = {
      ...(status ? { status } : {}),
      ...(query
        ? {
            OR: [
              { noteNumber: { contains: query, mode: "insensitive" } },
              { invoice: { invoiceNumber: { contains: query, mode: "insensitive" } } },
              { customer: { name: { contains: query, mode: "insensitive" } } },
            ],
          }
        : {}),
    };
    const [notes, groups] = await Promise.all([
      prisma.creditNote.findMany({
        where,
        include: { customer: { select: { name: true } }, invoice: { select: { id: true, invoiceNumber: true } } },
        orderBy: { issueDate: "desc" },
        take: RESULT_LIMIT,
      }),
      prisma.creditNote.groupBy({ by: ["status"], where, _count: { _all: true }, _sum: { total: true } }),
    ]);
    const summary = statusBreakdown(groups);
    return {
      ...listMeta(notes.length, summary.totalCount),
      totalValue: summary.totalValue,
      byStatus: summary.byStatus,
      results: notes.map((n) => ({
        id: n.id, noteNumber: n.status === "draft" ? `DRAFT-${n.id}` : n.noteNumber, status: n.status,
        reason: n.reason, customer: n.customer.name,
        invoice: { id: n.invoice.id, invoiceNumber: n.invoice.invoiceNumber },
        issueDate: n.issueDate, total: num(n.total),
      })),
    };
  },
};

const getCustomerAdvances: AgentTool = {
  name: "get_customer_advances",
  description:
    "Get one customer's unallocated payment advances (Accounting-Lite Phase C) - payments " +
    "received that haven't been fully applied to an invoice yet. Returns each payment's " +
    "amount, method, date, and the unallocated remainder still sitting as credit. Resolve " +
    "the customerId with search_customers first.",
  inputSchema: {
    type: "object",
    properties: { customerId: { type: "string", description: "Customer id, from search_customers." } },
    required: ["customerId"],
  },
  handler: async (input, auth) => {
    if (!hasAny(auth, [PERMISSION_KEY.RECORD_PAYMENTS, PERMISSION_KEY.MANAGE_INVOICES, PERMISSION_KEY.VIEW_LEDGERS]))
      return forbidden("customer advances");
    const customerId = String(input.customerId ?? "");
    if (!customerId) return { error: "customerId is required." };
    const payments = await prisma.paymentReceived.findMany({
      where: { customerId },
      include: { allocations: { select: { amount: true } } },
      orderBy: { receivedDate: "desc" },
    });
    return payments
      .map((p) => {
        const allocated = p.allocations.reduce((s, a) => s.plus(a.amount), new Prisma.Decimal(0));
        const unallocated = new Prisma.Decimal(p.amount).minus(allocated);
        return {
          id: p.id, amount: num(p.amount), method: p.method, receivedDate: isoDateIST(p.receivedDate),
          reference: p.reference, unallocatedAmount: num(unallocated),
        };
      })
      .filter((p) => p.unallocatedAmount !== null && p.unallocatedAmount > 0.01);
  },
};

export interface PaymentSummaryRow {
  /** yyyy-mm-dd (IST) - see isoDateIST. */
  receivedDate: string;
  amount: number | null;
  tdsAmount: number | null;
  method: string;
  unallocatedAmount: number | null;
}

/** Same labels as the admin-web Payments page (apps/admin-web/src/lib/finance.ts PAYMENT_METHOD_LABEL). */
const PAYMENT_METHOD_LABEL: Record<string, string> = {
  bank_transfer: "Bank Transfer", upi: "UPI", cheque: "Cheque", cash: "Cash", tds: "TDS Deducted", other: "Other",
};

/** Resolves a method filter typed by the model or user ("TDS Deducted", "Bank transfer", "upi")
 * to the stored PAYMENT_METHOD key, so "TDS Deducted" finds the legacy method="tds" rows. */
export function resolvePaymentMethodFilter(input: string): string {
  const key = normalizePaymentMethod(input).replace(/[\s-]+/g, "_");
  const byLabel = Object.entries(PAYMENT_METHOD_LABEL).find(([, label]) => label.toLowerCase().replace(/\s+/g, "_") === key);
  if (byLabel) return byLabel[0];
  return key === "tds_deducted" ? PAYMENT_METHOD.TDS : key;
}

// Cash/TDS split (legacy "TDS Deducted" rows are all TDS) lives in services/paymentSplit.ts,
// shared with the TDS register, customer ledger and finance dashboard; re-exported for tests.
export { paymentCashAndTds, normalizePaymentMethod };

function paymentGroupTotals(group: PaymentSummaryRow[]) {
  const split = group.map(paymentCashAndTds);
  return {
    count: group.length,
    amount: sumMoney(group.map((r) => r.amount)),
    cash: sumMoney(split.map((s) => s.cash)),
    tds: sumMoney(split.map((s) => s.tds)),
  };
}

/** Totals, per-month and per-method totals over EVERY payment passed in; lists the newest `listLimit`.
 * `amount` matches the Payments page Amount column (legacy TDS-method rows included); `cash`
 * excludes them; `tds` = tdsAmount + legacy TDS-method amounts; settled = cash + tds. */
export function summarizePayments<T extends PaymentSummaryRow>(rows: T[], listLimit: number) {
  const sorted = [...rows].sort((a, b) => b.receivedDate.localeCompare(a.receivedDate));
  const months = new Map<string, T[]>();
  const methods = new Map<string, T[]>();
  for (const r of sorted) {
    const month = r.receivedDate.slice(0, 7);
    months.set(month, [...(months.get(month) ?? []), r]);
    const method = normalizePaymentMethod(r.method);
    methods.set(method, [...(methods.get(method) ?? []), r]);
  }
  const listed = sorted.slice(0, listLimit);
  const all = paymentGroupTotals(rows);
  return {
    ...listMeta(listed.length, rows.length),
    totals: {
      count: all.count,
      totalAmount: all.amount,
      cashAmount: all.cash,
      totalTds: all.tds,
      totalSettled: sumMoney([all.cash, all.tds]),
      unallocatedAmount: sumMoney(rows.map((r) => r.unallocatedAmount)),
    },
    firstPaymentDate: sorted.length > 0 ? sorted[sorted.length - 1].receivedDate : null,
    lastPaymentDate: sorted.length > 0 ? sorted[0].receivedDate : null,
    byMonth: [...months.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, group]) => ({ month, ...paymentGroupTotals(group) })),
    byMethod: [...methods.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([method, group]) => ({ method, label: PAYMENT_METHOD_LABEL[method] ?? method, ...paymentGroupTotals(group) })),
    payments: listed,
  };
}

/** Collections had no agent tool at all, so "when/how much did we collect" was answered from
 * whatever partial rows other tools happened to show (2026-10: "all payments fell in Apr, Jun,
 * Jul" when they run Dec 2025 - Aug 2026). Same permission as GET /payments. */
const searchPayments: AgentTool = {
  name: "search_payments",
  description:
    "Search payments RECEIVED from customers (collections), optionally by customer name, " +
    "payment reference/UTR or invoice number, a receivedDate range and method. Lists the 15 " +
    "most recent: id, customer, receivedDate (yyyy-mm-dd, the actual payment date), amount " +
    "(as on the Payments page), tdsAmount, method, reference, allocatedTo (invoices it settled) and " +
    "unallocatedAmount (advance). ALWAYS also returns totalCount, totals {count, totalAmount, " +
    "cashAmount, totalTds, totalSettled, unallocatedAmount}, firstPaymentDate, lastPaymentDate, " +
    "byMonth (count/amount/cash/tds per yyyy-mm) and byMethod (count/amount/cash/tds per method) " +
    "over EVERY matching payment - use those for any 'how much did we collect', 'which months', " +
    "TDS or trend question; never infer months or totals from the listed rows. TDS = tdsAmount " +
    "plus the whole amount of method 'tds' (\"TDS Deducted\") rows - always quote the tds/totalTds " +
    "fields, never sum tdsAmount yourself. amount = cash + legacy TDS-method rows.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Customer name, payment reference, or invoice number (partial match)." },
      customerId: { type: "string", description: "Optional customer id, from search_customers." },
      from: { type: "string", description: "Optional first receivedDate to include, YYYY-MM-DD." },
      to: { type: "string", description: "Optional last receivedDate to include, YYYY-MM-DD." },
      method: { type: "string", description: "Optional filter: bank_transfer | upi | cheque | cash | tds (\"TDS Deducted\") | other. Omit it for TDS questions - totals/byMonth/byMethod already split TDS out." },
    },
  },
  handler: async (input, auth) => {
    if (auth.customerId || !hasAny(auth, [PERMISSION_KEY.RECORD_PAYMENTS, PERMISSION_KEY.MANAGE_INVOICES])) return forbidden("payments");
    const query = input.query ? String(input.query).trim() : "";
    const customerId = input.customerId ? String(input.customerId) : undefined;
    const method = input.method ? resolvePaymentMethodFilter(String(input.method)) : undefined;
    const from = input.from ? istDayStart(String(input.from).trim()) : undefined;
    const toStart = input.to ? istDayStart(String(input.to).trim()) : undefined;
    if ((input.from && !from) || (input.to && !toStart)) return { error: "from/to must be dates in YYYY-MM-DD format." };
    const toExclusive = toStart ? new Date(toStart.getTime() + 86_400_000) : undefined;

    const where: Prisma.PaymentReceivedWhereInput = {
      ...(customerId ? { customerId } : {}),
      ...(method ? { method } : {}),
      ...(from || toExclusive ? { receivedDate: { ...(from ? { gte: from } : {}), ...(toExclusive ? { lt: toExclusive } : {}) } } : {}),
      ...(query
        ? {
            OR: [
              { customer: { name: { contains: query, mode: "insensitive" } } },
              { reference: { contains: query, mode: "insensitive" } },
              { allocations: { some: { invoice: { invoiceNumber: { contains: query, mode: "insensitive" } } } } },
            ],
          }
        : {}),
    };
    // No take: totals and byMonth must cover every matching payment; summarizePayments caps the list.
    const payments = await prisma.paymentReceived.findMany({
      where,
      include: {
        customer: { select: { name: true } },
        allocations: { select: { amount: true, invoice: { select: { id: true, invoiceNumber: true } } } },
      },
      orderBy: { receivedDate: "desc" },
    });
    const rows = payments.map((p) => {
      const allocated = p.allocations.reduce((s, a) => s.plus(a.amount), new Prisma.Decimal(0));
      return {
        id: p.id, customer: p.customer.name, receivedDate: isoDateIST(p.receivedDate),
        amount: num(p.amount), tdsAmount: num(p.tdsAmount), method: p.method, reference: p.reference,
        allocatedTo: p.allocations.map((a) => ({ invoiceId: a.invoice.id, invoiceNumber: a.invoice.invoiceNumber, amount: num(a.amount) })),
        unallocatedAmount: num(new Prisma.Decimal(p.amount).minus(allocated)),
      };
    });
    return summarizePayments(rows, RESULT_LIMIT);
  },
};

export const zanAppReadTools: AgentTool[] = [
  searchCustomers,
  searchVendors,
  searchSuppliers,
  searchQuotations,
  searchInvoices,
  searchPurchaseOrders,
  searchExpenses,
  searchOrdersAndSites,
  searchSiteStatusUpdates,
  searchWorkOrders,
  searchComplaints,
  searchSavedItems,
  searchProducts,
  getCustomerPricing,
  getCustomerLedger,
  searchCreditNotes,
  getCustomerAdvances,
  searchPayments,
];
