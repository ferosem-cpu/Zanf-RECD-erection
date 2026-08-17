/** Read-only Zan-APP data tools for the in-app agent (§56 plan in HANDOVER.md, "Part A").
 * Each tool mirrors the permission logic of the equivalent REST route (see apps/api/src/routes)
 * rather than re-deriving it, and returns lightweight summaries - use get_document_detail for
 * full line-item drill-down on a specific document. All money fields are returned as plain
 * numbers (2dp) for the LLM to reason over; this is NOT used for anything that writes back to
 * the DB, so Decimal precision loss here is safe.
 */
import { Prisma } from "@prisma/client";
import { PERMISSION_KEY } from "@recd/shared";
import { prisma } from "../../lib/prisma";
import type { AgentTool, AgentAuthContext } from "./types";

const RESULT_LIMIT = 15;

function forbidden(what: string) {
  return { error: `You don't have permission to view ${what}.` };
}

function hasAny(auth: AgentAuthContext, keys: string[]): boolean {
  return keys.some((k) => auth.permissions.has(k));
}

function num(d: Prisma.Decimal | null | undefined): number | null {
  return d == null ? null : Number(d);
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
    const customers = await prisma.customer.findMany({
      where: query ? { name: { contains: query, mode: "insensitive" } } : undefined,
      include: { contacts: { select: { name: true, phone: true, email: true } } },
      orderBy: { name: "asc" },
      take: RESULT_LIMIT,
    });
    return customers.map((c) => ({
      id: c.id, name: c.name, gstin: c.gstin, state: c.state,
      contacts: c.contacts,
    }));
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
    const vendors = await prisma.vendor.findMany({
      where: {
        ...(query ? { name: { contains: query, mode: "insensitive" } } : {}),
        ...(status ? { status } : {}),
      },
      include: { _count: { select: { members: true, sites: true } } },
      orderBy: [{ status: "asc" }, { name: "asc" }],
      take: RESULT_LIMIT,
    });
    return vendors.map((v) => ({
      id: v.id, name: v.name, status: v.status, contactName: v.contactName,
      contactEmail: v.contactEmail, contactPhone: v.contactPhone, address: v.address,
      memberCount: v._count.members, siteCount: v._count.sites, approvedAt: v.approvedAt,
    }));
  },
};

const searchQuotations: AgentTool = {
  name: "search_quotations",
  description:
    "Search quotations by quote number or customer name. Returns id, quoteNumber, customer, " +
    "status, issueDate, validUntil, and total. Use get_document_detail for line items.",
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
    const quotations = await prisma.quotation.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(query
          ? { OR: [{ quoteNumber: { contains: query, mode: "insensitive" } }, { customer: { name: { contains: query, mode: "insensitive" } } }] }
          : {}),
      },
      include: { customer: { select: { name: true } } },
      orderBy: { quoteNumber: "asc" },
      take: RESULT_LIMIT,
    });
    return quotations.map((q) => ({
      id: q.id, quoteNumber: q.quoteNumber, customer: q.customer.name, status: q.status,
      issueDate: q.issueDate, validUntil: q.validUntil, total: num(q.total),
    }));
  },
};

const searchInvoices: AgentTool = {
  name: "search_invoices",
  description:
    "Search invoices (proforma or tax invoice) by invoice number or customer name. Returns " +
    "id, invoiceNumber, docType, customer, status, issueDate, dueDate, total, amountPaid, " +
    "balance, and whether it's overdue. Use get_document_detail for line items/payments.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Invoice number or customer name (partial match)." },
      status: { type: "string", description: "Optional filter: draft | issued | partially_paid | paid | cancelled" },
    },
  },
  handler: async (input, auth) => {
    if (!auth.permissions.has(PERMISSION_KEY.MANAGE_INVOICES)) return forbidden("invoices");
    const query = input.query ? String(input.query) : undefined;
    const status = input.status ? String(input.status) : undefined;
    const invoices = await prisma.invoice.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(query
          ? { OR: [{ invoiceNumber: { contains: query, mode: "insensitive" } }, { customer: { name: { contains: query, mode: "insensitive" } } }] }
          : {}),
      },
      include: { customer: { select: { name: true } }, payments: { select: { amount: true } } },
      orderBy: { invoiceNumber: "asc" },
      take: RESULT_LIMIT,
    });
    const now = Date.now();
    return invoices.map((inv) => {
      const paid = inv.payments.reduce((s, p) => s.plus(p.amount), new Prisma.Decimal(0));
      const balance = new Prisma.Decimal(inv.total).minus(paid);
      const overdue = ["issued", "partially_paid"].includes(inv.status) && !!inv.dueDate && inv.dueDate.getTime() < now;
      return {
        id: inv.id,
        invoiceNumber: inv.status === "draft" ? `DRAFT-${inv.id}` : inv.invoiceNumber,
        docType: inv.docType, customer: inv.customer.name, status: inv.status,
        issueDate: inv.issueDate, dueDate: inv.dueDate, total: num(inv.total),
        amountPaid: num(paid), balance: num(balance), overdue,
      };
    });
  },
};

