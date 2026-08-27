/** Confirm-gated write tools for Zan-APP (§56/§57 plan in HANDOVER.md, "Part B"). Unlike the
 * read tools, these NEVER write real data from the tool handler itself - they validate the
 * proposed input, resolve any references (category/site), and create an AgentPendingAction
 * row describing what *would* be created. The actual Prisma write only happens when the user
 * clicks Confirm in the chat UI (see the /conversations/:id/actions/:actionId/confirm route
 * in agentConversations.ts), which reuses the same logic as the real REST create-route.
 */
import { Prisma } from "@prisma/client";
import { PERMISSION_KEY, PAYMENT_METHOD, INVOICE_DOC_TYPE, COMPLAINT_CATEGORY } from "@recd/shared";
import { prisma } from "../../lib/prisma";
import { computeDocumentTotals } from "../../services/taxCalc";
import { assertOwnSite } from "../../routes/complaints";
import { computeBillTotals } from "../../routes/bills";
import { computeCustomerPoTotals } from "../../routes/customer-purchase-orders";
import type { AgentTool } from "./types";

const VALID_EXPENSE_METHODS = Object.values(PAYMENT_METHOD).filter((m) => m !== "tds");
const VALID_INVOICE_DOC_TYPES = Object.values(INVOICE_DOC_TYPE);
const VALID_COMPLAINT_CATEGORIES = Object.values(COMPLAINT_CATEGORY);
const VALID_COMPLAINT_SEVERITIES = ["low", "medium", "high", "critical"] as const;

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
      lineItems: normalizedLines.map((l) => ({ ...l, lineTotal: l.quantity * l.unitPrice })),
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
      lineItems: normalizedLines.map((l) => ({
        ...l,
        lineTotal: l.quantity * l.unitPrice * (1 - l.discountPct / 100),
      })),
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
      lineItems: normalizedLines.map((l) => ({
        ...l,
        lineTotal: l.quantity * l.unitPrice * (1 - l.discountPct / 100),
      })),
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

const createComplaintTool: AgentTool = {
  name: "create_complaint",
  description:
    "Propose a new complaint ticket against one of the customer's OWN sites (delivery delay, " +
    "erection/commissioning issue, non-performance). This does NOT raise the ticket " +
    "immediately - it prepares it and shows the user a confirm card in the chat; only THEY " +
    "can approve it by clicking Confirm. Only available to customers, about their own sites - " +
    "look up the siteId with search_orders_and_sites first, never guess it. After calling " +
    "this, tell the user you've prepared it for their review - never say it has been raised.",
  inputSchema: {
    type: "object",
    properties: {
      siteId: { type: "string", description: "The Site id from search_orders_and_sites, for one of the customer's own sites." },
      category: { type: "string", enum: [...VALID_COMPLAINT_CATEGORIES], description: "What kind of issue this is." },
      description: { type: "string", description: "What's wrong, in the customer's own words." },
      severity: { type: "string", enum: [...VALID_COMPLAINT_SEVERITIES], description: "How urgent this is." },
    },
    required: ["siteId", "category", "description", "severity"],
  },
  handler: async (input, auth) => {
    // customerId comes from the authenticated session (middleware/auth.ts), never from tool
    // input - a customer can only ever raise a ticket as themselves, never impersonate another.
    if (!auth.customerId) return { error: "Only customers can raise complaints." };
    if (!auth.permissions.has(PERMISSION_KEY.RAISE_COMPLAINT)) return forbidden("complaints");
    if (!auth.conversationId) return { error: "No active conversation - cannot propose a write action here." };

    const siteId = String(input.siteId ?? "");
    const category = String(input.category ?? "");
    const description = String(input.description ?? "").trim();
    const severity = String(input.severity ?? "");

    if (!siteId) return { error: "siteId is required - look it up with search_orders_and_sites first." };
    if (!VALID_COMPLAINT_CATEGORIES.includes(category as (typeof VALID_COMPLAINT_CATEGORIES)[number])) {
      return { error: `category must be one of: ${VALID_COMPLAINT_CATEGORIES.join(", ")}` };
    }
    if (!description) return { error: "description is required." };
    if (!VALID_COMPLAINT_SEVERITIES.includes(severity as (typeof VALID_COMPLAINT_SEVERITIES)[number])) {
      return { error: `severity must be one of: ${VALID_COMPLAINT_SEVERITIES.join(", ")}` };
    }

    let site: Awaited<ReturnType<typeof assertOwnSite>>;
    try {
      site = await assertOwnSite(siteId, auth.customerId);
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Could not verify that site." };
    }

    const preview = {
      site: site.companyName ?? site.address,
      category,
      severity,
      description,
    };

    const pending = await prisma.agentPendingAction.create({
      data: {
        conversationId: auth.conversationId,
        toolName: "create_complaint",
        input: { customerId: auth.customerId, siteId, category, description, severity },
        preview,
        createdById: auth.userId,
      },
    });

    return {
      status: "pending_confirmation",
      actionId: pending.id,
      preview,
      note: "Prepared for review - waiting for the user to confirm or reject in the chat UI. Do not tell the user it has been raised yet.",
    };
  },
};

