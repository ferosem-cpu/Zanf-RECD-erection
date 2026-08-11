/** Confirm-gated write tools for Zan-APP (§56/§57 plan in HANDOVER.md, "Part B"). Unlike the
 * read tools, these NEVER write real data from the tool handler itself - they validate the
 * proposed input, resolve any references (category/site), and create an AgentPendingAction
 * row describing what *would* be created. The actual Prisma write only happens when the user
 * clicks Confirm in the chat UI (see the /conversations/:id/actions/:actionId/confirm route
 * in agentConversations.ts), which reuses the same logic as the real REST create-route.
 */
import { Prisma } from "@prisma/client";
import { PERMISSION_KEY, PAYMENT_METHOD, INVOICE_DOC_TYPE } from "@recd/shared";
import { prisma } from "../../lib/prisma";
import { computeDocumentTotals } from "../../services/taxCalc";
import type { AgentTool } from "./types";

const VALID_EXPENSE_METHODS = Object.values(PAYMENT_METHOD).filter((m) => m !== "tds");
const VALID_INVOICE_DOC_TYPES = Object.values(INVOICE_DOC_TYPE);

function forbidden(what: string) {
  return { error: `You don't have permission to create ${what}.` };
}

const createExpenseTool: AgentTool = {
  name: "create_expense",
  description:
    "Propose a new expense-book entry (fuel, travel, site consumables, misc - non-PO spend). " +
    "This does NOT create the expense immediately - it prepares it and shows the user a " +
    "confirm card in the chat; only THEY can approve it by clicking Confirm. After calling " +
    "this, tell the user you've prepared it for their review - never say it has been created.",
  inputSchema: {
    type: "object",
    properties: {
      description: { type: "string", description: "What the expense was for, e.g. 'Crane hire for site erection'." },
      amount: { type: "number", description: "Amount in rupees." },
      categoryKey: {
        type: "string",
        description: "Category key. If unsure, first search_expenses or ask the user - do not guess.",
      },
      expenseDate: { type: "string", description: "ISO date (YYYY-MM-DD). Defaults to today if omitted." },
      method: { type: "string", enum: VALID_EXPENSE_METHODS, description: "How it was paid." },
      siteId: { type: "string", description: "Optional - a Site id from search_orders_and_sites, if this expense is tied to a specific site." },
    },
    required: ["description", "amount", "categoryKey", "method"],
  },
  handler: async (input, auth) => {
    if (!auth.permissions.has(PERMISSION_KEY.MANAGE_EXPENSES)) return forbidden("expenses");
    if (!auth.conversationId) return { error: "No active conversation - cannot propose a write action here." };

    const description = String(input.description ?? "").trim();
    const amount = Number(input.amount);
    const categoryKey = String(input.categoryKey ?? "").trim();
    const method = String(input.method ?? "");
    const siteId = input.siteId ? String(input.siteId) : null;
    const expenseDateStr = input.expenseDate ? String(input.expenseDate) : new Date().toISOString().slice(0, 10);

    if (!description) return { error: "description is required." };
    if (!Number.isFinite(amount) || amount <= 0) return { error: "amount must be a positive number." };
    if (!VALID_EXPENSE_METHODS.includes(method as (typeof VALID_EXPENSE_METHODS)[number])) {
      return { error: `method must be one of: ${VALID_EXPENSE_METHODS.join(", ")}` };
    }

    const category = await prisma.expenseCategory.findFirst({
      where: { OR: [{ key: categoryKey }, { label: { equals: categoryKey, mode: "insensitive" } }] },
    });
    if (!category) {
      const allCategories = await prisma.expenseCategory.findMany({ orderBy: { sequenceOrder: "asc" } });
      return {
        error: `No expense category matching "${categoryKey}". Available categories: ${allCategories
          .map((c) => `${c.key} (${c.label})`)
          .join(", ")}. Ask the user which one, then retry.`,
      };
    }

    if (siteId) {
      const site = await prisma.site.findUnique({ where: { id: siteId } });
      if (!site) return { error: `No site found with id ${siteId}. Use search_orders_and_sites first.` };
    }

    const preview = {
      description,
      amount,
      category: category.label,
      expenseDate: expenseDateStr,
      method,
      siteId,
    };

    const pending = await prisma.agentPendingAction.create({
      data: {
        conversationId: auth.conversationId,
        toolName: "create_expense",
        input: { description, amount, categoryId: category.id, expenseDate: expenseDateStr, method, siteId },
        preview,
        createdById: auth.userId,
      },
    });

    return {
      status: "pending_confirmation",
      actionId: pending.id,
      preview,
      note: "Prepared for review - waiting for the user to confirm or reject in the chat UI. Do not tell the user it has been created yet.",
    };
  },
};

