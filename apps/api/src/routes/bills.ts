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
  ROLE_KEY,
  BILL_STATUS,
  BILL_AUDIT_ACTION,
  billCreateSchema,
  billUpdateSchema,
  billRejectSchema,
  billDeleteSchema,
  billExtractRequestSchema,
  paymentMadeCreateSchema,
  paymentMadeGeneralCreateSchema,
  paymentMadeUpdateSchema,
  paymentMadeAttachmentInputSchema,
  PAYMENT_MADE_MAX_ATTACHMENTS,
  advanceApplicationCreateSchema,
} from "@recd/shared";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authenticate, requirePermission, requireRole, type AuthenticatedRequest } from "../middleware/auth";
import { asString } from "../lib/params";
import { computeDocumentTotals } from "../services/taxCalc";
import { extractBillFromFile, findSupplierCandidates, ExtractionUnavailableError } from "../agent/billExtraction";
import { archivedBillNumber, duplicateBillNumberMessage, rejectedBillDeleteBlocker } from "../services/billDelete";
import { billPaymentTotals, planVendorPayment, vendorTdsEditError } from "../services/vendorPaymentTds";
import { attachmentCreateRows, attachmentMetaSelect, attachmentsError, contentDisposition, decodeDataUrl } from "../services/paymentMadeAttachments";

export const billsRouter = Router();
billsRouter.use(authenticate);

const CAPTURE = [PERMISSION_KEY.RECORD_VENDOR_INVOICE, PERMISSION_KEY.APPROVE_VENDOR_INVOICE];
const APPROVE = PERMISSION_KEY.APPROVE_VENDOR_INVOICE;
/** Who can see vendor payments (same as GET /bills/payments has always used). */
const VIEW_PAYMENTS = [PERMISSION_KEY.RECORD_PAYMENTS, PERMISSION_KEY.APPROVE_VENDOR_INVOICE, PERMISSION_KEY.VIEW_LEDGERS];

/** amountPaid = cash, tdsDeducted = TDS withheld, balance = total - (cash + TDS). */
function billPaymentFigures(total: Prisma.Decimal, payments: { amount: Prisma.Decimal; tdsAmount: Prisma.Decimal | null }[]) {
  const { cash, tds, settled } = billPaymentTotals(payments);
  return { amountPaid: cash, tdsDeducted: tds, amountSettled: settled, balance: new Prisma.Decimal(total).minus(settled) };
}

const paymentListInclude = {
  supplier: { select: { id: true, name: true } },
  bill: { select: { id: true, billNumber: true } },
  orderTags: { include: { order: { select: { id: true, orderNumber: true } } } },
  // Metadata only - the file bytes (dataUrl) are omitted globally in lib/prisma.ts.
  attachments: { select: attachmentMetaSelect, orderBy: { createdAt: "asc" as const } },
};

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
  // Deleted (archived rejected) bills only show when asked for explicitly.
  const where: Record<string, unknown> = { status: { not: BILL_STATUS.DELETED } };
  if (typeof req.query.status === "string") where.status = req.query.status;
  if (typeof req.query.supplierId === "string") where.supplierId = req.query.supplierId;
  if (typeof req.query.siteId === "string") where.allocations = { some: { siteId: req.query.siteId } };
  if (typeof req.query.orderId === "string") where.allocations = { some: { orderId: req.query.orderId } };

  const bills = await prisma.bill.findMany({
    where,
    // The scan (base64) and raw AI extraction are detail-only - never drag them through a list.
    omit: { attachmentUrl: true, extractionRaw: true },
    include: {
      supplier: { select: { id: true, name: true } },
      payments: { select: { amount: true, tdsAmount: true } },
      allocations: { include: allocationDetail },
    },
    orderBy: { createdAt: "desc" },
  });
  const rows = bills.map((b) => ({ ...b, ...billPaymentFigures(b.total, b.payments), payments: undefined }));
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
    return res.status(400).json({ error: duplicateBillNumberMessage(existingSameNumber.status) });
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
billsRouter.get("/payments", requirePermission(...VIEW_PAYMENTS), async (req, res) => {
  const where: Record<string, unknown> = {};
  if (typeof req.query.supplierId === "string") where.supplierId = req.query.supplierId;

  const payments = await prisma.paymentMade.findMany({
    where,
    include: paymentListInclude,
    orderBy: { paidDate: "desc" },
  });
  res.json(payments);
});