const createSavedItemTool: AgentTool = {
  name: "create_saved_item",
  description:
    "Save a reusable billing item (name, HSN code, standard price) to the company's standard-" +
    "items catalog, so it shows up in search_saved_items and can be picked next time a " +
    "quotation/invoice/PO is drafted. This does NOT save it immediately - it prepares it and " +
    "shows the user a confirm card in the chat; only THEY can approve it. Only call this after " +
    "the user has agreed they want a specific item remembered - never save one unasked.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "e.g. 'Installation labour', 'Crane hire'." },
      hsnCode: { type: "string", description: "HSN/SAC code for GST, if known." },
      standardPrice: { type: "number", description: "Standard per-unit price in rupees, before tax." },
      taxRatePct: { type: "number", description: "GST rate, e.g. 18. Defaults to 18 if omitted." },
    },
    required: ["name", "standardPrice"],
  },
  handler: async (input, auth) => {
    if (!hasAny(auth, [PERMISSION_KEY.MANAGE_QUOTATIONS, PERMISSION_KEY.MANAGE_INVOICES, PERMISSION_KEY.MANAGE_PURCHASE_ORDERS]))
      return forbidden("saved items");
    if (!auth.conversationId) return { error: "No active conversation - cannot propose a write action here." };

    const name = String(input.name ?? "").trim();
    const hsnCode = input.hsnCode ? String(input.hsnCode).trim() : null;
    const standardPrice = Number(input.standardPrice);
    const taxRatePct = input.taxRatePct !== undefined ? Number(input.taxRatePct) : 18;

    if (!name) return { error: "name is required." };
    if (!Number.isFinite(standardPrice) || standardPrice < 0) return { error: "standardPrice must be a non-negative number." };

    const preview = { name, hsnCode, standardPrice, taxRatePct };

    const pending = await prisma.agentPendingAction.create({
      data: {
        conversationId: auth.conversationId,
        toolName: "create_saved_item",
        input: preview,
        preview,
        createdById: auth.userId,
      },
    });

    return {
      status: "pending_confirmation",
      actionId: pending.id,
      preview,
      note: "Prepared for review - waiting for the user to confirm or reject in the chat UI. Do not tell the user it has been saved yet.",
    };
  },
};