interface PoLineItemInput {
  description: string;
  hsnCode: string;
  quantity: number;
  unitPrice: number;
  taxRatePct?: number;
}

const createPurchaseOrderTool: AgentTool = {
  name: "create_purchase_order",
  description:
    "Propose a new purchase order to a supplier (material/service procurement - steel, " +
    "piping, transport, subcontract labour). This does NOT create the PO immediately - it " +
    "prepares it and shows the user a confirm card in the chat; only THEY can approve it by " +
    "clicking Confirm. The PO number is only allocated at confirm time (GST numbering must " +
    "stay gap-free, so nothing is reserved for a proposal that might be rejected). After " +
    "calling this, tell the user you've prepared it for their review - never say it has " +
    "been created or quote a PO number, since none exists yet.",
  inputSchema: {
    type: "object",
    properties: {
      supplierId: { type: "string", description: "Supplier id, if already known (e.g. from a prior search)." },
      supplierName: {
        type: "string",
        description: "Supplier name to look up if supplierId isn't known. Provide one of supplierId or supplierName.",
      },
      lineItems: {
        type: "array",
        description: "At least one line item.",
        items: {
          type: "object",
          properties: {
            description: { type: "string" },
            hsnCode: { type: "string", description: "REQUIRED - HSN/SAC code for GST. Never omit or guess; ask the user for the correct code if you don't know it for certain." },
            quantity: { type: "number" },
            unitPrice: { type: "number", description: "Per-unit price in rupees, before tax." },
            taxRatePct: { type: "number", description: "GST rate, e.g. 18. Defaults to 18 if omitted." },
          },
          required: ["description", "hsnCode", "quantity", "unitPrice"],
        },
      },
      orderDate: { type: "string", description: "ISO date (YYYY-MM-DD). Defaults to today if omitted." },
      expectedDate: { type: "string", description: "ISO date (YYYY-MM-DD) - when the goods/service are expected." },
      notes: { type: "string" },
      terms: { type: "string" },
    },
    required: ["lineItems"],
  },
  handler: async (input, auth) => {
    if (!auth.permissions.has(PERMISSION_KEY.MANAGE_PURCHASE_ORDERS)) return forbidden("purchase orders");
    if (!auth.conversationId) return { error: "No active conversation - cannot propose a write action here." };

    const supplierId = input.supplierId ? String(input.supplierId) : null;
    const supplierName = input.supplierName ? String(input.supplierName) : null;
    const lineItemsRaw = Array.isArray(input.lineItems) ? (input.lineItems as PoLineItemInput[]) : [];
    const orderDateStr = input.orderDate ? String(input.orderDate) : new Date().toISOString().slice(0, 10);
    const expectedDateStr = input.expectedDate ? String(input.expectedDate) : null;
    const notes = input.notes ? String(input.notes) : null;
    const terms = input.terms ? String(input.terms) : null;

    if (!supplierId && !supplierName) return { error: "Provide either supplierId or supplierName." };
    if (lineItemsRaw.length === 0) return { error: "At least one line item is required." };
    for (const [i, li] of lineItemsRaw.entries()) {
      if (!li.description) return { error: `Line item ${i + 1}: description is required.` };
      if (!li.hsnCode || !li.hsnCode.trim()) return { error: `Line item ${i + 1}: hsnCode is required - ask the user for the correct HSN/SAC code rather than guessing.` };
      if (!Number.isFinite(li.quantity) || li.quantity <= 0) return { error: `Line item ${i + 1}: quantity must be a positive number.` };
      if (!Number.isFinite(li.unitPrice) || li.unitPrice < 0) return { error: `Line item ${i + 1}: unitPrice must be a non-negative number.` };
    }

    let supplier = supplierId ? await prisma.supplier.findUnique({ where: { id: supplierId } }) : null;
    if (!supplier && supplierName) {
      const matches = await prisma.supplier.findMany({
        where: { name: { contains: supplierName, mode: "insensitive" } },
        take: 5,
      });
      if (matches.length === 1) {
        supplier = matches[0];
      } else if (matches.length > 1) {
        return {
          error: `Multiple suppliers match "${supplierName}": ${matches
            .map((s) => `${s.name} (id: ${s.id})`)
            .join(", ")}. Ask the user which one, then retry with the exact supplierId.`,
        };
      } else {
        const allSuppliers = await prisma.supplier.findMany({ select: { name: true }, take: 20 });
        return {
          error: `No supplier matching "${supplierName}". Existing suppliers: ${allSuppliers.map((s) => s.name).join(", ") || "(none yet)"}. Ask the user which one, or offer to add a new supplier first.`,
        };
      }
    }
    if (!supplier) return { error: `No supplier found with id ${supplierId}.` };

    const normalizedLines = lineItemsRaw.map((li) => ({
      description: li.description,
      hsnCode: li.hsnCode,
      quantity: li.quantity,
      unitPrice: li.unitPrice,
      taxRatePct: li.taxRatePct ?? 18,
    }));

    const company = await prisma.companySettings.findUnique({ where: { id: "singleton" } });
    // Purchase orders always compute tax as intra-state (CGST+SGST) - matches routes/purchase-orders.ts,
    // which never passes a placeOfSupply for POs.
    const totals = computeDocumentTotals(
      normalizedLines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, discountPct: 0, taxRatePct: l.taxRatePct })),
      company?.state,
      undefined,
    );

    const preview = {
      supplier: supplier.name,
      lineItems: normalizedLines.map((l) => `${l.description} x${l.quantity} @ ₹${l.unitPrice}`).join("; "),
      subtotal: Number(totals.subtotal),
      cgst: Number(totals.cgstAmount),
      sgst: Number(totals.sgstAmount),
      igst: Number(totals.igstAmount),
      total: Number(totals.total),
      orderDate: orderDateStr,
      expectedDate: expectedDateStr,
    };

    const pending = await prisma.agentPendingAction.create({
      data: {
        conversationId: auth.conversationId,
        toolName: "create_purchase_order",
        input: { supplierId: supplier.id, lineItems: normalizedLines, orderDate: orderDateStr, expectedDate: expectedDateStr, notes, terms },
        preview,
        createdById: auth.userId,
      },
    });

    return {
      status: "pending_confirmation",
      actionId: pending.id,
      preview,
      note: "Prepared for review - waiting for the user to confirm or reject in the chat UI. No PO number exists yet - do not quote one or say it has been created.",
    };
  },
};

