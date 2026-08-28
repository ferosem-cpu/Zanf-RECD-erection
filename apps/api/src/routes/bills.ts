/** Vendor Invoice (Payables) routes - "Bill" in the schema, "Vendor Invoice" in the UI.
 * Extends the original bills-under-purchase-orders routes (moved here + expanded) with the
 * uploaded -> verified -> approved -> (partially_paid -> paid) workflow, AI-assisted capture,
 * multi-site/order allocations, and a full audit trail. See docs/HANDOVER.md's Vendor
 * Invoice section for the design.
 */
import { Router } from "express";
import { Prisma } from "@prisma/client";
import {
  PERMISSION_KEY,
  BILL_STATUS,
  BILL_AUDIT_ACTION,
  billCreateSchema,
  billUpdateSchema,
  billRejectSchema,
  billExtractRequestSchema,
  paymentMadeCreateSchema,
  paymentMadeGeneralCreateSchema,
  advanceApplicationCreateSchema,
} from "@recd/shared";
import { prisma } from "../lib/prisma";
import { authenticate, requirePermission, type AuthenticatedRequest } from "../middleware/auth";
import { asString } from "../lib/params";
import { computeDocumentTotals } from "../services/taxCalc";
import { extractBillFromFile, findSupplierCandidates, ExtractionUnavailableError } from "../agent/billExtraction";

export const billsRouter = Router();
billsRouter.use(authenticate);

const CAPTURE = [PERMISSION_KEY.RECORD_VENDOR_INVOICE, PERMISSION_KEY.APPROVE_VENDOR_INVOICE];
const APPROVE = PERMISSION_KEY.APPROVE_VENDOR_INVOICE;

export type BillLineInput = { description: string; hsnCode?: string | null; quantity: number; unitPrice: number; taxRatePct: number };
type BillAllocationInput = { siteId?: string | null; orderId?: string | null; invoiceId?: string | null; amount: number; notes?: string | null };

export function mapBillLine(line: BillLineInput, sortOrder: number) {
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

export function computeBillTotals(lineItems: BillLineInput[], companyState?: string | null) {
  const totals = computeDocumentTotals(
    lineItems.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, discountPct: 0, taxRatePct: l.taxRatePct })),
    companyState,
    companyState, // Bill has no place-of-supply field - treat as always intra-state (CGST+SGST), then fold into one taxAmount below.
  );
  return {
    subtotal: totals.subtotal,
    taxAmount: totals.cgstAmount.plus(totals.sgstAmount).plus(totals.igstAmount),
    total: totals.total,
  };
}

/** Validates allocation rows: each needs an existing site/order/invoice reference and the
 * sum must not exceed the bill total. Throws a plain Error with a user-facing message on
 * any violation - callers should catch and respond 400. */
async function validateAllocations(allocations: BillAllocationInput[], total: Prisma.Decimal) {
  if (allocations.length === 0) return;
  const sum = allocations.reduce((s, a) => s.plus(a.amount), new Prisma.Decimal(0));
  if (sum.greaterThan(total)) {
    throw new Error(`Allocations (Rs ${sum.toFixed(2)}) exceed the bill total (Rs ${total.toFixed(2)})`);
  }
  const siteIds = allocations.map((a) => a.siteId).filter((v): v is string => !!v);
  const orderIds = allocations.map((a) => a.orderId).filter((v): v is string => !!v);
  const invoiceIds = allocations.map((a) => a.invoiceId).filter((v): v is string => !!v);
  const [sites, orders, invoices] = await Promise.all([
    siteIds.length ? prisma.site.findMany({ where: { id: { in: siteIds } }, select: { id: true } }) : [],
    orderIds.length ? prisma.order.findMany({ where: { id: { in: orderIds } }, select: { id: true } }) : [],
    invoiceIds.length ? prisma.invoice.findMany({ where: { id: { in: invoiceIds } }, select: { id: true } }) : [],
  ]);
  const siteSet = new Set(sites.map((s) => s.id));
  const orderSet = new Set(orders.map((o) => o.id));
  const invoiceSet = new Set(invoices.map((i) => i.id));
  for (const a of allocations) {
    if (a.siteId && !siteSet.has(a.siteId)) throw new Error(`Allocation references an unknown site (${a.siteId})`);
    if (a.orderId && !orderSet.has(a.orderId)) throw new Error(`Allocation references an unknown order (${a.orderId})`);
    if (a.invoiceId && !invoiceSet.has(a.invoiceId)) throw new Error(`Allocation references an unknown invoice (${a.invoiceId})`);
  }
}

