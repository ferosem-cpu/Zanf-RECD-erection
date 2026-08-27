import { Router } from "express";
import { Prisma } from "@prisma/client";
import {
  PERMISSION_KEY,
  PO_STATUS,
  PAYMENT_METHOD,
  FINANCE_DOC_TYPE,
  supplierCreateSchema,
  purchaseOrderCreateSchema,
  purchaseOrderUpdateSchema,
  purchaseOrderStatusSchema,
} from "@recd/shared";
import { prisma } from "../lib/prisma";
import { authenticate, requirePermission, type AuthenticatedRequest } from "../middleware/auth";
import { asString } from "../lib/params";
import { computeDocumentTotals } from "../services/taxCalc";
import { nextDocumentNumber } from "../services/documentNumber";

export const purchaseOrdersRouter = Router();
purchaseOrdersRouter.use(authenticate);

// --- Suppliers -------------------------------------------------------------
purchaseOrdersRouter.get("/suppliers", requirePermission(PERMISSION_KEY.MANAGE_PURCHASE_ORDERS), async (_req, res) => {
  const suppliers = await prisma.supplier.findMany({ orderBy: { name: "asc" } });
  res.json(suppliers);
});

purchaseOrdersRouter.post("/suppliers", requirePermission(PERMISSION_KEY.MANAGE_PURCHASE_ORDERS), async (req: AuthenticatedRequest, res) => {
  const parsed = supplierCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const supplier = await prisma.supplier.create({ data: parsed.data });
  res.status(201).json(supplier);
});

purchaseOrdersRouter.put("/suppliers/:id", requirePermission(PERMISSION_KEY.MANAGE_PURCHASE_ORDERS), async (req: AuthenticatedRequest, res) => {
  const id = asString(req.params.id);
  const parsed = supplierCreateSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const supplier = await prisma.supplier.update({ where: { id }, data: parsed.data });
  res.json(supplier);
});

// One-click "create supplier from vendor" affordance for the Vendor Invoices flow (an
// erection Vendor is a separate model from Supplier - see Supplier.vendorId's doc comment).
// Idempotent: if this vendor already has a linked Supplier, that row is returned unchanged
// instead of erroring (Supplier.vendorId is @unique), so re-clicking the button is harmless.
purchaseOrdersRouter.post(
  "/suppliers/from-vendor",
  requirePermission(PERMISSION_KEY.MANAGE_PURCHASE_ORDERS, PERMISSION_KEY.RECORD_VENDOR_INVOICE),
  async (req: AuthenticatedRequest, res) => {
    const vendorId = asString(req.body?.vendorId);
    const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor) return res.status(404).json({ error: "Vendor not found" });

    const existing = await prisma.supplier.findUnique({ where: { vendorId } });
    if (existing) return res.json(existing);

    const supplier = await prisma.supplier.create({
      data: {
        name: vendor.name,
        vendorId: vendor.id,
        contactName: vendor.contactName,
        contactEmail: vendor.contactEmail,
        contactPhone: vendor.contactPhone,
        address: vendor.address,
      },
    });
    res.status(201).json(supplier);
  },
);

// --- Purchase Orders -------------------------------------------------------
function mapPoLine(line: {
  description: string;
  hsnCode?: string | null;
  quantity: number;
  unitPrice: number;
  taxRatePct: number;
}) {
  return {
    description: line.description,
    hsnCode: line.hsnCode,
    quantity: new Prisma.Decimal(String(line.quantity)),
    unitPrice: new Prisma.Decimal(String(line.unitPrice)),
    taxRatePct: new Prisma.Decimal(String(line.taxRatePct)),
    lineTotal: new Prisma.Decimal(String(line.quantity * line.unitPrice)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
    sortOrder: 0,
  };
}

purchaseOrdersRouter.get("/", requirePermission(PERMISSION_KEY.MANAGE_PURCHASE_ORDERS), async (req, res) => {
  const where: Record<string, unknown> = {};
  if (typeof req.query.status === "string") where.status = req.query.status;
  if (typeof req.query.supplierId === "string") where.supplierId = req.query.supplierId;

  const pos = await prisma.purchaseOrder.findMany({
    where,
    include: { supplier: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });
  res.json(pos);
});

/** Exported so the in-app agent's create_purchase_order write tool (see agentConversations.ts's
 * confirm route) can reuse the exact same create logic rather than duplicating it - mirrors the
 * createQuotationRecord pattern in routes/quotations.ts. Also fixes a subtle asymmetry the
 * duplicated version had: previously the agent's confirm handler generated the PO number and
 * created the row in two separate transactions; this runs both inside the one transaction the
 * caller wraps it in, same as quotations already did. */
export async function createPurchaseOrderRecord(
  tx: Prisma.TransactionClient,
  input: {
    supplierId: string;
    lineItems: { description: string; hsnCode?: string | null; quantity: number; unitPrice: number; taxRatePct: number }[];
    orderDate?: string | null;
    expectedDate?: string | null;
    orderId?: string | null;
    siteId?: string | null;
    notes?: string | null;
    terms?: string | null;
  },
  createdById: string,
  poNumber: string,
  companyState?: string | null,
) {
  const totals = computeDocumentTotals(
    input.lineItems.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, discountPct: 0, taxRatePct: l.taxRatePct })),
    companyState,
    undefined,
  );
  return tx.purchaseOrder.create({
    data: {
      poNumber,
      supplierId: input.supplierId,
      status: PO_STATUS.DRAFT,
      orderDate: input.orderDate ? new Date(input.orderDate) : new Date(),
      expectedDate: input.expectedDate ? new Date(input.expectedDate) : null,
      orderId: input.orderId ?? undefined,
      siteId: input.siteId ?? undefined,
      subtotal: totals.subtotal,
      cgstAmount: totals.cgstAmount,
      sgstAmount: totals.sgstAmount,
      igstAmount: totals.igstAmount,
      total: totals.total,
      notes: input.notes ?? undefined,
      terms: input.terms ?? undefined,
      createdById,
      lineItems: { create: input.lineItems.map(mapPoLine) },
    },
    include: { lineItems: true },
  });
}