const createSiteStatusUpdateTool: AgentTool = {
  name: "create_site_status_update",
  description:
    "PROPOSE a new SITC timeline entry (progress note) on a site - this is what shows up as " +
    "'Post a status update' in the app, and is the only way to add one; the search/detail " +
    "tools are read-only. Resolve siteId first with search_orders_and_sites (use the site's " +
    "own \"id\" field, not the order's id). stageKey sets which SITC stage this update reflects " +
    "and moves the site's current stage to it - reuse the site's own current stage key (from " +
    "search_orders_and_sites/get_document_detail) to log a note without moving it forward, or " +
    "give the next stage key once that step has actually been reached; in sequence: " +
    "order_received, dispatched, delivered_unloading, measuring, measurement_done, " +
    "structure_building, structure_completed, installing, testing, commissioning, " +
    "commissioned, customer_signoff. statusKey flags why/how; common keys: pending (default - " +
    "general progress note, no stage change implied), done (a step just completed), " +
    "postpone_to_tomorrow, material_not_arrived, awaiting_scaffolding_materials. Both lists are " +
    "admin-editable - if either key is rejected, the error names the current valid set, relay " +
    "it to the user rather than guessing again. This does NOT post the update immediately - it " +
    "prepares it and shows the user a confirm card in the chat; only THEY can approve it by " +
    "clicking Confirm. After calling this, tell the user you've prepared it for their review - " +
    "never say the update has been posted.",
  inputSchema: {
    type: "object",
    properties: {
      siteId: { type: "string", description: "Site id, from search_orders_and_sites' site.id field (not the order id)." },
      stageKey: {
        type: "string",
        description: "Which SITC stage this update reflects, e.g. 'structure_building'. Reuse the site's current stage key to log a note without changing stage.",
      },
      statusKey: {
        type: "string",
        description: "Status flag for this update, e.g. 'pending', 'done', 'postpone_to_tomorrow'.",
      },
      comment: { type: "string", description: "The free-text note itself, e.g. 'Civil work completed, team visiting for installation tomorrow.'" },
    },
    required: ["siteId", "stageKey", "statusKey", "comment"],
  },
  handler: async (input, auth) => {
    if (!auth.permissions.has(PERMISSION_KEY.CHANGE_SITE_STATUS)) return forbidden("site status updates");
    if (!auth.conversationId) return { error: "No active conversation - cannot propose a write action here." };

    const siteId = String(input.siteId ?? "").trim();
    if (!siteId) return { error: "siteId is required." };
    const comment = String(input.comment ?? "").trim();
    if (!comment) return { error: "comment is required." };

    const site = await prisma.site.findUnique({
      where: { id: siteId },
      include: { order: { select: { orderNumber: true } } },
    });
    if (!site) return { error: `No site found with id ${siteId}. Use search_orders_and_sites first.` };
    // Vendor isolation, mirroring POST /sites/:id/stage-events: an erection vendor's engineers
    // can only post updates against sites assigned to their own vendor.
    if (auth.vendorId && site.vendorId !== auth.vendorId) {
      return { error: "You don't have permission to post updates for this site." };
    }

    const stageKey = String(input.stageKey ?? "").trim();
    const statusKey = String(input.statusKey ?? "").trim();
    const [stage, status] = await Promise.all([
      prisma.stageDefinition.findUnique({ where: { key: stageKey } }),
      prisma.statusOption.findUnique({ where: { domain_key: { domain: "site_stage", key: statusKey } } }),
    ]);
    if (!stage) {
      const valid = await prisma.stageDefinition.findMany({ orderBy: { sequenceOrder: "asc" }, select: { key: true, label: true } });
      return { error: `Unknown stageKey "${stageKey}". Valid stages: ${valid.map((s) => `${s.key} (${s.label})`).join(", ")}` };
    }
    if (!status) {
      const valid = await prisma.statusOption.findMany({
        where: { domain: "site_stage" },
        orderBy: { sequenceOrder: "asc" },
        select: { key: true, label: true },
      });
      return { error: `Unknown statusKey "${statusKey}". Valid statuses: ${valid.map((s) => `${s.key} (${s.label})`).join(", ")}` };
    }

    const preview = {
      site: site.companyName ?? site.address,
      orderNumber: site.order.orderNumber,
      stage: stage.label,
      status: status.label,
      comment,
    };

    const pending = await prisma.agentPendingAction.create({
      data: {
        conversationId: auth.conversationId,
        toolName: "create_site_status_update",
        input: { siteId, stageDefinitionId: stage.id, statusOptionId: status.id, comment },
        preview,
        createdById: auth.userId,
      },
    });

    return {
      status: "pending_confirmation",
      actionId: pending.id,
      preview,
      note: "Prepared for review - waiting for the user to confirm or reject in the chat UI. Do not tell the user it has been posted yet.",
    };
  },
};

interface BillLineItemInput {
  description: string;
  hsnCode?: string;
  quantity: number;
  unitPrice: number;
  taxRatePct?: number;
}