const allocationDetail = {
  site: { select: { id: true, address: true, companyName: true } },
  order: { select: { id: true, orderNumber: true, customer: { select: { id: true, name: true } } } },
  invoice: { select: { id: true, invoiceNumber: true, docType: true } },
};

const billDetailInclude = {
  supplier: { select: { id: true, name: true, gstin: true, pan: true, state: true, address: true, contactName: true, contactPhone: true, contactEmail: true, vendorId: true } },
  purchaseOrder: { select: { id: true, poNumber: true } },
  lineItems: { orderBy: { sortOrder: "asc" as const } },
  allocations: { include: allocationDetail, orderBy: { createdAt: "asc" as const } },
  payments: { orderBy: { paidDate: "desc" as const } },
  auditLogs: { orderBy: { createdAt: "desc" as const }, include: { actor: { select: { name: true } } } },
  verifiedBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  recordedBy: { select: { id: true, name: true } },
};

function deriveBillStatus(total: Prisma.Decimal, paid: Prisma.Decimal): string {
  if (paid.greaterThanOrEqualTo(total) && paid.greaterThan(0)) return BILL_STATUS.PAID;
  if (paid.greaterThan(0)) return BILL_STATUS.PARTIALLY_PAID;
  return BILL_STATUS.APPROVED;
}

// --- List / create ----------------------------------------------------------
billsRouter.get("/", requirePermission(...CAPTURE), async (req, res) => {
  const where: Record<string, unknown> = {};
  if (typeof req.query.status === "string") where.status = req.query.status;
  if (typeof req.query.supplierId === "string") where.supplierId = req.query.supplierId;
  if (typeof req.query.siteId === "string") where.allocations = { some: { siteId: req.query.siteId } };
  if (typeof req.query.orderId === "string") where.allocations = { some: { orderId: req.query.orderId } };

  const bills = await prisma.bill.findMany({
    where,
    include: {
      supplier: { select: { id: true, name: true } },
      payments: { select: { amount: true } },
      allocations: { include: allocationDetail },
    },
    orderBy: { createdAt: "desc" },
  });
  const rows = bills.map((b) => {
    const paid = b.payments.reduce((s, p) => s.plus(p.amount), new Prisma.Decimal(0));
    return { ...b, amountPaid: paid, balance: new Prisma.Decimal(b.total).minus(paid), payments: undefined };
  });
  res.json(rows);
});

billsRouter.post("/", requirePermission(...CAPTURE), async (req: AuthenticatedRequest, res) => {
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
  const existingSameNumber = await prisma.bill.findUnique({
    where: { supplierId_billNumber: { supplierId: data.supplierId, billNumber: data.billNumber } },
  });
  if (existingSameNumber) {
    return res.status(400).json({ error: "A bill with this number already exists for this supplier" });
  }

  const company = await prisma.companySettings.findUnique({ where: { id: "singleton" } });
  const totals = computeBillTotals(data.lineItems, company?.state);
  const allocations = data.allocations ?? [];

  try {
    await validateAllocations(allocations, totals.total);
  } catch (err) {
    return res.status(400).json({ error: (err as Error).message });
  }

  const bill = await prisma.$transaction(async (tx) => {
    const created = await tx.bill.create({
      data: {
        billNumber: data.billNumber,
        supplierId: data.supplierId,
        purchaseOrderId: data.purchaseOrderId,
        status: BILL_STATUS.UPLOADED,
        sourceType: data.sourceType,
        attachmentUrl: data.attachmentUrl,
        attachmentMimeType: data.attachmentMimeType,
        extractionRaw: data.extractionRaw as Prisma.InputJsonValue | undefined,
        billDate: new Date(data.billDate),
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        total: totals.total,
        notes: data.notes,
        recordedById: req.auth!.userId,
        lineItems: { create: data.lineItems.map((l, i) => mapBillLine(l, i)) },
        allocations: { create: allocations.map((a) => ({ siteId: a.siteId, orderId: a.orderId, invoiceId: a.invoiceId, amount: new Prisma.Decimal(String(a.amount)), notes: a.notes })) },
      },
      include: billDetailInclude,
    });
    await tx.billAuditLog.create({
      data: {
        billId: created.id,
        actorId: req.auth!.userId,
        action: data.extractionRaw ? BILL_AUDIT_ACTION.EXTRACTED : BILL_AUDIT_ACTION.CREATED,
        summary: data.extractionRaw
          ? `Uploaded and AI-extracted from a ${data.sourceType ?? "scanned"} document; ${data.lineItems.length} line item(s), total Rs ${totals.total.toFixed(2)}`
          : `Created manually; ${data.lineItems.length} line item(s), total Rs ${totals.total.toFixed(2)}`,
      },
    });
    return created;
  });
  res.status(201).json(bill);
});