purchaseOrdersRouter.post("/", requirePermission(PERMISSION_KEY.MANAGE_PURCHASE_ORDERS), async (req: AuthenticatedRequest, res) => {
  const parsed = purchaseOrderCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;

  const company = await prisma.companySettings.findUnique({ where: { id: "singleton" } });
  const poNumber = await prisma.$transaction((tx) => nextDocumentNumber(tx, FINANCE_DOC_TYPE.PURCHASE_ORDER));
  const po = await prisma.$transaction((tx) => createPurchaseOrderRecord(tx, data, req.auth!.userId, poNumber, company?.state));
  res.status(201).json(po);
});

purchaseOrdersRouter.get("/:id", requirePermission(PERMISSION_KEY.MANAGE_PURCHASE_ORDERS), async (req: AuthenticatedRequest, res) => {
  const id = asString(req.params.id);
  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: { select: { id: true, name: true, gstin: true, state: true, address: true, contactName: true, contactPhone: true, contactEmail: true } },
      order: { select: { id: true, orderNumber: true } },
      site: { select: { id: true } },
      lineItems: { orderBy: { sortOrder: "asc" } },
      bills: { select: { id: true, billNumber: true, status: true, total: true } },
    },
  });
  if (!po) return res.status(404).json({ error: "Purchase order not found" });
  res.json(po);
});

purchaseOrdersRouter.put("/:id", requirePermission(PERMISSION_KEY.MANAGE_PURCHASE_ORDERS), async (req: AuthenticatedRequest, res) => {
  const id = asString(req.params.id);
  const parsed = purchaseOrderUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;

  const existing = await prisma.purchaseOrder.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Purchase order not found" });
  if (existing.status !== PO_STATUS.DRAFT) {
    return res.status(400).json({ error: "Only draft purchase orders can be edited" });
  }

  const company = await prisma.companySettings.findUnique({ where: { id: "singleton" } });
  const po = await prisma.$transaction(async (tx) => {
    if (data.lineItems) {
      const totals = computeDocumentTotals(
        data.lineItems.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, discountPct: 0, taxRatePct: l.taxRatePct })),
        company?.state,
        undefined,
      );
      await tx.purchaseOrderLineItem.deleteMany({ where: { purchaseOrderId: id } });
      return tx.purchaseOrder.update({
        where: { id },
        data: {
          supplierId: data.supplierId,
          orderId: data.orderId,
          siteId: data.siteId,
          expectedDate: data.expectedDate ? new Date(data.expectedDate) : existing.expectedDate,
          notes: data.notes,
          terms: data.terms,
          subtotal: totals.subtotal,
          cgstAmount: totals.cgstAmount,
          sgstAmount: totals.sgstAmount,
          igstAmount: totals.igstAmount,
          total: totals.total,
          lineItems: { create: data.lineItems.map(mapPoLine) },
        },
        include: { lineItems: true },
      });
    }
    return tx.purchaseOrder.update({
      where: { id },
      data: {
        supplierId: data.supplierId,
        orderId: data.orderId,
        siteId: data.siteId,
        expectedDate: data.expectedDate ? new Date(data.expectedDate) : existing.expectedDate,
        notes: data.notes,
        terms: data.terms,
      },
      include: { lineItems: true },
    });
  });
  res.json(po);
});

purchaseOrdersRouter.post("/:id/status", requirePermission(PERMISSION_KEY.MANAGE_PURCHASE_ORDERS), async (req: AuthenticatedRequest, res) => {
  const id = asString(req.params.id);
  const parsed = purchaseOrderStatusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const existing = await prisma.purchaseOrder.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Purchase order not found" });
  if (existing.status !== PO_STATUS.DRAFT && parsed.data.status === PO_STATUS.ISSUED) {
    return res.status(400).json({ error: "Only draft purchase orders can be issued" });
  }

  const po = await prisma.purchaseOrder.update({ where: { id }, data: { status: parsed.data.status } });
  res.json(po);
});

// Bill/Vendor-Invoice routes moved to routes/bills.ts (mounted at /bills) as part of the
// Vendor Invoice (Payables) workflow feature - see docs/HANDOVER.md.
