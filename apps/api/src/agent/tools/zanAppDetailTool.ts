/** Full-detail drill-down for one specific document, given the id returned by one of the
 * zanAppReadTools search_* tools. Kept as one dispatched tool (rather than one per docType)
 * so the agent only has to remember one shape: docType + id.
 */
import { PERMISSION_KEY } from "@recd/shared";
import { prisma } from "../../lib/prisma";
import type { AgentTool, AgentAuthContext } from "./types";

const DOC_TYPES = [
  "customer", "vendor", "quotation", "invoice", "purchase_order",
  "expense", "order", "work_order", "complaint",
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
    case "invoice":
      if (!auth.permissions.has(PERMISSION_KEY.MANAGE_INVOICES)) return forbidden("invoices");
      return prisma.invoice.findUnique({
        where: { id },
        include: {
          customer: { select: { name: true, gstin: true, state: true, address: true } },
          order: { select: { orderNumber: true } },
          quotation: { select: { quoteNumber: true } },
          lineItems: { orderBy: { sortOrder: "asc" } },
          payments: true,
        },
      });
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
    case "order":
      if (!auth.permissions.has(PERMISSION_KEY.MANAGE_ORDERS)) return forbidden("orders");
      return prisma.order.findUnique({
        where: { id },
        include: {
          customer: true, product: true, salesEngineer: { select: { name: true } },
          site: { include: { currentStage: true, assignedEngineer: { select: { name: true } }, vendor: true } },
        },
      });
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
    "Get the full detail (all line items / payments / contacts, not just a summary) of one " +
    "specific record, given its id and type. Get the id from one of the search_* tools first " +
    `(never guess an id). docType must be one of: ${DOC_TYPES.join(", ")}.`,
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