// --- AI extraction (never auto-saves) ---------------------------------------
billsRouter.post("/extract", requirePermission(...CAPTURE), async (req, res) => {
  const parsed = billExtractRequestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const rawDataUrl = parsed.data.fileDataUrl;
  const commaIdx = rawDataUrl.indexOf(",");
  const fileBase64 = rawDataUrl.startsWith("data:") && commaIdx !== -1 ? rawDataUrl.slice(commaIdx + 1) : rawDataUrl;
  const approxBytes = (fileBase64.length * 3) / 4;
  if (approxBytes > 4_500_000) {
    return res.status(400).json({ error: "File is too large (max ~4MB). Please compress or crop the image and try again." });
  }

  try {
    const extraction = await extractBillFromFile(fileBase64, parsed.data.mimeType);
    const supplierCandidates = await findSupplierCandidates(extraction.supplierNameGuess);
    res.json({ available: true, extraction, supplierCandidates });
  } catch (err) {
    if (err instanceof ExtractionUnavailableError) {
      return res.json({ available: false, error: err.message });
    }
    res.json({ available: false, error: err instanceof Error ? err.message : "Extraction failed" });
  }
});

// All vendor payments (and standing advances) across suppliers/bills - powers the Vendor
// Payments admin page, mirroring GET /payments for customers. Registered before GET /:id so
// "/bills/payments" isn't swallowed by the :id param route.
billsRouter.get("/payments", requirePermission(PERMISSION_KEY.RECORD_PAYMENTS, PERMISSION_KEY.APPROVE_VENDOR_INVOICE, PERMISSION_KEY.VIEW_LEDGERS), async (req, res) => {
  const where: Record<string, unknown> = {};
  if (typeof req.query.supplierId === "string") where.supplierId = req.query.supplierId;

  const payments = await prisma.paymentMade.findMany({
    where,
    include: {
      supplier: { select: { id: true, name: true } },
      bill: { select: { id: true, billNumber: true } },
    },
    orderBy: { paidDate: "desc" },
  });
  res.json(payments);
});

// --- Detail / edit -----------------------------------------------------------
billsRouter.get("/:id", requirePermission(...CAPTURE), async (req: AuthenticatedRequest, res) => {
  const id = asString(req.params.id);
  const bill = await prisma.bill.findUnique({ where: { id }, include: billDetailInclude });
  if (!bill) return res.status(404).json({ error: "Bill not found" });
  const paid = bill.payments.reduce((s, p) => s.plus(p.amount), new Prisma.Decimal(0));
  res.json({ ...bill, amountPaid: paid, balance: new Prisma.Decimal(bill.total).minus(paid) });
});

