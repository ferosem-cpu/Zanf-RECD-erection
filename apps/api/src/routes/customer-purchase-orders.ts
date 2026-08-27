/** Customer Purchase Order routes - a PO a CUSTOMER sends TO Zan-F, the mirror image of
 * the outbound PurchaseOrder routes (which we send to suppliers). Recording one is always
 * optional (see docs/HANDOVER.md's Customer Purchase Orders section): it's never required to
 * create or invoice an Order. What it adds is a real record - the scanned PO, AI-assisted
 * capture, and links to the Order/Site it's for and the Invoice we issued against it - instead
 * of the free-text Order.customerPoNumber/customerPoDate fields, which stay untouched for
 * backward compatibility and quick reference.
 */
import { Router } from "express";
import { Prisma } from "@prisma/client";
import {
  PERMISSION_KEY,
  CUSTOMER_PO_STATUS,
  CUSTOMER_PO_AUDIT_ACTION,
  customerPurchaseOrderCreateSchema,
  customerPurchaseOrderUpdateSchema,
  customerPurchaseOrderExtractRequestSchema,
} from "@recd/shared";
import { prisma } from "../lib/prisma";
import { authenticate, requirePermission, type AuthenticatedRequest } from "../middleware/auth";
import { asString } from "../lib/params";
import { computeDocumentTotals } from "../services/taxCalc";
import { extractCustomerPoFromFile, findCustomerCandidates } from "../agent/customerPoExtraction";
import { ExtractionUnavailableError } from "../agent/billExtraction";

export const customerPurchaseOrdersRouter = Router();
customerPurchaseOrdersRouter.use(authenticate);

const ACCESS = PERMISSION_KEY.MANAGE_ORDERS;

type LineInput = { description: string; hsnCode?: string | null; quantity: number; unitPrice: number; taxRatePct: number };

function mapLine(line: LineInput, sortOrder: number) {
  return {
    description: line.description,
    hsnCode: line.hsnCode ?? undefined,
    quantity: new Prisma.Decimal(String(line.quantity)),
    unitPrice: new Prisma.Decimal(String(line.unitPrice)),
    taxRatePct: new Prisma.Decimal(String(line.taxRatePct)),
    lineTotal: new Prisma.Decimal(String(line.quantity * line.unitPrice)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
    sortOrder,
  };
}

export function computeCustomerPoTotals(lineItems: LineInput[], companyState?: string | null) {
  const totals = computeDocumentTotals(
    lineItems.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, discountPct: 0, taxRatePct: l.taxRatePct })),
    companyState,
    companyState, // No place-of-supply field on this model either - treat as intra-state, fold into one taxAmount.
  );
  return {
    subtotal: totals.subtotal,
    taxAmount: totals.cgstAmount.plus(totals.sgstAmount).plus(totals.igstAmount),
    total: totals.total,
  };
}

const detailInclude = {
  customer: { select: { id: true, name: true, gstin: true, state: true } },
  order: { select: { id: true, orderNumber: true, site: { select: { id: true, address: true, companyName: true } } } },
  invoice: { select: { id: true, invoiceNumber: true, docType: true, status: true } },
  lineItems: { orderBy: { sortOrder: "asc" as const } },
  auditLogs: { orderBy: { createdAt: "desc" as const }, include: { actor: { select: { name: true } } } },
  recordedBy: { select: { id: true, name: true } },
};

// --- List / create ------------------------------------------------------------
customerPurchaseOrdersRouter.get("/", requirePermission(ACCESS), async (req, res) => {
  const where: Record<string, unknown> = {};
  if (typeof req.query.customerId === "string") where.customerId = req.query.customerId;
  if (typeof req.query.orderId === "string") where.orderId = req.query.orderId;
  if (typeof req.query.invoiceId === "string") where.invoiceId = req.query.invoiceId;
  if (typeof req.query.status === "string") where.status = req.query.status;

  const rows = await prisma.customerPurchaseOrder.findMany({
    where,
    include: {
      customer: { select: { id: true, name: true } },
      order: { select: { id: true, orderNumber: true } },
      invoice: { select: { id: true, invoiceNumber: true, status: true } },
    },
    orderBy: { poDate: "desc" },
  });
  res.json(rows);
});

