import { Router } from "express";
import { Prisma } from "@prisma/client";
import {
  PERMISSION_KEY,
  PO_STATUS,
  BILL_STATUS,
  PAYMENT_METHOD,
  FINANCE_DOC_TYPE,
  supplierCreateSchema,
  supplierUpdateSchema,
  purchaseOrderCreateSchema,
  purchaseOrderUpdateSchema,
  purchaseOrderStatusSchema,
} from "@recd/shared";
import { prisma } from "../lib/prisma";
import { authenticate, requirePermission, type AuthenticatedRequest } from "../middleware/auth";
import { asString } from "../lib/params";
import { computeDocumentTotals } from "../services/taxCalc";
import { nextDocumentNumber } from "../services/documentNumber";
import { poTaxStates } from "../lib/purchaseOrderTax";
import { normalizeSupplierInput } from "../lib/supplierInput";


export const purchaseOrdersRouter = Router();
purchaseOrdersRouter.use(authenticate);

// --- Suppliers -------------------------------------------------------------
// Reusable supplier records (name, GSTIN, state, structured address, contact). Suppliers reuse
// the PO permissions: manage_purchase_orders to create/edit; reading is also open to
// view_ledgers (party ledgers) as before.

purchaseOrdersRouter.get("/suppliers", requirePermission(PERMISSION_KEY.MANAGE_PURCHASE_ORDERS, PERMISSION_KEY.VIEW_LEDGERS), async (_req, res) => {
  const suppliers = await prisma.supplier.findMany({ orderBy: { name: "asc" } });
  res.json(suppliers);
});

purchaseOrdersRouter.get("/suppliers/:id", requirePermission(PERMISSION_KEY.MANAGE_PURCHASE_ORDERS, PERMISSION_KEY.VIEW_LEDGERS), async (req, res) => {
  const id = asString(req.params.id);
  const supplier = await prisma.supplier.findUnique({
    where: { id },
    include: { _count: { select: { purchaseOrders: true, bills: true } } },
  });
  if (!supplier) return res.status(404).json({ error: "Supplier not found" });
  res.json(supplier);
});

purchaseOrdersRouter.post("/suppliers", requirePermission(PERMISSION_KEY.MANAGE_PURCHASE_ORDERS), async (req: AuthenticatedRequest, res) => {
  const parsed = supplierCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { openingBalance, openingBalanceDate, ...rest } = normalizeSupplierInput(parsed.data);
  const supplier = await prisma.supplier.create({
    data: {
      ...rest,
      openingBalance: openingBalance ?? undefined,
      openingBalanceDate: openingBalanceDate ? new Date(openingBalanceDate) : undefined,
    },
  });
  res.status(201).json(supplier);
});

purchaseOrdersRouter.put("/suppliers/:id", requirePermission(PERMISSION_KEY.MANAGE_PURCHASE_ORDERS), async (req: AuthenticatedRequest, res) => {
  const id = asString(req.params.id);
  const parsed = supplierUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.supplier.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Supplier not found" });
  const { openingBalance, openingBalanceDate, ...rest } = normalizeSupplierInput(parsed.data);
  const supplier = await prisma.supplier.update({
    where: { id },
    data: {
      ...rest,
      openingBalance: openingBalance ?? undefined,
      openingBalanceDate: openingBalanceDate ? new Date(openingBalanceDate) : undefined,
    },
  });
  res.json(supplier);
});

// Payments made to this supplier with no bill attached - i.e. money paid out that hasn't yet
// been applied to a bill (mirrors GET /customers/:id/advances, Phase C). PaymentMade has no
// allocation table like PaymentReceived does, so "advance" here is simply billId === null,
// rather than a positive unallocated remainder.
purchaseOrdersRouter.get(
  "/suppliers/:id/advances",
  requirePermission(PERMISSION_KEY.RECORD_PAYMENTS, PERMISSION_KEY.APPROVE_VENDOR_INVOICE, PERMISSION_KEY.VIEW_LEDGERS),
  async (req, res) => {
    const id = asString(req.params.id);
    const advances = await prisma.paymentMade.findMany({
      where: { supplierId: id, billId: null },
      include: { orderTags: { include: { order: { select: { id: true, orderNumber: true } } } } },
      orderBy: { paidDate: "desc" },
    });
    res.json(advances);
  },
);

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

/** A 400-worthy validation problem raised inside a PO transaction (e.g. unknown supplier). */
export class PoInputError extends Error {}