billsRouter.patch("/:id", requirePermission(...CAPTURE), async (req: AuthenticatedRequest, res) => {
  const id = asString(req.params.id);
  const parsed = billUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;

  const existing = await prisma.bill.findUnique({ where: { id }, include: { lineItems: { orderBy: { sortOrder: "asc" } }, allocations: true, supplier: { select: { name: true } } } });
  if (!existing) return res.status(404).json({ error: "Bill not found" });
  if (existing.status !== BILL_STATUS.UPLOADED && existing.status !== BILL_STATUS.VERIFIED) {
    return res.status(400).json({ error: "Only an uploaded or verified vendor invoice can be edited. Rejected/approved invoices must be rejected and re-entered to correct." });
  }

  const company = await prisma.companySettings.findUnique({ where: { id: "singleton" } });
  const effectiveLineItems = data.lineItems ?? existing.lineItems.map((l) => ({
    description: l.description, hsnCode: l.hsnCode ?? undefined, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), taxRatePct: Number(l.taxRatePct),
  }));
  const totals = computeBillTotals(effectiveLineItems, company?.state);

  let newAllocations = data.allocations;
  if (newAllocations) {
    try {
      await validateAllocations(newAllocations, totals.total);
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
  }

  if (data.supplierId && data.supplierId !== existing.supplierId) {
    const supplier = await prisma.supplier.findUnique({ where: { id: data.supplierId } });
    if (!supplier) return res.status(404).json({ error: "Supplier not found" });
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (data.lineItems) await tx.billLineItem.deleteMany({ where: { billId: id } });
    if (newAllocations) await tx.billAllocation.deleteMany({ where: { billId: id } });

    const bill = await tx.bill.update({
      where: { id },
      data: {
        billNumber: data.billNumber,
        supplierId: data.supplierId,
        purchaseOrderId: data.purchaseOrderId,
        sourceType: data.sourceType,
        attachmentUrl: data.attachmentUrl,
        attachmentMimeType: data.attachmentMimeType,
        billDate: data.billDate ? new Date(data.billDate) : undefined,
        dueDate: data.dueDate !== undefined ? (data.dueDate ? new Date(data.dueDate) : null) : undefined,
        notes: data.notes,
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        total: totals.total,
        lineItems: data.lineItems ? { create: data.lineItems.map((l, i) => mapBillLine(l, i)) } : undefined,
        allocations: newAllocations ? { create: newAllocations.map((a) => ({ siteId: a.siteId, orderId: a.orderId, invoiceId: a.invoiceId, amount: new Prisma.Decimal(String(a.amount)), notes: a.notes })) } : undefined,
      },
      include: billDetailInclude,
    });

    const changes: string[] = [];
    if (data.billNumber && data.billNumber !== existing.billNumber) changes.push(`Bill #: ${existing.billNumber} -> ${data.billNumber}`);
    if (data.billDate && new Date(data.billDate).getTime() !== existing.billDate.getTime()) {
      changes.push(`Bill date: ${existing.billDate.toISOString().slice(0, 10)} -> ${new Date(data.billDate).toISOString().slice(0, 10)}`);
    }
    if (data.notes !== undefined && data.notes !== existing.notes) changes.push("Notes updated");
    if (data.lineItems) changes.push(`Line items updated (${data.lineItems.length} item${data.lineItems.length === 1 ? "" : "s"})`);
    if (newAllocations) changes.push(`Allocations updated (${newAllocations.length} row${newAllocations.length === 1 ? "" : "s"})`);
    if (new Prisma.Decimal(bill.total).toString() !== new Prisma.Decimal(existing.total).toString()) {
      changes.push(`Total: Rs ${new Prisma.Decimal(existing.total).toFixed(2)} -> Rs ${new Prisma.Decimal(bill.total).toFixed(2)}`);
    }
    if (changes.length > 0) {
      await tx.billAuditLog.create({
        data: {
          billId: id,
          actorId: req.auth!.userId,
          action: newAllocations && !data.lineItems && changes.length === 1 ? BILL_AUDIT_ACTION.ALLOCATION_CHANGED : BILL_AUDIT_ACTION.FIELD_EDITED,
          summary: changes.join("; "),
        },
      });
    }
    return bill;
  });
  res.json(updated);
});