const createVendorInvoiceTool: AgentTool = {
  name: "create_vendor_invoice",
  description:
    "Propose recording a new vendor invoice / supplier bill (payable) - e.g. from a photo or " +
    "PDF the user attached in this chat. This does NOT create it immediately - it prepares it " +
    "and shows the user a confirm card in the chat; only THEY can approve it by clicking " +
    "Confirm. Once confirmed, it's created with status 'uploaded', same starting point as the " +
    "normal Record Vendor Invoice flow - a human still needs to verify and approve it from the " +
    "Finance > Vendor Invoices page before it can be paid. If the user attached a document, use " +
    "the AI-extracted fields/text already folded into their message to fill this in - don't ask " +
    "them to retype what was already read from the attachment, but do double-check anything the " +
    "extraction flagged as low-confidence or illegible (e.g. handwritten totals) before proposing " +
    "it, and mention what you're unsure about.",
  inputSchema: {
    type: "object",
    properties: {
      supplierId: { type: "string", description: "Supplier id, if already known (e.g. from a prior search)." },
      supplierName: {
        type: "string",
        description: "Supplier name to look up if supplierId isn't known (e.g. read off the attached invoice). Provide one of supplierId or supplierName.",
      },
      purchaseOrderId: { type: "string", description: "Optional - an existing purchase order this bill is against." },
      billNumber: { type: "string", description: "The supplier's own invoice/bill number, as printed/written on the document." },
      billDate: { type: "string", description: "ISO date (YYYY-MM-DD) the bill was issued. Defaults to today if omitted." },
      dueDate: { type: "string", description: "ISO date (YYYY-MM-DD) payment is due by, if known." },
      lineItems: {
        type: "array",
        description: "At least one line item. If the source document only gave a total with no itemized breakdown, use a single line item describing the whole bill.",
        items: {
          type: "object",
          properties: {
            description: { type: "string" },
            hsnCode: { type: "string", description: "HSN/SAC code, if known - never guess, leave it out if not stated." },
            quantity: { type: "number" },
            unitPrice: { type: "number", description: "Per-unit price in rupees, before tax." },
            taxRatePct: { type: "number", description: "GST rate, e.g. 18. Defaults to 18 if omitted." },
          },
          required: ["description", "quantity", "unitPrice"],
        },
      },
      notes: { type: "string", description: "Anything worth a human's attention - e.g. that this was read from a handwritten/attached document, or fields you weren't fully sure about." },
    },
    required: ["lineItems", "billNumber"],
  },
  handler: async (input, auth) => {
    if (!auth.permissions.has(PERMISSION_KEY.RECORD_VENDOR_INVOICE)) return forbidden("vendor invoices");
    if (!auth.conversationId) return { error: "No active conversation - cannot propose a write action here." };

    const supplierId = input.supplierId ? String(input.supplierId) : null;
    const supplierName = input.supplierName ? String(input.supplierName) : null;
    const purchaseOrderId = input.purchaseOrderId ? String(input.purchaseOrderId) : null;
    const billNumber = String(input.billNumber ?? "").trim();
    const billDateStr = input.billDate ? String(input.billDate) : new Date().toISOString().slice(0, 10);
    const dueDateStr = input.dueDate ? String(input.dueDate) : null;
    const lineItemsRaw = Array.isArray(input.lineItems) ? (input.lineItems as BillLineItemInput[]) : [];
    const notes = input.notes ? String(input.notes) : null;

    if (!supplierId && !supplierName) return { error: "Provide either supplierId or supplierName." };
    if (!billNumber) return { error: "billNumber is required - the supplier's own invoice number as printed/written on the document." };
    if (lineItemsRaw.length === 0) return { error: "At least one line item is required." };
    for (const [i, li] of lineItemsRaw.entries()) {
      if (!li.description) return { error: `Line item ${i + 1}: description is required.` };
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
          error: `No supplier matching "${supplierName}". Existing suppliers: ${allSuppliers.map((s) => s.name).join(", ") || "(none yet)"}. Ask the user which one, or offer to add a new supplier first (this chat can't create suppliers - point them to Purchase Orders > New supplier).`,
        };
      }
    }
    if (!supplier) return { error: `No supplier found with id ${supplierId}.` };

    if (purchaseOrderId) {
      const po = await prisma.purchaseOrder.findUnique({ where: { id: purchaseOrderId } });
      if (!po) return { error: `No purchase order found with id ${purchaseOrderId}.` };
      if (po.supplierId !== supplier.id) return { error: "That purchase order belongs to a different supplier." };
    }

    const existingSameNumber = await prisma.bill.findUnique({
      where: { supplierId_billNumber: { supplierId: supplier.id, billNumber } },
    });
    if (existingSameNumber) return { error: `A bill numbered "${billNumber}" already exists for ${supplier.name}.` };

    const normalizedLines = lineItemsRaw.map((li) => ({
      description: li.description,
      hsnCode: li.hsnCode ?? undefined,
      quantity: li.quantity,
      unitPrice: li.unitPrice,
      taxRatePct: li.taxRatePct ?? 18,
    }));

    const company = await prisma.companySettings.findUnique({ where: { id: "singleton" } });
    const totals = computeBillTotals(normalizedLines, company?.state);

    const preview = {
      supplier: supplier.name,
      purchaseOrderId,
      billNumber,
      lineItems: normalizedLines.map((l) => ({ ...l, lineTotal: l.quantity * l.unitPrice })),
      subtotal: Number(totals.subtotal),
      taxAmount: Number(totals.taxAmount),
      total: Number(totals.total),
      billDate: billDateStr,
      dueDate: dueDateStr,
      notes,
    };

    const pending = await prisma.agentPendingAction.create({
      data: {
        conversationId: auth.conversationId,
        toolName: "create_vendor_invoice",
        input: { supplierId: supplier.id, purchaseOrderId, billNumber, lineItems: normalizedLines, billDate: billDateStr, dueDate: dueDateStr, notes },
        preview,
        createdById: auth.userId,
      },
    });

    return {
      status: "pending_confirmation",
      actionId: pending.id,
      preview,
      note: "Prepared for review - waiting for the user to confirm or reject in the chat UI. Do not tell the user it has been recorded yet - and once confirmed, it still needs a human to verify/approve it from Finance > Vendor Invoices before it can be paid.",
    };
  },
};