const searchPurchaseOrders: AgentTool = {
  name: "search_purchase_orders",
  description:
    "Search purchase orders by PO number or supplier name. Returns id, poNumber, supplier, " +
    "status, orderDate, expectedDate, and total. Use get_document_detail for line items.",
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
    const pos = await prisma.purchaseOrder.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(query
          ? { OR: [{ poNumber: { contains: query, mode: "insensitive" } }, { supplier: { name: { contains: query, mode: "insensitive" } } }] }
          : {}),
      },
      include: { supplier: { select: { name: true } } },
      orderBy: { poNumber: "asc" },
      take: RESULT_LIMIT,
    });
    return pos.map((po) => ({
      id: po.id, poNumber: po.poNumber, supplier: po.supplier.name, status: po.status,
      orderDate: po.orderDate, expectedDate: po.expectedDate, total: num(po.total),
    }));
  },
};

const searchExpenses: AgentTool = {
  name: "search_expenses",
  description:
    "Search the expense book (non-PO spend: fuel, travel, site consumables, misc) by " +
    "description or category. Returns id, description, category, amount, date, method, site.",
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
    const expenses = await prisma.expense.findMany({
      where: {
        ...(query ? { description: { contains: query, mode: "insensitive" } } : {}),
        ...(categoryKey ? { category: { key: categoryKey } } : {}),
      },
      include: { category: { select: { label: true } }, site: { select: { address: true } } },
      orderBy: { expenseDate: "desc" },
      take: RESULT_LIMIT,
    });
    return expenses.map((e) => ({
      id: e.id, description: e.description, category: e.category.label, amount: num(e.amount),
      expenseDate: e.expenseDate, method: e.method, site: e.site?.address ?? null,
    }));
  },
};