// --- Workflow transitions -----------------------------------------------------
billsRouter.post("/:id/verify", requirePermission(APPROVE), async (req: AuthenticatedRequest, res) => {
  const id = asString(req.params.id);
  const existing = await prisma.bill.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Bill not found" });
  if (existing.status !== BILL_STATUS.UPLOADED) return res.status(400).json({ error: "Only an uploaded vendor invoice can be verified" });

  const bill = await prisma.$transaction(async (tx) => {
    const updated = await tx.bill.update({ where: { id }, data: { status: BILL_STATUS.VERIFIED, verifiedById: req.auth!.userId, verifiedAt: new Date() } });
    await tx.billAuditLog.create({ data: { billId: id, actorId: req.auth!.userId, action: BILL_AUDIT_ACTION.VERIFIED, summary: "Marked verified" } });
    return updated;
  });
  res.json(bill);
});

billsRouter.post("/:id/approve", requirePermission(APPROVE), async (req: AuthenticatedRequest, res) => {
  const id = asString(req.params.id);
  const existing = await prisma.bill.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Bill not found" });
  if (existing.status !== BILL_STATUS.VERIFIED) return res.status(400).json({ error: "Only a verified vendor invoice can be approved" });

  const bill = await prisma.$transaction(async (tx) => {
    const updated = await tx.bill.update({ where: { id }, data: { status: BILL_STATUS.APPROVED, approvedById: req.auth!.userId, approvedAt: new Date() } });
    await tx.billAuditLog.create({ data: { billId: id, actorId: req.auth!.userId, action: BILL_AUDIT_ACTION.APPROVED, summary: "Approved for payment" } });
    return updated;
  });
  res.json(bill);
});

billsRouter.post("/:id/reject", requirePermission(APPROVE), async (req: AuthenticatedRequest, res) => {
  const id = asString(req.params.id);
  const parsed = billRejectSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const existing = await prisma.bill.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Bill not found" });
  if (existing.status !== BILL_STATUS.UPLOADED && existing.status !== BILL_STATUS.VERIFIED) {
    return res.status(400).json({ error: "Only an uploaded or verified vendor invoice can be rejected" });
  }

  const bill = await prisma.$transaction(async (tx) => {
    const updated = await tx.bill.update({ where: { id }, data: { status: BILL_STATUS.REJECTED, rejectedReason: parsed.data.reason } });
    await tx.billAuditLog.create({ data: { billId: id, actorId: req.auth!.userId, action: BILL_AUDIT_ACTION.REJECTED, summary: `Rejected: ${parsed.data.reason}` } });
    return updated;
  });
  res.json(bill);
});

billsRouter.post("/:id/cancel", requirePermission(APPROVE), async (req: AuthenticatedRequest, res) => {
  const id = asString(req.params.id);
  const existing = await prisma.bill.findUnique({ where: { id }, include: { payments: { select: { id: true } } } });
  if (!existing) return res.status(404).json({ error: "Bill not found" });
  if (existing.status === BILL_STATUS.PAID || existing.status === BILL_STATUS.CANCELLED) {
    return res.status(400).json({ error: "This vendor invoice can no longer be cancelled" });
  }
  if (existing.payments.length > 0) {
    return res.status(400).json({ error: "Cannot cancel a vendor invoice that has payments recorded" });
  }

  const bill = await prisma.$transaction(async (tx) => {
    const updated = await tx.bill.update({ where: { id }, data: { status: BILL_STATUS.CANCELLED } });
    await tx.billAuditLog.create({ data: { billId: id, actorId: req.auth!.userId, action: BILL_AUDIT_ACTION.CANCELLED, summary: "Cancelled" } });
    return updated;
  });
  res.json(bill);
});

// --- Payments ------------------------------------------------------------------
billsRouter.post("/:id/payments", requirePermission(PERMISSION_KEY.RECORD_PAYMENTS), async (req: AuthenticatedRequest, res) => {
  const id = asString(req.params.id);
  const parsed = paymentMadeCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;

  const bill = await prisma.bill.findUnique({ where: { id }, include: { payments: true } });
  if (!bill) return res.status(404).json({ error: "Bill not found" });
  if (![BILL_STATUS.APPROVED, BILL_STATUS.PARTIALLY_PAID].includes(bill.status as never)) {
    return res.status(400).json({ error: "Only an approved (or partially paid) vendor invoice can receive payments" });
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
    const updated = await tx.bill.update({ where: { id: bill.id }, data: { status: newStatus } });
    await tx.billAuditLog.create({
      data: {
        billId: id,
        actorId: req.auth!.userId,
        action: BILL_AUDIT_ACTION.PAYMENT_RECORDED,
        summary: `Payment recorded: Rs ${amount.toFixed(2)} (${data.method}); Status: ${bill.status} -> ${newStatus}`,
      },
    });
    return updated;
  });
  res.status(201).json(result);
});