interface CustomerPoLineItemInput {
  description: string;
  hsnCode?: string;
  quantity: number;
  unitPrice: number;
  taxRatePct?: number;
}

const createCustomerPoTool: AgentTool = {
  name: "create_customer_po",
  description:
    "Propose recording a Customer Purchase Order - a PO a CUSTOMER sent TO us (the mirror of " +
    "create_purchase_order, which is a PO we send to a supplier), most often from a photo or " +
    "PDF the user attached in this chat. This is entirely optional record-keeping - many " +
    "customers confirm work by email or verbally instead of a formal PO, so never suggest this " +
    "is required before an order can be created or invoiced. This does NOT record it " +
    "immediately - it prepares it and shows the user a confirm card in the chat; only THEY can " +
    "approve it by clicking Confirm. If the user attached a document, use the AI-extracted " +
    "fields/text already folded into their message to fill this in - don't ask them to retype " +
    "what was already read, but do double-check anything the extraction flagged as unsure " +
    "before proposing it. Resolve the customer the normal way (search/match by name) rather " +
    "than trusting a raw name string blindly - the customer issuing the PO is usually named at " +
    "the top of the document, NOT in any 'Vendor'/'Vendor Details' section (that's us).",
  inputSchema: {
    type: "object",
    properties: {
      customerId: { type: "string", description: "Customer id, if already known (e.g. from a prior search)." },
      customerName: {
        type: "string",
        description: "Customer name to look up if customerId isn't known (e.g. read off the attached PO). Provide one of customerId or customerName.",
      },
      orderId: { type: "string", description: "Optional - an existing order/job this PO is for, if already resolved (e.g. via search_orders_and_sites)." },
      invoiceId: { type: "string", description: "Optional - an existing invoice already issued against this PO, if already resolved." },
      poNumber: { type: "string", description: "The customer's own PO number, as printed/written on the document." },
      poDate: { type: "string", description: "ISO date (YYYY-MM-DD) the PO was issued. Defaults to today if omitted." },
      placeOfSupply: { type: "string", description: "State/place of supply, if printed, e.g. '33-TAMIL NADU'." },
      workLocation: { type: "string", description: "Site/work location exactly as printed on the PO (e.g. a site name or code) - kept verbatim even if it doesn't exactly match one of our own site names." },
      scopeOfWork: { type: "string", description: "Short description of the work/scope, if stated." },
      paymentDueDate: { type: "string", description: "ISO date (YYYY-MM-DD) payment is due by, if a 'payment by' date is printed." },
      customerRefCode: { type: "string", description: "The customer's own reference/vendor code for us, if printed (e.g. a vendor empanelment code)." },
      lineItems: {
        type: "array",
        description: "At least one line item. If the source document only gave a total with no itemized breakdown, use a single line item describing the whole scope of work.",
        items: {
          type: "object",
          properties: {
            description: { type: "string" },
            hsnCode: { type: "string", description: "HSN/SAC code, if known - never guess, leave it out if not stated." },
            quantity: { type: "number" },
            unitPrice: { type: "number", description: "Per-unit price in rupees, before tax." },
            taxRatePct: { type: "number", description: "GST rate, e.g. 18. Defaults to 18 if omitted." },
          },
          required: ["description", "quantity", "unitPrice"],
        },
      },
      notes: { type: "string", description: "Anything worth a human's attention - e.g. that this was read from a handwritten/attached document, or fields you weren't fully sure about." },
    },
    required: ["lineItems", "poNumber"],
  },
  handler: async (input, auth) => {
    if (!auth.permissions.has(PERMISSION_KEY.MANAGE_ORDERS)) return forbidden("customer purchase orders");
    if (!auth.conversationId) return { error: "No active conversation - cannot propose a write action here." };

    const customerId = input.customerId ? String(input.customerId) : null;
    const customerName = input.customerName ? String(input.customerName) : null;
    const orderId = input.orderId ? String(input.orderId) : null;
    const invoiceId = input.invoiceId ? String(input.invoiceId) : null;
    const poNumber = String(input.poNumber ?? "").trim();
    const poDateStr = input.poDate ? String(input.poDate) : new Date().toISOString().slice(0, 10);
    const lineItemsRaw = Array.isArray(input.lineItems) ? (input.lineItems as CustomerPoLineItemInput[]) : [];
    const notes = input.notes ? String(input.notes) : null;

    if (!customerId && !customerName) return { error: "Provide either customerId or customerName." };
    if (!poNumber) return { error: "poNumber is required - the customer's own PO number as printed/written on the document." };
    if (lineItemsRaw.length === 0) return { error: "At least one line item is required." };
    for (const [i, li] of lineItemsRaw.entries()) {
      if (!li.description) return { error: `Line item ${i + 1}: description is required.` };
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
          error: `No customer matching "${customerName}". Existing customers: ${allCustomers.map((c) => c.name).join(", ") || "(none yet)"}. Ask the user which one, or point them to Customers > New customer to add this one first (this chat can't create customers).`,
        };
      }
    }
    if (!customer) return { error: `No customer found with id ${customerId}.` };

    if (orderId) {
      const order = await prisma.order.findUnique({ where: { id: orderId } });
      if (!order) return { error: `No order found with id ${orderId}.` };
      if (order.customerId !== customer.id) return { error: "That order belongs to a different customer." };
    }
    if (invoiceId) {
      const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
      if (!invoice) return { error: `No invoice found with id ${invoiceId}.` };
      if (invoice.customerId !== customer.id) return { error: "That invoice belongs to a different customer." };
    }

    const normalizedLines = lineItemsRaw.map((li) => ({
      description: li.description,
      hsnCode: li.hsnCode ?? undefined,
      quantity: li.quantity,
      unitPrice: li.unitPrice,
      taxRatePct: li.taxRatePct ?? 18,
    }));

    const company = await prisma.companySettings.findUnique({ where: { id: "singleton" } });
    const totals = computeCustomerPoTotals(normalizedLines, company?.state);

    const preview = {
      customer: customer.name,
      orderId,
      invoiceId,
      poNumber,
      lineItems: normalizedLines.map((l) => ({ ...l, lineTotal: l.quantity * l.unitPrice })),
      subtotal: Number(totals.subtotal),
      taxAmount: Number(totals.taxAmount),
      total: Number(totals.total),
      poDate: poDateStr,
      placeOfSupply: input.placeOfSupply ? String(input.placeOfSupply) : undefined,
      workLocation: input.workLocation ? String(input.workLocation) : undefined,
      scopeOfWork: input.scopeOfWork ? String(input.scopeOfWork) : undefined,
      paymentDueDate: input.paymentDueDate ? String(input.paymentDueDate) : undefined,
      customerRefCode: input.customerRefCode ? String(input.customerRefCode) : undefined,
      notes,
    };

    const pending = await prisma.agentPendingAction.create({
      data: {
        conversationId: auth.conversationId,
        toolName: "create_customer_po",
        input: {
          customerId: customer.id,
          orderId,
          invoiceId,
          poNumber,
          lineItems: normalizedLines,
          poDate: poDateStr,
          placeOfSupply: preview.placeOfSupply,
          workLocation: preview.workLocation,
          scopeOfWork: preview.scopeOfWork,
          paymentDueDate: preview.paymentDueDate,
          customerRefCode: preview.customerRefCode,
          notes,
        },
        preview,
        createdById: auth.userId,
      },
    });

    return {
      status: "pending_confirmation",
      actionId: pending.id,
      preview,
      note: "Prepared for review - waiting for the user to confirm or reject in the chat UI. Do not tell the user it has been recorded yet.",
    };
  },
};

function hasAny(auth: { permissions: Set<string> }, keys: string[]): boolean {
  return keys.some((k) => auth.permissions.has(k));
}

export const zanAppWriteTools: AgentTool[] = [
  createExpenseTool,
  createPurchaseOrderTool,
  createQuotationTool,
  createInvoiceTool,
  createSavedItemTool,
  createComplaintTool,
  createSiteStatusUpdateTool,
  createVendorInvoiceTool,
  createCustomerPoTool,
];
