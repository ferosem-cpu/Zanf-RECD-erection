/** Full-detail drill-down for one specific document, given the id returned by one of the
 * zanAppReadTools search_* tools. Kept as one dispatched tool (rather than one per docType)
 * so the agent only has to remember one shape: docType + id.
 */
import { Prisma } from "@prisma/client";
import { PERMISSION_KEY, CREDIT_NOTE_STATUS } from "@recd/shared";
import { prisma } from "../../lib/prisma";
import { settledFromAllocations, netInvoiceTotal } from "../../services/settlement";
import type { AgentTool, AgentAuthContext } from "./types";

const DOC_TYPES = [
  "customer", "vendor", "quotation", "invoice", "purchase_order",
  "expense", "order", "work_order", "complaint", "product",
] as const;
type DocType = (typeof DOC_TYPES)[number];

function forbidden(what: string) {
  return { error: `You don't have permission to view ${what}.` };
}

async function loadDetail(docType: DocType, id: string, auth: AgentAuthContext) {
  switch (docType) {
    case "customer":
      if (!auth.permissions.has(PERMISSION_KEY.MANAGE_ORDERS)) return forbidden("customers");
      return prisma.customer.findUnique({
        where: { id },
        include: {
          contacts: { select: { name: true, phone: true, email: true } },
          orders: { select: { id: true, orderNumber: true, value: true, orderDate: true } },
          quotations: { select: { id: true, quoteNumber: true, status: true, total: true } },
          invoices: { select: { id: true, invoiceNumber: true, status: true, total: true } },
        },
      });
    case "vendor":
      if (!auth.permissions.has(PERMISSION_KEY.MANAGE_VENDORS)) return forbidden("vendors");
      return prisma.vendor.findUnique({
        where: { id },
        include: {
          members: { select: { name: true, phone: true, email: true } },
          sites: { include: { order: { select: { orderNumber: true } }, currentStage: true } },
        },
      });
    case "quotation":
      if (!auth.permissions.has(PERMISSION_KEY.MANAGE_QUOTATIONS)) return forbidden("quotations");
      return prisma.quotation.findUnique({
        where: { id },
        include: {
          customer: { select: { name: true, gstin: true, state: true, address: true } },
          lineItems: { orderBy: { sortOrder: "asc" } },
          invoices: { select: { id: true, invoiceNumber: true, status: true } },
        },
      });
    case "invoice": {
      if (!auth.permissions.has(PERMISSION_KEY.MANAGE_INVOICES)) return forbidden("invoices");
      const inv = await prisma.invoice.findUnique({
        where: { id },
        include: {
          customer: { select: { name: true, gstin: true, state: true, address: true } },
          order: { select: { orderNumber: true } },
          quotation: { select: { quoteNumber: true } },
          lineItems: { orderBy: { sortOrder: "asc" } },
          // paymentAllocations (Phase C), not the legacy `payments` relation, is the complete
          // picture - a payment split across invoices or carrying TDS would otherwise be
          // undercounted, same fix already applied to the invoices.ts REST route.
          paymentAllocations: {
            orderBy: { createdAt: "desc" },
            include: {
              payment: {
                include: { allocations: { include: { invoice: { select: { id: true, invoiceNumber: true } } } } },
              },
            },
          },
          creditNotes: { where: { status: CREDIT_NOTE_STATUS.ISSUED }, orderBy: { issueDate: "desc" } },
        },
      });
      if (!inv) return null;
      const paid = settledFromAllocations(inv.paymentAllocations);
      const creditNoteTotal = inv.creditNotes.reduce((s, cn) => s.plus(cn.total), new Prisma.Decimal(0));
      const netTotal = netInvoiceTotal(new Prisma.Decimal(inv.total), creditNoteTotal);
      return {
        ...inv,
        amountPaid: paid,
        creditNoteTotal,
        netTotal,
        balance: netTotal.minus(paid),
        // One row per PaymentAllocation (not per PaymentReceived) - a payment split across
        // several invoices shows up here once, with otherInvoices listing where the rest
        // went, so the amount shown always matches what actually settled THIS invoice.
        payments: inv.paymentAllocations.map((a) => ({
          id: a.payment.id, amount: a.amount, tdsAmount: a.payment.tdsAmount,
          tdsCertificateRef: a.payment.tdsCertificateRef, method: a.payment.method,
          reference: a.payment.reference, receivedDate: a.payment.receivedDate,
          otherInvoices: a.payment.allocations
            .filter((other) => other.invoiceId !== inv.id)
            .map((other) => ({ id: other.invoice.id, invoiceNumber: other.invoice.invoiceNumber, amount: other.amount })),
        })),
        paymentAllocations: undefined,
      };
    }
    case "purchase_order":
      if (!auth.permissions.has(PERMISSION_KEY.MANAGE_PURCHASE_ORDERS)) return forbidden("purchase orders");
      return prisma.purchaseOrder.findUnique({
        where: { id },
        include: {
          supplier: { select: { name: true, gstin: true, state: true, address: true } },
          lineItems: { orderBy: { sortOrder: "asc" } },
          bills: { select: { id: true, billNumber: true, status: true, total: true } },
        },
      });
    case "expense":
      if (!auth.permissions.has(PERMISSION_KEY.MANAGE_EXPENSES)) return forbidden("expenses");
      return prisma.expense.findUnique({
        where: { id },
        include: { category: true, site: { include: { order: { select: { orderNumber: true } } } } },
      });
    case "order": {
      // A customer can look up one of their OWN orders (e.g. to resolve its siteId before
      // calling create_complaint) with just VIEW_SITE_STATUS - staff still needs MANAGE_ORDERS,
      // unscoped. Object-level check happens after the fetch since we need the row's
      // customerId to compare against auth.customerId (which comes from the session, never
      // from tool input).
      if (auth.customerId) {
        if (!auth.permissions.has(PERMISSION_KEY.VIEW_SITE_STATUS)) return forbidden("orders");
      } else if (!auth.permissions.has(PERMISSION_KEY.MANAGE_ORDERS)) {
        return forbidden("orders");
      }
      const order = await prisma.order.findUnique({
        where: { id },
        include: {
          customer: true, product: true, salesEngineer: { select: { name: true } },
          lineItems: { include: { product: true } },
          site: { include: { currentStage: true, assignedEngineer: { select: { name: true } }, vendor: true } },
        },
      });
      if (auth.customerId && order && order.customerId !== auth.customerId) return forbidden("orders");
      return order;
    }
    case "work_order":
      if (
        !auth.permissions.has(PERMISSION_KEY.MANAGE_WORK_ORDERS) &&
        !auth.permissions.has(PERMISSION_KEY.ACT_ASSIGNED_WORK_ORDERS)
      )
        return forbidden("work orders");
      return prisma.workOrder.findUnique({
        where: { id },
        include: {
          site: { include: { order: { include: { customer: { select: { name: true } } } } } },
          assignedTo: { select: { name: true } }, createdBy: { select: { name: true } },
        },
      });
    case "product":
      if (!auth.permissions.has(PERMISSION_KEY.MANAGE_ORDERS)) return forbidden("products");
      return prisma.product.findUnique({ where: { id } });
    case "complaint":
      if (
        !auth.permissions.has(PERMISSION_KEY.MANAGE_COMPLAINTS) &&
        !auth.permissions.has(PERMISSION_KEY.VIEW_COMPLAINTS_OVERVIEW) &&
        !auth.permissions.has(PERMISSION_KEY.ACT_ASSIGNED_COMPLAINTS)
      )
        return forbidden("complaints");
      return prisma.complaint.findUnique({
        where: { id },
        include: {
          customer: { select: { name: true } }, site: { select: { address: true } },
          assignedTo: { select: { name: true } },
        },
      });
  }
}

export const getDocumentDetailTool: AgentTool = {
  name: "get_document_detail",
  description:
    "Get the full detail (all line items / payments / issued credit notes / contacts, not " +
    "just a summary) of one specific record, given its id and type. For an invoice, this " +
    "includes amountPaid/creditNoteTotal/balance computed net of any issued credit notes and " +
    "pro-rated TDS, plus the creditNotes array itself. Get the id from one of the search_* " +
    `tools first (never guess an id). docType must be one of: ${DOC_TYPES.join(", ")}.`,
  inputSchema: {
    type: "object",
    properties: {
      docType: { type: "string", enum: [...DOC_TYPES], description: "Which kind of record this id belongs to." },
      id: { type: "string", description: "The record's id, as returned by a search_* tool." },
    },
    required: ["docType", "id"],
  },
  handler: async (input, auth) => {
    const docType = String(input.docType) as DocType;
    const id = String(input.id ?? "");
    if (!DOC_TYPES.includes(docType)) return { error: `Unknown docType. Must be one of: ${DOC_TYPES.join(", ")}.` };
    const result = await loadDetail(docType, id, auth);
    if (!result) return { error: `No ${docType} found with id ${id}.` };
    return result;
  },
};