// The general vendor-payment endpoint (mirrors POST /payments for customers, Phase C): a
// payment can be recorded against a specific bill, left entirely unallocated as a supplier
// advance (omit billId), or both at once - pay more than a bill's outstanding balance and
// the excess is automatically split off into a separate advance PaymentMade row, the same
// way an over-payment becomes a customer advance. Kept separate from POST /:id/payments
// above (which still hard-caps at the bill's outstanding balance) so that existing call site
// keeps its simpler, stricter behaviour.
billsRouter.post("/payments", requirePermission(PERMISSION_KEY.RECORD_PAYMENTS), async (req: AuthenticatedRequest, res) => {
  const parsed = paymentMadeGeneralCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;

  const supplier = await prisma.supplier.findUnique({ where: { id: data.supplierId }, select: { id: true } });
  if (!supplier) return res.status(404).json({ error: "Supplier not found" });

  const amount = new Prisma.Decimal(String(data.amount));
  const paidDate = data.paidDate ? new Date(data.paidDate) : new Date();

  if (!data.billId) {
    // Pure advance - no bill to validate against.
    const created = await prisma.paymentMade.create({
      data: {
        supplierId: data.supplierId,
        amount,
        method: data.method,
        reference: data.reference,
        paidDate,
        notes: data.notes,
        recordedById: req.auth!.userId,
      },
    });
    return res.status(201).json(created);
  }

  const billId = data.billId;
  const bill = await prisma.bill.findUnique({ where: { id: billId }, include: { payments: true } });
  if (!bill) return res.status(404).json({ error: "Bill not found" });
  if (bill.supplierId !== data.supplierId) return res.status(400).json({ error: "Bill does not belong to this supplier" });
  if (![BILL_STATUS.APPROVED, BILL_STATUS.PARTIALLY_PAID].includes(bill.status as never)) {
    return res.status(400).json({ error: "Only an approved (or partially paid) vendor invoice can receive payments" });
  }
  const paidBefore = bill.payments.reduce((s, p) => s.plus(p.amount), new Prisma.Decimal(0));
  const outstanding = new Prisma.Decimal(bill.total).minus(paidBefore);
  const appliedAmount = Prisma.Decimal.min(amount, outstanding.isNegative() ? new Prisma.Decimal(0) : outstanding);
  const advanceAmount = amount.minus(appliedAmount);

  const result = await prisma.$transaction(async (tx) => {
    if (appliedAmount.greaterThan(0)) {
      await tx.paymentMade.create({
        data: {
          billId,
          supplierId: data.supplierId,
          amount: appliedAmount,
          method: data.method,
          reference: data.reference,
          paidDate,
          notes: data.notes,
          recordedById: req.auth!.userId,
        },
      });
    }
    if (advanceAmount.greaterThan(0.01)) {
      await tx.paymentMade.create({
        data: {
          supplierId: data.supplierId,
          amount: advanceAmount,
          method: data.method,
          reference: data.reference,
          paidDate,
          notes: data.notes ? `${data.notes} (advance)` : "Advance (paid alongside a bill payment)",
          recordedById: req.auth!.userId,
        },
      });
    }
    const newPaid = paidBefore.plus(appliedAmount);
    const newStatus = deriveBillStatus(new Prisma.Decimal(bill.total), newPaid);
    const updated = await tx.bill.update({ where: { id: billId }, data: { status: newStatus } });
    const summary = advanceAmount.greaterThan(0.01)
      ? `Payment recorded: Rs ${appliedAmount.toFixed(2)} (${data.method}) against this bill, Rs ${advanceAmount.toFixed(2)} held as a supplier advance; Status: ${bill.status} -> ${newStatus}`
      : `Payment recorded: Rs ${appliedAmount.toFixed(2)} (${data.method}); Status: ${bill.status} -> ${newStatus}`;
    await tx.billAuditLog.create({
      data: { billId, actorId: req.auth!.userId, action: BILL_AUDIT_ACTION.PAYMENT_RECORDED, summary },
    });
    return updated;
  });
  res.status(201).json({ ...result, advanceAmount });
});