billsRouter.get("/payments/:id", requirePermission(...VIEW_PAYMENTS), async (req, res) => {
  const payment = await prisma.paymentMade.findUnique({ where: { id: asString(req.params.id) }, include: paymentListInclude });
  if (!payment) return res.status(404).json({ error: "Payment not found" });
  res.json(payment);
});

// The only route that reads attachment bytes. ?download=1 forces a download; otherwise images
// and PDFs open inline in the browser. Private cache: finance documents, behind auth.
billsRouter.get("/payments/:id/attachments/:attachmentId", requirePermission(...VIEW_PAYMENTS), async (req, res) => {
  const attachment = await prisma.paymentMadeAttachment.findUnique({
    where: { id: asString(req.params.attachmentId) },
    omit: { dataUrl: false },
  });
  if (!attachment || attachment.paymentMadeId !== asString(req.params.id)) return res.status(404).json({ error: "Attachment not found" });
  res.setHeader("Content-Type", attachment.mimeType);
  res.setHeader("Content-Disposition", contentDisposition(attachment.fileName, req.query.download !== "1"));
  res.setHeader("Cache-Control", "private, max-age=300");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(decodeDataUrl(attachment.dataUrl));
});

// Add attachments to an existing payment - one file per request keeps each body under the
// hosting request-size limit, so the UI uploads files one by one after the payment is saved.
billsRouter.post("/payments/:id/attachments", requirePermission(PERMISSION_KEY.RECORD_PAYMENTS), async (req: AuthenticatedRequest, res) => {
  const id = asString(req.params.id);
  const parsed = z.object({ attachments: z.array(paymentMadeAttachmentInputSchema).min(1).max(PAYMENT_MADE_MAX_ATTACHMENTS) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const payment = await prisma.paymentMade.findUnique({ where: { id }, include: { _count: { select: { attachments: true } } } });
  if (!payment) return res.status(404).json({ error: "Payment not found" });
  const err = attachmentsError(parsed.data.attachments, payment._count.attachments);
  if (err) return res.status(400).json({ error: err });
  await prisma.paymentMadeAttachment.createMany({
    data: attachmentCreateRows(parsed.data.attachments, req.auth!.userId).map((a) => ({ ...a, paymentMadeId: id })),
  });
  const updated = await prisma.paymentMade.findUnique({ where: { id }, include: paymentListInclude });
  res.status(201).json(updated);
});

billsRouter.delete("/payments/:id/attachments/:attachmentId", requirePermission(PERMISSION_KEY.RECORD_PAYMENTS), async (req, res) => {
  const { count } = await prisma.paymentMadeAttachment.deleteMany({
    where: { id: asString(req.params.attachmentId), paymentMadeId: asString(req.params.id) },
  });
  if (count === 0) return res.status(404).json({ error: "Attachment not found" });
  res.status(204).end();
});

// Edit a recorded vendor payment: method/reference/date/notes, TDS (+ certificate ref) and
// attachments. The cash amount, supplier and bill stay fixed (they drive settlement and advance
// splitting - delete-and-re-record is not offered either). A TDS change is re-validated against
// the bill, re-derives the bill's status and is written to the bill's audit trail.
billsRouter.patch("/payments/:id", requirePermission(PERMISSION_KEY.RECORD_PAYMENTS), async (req: AuthenticatedRequest, res) => {
  const id = asString(req.params.id);
  const parsed = paymentMadeUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;

  const payment = await prisma.paymentMade.findUnique({
    where: { id },
    include: { bill: { include: { payments: { select: { id: true, amount: true, tdsAmount: true } } } }, attachments: { select: { id: true } } },
  });
  if (!payment) return res.status(404).json({ error: "Payment not found" });

  const oldTds = new Prisma.Decimal(payment.tdsAmount ?? 0);
  const newTds = data.tdsAmount !== undefined ? new Prisma.Decimal(String(data.tdsAmount)) : oldTds;
  const tdsChanged = !newTds.equals(oldTds);
  if (tdsChanged) {
    const others = payment.bill ? payment.bill.payments.filter((p) => p.id !== id) : [];
    const err = vendorTdsEditError({
      billTotal: payment.bill ? payment.bill.total : null,
      otherSettled: billPaymentTotals(others).settled,
      cash: payment.amount,
      newTds,
    });
    if (err) return res.status(400).json({ error: err });
  }

  const removeIds = (data.removeAttachmentIds ?? []).filter((a) => payment.attachments.some((x) => x.id === a));
  const incoming = data.attachments ?? [];
  const attachErr = attachmentsError(incoming, payment.attachments.length - removeIds.length);
  if (attachErr) return res.status(400).json({ error: attachErr });

  const updated = await prisma.$transaction(async (tx) => {
    if (removeIds.length) await tx.paymentMadeAttachment.deleteMany({ where: { id: { in: removeIds }, paymentMadeId: id } });
    const row = await tx.paymentMade.update({
      where: { id },
      data: {
        method: data.method,
        reference: data.reference,
        paidDate: data.paidDate ? new Date(data.paidDate) : undefined,
        notes: data.notes,
        tdsAmount: tdsChanged ? newTds : undefined,
        tdsCertificateRef: data.tdsCertificateRef,
        attachments: incoming.length ? { create: attachmentCreateRows(incoming, req.auth!.userId) } : undefined,
      },
      include: paymentListInclude,
    });
    if (payment.bill && tdsChanged) {
      const bill = payment.bill;
      const settled = billPaymentTotals(bill.payments.map((p) => (p.id === id ? { ...p, tdsAmount: newTds } : p))).settled;
      const newStatus = deriveBillStatus(new Prisma.Decimal(bill.total), settled);
      await tx.bill.update({ where: { id: bill.id }, data: { status: newStatus } });
      await tx.billAuditLog.create({
        data: {
          billId: bill.id,
          actorId: req.auth!.userId,
          action: BILL_AUDIT_ACTION.PAYMENT_EDITED,
          summary: `Payment of Rs ${new Prisma.Decimal(payment.amount).toFixed(2)} edited: TDS Rs ${oldTds.toFixed(2)} -> Rs ${newTds.toFixed(2)}; Status: ${bill.status} -> ${newStatus}`,
        },
      });
    }
    return row;
  });
  res.json(updated);
});

// --- Detail / edit -----------------------------------------------------------
billsRouter.get("/:id", requirePermission(...CAPTURE), async (req: AuthenticatedRequest, res) => {
  const id = asString(req.params.id);
  const bill = await prisma.bill.findUnique({ where: { id }, include: billDetailInclude });
  if (!bill) return res.status(404).json({ error: "Bill not found" });
  res.json({ ...bill, ...billPaymentFigures(bill.total, bill.payments) });
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

// Delete a REJECTED vendor invoice (soft: archived, number freed, audit kept) - see
// services/billDelete.ts. Admins only (Super Admin, Owner/Admin) - approvers can reject but not delete.
billsRouter.post("/:id/delete", requireRole(ROLE_KEY.SUPER_ADMIN, ROLE_KEY.OWNER_ADMIN), async (req: AuthenticatedRequest, res) => {
  const id = asString(req.params.id);
  const parsed = billDeleteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "A reason (at least 3 characters) is required to delete a vendor invoice" });

  const existing = await prisma.bill.findUnique({
    where: { id },
    include: { _count: { select: { payments: true, debitNotes: true } } },
  });
  if (!existing) return res.status(404).json({ error: "Bill not found" });
  const blocker = rejectedBillDeleteBlocker({
    status: existing.status,
    billNumber: existing.billNumber,
    paymentCount: existing._count.payments,
    debitNoteCount: existing._count.debitNotes,
  });
  if (blocker) return res.status(400).json({ error: blocker });

  const now = new Date();
  const bill = await prisma.$transaction(async (tx) => {
    const updated = await tx.bill.update({
      where: { id },
      data: { status: BILL_STATUS.DELETED, billNumber: archivedBillNumber(existing.billNumber, id, now) },
    });
    await tx.billAuditLog.create({
      data: {
        billId: id,
        actorId: req.auth!.userId,
        action: BILL_AUDIT_ACTION.DELETED,
        summary: `Deleted rejected vendor invoice ${existing.billNumber} (number freed for re-entry). Reason: ${parsed.data.reason}`,
      },
    });
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
  const paidBefore = billPaymentTotals(bill.payments).settled;
  const outstanding = new Prisma.Decimal(bill.total).minus(paidBefore);
  const amount = new Prisma.Decimal(String(data.amount));
  // Strict route: cash + TDS must fit in the outstanding balance (no advance split here).
  const plan = planVendorPayment({ outstanding, cash: amount, tds: data.tdsAmount, allowAdvance: false });
  if (!plan.ok) return res.status(400).json({ error: plan.error });
  const attachments = data.attachments ?? [];
  const attachErr = attachmentsError(attachments, 0);
  if (attachErr) return res.status(400).json({ error: attachErr });

  const result = await prisma.$transaction(async (tx) => {
    const payment = await tx.paymentMade.create({
      data: {
        billId: bill.id,
        supplierId: bill.supplierId,
        amount,
        tdsAmount: plan.tds,
        tdsCertificateRef: data.tdsCertificateRef,
        method: data.method,
        reference: data.reference,
        paidDate: data.paidDate ? new Date(data.paidDate) : new Date(),
        notes: data.notes,
        recordedById: req.auth!.userId,
        attachments: attachments.length ? { create: attachmentCreateRows(attachments, req.auth!.userId) } : undefined,
      },
    });
    const newPaid = paidBefore.plus(amount).plus(plan.tds);
    const newStatus = deriveBillStatus(new Prisma.Decimal(bill.total), newPaid);
    const updated = await tx.bill.update({ where: { id: bill.id }, data: { status: newStatus } });
    await tx.billAuditLog.create({
      data: {
        billId: id,
        actorId: req.auth!.userId,
        action: BILL_AUDIT_ACTION.PAYMENT_RECORDED,
        summary: `Payment recorded: Rs ${amount.toFixed(2)} (${data.method})${plan.tds.greaterThan(0) ? ` + TDS Rs ${plan.tds.toFixed(2)}` : ""}; Status: ${bill.status} -> ${newStatus}`,
      },
    });
    return { ...updated, paymentId: payment.id };
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

  // Order tagging is optional and purely a discovery aid (see paymentMadeGeneralCreateSchema's
  // doc comment) - validate the IDs exist so a typo doesn't silently create a dangling tag.
  const orderIds = Array.from(new Set(data.orderIds ?? []));
  if (orderIds.length) {
    const orders = await prisma.order.findMany({ where: { id: { in: orderIds } }, select: { id: true } });
    if (orders.length !== orderIds.length) return res.status(400).json({ error: "One or more order IDs were not found" });
  }

  const amount = new Prisma.Decimal(String(data.amount));
  const paidDate = data.paidDate ? new Date(data.paidDate) : new Date();
  const attachments = data.attachments ?? [];
  const attachErr = attachmentsError(attachments, 0);
  if (attachErr) return res.status(400).json({ error: attachErr });
  const attachmentCreate = attachments.length ? { create: attachmentCreateRows(attachments, req.auth!.userId) } : undefined;

  if (!data.billId) {
    // Pure advance - no bill to validate against, and no TDS (the schema refuses TDS without a bill).
    const created = await prisma.paymentMade.create({
      data: {
        supplierId: data.supplierId,
        amount,
        method: data.method,
        reference: data.reference,
        paidDate,
        notes: data.notes,
        recordedById: req.auth!.userId,
        orderTags: orderIds.length ? { create: orderIds.map((orderId) => ({ orderId })) } : undefined,
        attachments: attachmentCreate,
      },
      include: paymentListInclude,
    });
    return res.status(201).json({ ...created, paymentId: created.id, advancePaymentId: created.id });
  }

  const billId = data.billId;
  const bill = await prisma.bill.findUnique({ where: { id: billId }, include: { payments: true } });
  if (!bill) return res.status(404).json({ error: "Bill not found" });
  if (bill.supplierId !== data.supplierId) return res.status(400).json({ error: "Bill does not belong to this supplier" });
  if (![BILL_STATUS.APPROVED, BILL_STATUS.PARTIALLY_PAID].includes(bill.status as never)) {
    return res.status(400).json({ error: "Only an approved (or partially paid) vendor invoice can receive payments" });
  }
  const paidBefore = billPaymentTotals(bill.payments).settled;
  const outstanding = new Prisma.Decimal(bill.total).minus(paidBefore);
  // TDS settles the bill first-class; cash fills the rest and any excess cash becomes an advance.
  const plan = planVendorPayment({ outstanding, cash: amount, tds: data.tdsAmount });
  if (!plan.ok) return res.status(400).json({ error: plan.error });
  const { appliedCash: appliedAmount, advanceCash: advanceAmount, tds } = plan;
  const tdsNote = tds.greaterThan(0) ? ` + TDS Rs ${tds.toFixed(2)}` : "";

  const result = await prisma.$transaction(async (tx) => {
    let paymentId: string | null = null;
    let advancePaymentId: string | null = null;
    // A bill row is needed whenever cash or TDS lands on the bill (TDS-only rows are allowed).
    if (appliedAmount.greaterThan(0) || tds.greaterThan(0)) {
      const row = await tx.paymentMade.create({
        data: {
          billId,
          supplierId: data.supplierId,
          amount: appliedAmount,
          tdsAmount: tds,
          tdsCertificateRef: data.tdsCertificateRef,
          method: data.method,
          reference: data.reference,
          paidDate,
          notes: data.notes,
          recordedById: req.auth!.userId,
          attachments: attachmentCreate,
        },
      });
      paymentId = row.id;
    }
    if (advanceAmount.greaterThan(0)) {
      const row = await tx.paymentMade.create({
        data: {
          supplierId: data.supplierId,
          amount: advanceAmount,
          method: data.method,
          reference: data.reference,
          paidDate,
          notes: data.notes ? `${data.notes} (advance)` : "Advance (paid alongside a bill payment)",
          recordedById: req.auth!.userId,
          orderTags: orderIds.length ? { create: orderIds.map((orderId) => ({ orderId })) } : undefined,
          // Documents go on the bill row; only when nothing landed on the bill do they sit here.
          attachments: paymentId ? undefined : attachmentCreate,
        },
      });
      advancePaymentId = row.id;
    }
    const newPaid = paidBefore.plus(appliedAmount).plus(tds);
    const newStatus = deriveBillStatus(new Prisma.Decimal(bill.total), newPaid);
    const updated = await tx.bill.update({ where: { id: billId }, data: { status: newStatus } });
    const summary = advanceAmount.greaterThan(0)
      ? `Payment recorded: Rs ${appliedAmount.toFixed(2)} (${data.method})${tdsNote} against this bill, Rs ${advanceAmount.toFixed(2)} held as a supplier advance; Status: ${bill.status} -> ${newStatus}`
      : `Payment recorded: Rs ${appliedAmount.toFixed(2)} (${data.method})${tdsNote}; Status: ${bill.status} -> ${newStatus}`;
    await tx.billAuditLog.create({
      data: { billId, actorId: req.auth!.userId, action: BILL_AUDIT_ACTION.PAYMENT_RECORDED, summary },
    });
    return { bill: updated, paymentId: paymentId ?? advancePaymentId, advancePaymentId };
  });
  res.status(201).json({ ...result.bill, advanceAmount, tdsAmount: tds, paymentId: result.paymentId, advancePaymentId: result.advancePaymentId });
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

  // Settled = cash + TDS (vendorPaymentTds.ts). Advances never carry TDS, so the applied part is cash only.
  const paidBefore = billPaymentTotals(bill.payments).settled;
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
