import { Router } from "express";
import { Prisma } from "@prisma/client";
import {
  PERMISSION_KEY,
  INVOICE_STATUS,
  PAYMENT_METHOD,
  FINANCE_DOC_TYPE,
  invoiceCreateSchema,
  invoiceUpdateSchema,
  invoiceCancelSchema,
  paymentCreateSchema,
  INVOICE_DOC_TYPE,
} from "@recd/shared";
import { prisma } from "../lib/prisma";
import { authenticate, requirePermission, type AuthenticatedRequest } from "../middleware/auth";
import { asString } from "../lib/params";
import { computeDocumentTotals } from "../services/taxCalc";
import { nextDocumentNumber } from "../services/documentNumber";

export const invoicesRouter = Router();
invoicesRouter.use(authenticate);

async function invoiceSummary(tx: Prisma.TransactionClient, id: string) {
  return tx.invoice.findUniqueOrThrow({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, gstin: true, state: true, address: true } },
      order: { select: { id: true, orderNumber: true } },
      quotation: { select: { id: true, quoteNumber: true } },
      lineItems: { orderBy: { sortOrder: "asc" } },
      payments: true,
    },
  });
}

function deriveInvoiceStatus(total: Prisma.Decimal, paid: Prisma.Decimal): string {
  if (paid.isZero()) return INVOICE_STATUS.ISSUED;
  if (paid.greaterThanOrEqualTo(total)) return INVOICE_STATUS.PAID;
  return INVOICE_STATUS.PARTIALLY_PAID;
}