// Apply part or all of an existing, still-unallocated supplier advance (a PaymentMade with
// billId null) to a specific bill. Splits the advance in two when only part of it is used:
// the original row shrinks by the applied amount, and a new billId-linked row is created for
// the applied portion - PaymentMade has no allocation/junction table (unlike PaymentReceived's
// PaymentAllocation), so this is the simplest way to keep one advance usable across several
// bills over time without a schema change.
billsRouter.post("/:id/apply-advance", requirePermission(PERMISSION_KEY.RECORD_PAYMENTS), async (req: AuthenticatedRequest, res) => {
  const id = asString(req.params.id);
  const parsed = advanceApplicationCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;

  const bill = await prisma.bill.findUnique({ where: { id }, include: { payments: true } });
  if (!bill) return res.status(404).json({ error: "Bill not found" });
  if (![BILL_STATUS.APPROVED, BILL_STATUS.PARTIALLY_PAID].includes(bill.status as never)) {
    return res.status(400).json({ error: "Only an approved (or partially paid) vendor invoice can receive payments" });
  }

  const advance = await prisma.paymentMade.findUnique({ where: { id: data.paymentId } });
  if (!advance) return res.status(404).json({ error: "Advance payment not found" });
  if (advance.billId) return res.status(400).json({ error: "This payment is already applied to a bill" });
  if (advance.supplierId !== bill.supplierId) return res.status(400).json({ error: "Advance does not belong to this bill's supplier" });

  const paidBefore = bill.payments.reduce((s, p) => s.plus(p.amount), new Prisma.Decimal(0));
  const outstanding = new Prisma.Decimal(bill.total).minus(paidBefore);
  const applyAmount = new Prisma.Decimal(String(data.amount));
  if (applyAmount.greaterThan(outstanding.plus(0.01))) {
    return res.status(400).json({ error: "Amount exceeds the bill's outstanding balance" });
  }
  if (applyAmount.greaterThan(new Prisma.Decimal(advance.amount).plus(0.01))) {
    return res.status(400).json({ error: "Amount exceeds the advance's remaining balance" });
  }

  const result = await prisma.$transaction(async (tx) => {
    const remaining = new Prisma.Decimal(advance.amount).minus(applyAmount);
    if (remaining.lessThanOrEqualTo(0.01)) {
      // Using the whole advance - just point the existing row at this bill.
      await tx.paymentMade.update({ where: { id: advance.id }, data: { billId: id } });
    } else {
      // Using part of it - shrink the original advance and create a new bill-linked row.
      await tx.paymentMade.update({ where: { id: advance.id }, data: { amount: remaining } });
      await tx.paymentMade.create({
        data: {
          billId: id,
          supplierId: advance.supplierId,
          amount: applyAmount,
          method: advance.method,
          reference: advance.reference,
          paidDate: advance.paidDate,
          notes: `Applied from advance recorded ${advance.paidDate.toISOString().slice(0, 10)}`,
          recordedById: req.auth!.userId,
        },
      });
    }
    const newPaid = paidBefore.plus(applyAmount);
    const newStatus = deriveBillStatus(new Prisma.Decimal(bill.total), newPaid);
    const updated = await tx.bill.update({ where: { id }, data: { status: newStatus } });
    await tx.billAuditLog.create({
      data: {
        billId: id,
        actorId: req.auth!.userId,
        action: BILL_AUDIT_ACTION.PAYMENT_RECORDED,
        summary: `Advance applied: Rs ${applyAmount.toFixed(2)}; Status: ${bill.status} -> ${newStatus}`,
      },
    });
    return updated;
  });
  res.status(201).json(result);
});
