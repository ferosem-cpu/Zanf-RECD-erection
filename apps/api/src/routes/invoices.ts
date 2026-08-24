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
  paymentUpdateSchema,
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
      customer: {
        select: {
          id: true, name: true, gstin: true, state: true, address: true,
          contacts: { select: { name: true, phone: true, email: true }, take: 1 },
        },
      },
      order: { select: { id: true, orderNumber: true } },
      quotation: { select: { id: true, quoteNumber: true } },
      lineItems: { orderBy: { sortOrder: "asc" } },
      payments: true,
      editLogs: { orderBy: { editedAt: "desc" }, include: { editedBy: { select: { name: true } } } },
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
    // Sort by invoice number (ascending) so the list follows the actual document sequence
    // (0001, 0002, ...) instead of createdAt - invoices entered together in one batch (e.g.
    // a data migration) can share the exact same createdAt timestamp, which made their
    // relative order arbitrary/undefined under a createdAt sort. Drafts (invoiceNumber is
    // a random "DRAFT-<uuid>" until issued) sort wherever their uuid falls, which is fine
    // since they don't have a real sequence position yet.
    orderBy: { invoiceNumber: "asc" },
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

  const existing = await prisma.invoice.findUnique({
    where: { id },
    include: { lineItems: { orderBy: { sortOrder: "asc" } }, payments: { select: { amount: true } }, customer: { select: { name: true } } },
  });
  if (!existing) return res.status(404).json({ error: "Invoice not found" });
  // Cancelled invoices are a dead end (no payments allowed against them either); everything
  // else - including issued/paid - can be corrected. Corrections to a non-draft invoice are
  // logged to InvoiceEditLog below so the correction is visible, not a silent rewrite.
  if (existing.status === INVOICE_STATUS.CANCELLED) {
    return res.status(400).json({ error: "Cannot edit a cancelled invoice" });
  }

  const company = await prisma.companySettings.findUnique({ where: { id: "singleton" } });
  const newCustomer = data.customerId && data.customerId !== existing.customerId
    ? await prisma.customer.findUnique({ where: { id: data.customerId }, select: { name: true } })
    : null;

  const invoice = await prisma.$transaction(async (tx) => {
    // Recompute totals whenever line items OR place-of-supply changed (place of supply
    // determines CGST+SGST vs IGST, so it affects totals even without touching line items).
    // Otherwise reuse the invoice's existing line items/totals untouched.
    const placeOfSupplyChanged = data.placeOfSupply !== undefined && data.placeOfSupply !== existing.placeOfSupply;
    const effectiveLineItems = data.lineItems ?? existing.lineItems.map((l) => ({
      productId: l.productId ?? undefined,
      description: l.description,
      hsnCode: l.hsnCode ?? undefined,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice),
      discountPct: Number(l.discountPct),
      taxRatePct: Number(l.taxRatePct),
    }));

    let updateData: Prisma.InvoiceUpdateInput = {
      docType: data.docType,
      customer: data.customerId ? { connect: { id: data.customerId } } : undefined,
      order: data.orderId ? { connect: { id: data.orderId } } : undefined,
      quotation: data.quotationId ? { connect: { id: data.quotationId } } : undefined,
      issueDate: data.issueDate ? new Date(data.issueDate) : undefined,
      dueDate: data.dueDate ? new Date(data.dueDate) : existing.dueDate,
      placeOfSupply: data.placeOfSupply,
      notes: data.notes,
      terms: data.terms,
    };

    if (data.lineItems || placeOfSupplyChanged) {
      const totals = computeDocumentTotals(
        effectiveLineItems.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, discountPct: l.discountPct, taxRatePct: l.taxRatePct })),
        company?.state,
        data.placeOfSupply ?? existing.placeOfSupply,
      );
      updateData = {
        ...updateData,
        subtotal: totals.subtotal,
        discountAmount: totals.discountAmount,
        cgstAmount: totals.cgstAmount,
        sgstAmount: totals.sgstAmount,
        igstAmount: totals.igstAmount,
        total: totals.total,
      };
      if (data.lineItems) {
        await tx.invoiceLineItem.deleteMany({ where: { invoiceId: id } });
        updateData.lineItems = {
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
        };
      }
      // Amounts changing after payments were already recorded means the paid-vs-total
      // relationship may have shifted (e.g. total raised above what was paid) - recompute
      // status the same way a new payment would, rather than leaving a stale "paid" status
      // on an invoice whose corrected total is no longer fully covered.
      const paidSoFar = existing.payments.reduce((s, p) => s.plus(p.amount), new Prisma.Decimal(0));
      updateData.status = deriveInvoiceStatus(totals.total, paidSoFar);
    }

    const updated = await tx.invoice.update({ where: { id }, data: updateData, include: { lineItems: true } });

    // Build a human-readable diff for the audit log - only for invoices that were already a
    // real document (issued/partially_paid/paid), and only fields that actually changed.
    if (existing.status !== INVOICE_STATUS.DRAFT) {
      const changes: string[] = [];
      if (newCustomer) changes.push(`Customer: ${existing.customer.name} -> ${newCustomer.name}`);
      if (data.issueDate && new Date(data.issueDate).getTime() !== existing.issueDate.getTime()) {
        changes.push(`Issue date: ${existing.issueDate.toISOString().slice(0, 10)} -> ${new Date(data.issueDate).toISOString().slice(0, 10)}`);
      }
      if (data.dueDate) {
        const newDue = new Date(data.dueDate).toISOString().slice(0, 10);
        const oldDue = existing.dueDate ? existing.dueDate.toISOString().slice(0, 10) : "none";
        if (newDue !== oldDue) changes.push(`Due date: ${oldDue} -> ${newDue}`);
      }
      if (data.placeOfSupply !== undefined && data.placeOfSupply !== existing.placeOfSupply) {
        changes.push(`Place of supply: ${existing.placeOfSupply ?? "none"} -> ${data.placeOfSupply}`);
      }
      if (data.notes !== undefined && data.notes !== existing.notes) changes.push("Notes updated");
      if (data.terms !== undefined && data.terms !== existing.terms) changes.push("Terms updated");
      if (data.lineItems) changes.push(`Line items updated (${data.lineItems.length} item${data.lineItems.length === 1 ? "" : "s"})`);
      if (new Prisma.Decimal(updated.total).toString() !== new Prisma.Decimal(existing.total).toString()) {
        changes.push(`Total: Rs ${new Prisma.Decimal(existing.total).toFixed(2)} -> Rs ${new Prisma.Decimal(updated.total).toFixed(2)}`);
      }
      if (updateData.status && updateData.status !== existing.status) {
        changes.push(`Status: ${existing.status} -> ${updateData.status}`);
      }
      if (changes.length > 0) {
        await tx.invoiceEditLog.create({
          data: { invoiceId: id, editedById: req.auth!.userId, summary: changes.join("; ") },
        });
      }
    }

    return updated;
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