interface QuoteLineItemInput {
  productId?: string;
  description: string;
  hsnCode: string;
  quantity: number;
  unitPrice: number;
  discountPct?: number;
  taxRatePct?: number;
}

const createQuotationTool: AgentTool = {
  name: "create_quotation",
  description:
    "Propose a new quotation to a customer. This does NOT create the quotation immediately - " +
    "it prepares it and shows the user a confirm card in the chat; only THEY can approve it " +
    "by clicking Confirm. The quote number is only allocated at confirm time (GST numbering " +
    "must stay gap-free, so nothing is reserved for a proposal that might be rejected). After " +
    "calling this, tell the user you've prepared it for their review - never say it has been " +
    "created or quote a quote number, since none exists yet.",
  inputSchema: {
    type: "object",
    properties: {
      customerId: { type: "string", description: "Customer id, if already known (e.g. from a prior search)." },
      customerName: {
        type: "string",
        description: "Customer name to look up if customerId isn't known. Provide one of customerId or customerName.",
      },
      lineItems: {
        type: "array",
        description: "At least one line item.",
        items: {
          type: "object",
          properties: {
            description: { type: "string" },
            hsnCode: { type: "string", description: "REQUIRED - HSN/SAC code for GST. Never omit or guess; ask the user for the correct code if you don't know it for certain." },
            quantity: { type: "number" },
            unitPrice: { type: "number", description: "Per-unit price in rupees, before tax and discount." },
            discountPct: { type: "number", description: "Discount percent, 0-100. Defaults to 0." },
            taxRatePct: { type: "number", description: "GST rate, e.g. 18. Defaults to 18 if omitted." },
          },
          required: ["description", "hsnCode", "quantity", "unitPrice"],
        },
      },
      validUntil: { type: "string", description: "ISO date (YYYY-MM-DD) the quote expires." },
      notes: { type: "string" },
      terms: { type: "string" },
    },
    required: ["lineItems"],
  },
  handler: async (input, auth) => {
    if (!auth.permissions.has(PERMISSION_KEY.MANAGE_QUOTATIONS)) return forbidden("quotations");
    if (!auth.conversationId) return { error: "No active conversation - cannot propose a write action here." };

    const customerId = input.customerId ? String(input.customerId) : null;
    const customerName = input.customerName ? String(input.customerName) : null;
    const lineItemsRaw = Array.isArray(input.lineItems) ? (input.lineItems as QuoteLineItemInput[]) : [];
    const validUntilStr = input.validUntil ? String(input.validUntil) : null;
    const notes = input.notes ? String(input.notes) : null;
    const terms = input.terms ? String(input.terms) : null;

    if (!customerId && !customerName) return { error: "Provide either customerId or customerName." };
    if (lineItemsRaw.length === 0) return { error: "At least one line item is required." };
    for (const [i, li] of lineItemsRaw.entries()) {
      if (!li.description) return { error: `Line item ${i + 1}: description is required.` };
      if (!li.hsnCode || !li.hsnCode.trim()) return { error: `Line item ${i + 1}: hsnCode is required - ask the user for the correct HSN/SAC code rather than guessing.` };
      if (!Number.isFinite(li.quantity) || li.quantity <= 0) return { error: `Line item ${i + 1}: quantity must be a positive number.` };
      if (!Number.isFinite(li.unitPrice) || li.unitPrice < 0) return { error: `Line item ${i + 1}: unitPrice must be a non-negative number.` };
    }

    let customer = customerId ? await prisma.customer.findUnique({ where: { id: customerId } }) : null;
    if (!customer && customerName) {
      const matches = await prisma.customer.findMany({
        where: { name: { contains: customerName, mode: "insensitive" } },
        take: 5,
      });
      if (matches.length === 1) {
        customer = matches[0];
      } else if (matches.length > 1) {
        return {
          error: `Multiple customers match "${customerName}": ${matches
            .map((c) => `${c.name} (id: ${c.id})`)
            .join(", ")}. Ask the user which one, then retry with the exact customerId.`,
        };
      } else {
        const allCustomers = await prisma.customer.findMany({ select: { name: true }, take: 20 });
        return {
          error: `No customer matching "${customerName}". Existing customers: ${allCustomers.map((c) => c.name).join(", ") || "(none yet)"}. Ask the user which one, or offer to add a new customer first.`,
        };
      }
    }
    if (!customer) return { error: `No customer found with id ${customerId}.` };

    const normalizedLines = lineItemsRaw.map((li) => ({
      productId: li.productId,
      description: li.description,
      hsnCode: li.hsnCode,
      quantity: li.quantity,
      unitPrice: li.unitPrice,
      discountPct: li.discountPct ?? 0,
      taxRatePct: li.taxRatePct ?? 18,
    }));

    // Place of supply defaults to the customer's own billing state (same as the real
    // quotation form's default), which drives CGST+SGST vs IGST.
    const placeOfSupply = customer.state ?? undefined;
    const company = await prisma.companySettings.findUnique({ where: { id: "singleton" } });
    const totals = computeDocumentTotals(
      normalizedLines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, discountPct: l.discountPct, taxRatePct: l.taxRatePct })),
      company?.state,
      placeOfSupply,
    );

    const preview = {
      customer: customer.name,
      lineItems: normalizedLines.map((l) => `${l.description} x${l.quantity} @ ₹${l.unitPrice}`).join("; "),
      subtotal: Number(totals.subtotal),
      discount: Number(totals.discountAmount),
      cgst: Number(totals.cgstAmount),
      sgst: Number(totals.sgstAmount),
      igst: Number(totals.igstAmount),
      total: Number(totals.total),
      placeOfSupply: placeOfSupply ?? null,
      validUntil: validUntilStr,
    };

    const pending = await prisma.agentPendingAction.create({
      data: {
        conversationId: auth.conversationId,
        toolName: "create_quotation",
        input: {
          customerId: customer.id,
          lineItems: normalizedLines,
          placeOfSupply,
          validUntil: validUntilStr,
          notes,
          terms,
        },
        preview,
        createdById: auth.userId,
      },
    });

    return {
      status: "pending_confirmation",
      actionId: pending.id,
      preview,
      note: "Prepared for review - waiting for the user to confirm or reject in the chat UI. No quote number exists yet - do not quote one or say it has been created.",
    };
  },
};