function blankToNull(v: string | null | undefined): string | null {
  if (v === undefined || v === null) return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function mapPoLine(line: {
  description: string;
  hsnCode?: string | null;
  quantity: number;
  unitPrice: number;
  taxRatePct: number;
}, index = 0) {
  return {
    description: line.description,
    hsnCode: line.hsnCode,
    quantity: new Prisma.Decimal(String(line.quantity)),
    unitPrice: new Prisma.Decimal(String(line.unitPrice)),
    taxRatePct: new Prisma.Decimal(String(line.taxRatePct)),
    lineTotal: new Prisma.Decimal(String(line.quantity * line.unitPrice)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
    // Keep the entered order on the detail page / printout (was always 0 before).
    sortOrder: index,
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
    vendorQuoteRef?: string | null;
    vendorQuoteDate?: string | null;
    shipToAddress?: string | null;
    placeOfSupply?: string | null;
    paymentTerms?: string | null;
  },
  createdById: string,
  poNumber: string,
) {
  const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId }, select: { state: true } });
  if (!supplier) throw new PoInputError("Supplier not found");
  const placeOfSupply = blankToNull(input.placeOfSupply);
  const [taxFrom, taxTo] = poTaxStates(supplier.state, placeOfSupply);
  const totals = computeDocumentTotals(
    input.lineItems.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, discountPct: 0, taxRatePct: l.taxRatePct })),
    taxFrom,
    taxTo,
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
      vendorQuoteRef: blankToNull(input.vendorQuoteRef),
      vendorQuoteDate: input.vendorQuoteDate ? new Date(input.vendorQuoteDate) : null,
      shipToAddress: blankToNull(input.shipToAddress),
      placeOfSupply,
      paymentTerms: blankToNull(input.paymentTerms),
      subtotal: totals.subtotal,
      cgstAmount: totals.cgstAmount,
      sgstAmount: totals.sgstAmount,
      igstAmount: totals.igstAmount,
      total: totals.total,
      notes: input.notes ?? undefined,
      terms: input.terms ?? undefined,
      createdById,
      lineItems: { create: input.lineItems.map((l, i) => mapPoLine(l, i)) },
    },
    include: { lineItems: true },
  });
}

purchaseOrdersRouter.post("/", requirePermission(PERMISSION_KEY.MANAGE_PURCHASE_ORDERS), async (req: AuthenticatedRequest, res) => {
  const parsed = purchaseOrderCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;

  try {
    // Number allocation and the insert share one transaction, so a failed insert (e.g. unknown
    // supplier) never burns a PO number - same as the agent's confirm path.
    const po = await prisma.$transaction(async (tx) => {
      const poNumber = await nextDocumentNumber(tx, FINANCE_DOC_TYPE.PURCHASE_ORDER);
      return createPurchaseOrderRecord(tx, data, req.auth!.userId, poNumber);
    });
    res.status(201).json(po);
  } catch (err) {
    if (err instanceof PoInputError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

purchaseOrdersRouter.get("/:id", requirePermission(PERMISSION_KEY.MANAGE_PURCHASE_ORDERS), async (req: AuthenticatedRequest, res) => {
  const id = asString(req.params.id);
  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: { select: { id: true, name: true, gstin: true, pan: true, state: true, address: true, addressLine2: true, city: true, pincode: true, contactName: true, contactPhone: true, contactEmail: true } },
      order: { select: { id: true, orderNumber: true } },
      site: { select: { id: true } },
      lineItems: { orderBy: { sortOrder: "asc" } },
      bills: { where: { status: { not: BILL_STATUS.DELETED } }, select: { id: true, billNumber: true, status: true, total: true } },
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

  const existing = await prisma.purchaseOrder.findUnique({ where: { id }, include: { lineItems: true } });
  if (!existing) return res.status(404).json({ error: "Purchase order not found" });
  if (existing.status !== PO_STATUS.DRAFT) {
    return res.status(400).json({ error: "Only draft purchase orders can be edited" });
  }

  const supplierId = data.supplierId ?? existing.supplierId;
  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId }, select: { state: true } });
  if (!supplier) return res.status(400).json({ error: "Supplier not found" });

  // Header fields: undefined = leave unchanged, null/"" = clear.
  const header = {
    supplierId: data.supplierId,
    orderId: data.orderId,
    siteId: data.siteId,
    orderDate: data.orderDate ? new Date(data.orderDate) : undefined,
    expectedDate: data.expectedDate ? new Date(data.expectedDate) : existing.expectedDate,
    notes: data.notes,
    terms: data.terms,
    vendorQuoteRef: data.vendorQuoteRef === undefined ? undefined : blankToNull(data.vendorQuoteRef),
    vendorQuoteDate: data.vendorQuoteDate === undefined ? undefined : data.vendorQuoteDate ? new Date(data.vendorQuoteDate) : null,
    shipToAddress: data.shipToAddress === undefined ? undefined : blankToNull(data.shipToAddress),
    placeOfSupply: data.placeOfSupply === undefined ? undefined : blankToNull(data.placeOfSupply),
    paymentTerms: data.paymentTerms === undefined ? undefined : blankToNull(data.paymentTerms),
  };

  // Totals depend on the lines AND on the supplier's state / place of supply, so a draft's
  // totals are always recomputed on save (using the stored lines if only the header changed).
  // Legacy POs without a place of supply keep computing CGST+SGST exactly as before.
  const placeOfSupply = header.placeOfSupply === undefined ? existing.placeOfSupply : header.placeOfSupply;
  const lines = data.lineItems
    ? data.lineItems.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, taxRatePct: l.taxRatePct }))
    : existing.lineItems.map((l) => ({ quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), taxRatePct: Number(l.taxRatePct) }));
  const [taxFrom, taxTo] = poTaxStates(supplier.state, placeOfSupply);
  const totals = computeDocumentTotals(lines.map((l) => ({ ...l, discountPct: 0 })), taxFrom, taxTo);

  const po = await prisma.$transaction(async (tx) => {
    if (data.lineItems) {
      await tx.purchaseOrderLineItem.deleteMany({ where: { purchaseOrderId: id } });
    }
    return tx.purchaseOrder.update({
      where: { id },
      data: {
        ...header,
        subtotal: totals.subtotal,
        cgstAmount: totals.cgstAmount,
        sgstAmount: totals.sgstAmount,
        igstAmount: totals.igstAmount,
        total: totals.total,
        ...(data.lineItems ? { lineItems: { create: data.lineItems.map((l, i) => mapPoLine(l, i)) } } : {}),
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
