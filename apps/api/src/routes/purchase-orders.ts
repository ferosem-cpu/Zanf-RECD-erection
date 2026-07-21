import { Router } from "express";
import { Prisma } from "@prisma/client";
import {
  PERMISSION_KEY,
  PO_STATUS,
  BILL_STATUS,
  PAYMENT_METHOD,
  FINANCE_DOC_TYPE,
  supplierCreateSchema,
  purchaseOrderCreateSchema,
  purchaseOrderUpdateSchema,
  purchaseOrderStatusSchema,
  billCreateSchema,
  paymentMadeCreateSchema,
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

purchaseOrdersRouter.post("/", requirePermission(PERMISSION_KEY.MANAGE_PURCHASE_ORDERS), async (req: AuthenticatedRequest, res) => {
  const parsed = purchaseOrderCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;

  const company = await prisma.companySettings.findUnique({ where: { id: "singleton" } });
  const totals = computeDocumentTotals(
    data.lineItems.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, discountPct: 0, taxRatePct: l.taxRatePct })),
    company?.state,
    undefined,
  );

  const poNumber = await prisma.$transaction((tx) => nextDocumentNumber(tx, FINANCE_DOC_TYPE.PURCHASE_ORDER));
  const po = await prisma.purchaseOrder.create({
    data: {
      poNumber,
      supplierId: data.supplierId,
      status: PO_STATUS.DRAFT,
      orderDate: data.orderDate ? new Date(data.orderDate) : new Date(),
      expectedDate: data.expectedDate ? new Date(data.expectedDate) : null,
      orderId: data.orderId,
      siteId: data.siteId,
      subtotal: totals.subtotal,
      cgstAmount: totals.cgstAmount,
      sgstAmount: totals.sgstAmount,
      igstAmount: totals.igstAmount,
      total: totals.total,
      notes: data.notes,
      terms: data.terms,
      createdById: req.auth!.userId,
      lineItems: { create: data.lineItems.map(mapPoLine) },
    },
    include: { lineItems: true },
  });
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

// --- Bills -----------------------------------------------------------------
purchaseOrdersRouter.get("/bills", requirePermission(PERMISSION_KEY.MANAGE_PURCHASE_ORDERS), async (req, res) => {
  const where: Record<string, unknown> = {};
  if (typeof req.query.status === "string") where.status = req.query.status;
  if (typeof req.query.supplierId === "string") where.supplierId = req.query.supplierId;

  const bills = await prisma.bill.findMany({
    where,
    include: {
      supplier: { select: { id: true, name: true } },
      payments: { select: { amount: true } },
    },
    orderBy: { billDate: "desc" },
  });
  const rows = bills.map((b) => {
    const paid = b.payments.reduce((s, p) => s.plus(p.amount), new Prisma.Decimal(0));
    return { ...b, amountPaid: paid, balance: new Prisma.Decimal(b.total).minus(paid), payments: undefined };
  });
  res.json(rows);
});

purchaseOrdersRouter.post("/bills", requirePermission(PERMISSION_KEY.MANAGE_PURCHASE_ORDERS), async (req: AuthenticatedRequest, res) => {
  const parsed = billCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;

  const supplier = await prisma.supplier.findUnique({ where: { id: data.supplierId } });
  if (!supplier) return res.status(404).json({ error: "Supplier not found" });
  if (data.purchaseOrderId) {
    const po = await prisma.purchaseOrder.findUnique({ where: { id: data.purchaseOrderId } });
    if (!po) return res.status(404).json({ error: "Purchase order not found" });
    if (po.supplierId !== data.supplierId) {
      return res.status(400).json({ error: "Bill's purchase order belongs to a different supplier" });
    }
  }

  const bill = await prisma.bill.create({
    data: {
      billNumber: data.billNumber,
      supplierId: data.supplierId,
      purchaseOrderId: data.purchaseOrderId,
      status: BILL_STATUS.UNPAID,
      billDate: new Date(data.billDate),
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      subtotal: new Prisma.Decimal(String(data.subtotal)),
      taxAmount: new Prisma.Decimal(String(data.taxAmount)),
      total: new Prisma.Decimal(String(data.total)),
      notes: data.notes,
      recordedById: req.auth!.userId,
    },
  });
  res.status(201).json(bill);
});

purchaseOrdersRouter.get("/bills/:id", requirePermission(PERMISSION_KEY.MANAGE_PURCHASE_ORDERS), async (req: AuthenticatedRequest, res) => {
  const id = asString(req.params.id);
  const bill = await prisma.bill.findUnique({
    where: { id },
    include: {
      supplier: { select: { id: true, name: true } },
      purchaseOrder: { select: { id: true, poNumber: true } },
      payments: true,
    },
  });
  if (!bill) return res.status(404).json({ error: "Bill not found" });
  res.json(bill);
});

function deriveBillStatus(total: Prisma.Decimal, paid: Prisma.Decimal): string {
  if (paid.isZero()) return BILL_STATUS.UNPAID;
  if (paid.greaterThanOrEqualTo(total)) return BILL_STATUS.PAID;
  return BILL_STATUS.PARTIALLY_PAID;
}

purchaseOrdersRouter.post(
  "/bills/:id/payments",
  requirePermission(PERMISSION_KEY.RECORD_PAYMENTS),
  async (req: AuthenticatedRequest, res) => {
    const id = asString(req.params.id);
    const parsed = paymentMadeCreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const data = parsed.data;

    const bill = await prisma.bill.findUnique({ where: { id }, include: { payments: true } });
    if (!bill) return res.status(404).json({ error: "Bill not found" });
    if (bill.status === BILL_STATUS.CANCELLED) {
      return res.status(400).json({ error: "Cannot record payments against a cancelled bill" });
    }
    const paidBefore = bill.payments.reduce((s, p) => s.plus(p.amount), new Prisma.Decimal(0));
    const outstanding = new Prisma.Decimal(bill.total).minus(paidBefore);
    const amount = new Prisma.Decimal(String(data.amount));
    if (amount.greaterThan(outstanding)) {
      return res.status(400).json({ error: "Payment exceeds the outstanding balance" });
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.paymentMade.create({
        data: {
          billId: bill.id,
          supplierId: bill.supplierId,
          amount,
          method: data.method,
          reference: data.reference,
          paidDate: data.paidDate ? new Date(data.paidDate) : new Date(),
          notes: data.notes,
          recordedById: req.auth!.userId,
        },
      });
      const newPaid = paidBefore.plus(amount);
      const newStatus = deriveBillStatus(new Prisma.Decimal(bill.total), newPaid);
      return tx.bill.update({ where: { id: bill.id }, data: { status: newStatus } });
    });
    res.status(201).json(result);
  },
);