customerPurchaseOrdersRouter.post("/", requirePermission(ACCESS), async (req: AuthenticatedRequest, res) => {
  const parsed = customerPurchaseOrderCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;

  const customer = await prisma.customer.findUnique({ where: { id: data.customerId } });
  if (!customer) return res.status(404).json({ error: "Customer not found" });
  if (data.orderId) {
    const order = await prisma.order.findUnique({ where: { id: data.orderId } });
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (order.customerId !== data.customerId) {
      return res.status(400).json({ error: "That order belongs to a different customer" });
    }
  }
  if (data.invoiceId) {
    const invoice = await prisma.invoice.findUnique({ where: { id: data.invoiceId } });
    if (!invoice) return res.status(404).json({ error: "Invoice not found" });
    if (invoice.customerId !== data.customerId) {
      return res.status(400).json({ error: "That invoice belongs to a different customer" });
    }
  }

  const company = await prisma.companySettings.findUnique({ where: { id: "singleton" } });
  const totals = computeCustomerPoTotals(data.lineItems, company?.state);

  const created = await prisma.$transaction(async (tx) => {
    const po = await tx.customerPurchaseOrder.create({
      data: {
        poNumber: data.poNumber,
        poDate: new Date(data.poDate),
        customerId: data.customerId,
        orderId: data.orderId,
        invoiceId: data.invoiceId,
        status: data.invoiceId ? CUSTOMER_PO_STATUS.INVOICED : CUSTOMER_PO_STATUS.OPEN,
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        total: totals.total,
        placeOfSupply: data.placeOfSupply,
        workLocation: data.workLocation,
        scopeOfWork: data.scopeOfWork,
        paymentDueDate: data.paymentDueDate ? new Date(data.paymentDueDate) : null,
        customerRefCode: data.customerRefCode,
        notes: data.notes,
        sourceType: data.sourceType,
        attachmentUrl: data.attachmentUrl,
        attachmentMimeType: data.attachmentMimeType,
        extractionRaw: data.extractionRaw as Prisma.InputJsonValue | undefined,
        recordedById: req.auth!.userId,
        lineItems: { create: data.lineItems.map((l, i) => mapLine(l, i)) },
      },
      include: detailInclude,
    });
    await tx.customerPurchaseOrderAuditLog.create({
      data: {
        customerPurchaseOrderId: po.id,
        actorId: req.auth!.userId,
        action: data.extractionRaw ? CUSTOMER_PO_AUDIT_ACTION.EXTRACTED : CUSTOMER_PO_AUDIT_ACTION.CREATED,
        summary: data.extractionRaw
          ? `Uploaded and AI-extracted from a ${data.sourceType ?? "scanned"} document; ${data.lineItems.length} line item(s), total Rs ${totals.total.toFixed(2)}`
          : `Recorded manually; ${data.lineItems.length} line item(s), total Rs ${totals.total.toFixed(2)}`,
      },
    });
    return po;
  });
  res.status(201).json(created);
});

// --- AI extraction (never auto-saves) -----------------------------------------
customerPurchaseOrdersRouter.post("/extract", requirePermission(ACCESS), async (req, res) => {
  const parsed = customerPurchaseOrderExtractRequestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const rawDataUrl = parsed.data.fileDataUrl;
  const commaIdx = rawDataUrl.indexOf(",");
  const fileBase64 = rawDataUrl.startsWith("data:") && commaIdx !== -1 ? rawDataUrl.slice(commaIdx + 1) : rawDataUrl;
  const approxBytes = (fileBase64.length * 3) / 4;
  if (approxBytes > 4_500_000) {
    return res.status(400).json({ error: "File is too large (max ~4MB). Please compress or crop the image and try again." });
  }

  try {
    const extraction = await extractCustomerPoFromFile(fileBase64, parsed.data.mimeType);
    const customerCandidates = await findCustomerCandidates(extraction.customerNameGuess);
    res.json({ available: true, extraction, customerCandidates });
  } catch (err) {
    if (err instanceof ExtractionUnavailableError) {
      return res.json({ available: false, error: err.message });
    }
    res.json({ available: false, error: err instanceof Error ? err.message : "Extraction failed" });
  }
});

// --- Detail / edit --------------------------------------------------------------
customerPurchaseOrdersRouter.get("/:id", requirePermission(ACCESS), async (req: AuthenticatedRequest, res) => {
  const id = asString(req.params.id);
  const po = await prisma.customerPurchaseOrder.findUnique({ where: { id }, include: detailInclude });
  if (!po) return res.status(404).json({ error: "Customer purchase order not found" });
  res.json(po);
});