// Hard-delete a cancelled invoice - only when it was cancelled while still a draft (its
// invoiceNumber still "DRAFT-<uuid>", never a real sequential number from POST /:id/issue).
// A cancelled invoice that WAS issued keeps its real number and must stay undeletable forever -
// deleting it would leave a gap in India's GST-mandated sequential invoice numbering.
invoicesRouter.delete("/:id", requirePermission(PERMISSION_KEY.MANAGE_INVOICES), async (req: AuthenticatedRequest, res) => {
  const id = asString(req.params.id);
  const existing = await prisma.invoice.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Invoice not found" });
  if (existing.status !== INVOICE_STATUS.CANCELLED) {
    return res.status(400).json({ error: "Only a cancelled invoice can be deleted" });
  }
  if (!existing.invoiceNumber.startsWith("DRAFT-")) {
    return res.status(400).json({
      error: "Cannot delete an invoice that was issued a real invoice number - it must stay cancelled for the audit trail",
    });
  }

  await prisma.invoice.delete({ where: { id } });
  res.status(204).end();
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

// Correct a previously-recorded payment (wrong amount, date, method, reference, etc.) - as
// distinct from POST /:id/payments, which only ever adds a new one. Recomputes the invoice's
// paid-vs-total status afterward (same as recording a new payment) and, since the invoice is
// necessarily non-draft by the time a payment exists against it, logs the correction to
// InvoiceEditLog - same audit-trail requirement as invoice field edits (see §47).
invoicesRouter.put(
  "/:id/payments/:paymentId",
  requirePermission(PERMISSION_KEY.RECORD_PAYMENTS),
  async (req: AuthenticatedRequest, res) => {
    const id = asString(req.params.id);
    const paymentId = asString(req.params.paymentId);
    const parsed = paymentUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const data = parsed.data;

    const invoice = await prisma.invoice.findUnique({ where: { id }, include: { payments: true } });
    if (!invoice) return res.status(404).json({ error: "Invoice not found" });
    if (invoice.status === INVOICE_STATUS.CANCELLED) {
      return res.status(400).json({ error: "Cannot edit payments on a cancelled invoice" });
    }
    const payment = invoice.payments.find((p) => p.id === paymentId);
    if (!payment) return res.status(404).json({ error: "Payment not found" });

    const otherPaid = invoice.payments.filter((p) => p.id !== paymentId).reduce((s, p) => s.plus(p.amount), new Prisma.Decimal(0));
    const newAmount = data.amount !== undefined ? new Prisma.Decimal(String(data.amount)) : new Prisma.Decimal(payment.amount);
    if (otherPaid.plus(newAmount).greaterThan(new Prisma.Decimal(invoice.total))) {
      return res.status(400).json({ error: "This amount would exceed the invoice total" });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const updatedPayment = await tx.paymentReceived.update({
        where: { id: paymentId },
        data: {
          amount: data.amount !== undefined ? newAmount : undefined,
          method: data.method,
          reference: data.reference,
          receivedDate: data.receivedDate ? new Date(data.receivedDate) : undefined,
          notes: data.notes,
        },
      });

      const newStatus = deriveInvoiceStatus(new Prisma.Decimal(invoice.total), otherPaid.plus(newAmount));
      const updatedInvoice = await tx.invoice.update({ where: { id }, data: { status: newStatus } });

      const changes: string[] = [];
      if (data.amount !== undefined && newAmount.toString() !== new Prisma.Decimal(payment.amount).toString()) {
        changes.push(`Payment amount: Rs ${new Prisma.Decimal(payment.amount).toFixed(2)} -> Rs ${newAmount.toFixed(2)}`);
      }
      if (data.method && data.method !== payment.method) changes.push(`Payment method: ${payment.method} -> ${data.method}`);
      if (data.reference !== undefined && data.reference !== payment.reference) changes.push("Payment reference updated");
      if (data.receivedDate) {
        const newDate = new Date(data.receivedDate).toISOString().slice(0, 10);
        const oldDate = payment.receivedDate.toISOString().slice(0, 10);
        if (newDate !== oldDate) changes.push(`Payment date: ${oldDate} -> ${newDate}`);
      }
      if (newStatus !== invoice.status) changes.push(`Status: ${invoice.status} -> ${newStatus}`);
      if (changes.length > 0) {
        await tx.invoiceEditLog.create({
          data: { invoiceId: id, editedById: req.auth!.userId, summary: changes.join("; ") },
        });
      }

      return updatedInvoice;
    });
    res.json(updated);
  },
);

// Remove a payment recorded in error entirely (as opposed to correcting its details above).
invoicesRouter.delete(
  "/:id/payments/:paymentId",
  requirePermission(PERMISSION_KEY.RECORD_PAYMENTS),
  async (req: AuthenticatedRequest, res) => {
    const id = asString(req.params.id);
    const paymentId = asString(req.params.paymentId);

    const invoice = await prisma.invoice.findUnique({ where: { id }, include: { payments: true } });
    if (!invoice) return res.status(404).json({ error: "Invoice not found" });
    const payment = invoice.payments.find((p) => p.id === paymentId);
    if (!payment) return res.status(404).json({ error: "Payment not found" });

    const remainingPaid = invoice.payments.filter((p) => p.id !== paymentId).reduce((s, p) => s.plus(p.amount), new Prisma.Decimal(0));

    const updated = await prisma.$transaction(async (tx) => {
      await tx.paymentReceived.delete({ where: { id: paymentId } });
      const newStatus = deriveInvoiceStatus(new Prisma.Decimal(invoice.total), remainingPaid);
      const updatedInvoice = await tx.invoice.update({ where: { id }, data: { status: newStatus } });
      await tx.invoiceEditLog.create({
        data: {
          invoiceId: id,
          editedById: req.auth!.userId,
          summary: `Payment removed: Rs ${new Prisma.Decimal(payment.amount).toFixed(2)} (${payment.method}, ${payment.receivedDate.toISOString().slice(0, 10)}); Status: ${invoice.status} -> ${newStatus}`,
        },
      });
      return updatedInvoice;
    });
    res.json(updated);
  },
);