invoicesRouter.get("/", requirePermission(PERMISSION_KEY.MANAGE_INVOICES), async (req: AuthenticatedRequest, res) => {
  const where: Record<string, unknown> = {};
  if (typeof req.query.docType === "string") where.docType = req.query.docType;
  if (typeof req.query.status === "string") where.status = req.query.status;
  if (typeof req.query.customerId === "string") where.customerId = req.query.customerId;

  const invoices = await prisma.invoice.findMany({
    where,
    include: {
      customer: { select: { id: true, name: true } },
      payments: { select: { amount: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const now = new Date();
  const rows = invoices.map((inv) => {
    const paid = inv.payments.reduce((s, p) => s.plus(p.amount), new Prisma.Decimal(0));
    const balance = new Prisma.Decimal(inv.total).minus(paid);
    const overdue =
      (inv.status === INVOICE_STATUS.ISSUED || inv.status === INVOICE_STATUS.PARTIALLY_PAID) &&
      !!inv.dueDate &&
      new Prisma.Decimal(inv.dueDate.getTime()).lessThan(now.getTime());
    return {
      ...inv,
      invoiceNumber: inv.status === INVOICE_STATUS.DRAFT ? `DRAFT-${inv.id}` : inv.invoiceNumber,
      amountPaid: paid,
      balance,
      overdue,
      payments: undefined,
    };
  });
  res.json(rows);
});

invoicesRouter.post("/", requirePermission(PERMISSION_KEY.MANAGE_INVOICES), async (req: AuthenticatedRequest, res) => {
  const parsed = invoiceCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;

  const company = await prisma.companySettings.findUnique({ where: { id: "singleton" } });
  const totals = computeDocumentTotals(
    data.lineItems.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, discountPct: l.discountPct, taxRatePct: l.taxRatePct })),
    company?.state,
    data.placeOfSupply,
  );

  const invoice = await prisma.invoice.create({
    data: {
      docType: data.docType,
      invoiceNumber: `DRAFT-${crypto.randomUUID()}`,
      customerId: data.customerId,
      orderId: data.orderId,
      quotationId: data.quotationId,
      status: INVOICE_STATUS.DRAFT,
      issueDate: data.issueDate ? new Date(data.issueDate) : new Date(),
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      placeOfSupply: data.placeOfSupply,
      subtotal: totals.subtotal,
      discountAmount: totals.discountAmount,
      cgstAmount: totals.cgstAmount,
      sgstAmount: totals.sgstAmount,
      igstAmount: totals.igstAmount,
      total: totals.total,
      notes: data.notes,
      terms: data.terms,
      createdById: req.auth!.userId,
      lineItems: {
        create: data.lineItems.map((l, i) => ({
          productId: l.productId,
          description: l.description,
          hsnCode: l.hsnCode,
          quantity: new Prisma.Decimal(String(l.quantity)),
          unitPrice: new Prisma.Decimal(String(l.unitPrice)),
          discountPct: new Prisma.Decimal(String(l.discountPct)),
          taxRatePct: new Prisma.Decimal(String(l.taxRatePct)),
          lineTotal: new Prisma.Decimal(String(l.quantity * l.unitPrice * (1 - l.discountPct / 100))).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
          sortOrder: i,
        })),
      },
    },
    include: { lineItems: true },
  });
  res.status(201).json(invoice);
});

invoicesRouter.get("/:id", requirePermission(PERMISSION_KEY.MANAGE_INVOICES), async (req: AuthenticatedRequest, res) => {
  const id = asString(req.params.id);
  let inv;
  try {
    inv = await invoiceSummary(prisma, id);
  } catch {
    return res.status(404).json({ error: "Invoice not found" });
  }
  const paid = inv.payments.reduce((s, p) => s.plus(p.amount), new Prisma.Decimal(0));
  const now = new Date();
  const overdue =
    (inv.status === INVOICE_STATUS.ISSUED || inv.status === INVOICE_STATUS.PARTIALLY_PAID) &&
    !!inv.dueDate &&
    inv.dueDate.getTime() < now.getTime();
  res.json({
    ...inv,
    invoiceNumber: inv.status === INVOICE_STATUS.DRAFT ? `DRAFT-${inv.id}` : inv.invoiceNumber,
    amountPaid: paid,
    balance: new Prisma.Decimal(inv.total).minus(paid),
    overdue,
    payments: inv.payments.map((p) => ({
      id: p.id,
      amount: p.amount,
      method: p.method,
      reference: p.reference,
      receivedDate: p.receivedDate,
      notes: p.notes,
    })),
  });
});

invoicesRouter.put("/:id", requirePermission(PERMISSION_KEY.MANAGE_INVOICES), async (req: AuthenticatedRequest, res) => {
  const id = asString(req.params.id);
  const parsed = invoiceUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;

  const existing = await prisma.invoice.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Invoice not found" });
  if (existing.status !== INVOICE_STATUS.DRAFT) {
    return res.status(400).json({ error: "Only draft invoices can be edited" });
  }

  const company = await prisma.companySettings.findUnique({ where: { id: "singleton" } });
  const invoice = await prisma.$transaction(async (tx) => {
    if (data.lineItems) {
      const totals = computeDocumentTotals(
        data.lineItems.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, discountPct: l.discountPct, taxRatePct: l.taxRatePct })),
        company?.state,
        data.placeOfSupply ?? existing.placeOfSupply,
      );
      await tx.invoiceLineItem.deleteMany({ where: { invoiceId: id } });
      return tx.invoice.update({
        where: { id },
        data: {
          docType: data.docType,
          customerId: data.customerId,
          orderId: data.orderId,
          quotationId: data.quotationId,
          dueDate: data.dueDate ? new Date(data.dueDate) : existing.dueDate,
          placeOfSupply: data.placeOfSupply,
          notes: data.notes,
          terms: data.terms,
          subtotal: totals.subtotal,
          discountAmount: totals.discountAmount,
          cgstAmount: totals.cgstAmount,
          sgstAmount: totals.sgstAmount,
          igstAmount: totals.igstAmount,
          total: totals.total,
          lineItems: {
            create: data.lineItems.map((l, i) => ({
              productId: l.productId,
              description: l.description,
              hsnCode: l.hsnCode,
              quantity: new Prisma.Decimal(String(l.quantity)),
              unitPrice: new Prisma.Decimal(String(l.unitPrice)),
              discountPct: new Prisma.Decimal(String(l.discountPct)),
              taxRatePct: new Prisma.Decimal(String(l.taxRatePct)),
              lineTotal: new Prisma.Decimal(String(l.quantity * l.unitPrice * (1 - l.discountPct / 100))).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
              sortOrder: i,
            })),
          },
        },
        include: { lineItems: true },
      });
    }
    return tx.invoice.update({
      where: { id },
      data: {
        docType: data.docType,
        customerId: data.customerId,
        orderId: data.orderId,
        quotationId: data.quotationId,
        dueDate: data.dueDate ? new Date(data.dueDate) : existing.dueDate,
        placeOfSupply: data.placeOfSupply,
        notes: data.notes,
        terms: data.terms,
      },
      include: { lineItems: true },
    });
  });
  res.json(invoice);
});