interface InvoiceLineItemInput {
  productId?: string;
  description: string;
  hsnCode: string;
  quantity: number;
  unitPrice: number;
  discountPct?: number;
  taxRatePct?: number;
}

const createInvoiceTool: AgentTool = {
  name: "create_invoice",
  description:
    "Propose a new invoice (proforma or tax invoice) for a customer. This does NOT create " +
    "the invoice immediately - it prepares it and shows the user a confirm card in the chat; " +
    "only THEY can approve it by clicking Confirm. Even after confirming, the invoice is " +
    "created as a DRAFT with no real invoice number yet - Zan-APP only allocates the real " +
    "sequential invoice number when a human 'issues' the draft from the Invoices page (a " +
    "separate manual step you cannot do). After calling this, tell the user you've prepared " +
    "a draft for their review - never say it has been created/issued or quote an invoice " +
    "number, since neither exists yet.",
  inputSchema: {
    type: "object",
    properties: {
      docType: { type: "string", enum: [...VALID_INVOICE_DOC_TYPES], description: "'proforma' or 'tax_invoice'." },
      customerId: { type: "string", description: "Customer id, if already known (e.g. from a prior search)." },
      customerName: {
        type: "string",
        description: "Customer name to look up if customerId isn't known. Provide one of customerId or customerName.",
      },
      orderId: { type: "string", description: "Optional - link to an existing Order (from search_orders_and_sites), if this invoice is for one." },
      quotationId: { type: "string", description: "Optional - link to an existing Quotation (from search_quotations), if this invoice is for one." },
      lineItems: {
        type: "array",
        description: "At least one line item.",
        items: {
          type: "object",
          properties: {
            description: { type: "string" },
            hsnCode: { type: "string", description: "REQUIRED - HSN/SAC code for GST. Never omit or guess; ask the user for the correct code if you don't know it for certain." },
            quantity: { type: "number" },
            unitPrice: { type: "number", description: "Per-unit price in rupees, before tax and discount." },
            discountPct: { type: "number", description: "Discount percent, 0-100. Defaults to 0." },
            taxRatePct: { type: "number", description: "GST rate, e.g. 18. Defaults to 18 if omitted." },
          },
          required: ["description", "hsnCode", "quantity", "unitPrice"],
        },
      },
      issueDate: { type: "string", description: "ISO date (YYYY-MM-DD). Defaults to today if omitted." },
      dueDate: { type: "string", description: "ISO date (YYYY-MM-DD) payment is due by." },
      notes: { type: "string" },
      terms: { type: "string" },
    },
    required: ["docType", "lineItems"],
  },
  handler: async (input, auth) => {
    if (!auth.permissions.has(PERMISSION_KEY.MANAGE_INVOICES)) return forbidden("invoices");
    if (!auth.conversationId) return { error: "No active conversation - cannot propose a write action here." };

    const docType = String(input.docType ?? "");
    if (!VALID_INVOICE_DOC_TYPES.includes(docType as (typeof VALID_INVOICE_DOC_TYPES)[number])) {
      return { error: `docType must be one of: ${VALID_INVOICE_DOC_TYPES.join(", ")}` };
    }
    const customerId = input.customerId ? String(input.customerId) : null;
    const customerName = input.customerName ? String(input.customerName) : null;
    const orderId = input.orderId ? String(input.orderId) : null;
    const quotationId = input.quotationId ? String(input.quotationId) : null;
    const lineItemsRaw = Array.isArray(input.lineItems) ? (input.lineItems as InvoiceLineItemInput[]) : [];
    const issueDateStr = input.issueDate ? String(input.issueDate) : new Date().toISOString().slice(0, 10);
    const dueDateStr = input.dueDate ? String(input.dueDate) : null;
    const notes = input.notes ? String(input.notes) : null;
    const terms = input.terms ? String(input.terms) : null;

    if (!customerId && !customerName) return { error: "Provide either customerId or customerName." };
    if (lineItemsRaw.length === 0) return { error: "At least one line item is required." };
    for (const [i, li] of lineItemsRaw.entries()) {
      if (!li.description) return { error: `Line item ${i + 1}: description is required.` };
      if (!li.hsnCode || !li.hsnCode.trim()) return { error: `Line item ${i + 1}: hsnCode is required - ask the user for the correct HSN/SAC code rather than guessing.` };
      if (!Number.isFinite(li.quantity) || li.quantity <= 0) return { error: `Line item ${i + 1}: quantity must be a positive number.` };
      if (!Number.isFinite(li.unitPrice) || li.unitPrice < 0) return { error: `Line item ${i + 1}: unitPrice must be a non-negative number.` };
    }

    let customer = customerId ? await prisma.customer.findUnique({ where: { id: customerId } }) : null;
    if (!customer && customerName) {
      const matches = await prisma.customer.findMany({
        where: { name: { contains: customerName, mode: "insensitive" } },
        take: 5,
      });
      if (matches.length === 1) {
        customer = matches[0];
      } else if (matches.length > 1) {
        return {
          error: `Multiple customers match "${customerName}": ${matches
            .map((c) => `${c.name} (id: ${c.id})`)
            .join(", ")}. Ask the user which one, then retry with the exact customerId.`,
        };
      } else {
        const allCustomers = await prisma.customer.findMany({ select: { name: true }, take: 20 });
        return {
          error: `No customer matching "${customerName}". Existing customers: ${allCustomers.map((c) => c.name).join(", ") || "(none yet)"}. Ask the user which one, or offer to add a new customer first.`,
        };
      }
    }
    if (!customer) return { error: `No customer found with id ${customerId}.` };

    if (orderId) {
      const order = await prisma.order.findUnique({ where: { id: orderId } });
      if (!order) return { error: `No order found with id ${orderId}. Use search_orders_and_sites first.` };
    }
    if (quotationId) {
      const quotation = await prisma.quotation.findUnique({ where: { id: quotationId } });
      if (!quotation) return { error: `No quotation found with id ${quotationId}. Use search_quotations first.` };
    }

    const normalizedLines = lineItemsRaw.map((li) => ({
      productId: li.productId,
      description: li.description,
      hsnCode: li.hsnCode,
      quantity: li.quantity,
      unitPrice: li.unitPrice,
      discountPct: li.discountPct ?? 0,
      taxRatePct: li.taxRatePct ?? 18,
    }));

    // Place of supply defaults to the customer's own billing state, same as create_quotation.
    const placeOfSupply = customer.state ?? undefined;
    const company = await prisma.companySettings.findUnique({ where: { id: "singleton" } });
    const totals = computeDocumentTotals(
      normalizedLines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, discountPct: l.discountPct, taxRatePct: l.taxRatePct })),
      company?.state,
      placeOfSupply,
    );

    const preview = {
      docType,
      customer: customer.name,
      lineItems: normalizedLines.map((l) => `${l.description} x${l.quantity} @ ₹${l.unitPrice}`).join("; "),
      subtotal: Number(totals.subtotal),
      discount: Number(totals.discountAmount),
      cgst: Number(totals.cgstAmount),
      sgst: Number(totals.sgstAmount),
      igst: Number(totals.igstAmount),
      total: Number(totals.total),
      placeOfSupply: placeOfSupply ?? null,
      issueDate: issueDateStr,
      dueDate: dueDateStr,
    };

    const pending = await prisma.agentPendingAction.create({
      data: {
        conversationId: auth.conversationId,
        toolName: "create_invoice",
        input: {
          docType,
          customerId: customer.id,
          orderId,
          quotationId,
          lineItems: normalizedLines,
          placeOfSupply,
          issueDate: issueDateStr,
          dueDate: dueDateStr,
          notes,
          terms,
        },
        preview,
        createdById: auth.userId,
      },
    });

    return {
      status: "pending_confirmation",
      actionId: pending.id,
      preview,
      note: "Prepared for review - waiting for the user to confirm or reject in the chat UI. This creates a DRAFT only (no invoice number) - do not say it has been created/issued.",
    };
  },
};

export const zanAppWriteTools: AgentTool[] = [createExpenseTool, createPurchaseOrderTool, createQuotationTool, createInvoiceTool];