customerPurchaseOrdersRouter.patch("/:id", requirePermission(ACCESS), async (req: AuthenticatedRequest, res) => {
  const id = asString(req.params.id);
  const parsed = customerPurchaseOrderUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;

  const existing = await prisma.customerPurchaseOrder.findUnique({
    where: { id },
    include: { lineItems: { orderBy: { sortOrder: "asc" } } },
  });
  if (!existing) return res.status(404).json({ error: "Customer purchase order not found" });
  if (existing.status === CUSTOMER_PO_STATUS.CANCELLED) {
    return res.status(400).json({ error: "This customer purchase order has been cancelled and can no longer be edited" });
  }

  const effectiveCustomerId = data.customerId ?? existing.customerId;
  if (data.orderId) {
    const order = await prisma.order.findUnique({ where: { id: data.orderId } });
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (order.customerId !== effectiveCustomerId) {
      return res.status(400).json({ error: "That order belongs to a different customer" });
    }
  }
  if (data.invoiceId) {
    const invoice = await prisma.invoice.findUnique({ where: { id: data.invoiceId } });
    if (!invoice) return res.status(404).json({ error: "Invoice not found" });
    if (invoice.customerId !== effectiveCustomerId) {
      return res.status(400).json({ error: "That invoice belongs to a different customer" });
    }
  }

  const company = await prisma.companySettings.findUnique({ where: { id: "singleton" } });
  const effectiveLineItems: LineInput[] = data.lineItems ?? existing.lineItems.map((l) => ({
    description: l.description, hsnCode: l.hsnCode ?? undefined, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), taxRatePct: Number(l.taxRatePct),
  }));
  const totals = computeCustomerPoTotals(effectiveLineItems, company?.state);

  const nextInvoiceId = data.invoiceId !== undefined ? data.invoiceId : existing.invoiceId;
  const nextStatus = data.status ?? (nextInvoiceId ? CUSTOMER_PO_STATUS.INVOICED : existing.status);

  const updated = await prisma.$transaction(async (tx) => {
    if (data.lineItems) await tx.customerPurchaseOrderLineItem.deleteMany({ where: { customerPurchaseOrderId: id } });

    const po = await tx.customerPurchaseOrder.update({
      where: { id },
      data: {
        poNumber: data.poNumber,
        poDate: data.poDate ? new Date(data.poDate) : undefined,
        customerId: data.customerId,
        orderId: data.orderId !== undefined ? data.orderId : undefined,
        invoiceId: data.invoiceId !== undefined ? data.invoiceId : undefined,
        status: nextStatus,
        placeOfSupply: data.placeOfSupply !== undefined ? data.placeOfSupply : undefined,
        workLocation: data.workLocation !== undefined ? data.workLocation : undefined,
        scopeOfWork: data.scopeOfWork !== undefined ? data.scopeOfWork : undefined,
        paymentDueDate: data.paymentDueDate !== undefined ? (data.paymentDueDate ? new Date(data.paymentDueDate) : null) : undefined,
        customerRefCode: data.customerRefCode !== undefined ? data.customerRefCode : undefined,
        notes: data.notes !== undefined ? data.notes : undefined,
        sourceType: data.sourceType,
        attachmentUrl: data.attachmentUrl,
        attachmentMimeType: data.attachmentMimeType,
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        total: totals.total,
        lineItems: data.lineItems ? { create: data.lineItems.map((l, i) => mapLine(l, i)) } : undefined,
      },
      include: detailInclude,
    });

    const changes: string[] = [];
    if (data.poNumber && data.poNumber !== existing.poNumber) changes.push(`PO #: ${existing.poNumber} -> ${data.poNumber}`);
    if (data.orderId !== undefined && data.orderId !== existing.orderId) changes.push(data.orderId ? "Linked to an order" : "Unlinked from its order");
    if (data.invoiceId !== undefined && data.invoiceId !== existing.invoiceId) changes.push(data.invoiceId ? "Linked to an invoice" : "Unlinked from its invoice");
    if (data.lineItems) changes.push(`Line items updated (${data.lineItems.length} item${data.lineItems.length === 1 ? "" : "s"})`);
    if (new Prisma.Decimal(po.total).toString() !== new Prisma.Decimal(existing.total).toString()) {
      changes.push(`Total: Rs ${new Prisma.Decimal(existing.total).toFixed(2)} -> Rs ${new Prisma.Decimal(po.total).toFixed(2)}`);
    }
    if (changes.length > 0) {
      const action = data.orderId !== undefined && data.orderId !== existing.orderId
        ? CUSTOMER_PO_AUDIT_ACTION.LINKED_TO_ORDER
        : data.invoiceId !== undefined && data.invoiceId !== existing.invoiceId
          ? CUSTOMER_PO_AUDIT_ACTION.LINKED_TO_INVOICE
          : CUSTOMER_PO_AUDIT_ACTION.FIELD_EDITED;
      await tx.customerPurchaseOrderAuditLog.create({
        data: { customerPurchaseOrderId: id, actorId: req.auth!.userId, action, summary: changes.join("; ") },
      });
    }
    return po;
  });
  res.json(updated);
});

customerPurchaseOrdersRouter.post("/:id/cancel", requirePermission(ACCESS), async (req: AuthenticatedRequest, res) => {
  const id = asString(req.params.id);
  const existing = await prisma.customerPurchaseOrder.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Customer purchase order not found" });
  if (existing.status === CUSTOMER_PO_STATUS.CANCELLED) {
    return res.status(400).json({ error: "This customer purchase order is already cancelled" });
  }

  const po = await prisma.$transaction(async (tx) => {
    const updated = await tx.customerPurchaseOrder.update({ where: { id }, data: { status: CUSTOMER_PO_STATUS.CANCELLED } });
    await tx.customerPurchaseOrderAuditLog.create({
      data: { customerPurchaseOrderId: id, actorId: req.auth!.userId, action: CUSTOMER_PO_AUDIT_ACTION.CANCELLED, summary: "Cancelled" },
    });
    return updated;
  });
  res.json(po);
});