const searchOrdersAndSites: AgentTool = {
  name: "search_orders_and_sites",
  description:
    "Search sales orders (and their site's SITC progress) by order number, customer name, " +
    "site/end-client company name (e.g. 'BPCL', 'VRL'), or site address/location (e.g. " +
    "'Belgaum', 'Bangalore') - matches any of these, not just order number or customer. " +
    "Returns id, orderNumber, customer, product, quantity, additionalLineItems (extra products " +
    "on the same order, if any - an order can carry more than one RECD/product), order value, " +
    "dispatch dates, and - if a site exists - its address, end-client company name, current " +
    "SITC stage, assigned engineer, and erection vendor. When answering 'how many RECDs/units " +
    "at <site>', always add the base quantity to every additionalLineItems quantity - a single " +
    "site can have multiple RECDs on one order. Use this for any 'how many/which sites are in " +
    "<place>' question - there's no separate stock/inventory-by-location feature, so this " +
    "order/site list is the closest thing to it. When called by a customer, this is " +
    "automatically scoped to only " +
    "their own orders/sites - they can search within their own records but never see anyone " +
    "else's, and searching for another company's name simply returns no results.",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string", description: "Order number, customer name, site company name, or site address/location (partial match)." } },
  },
  handler: async (input, auth) => {
    const query = input.query ? String(input.query) : undefined;
    const searchClauses: Prisma.OrderWhereInput = query
      ? {
          OR: [
            { orderNumber: { contains: query, mode: "insensitive" } },
            { customer: { name: { contains: query, mode: "insensitive" } } },
            { site: { is: { address: { contains: query, mode: "insensitive" } } } },
            { site: { is: { companyName: { contains: query, mode: "insensitive" } } } },
          ],
        }
      : {};

    let where: Prisma.OrderWhereInput;
    if (auth.customerId) {
      // A customer's own id comes from their authenticated session (middleware/auth.ts), never
      // from tool input, so this scoping can't be bypassed by anything the model or user types.
      if (!auth.permissions.has(PERMISSION_KEY.VIEW_SITE_STATUS)) return forbidden("your sites");
      where = { AND: [{ customerId: auth.customerId }, searchClauses] };
    } else {
      if (!auth.permissions.has(PERMISSION_KEY.MANAGE_ORDERS)) return forbidden("orders");
      where = searchClauses;
    }

    const orders = await prisma.order.findMany({
      where,
      include: {
        customer: { select: { name: true } },
        product: { select: { name: true, model: true } },
        lineItems: { include: { product: { select: { name: true, model: true } } } },
        site: { include: { currentStage: true, assignedEngineer: { select: { name: true } }, vendor: { select: { name: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: RESULT_LIMIT,
    });
    return orders.map((o) => ({
      id: o.id, orderNumber: o.orderNumber, customer: o.customer.name,
      product: `${o.product.name} (${o.product.model})`, quantity: o.quantity,
      additionalLineItems: o.lineItems.map((li) => ({
        product: `${li.product.name} (${li.product.model})`, quantity: li.quantity,
      })),
      value: num(o.value),
      orderDate: o.orderDate, promisedDeliveryDate: o.promisedDeliveryDate, actualDispatchDate: o.actualDispatchDate,
      site: o.site
        ? {
            address: o.site.address,
            companyName: o.site.companyName,
            currentStage: o.site.currentStage.label,
            assignedEngineer: o.site.assignedEngineer?.name ?? null,
            vendor: o.site.vendor?.name ?? null,
          }
        : null,
    }));
  },
};

const searchWorkOrders: AgentTool = {
  name: "search_work_orders",
  description:
    "Search internal work orders (field-crew task dispatch) by title or work order number. " +
    "Returns id, workOrderNumber, title, taskType, status, assignedTo, scheduledDate, site.",
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
    const where: Record<string, unknown> = auth.permissions.has(PERMISSION_KEY.MANAGE_WORK_ORDERS) ? {} : { assignedToId: auth.userId };
    if (status) where.status = status;
    if (query) where.OR = [{ title: { contains: query, mode: "insensitive" } }, { workOrderNumber: { contains: query, mode: "insensitive" } }];
    const workOrders = await prisma.workOrder.findMany({
      where,
      include: { site: { include: { order: { include: { customer: { select: { name: true } } } } } }, assignedTo: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: RESULT_LIMIT,
    });
    return workOrders.map((w) => ({
      id: w.id, workOrderNumber: w.workOrderNumber, title: w.title, taskType: w.taskType, status: w.status,
      assignedTo: w.assignedTo?.name ?? null, scheduledDate: w.scheduledDate,
      customer: w.site.order.customer.name,
    }));
  },
};

const searchComplaints: AgentTool = {
  name: "search_complaints",
  description:
    "Search customer complaints by ticket number or customer name. Returns id, ticketNumber, " +
    "customer, category, severity, status, assignedTo.",
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
    const where: Record<string, unknown> = {};
    if (!auth.permissions.has(PERMISSION_KEY.MANAGE_COMPLAINTS) && !auth.permissions.has(PERMISSION_KEY.VIEW_COMPLAINTS_OVERVIEW)) {
      where.assignedToId = auth.userId;
    }
    if (status) where.status = status;
    if (query) where.OR = [{ ticketNumber: { contains: query, mode: "insensitive" } }, { customer: { name: { contains: query, mode: "insensitive" } } }];
    const complaints = await prisma.complaint.findMany({
      where,
      include: { customer: { select: { name: true } }, assignedTo: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: RESULT_LIMIT,
    });
    return complaints.map((c) => ({
      id: c.id, ticketNumber: c.ticketNumber, customer: c.customer.name, category: c.category,
      severity: c.severity, status: c.status, assignedTo: c.assignedTo?.name ?? null,
    }));
  },
};

export const zanAppReadTools: AgentTool[] = [
  searchCustomers,
  searchVendors,
  searchQuotations,
  searchInvoices,
  searchPurchaseOrders,
  searchExpenses,
  searchOrdersAndSites,
  searchWorkOrders,
  searchComplaints,
];