invoicesRouter.post("/:id/issue", requirePermission(PERMISSION_KEY.MANAGE_INVOICES), async (req: AuthenticatedRequest, res) => {
  const id = asString(req.params.id);
  const existing = await prisma.invoice.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Invoice not found" });
  if (existing.status !== INVOICE_STATUS.DRAFT) {
    return res.status(400).json({ error: "Only draft invoices can be issued" });
  }

  const docType = existing.docType === INVOICE_DOC_TYPE.TAX_INVOICE ? FINANCE_DOC_TYPE.TAX_INVOICE : FINANCE_DOC_TYPE.PROFORMA;
  const invoiceNumber = await prisma.$transaction((tx) => nextDocumentNumber(tx, docType));
  const invoice = await prisma.$transaction((tx) =>
    tx.invoice.update({
      where: { id },
      data: { status: INVOICE_STATUS.ISSUED, invoiceNumber, issueDate: new Date() },
      include: { customer: { select: { id: true, name: true, contacts: { select: { id: true } } } } },
    }),
  );

  const contact = invoice.customer.contacts[0];
  if (contact) {
    try {
      const { send } = await import("../services/notifications/notificationService");
      await send({ recipientId: contact.id, templateKey: "invoice_issued", data: { invoiceNumber } });
    } catch (err) {
      console.error("Notification failed", err);
    }
  }
  res.json(invoice);
});

invoicesRouter.post("/:id/cancel", requirePermission(PERMISSION_KEY.MANAGE_INVOICES), async (req: AuthenticatedRequest, res) => {
  const id = asString(req.params.id);
  const parsed = invoiceCancelSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const existing = await prisma.invoice.findUnique({
    where: { id },
    include: { payments: { select: { id: true } } },
  });
  if (!existing) return res.status(404).json({ error: "Invoice not found" });
  if (existing.status !== INVOICE_STATUS.DRAFT && existing.status !== INVOICE_STATUS.ISSUED) {
    return res.status(400).json({ error: "Only draft or issued invoices can be cancelled" });
  }
  if (existing.payments.length > 0) {
    return res.status(400).json({ error: "Cannot cancel an invoice that has payments recorded" });
  }

  const invoice = await prisma.invoice.update({
    where: { id },
    data: { status: INVOICE_STATUS.CANCELLED, cancelledAt: new Date(), cancelReason: parsed.data.reason },
  });
  res.json(invoice);
});

invoicesRouter.post(
  "/:id/payments",
  requirePermission(PERMISSION_KEY.RECORD_PAYMENTS),
  async (req: AuthenticatedRequest, res) => {
    const id = asString(req.params.id);
    const parsed = paymentCreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const data = parsed.data;

    const existing = await prisma.invoice.findUnique({
      where: { id },
      include: { payments: true, customer: { select: { id: true, name: true, contacts: { select: { id: true } } } } },
    });
    if (!existing) return res.status(404).json({ error: "Invoice not found" });
    if (existing.status === INVOICE_STATUS.CANCELLED) {
      return res.status(400).json({ error: "Cannot record payments against a cancelled invoice" });
    }
    const paidBefore = existing.payments.reduce((s, p) => s.plus(p.amount), new Prisma.Decimal(0));
    const outstanding = new Prisma.Decimal(existing.total).minus(paidBefore);
    const amount = new Prisma.Decimal(String(data.amount));
    if (amount.greaterThan(outstanding)) {
      return res.status(400).json({ error: "Payment exceeds the outstanding balance" });
    }

    const invoice = await prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.findUniqueOrThrow({
        where: { id },
        include: { customer: { select: { id: true, name: true, contacts: { select: { id: true } } } } },
      });

      await tx.paymentReceived.create({
        data: {
          invoiceId: inv.id,
          amount,
          method: data.method,
          reference: data.reference,
          receivedDate: data.receivedDate ? new Date(data.receivedDate) : new Date(),
          notes: data.notes,
          recordedById: req.auth!.userId,
        },
      });

      const newPaid = paidBefore.plus(amount);
      const newStatus = deriveInvoiceStatus(new Prisma.Decimal(inv.total), newPaid);
      const updated = await tx.invoice.update({
        where: { id: inv.id },
        data: { status: newStatus },
        include: { customer: { select: { id: true, name: true, contacts: { select: { id: true } } } } },
      });

      const contact = updated.customer.contacts[0];
      if (contact) {
        try {
          const { send } = await import("../services/notifications/notificationService");
          await send({
            recipientId: contact.id,
            templateKey: "payment_received",
            data: { invoiceNumber: updated.invoiceNumber, amount: amount.toString(), balance: new Prisma.Decimal(inv.total).minus(newPaid).toString() },
          });
        } catch (err) {
          console.error("Notification failed", err);
        }
      }
      return updated;
    });
    res.status(201).json(invoice);
  },
);

invoicesRouter.get("/:id/payments", requirePermission(PERMISSION_KEY.MANAGE_INVOICES, PERMISSION_KEY.RECORD_PAYMENTS), async (req: AuthenticatedRequest, res) => {
  const id = asString(req.params.id);
  const payments = await prisma.paymentReceived.findMany({
    where: { invoiceId: id },
    orderBy: { receivedDate: "desc" },
  });
  res.json(payments);
});
