import { Router } from "express";
import { Prisma } from "@prisma/client";
import {
  PERMISSION_KEY,
  CREDIT_NOTE_STATUS,
  FINANCE_DOC_TYPE,
  INVOICE_STATUS,
  INVOICE_DOC_TYPE,
  creditNoteCreateSchema,
  creditNoteUpdateSchema,
  creditNoteCancelSchema,
  debitNoteCreateSchema,
  debitNoteUpdateSchema,
} from "@recd/shared";
import { prisma } from "../lib/prisma";
import { authenticate, requirePermission, type AuthenticatedRequest } from "../middleware/auth";
import { asString } from "../lib/params";
import { computeDocumentTotals } from "../services/taxCalc";
import { nextDocumentNumber } from "../services/documentNumber";
import { issuedCreditNoteTotal, netInvoiceTotal, deriveInvoiceStatus } from "./invoices";

export const creditNotesRouter = Router();
creditNotesRouter.use(authenticate);
async function nonCancelledCreditNoteTotal(
  tx: Prisma.TransactionClient,
  invoiceId: string,
  excludeId?: string,
): Promise<Prisma.Decimal> {
  const notes = await tx.creditNote.findMany({
    where: { invoiceId, status: { not: CREDIT_NOTE_STATUS.CANCELLED }, id: excludeId ? { not: excludeId } : undefined },
    select: { total: true },
  });
  return notes.reduce((s, n) => s.plus(n.total), new Prisma.Decimal(0));
}

async function creditNoteSummary(tx: Prisma.TransactionClient, id: string) {
  return tx.creditNote.findUniqueOrThrow({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, gstin: true, state: true, address: true } },
      invoice: { select: { id: true, invoiceNumber: true, total: true, docType: true } },
      lineItems: { orderBy: { sortOrder: "asc" } },
    },
  });
}

creditNotesRouter.get("/", requirePermission(PERMISSION_KEY.MANAGE_CREDIT_NOTES), async (req: AuthenticatedRequest, res) => {
  const where: Record<string, unknown> = {};
  if (typeof req.query.status === "string") where.status = req.query.status;
  if (typeof req.query.customerId === "string") where.customerId = req.query.customerId;
  if (typeof req.query.invoiceId === "string") where.invoiceId = req.query.invoiceId;

  const notes = await prisma.creditNote.findMany({
    where,
    include: {
      customer: { select: { id: true, name: true } },
      invoice: { select: { id: true, invoiceNumber: true } },
    },
    orderBy: { noteNumber: "asc" },
  });
  res.json(
    notes.map((n) => ({
      ...n,
      noteNumber: n.status === CREDIT_NOTE_STATUS.DRAFT ? `DRAFT-${n.id}` : n.noteNumber,
    })),
  );
});

creditNotesRouter.post("/", requirePermission(PERMISSION_KEY.MANAGE_CREDIT_NOTES), async (req: AuthenticatedRequest, res) => {
  const parsed = creditNoteCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;

  const invoice = await prisma.invoice.findUnique({ where: { id: data.invoiceId } });
  if (!invoice) return res.status(404).json({ error: "Invoice not found" });
  if (invoice.docType !== INVOICE_DOC_TYPE.TAX_INVOICE) {
    return res.status(400).json({ error: "Credit notes can only be raised against a tax invoice" });
  }
  if (invoice.status === INVOICE_STATUS.DRAFT || invoice.status === INVOICE_STATUS.CANCELLED) {
    return res.status(400).json({ error: "Credit notes can only be raised against an issued invoice" });
  }

  const company = await prisma.companySettings.findUnique({ where: { id: "singleton" } });
  const totals = computeDocumentTotals(
    data.lineItems.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, discountPct: l.discountPct, taxRatePct: l.taxRatePct })),
    company?.state,
    invoice.placeOfSupply,
  );

  const existingTotal = await nonCancelledCreditNoteTotal(prisma, invoice.id);
  if (existingTotal.plus(totals.total).greaterThan(new Prisma.Decimal(invoice.total))) {
    return res.status(400).json({ error: "Total credit notes against this invoice cannot exceed the invoice total" });
  }

  const note = await prisma.creditNote.create({
    data: {
      noteNumber: `DRAFT-${crypto.randomUUID()}`,
      invoiceId: invoice.id,
      customerId: invoice.customerId,
      status: CREDIT_NOTE_STATUS.DRAFT,
      reason: data.reason,
      issueDate: data.issueDate ? new Date(data.issueDate) : new Date(),
      placeOfSupply: invoice.placeOfSupply,
      subtotal: totals.subtotal,
      cgstAmount: totals.cgstAmount,
      sgstAmount: totals.sgstAmount,
      igstAmount: totals.igstAmount,
      total: totals.total,
      notes: data.notes,
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
  res.status(201).json(note);
});

creditNotesRouter.get("/:id", requirePermission(PERMISSION_KEY.MANAGE_CREDIT_NOTES), async (req: AuthenticatedRequest, res) => {
  const id = asString(req.params.id);
  let note;
  try {
    note = await creditNoteSummary(prisma, id);
  } catch {
    return res.status(404).json({ error: "Credit note not found" });
  }
  res.json({
    ...note,
    noteNumber: note.status === CREDIT_NOTE_STATUS.DRAFT ? `DRAFT-${note.id}` : note.noteNumber,
  });
});

// Only draft credit notes can be edited - once issued it's a real statutory document,
// same convention as Invoice (issued/paid invoices are corrected via edit-log, but a CN
// has no such correction workflow yet; issue a fresh CN instead).
creditNotesRouter.put("/:id", requirePermission(PERMISSION_KEY.MANAGE_CREDIT_NOTES), async (req: AuthenticatedRequest, res) => {
  const id = asString(req.params.id);
  const parsed = creditNoteUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;

  const existing = await prisma.creditNote.findUnique({ where: { id }, include: { invoice: true, lineItems: true } });
  if (!existing) return res.status(404).json({ error: "Credit note not found" });
  if (existing.status !== CREDIT_NOTE_STATUS.DRAFT) {
    return res.status(400).json({ error: "Only a draft credit note can be edited" });
  }

  const company = await prisma.companySettings.findUnique({ where: { id: "singleton" } });
  const effectiveLineItems = data.lineItems ?? existing.lineItems.map((l) => ({
    productId: l.productId ?? undefined,
    description: l.description,
    hsnCode: l.hsnCode ?? undefined,
    quantity: Number(l.quantity),
    unitPrice: Number(l.unitPrice),
    discountPct: Number(l.discountPct),
    taxRatePct: Number(l.taxRatePct),
  }));
  const totals = computeDocumentTotals(
    effectiveLineItems.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, discountPct: l.discountPct, taxRatePct: l.taxRatePct })),
    company?.state,
    existing.invoice.placeOfSupply,
  );

  if (data.lineItems) {
    const otherTotal = await nonCancelledCreditNoteTotal(prisma, existing.invoiceId, existing.id);
    if (otherTotal.plus(totals.total).greaterThan(new Prisma.Decimal(existing.invoice.total))) {
      return res.status(400).json({ error: "Total credit notes against this invoice cannot exceed the invoice total" });
    }
  }

  const note = await prisma.$transaction(async (tx) => {
    if (data.lineItems) {
      await tx.creditNoteLineItem.deleteMany({ where: { creditNoteId: id } });
    }
    return tx.creditNote.update({
      where: { id },
      data: {
        reason: data.reason,
        issueDate: data.issueDate ? new Date(data.issueDate) : undefined,
        notes: data.notes,
        subtotal: totals.subtotal,
        cgstAmount: totals.cgstAmount,
        sgstAmount: totals.sgstAmount,
        igstAmount: totals.igstAmount,
        total: totals.total,
        lineItems: data.lineItems
          ? {
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
            }
          : undefined,
      },
      include: { lineItems: true },
    });
  });
  res.json(note);
});

creditNotesRouter.post("/:id/issue", requirePermission(PERMISSION_KEY.MANAGE_CREDIT_NOTES), async (req: AuthenticatedRequest, res) => {
  const id = asString(req.params.id);
  const existing = await prisma.creditNote.findUnique({ where: { id }, include: { invoice: { include: { payments: true } } } });
  if (!existing) return res.status(404).json({ error: "Credit note not found" });
  if (existing.status !== CREDIT_NOTE_STATUS.DRAFT) {
    return res.status(400).json({ error: "Only a draft credit note can be issued" });
  }

  // Re-validate against the invoice total at issue time using only OTHER already-issued
  // notes - this is the moment the credit note becomes a real accounting effect, so this
  // is the authoritative check (the draft-time check in POST/PUT is just early feedback).
  const otherIssuedTotal = await issuedCreditNoteTotal(prisma, existing.invoiceId);
  if (otherIssuedTotal.plus(existing.total).greaterThan(new Prisma.Decimal(existing.invoice.total))) {
    return res.status(400).json({ error: "Total issued credit notes would exceed the invoice total" });
  }

  const note = await prisma.$transaction(async (tx) => {
    const noteNumber = await nextDocumentNumber(tx, FINANCE_DOC_TYPE.CREDIT_NOTE);
    const issued = await tx.creditNote.update({
      where: { id },
      data: { status: CREDIT_NOTE_STATUS.ISSUED, noteNumber, issueDate: new Date() },
    });

    const paid = existing.invoice.payments.reduce((s, p) => s.plus(p.amount), new Prisma.Decimal(0));
    const newIssuedTotal = otherIssuedTotal.plus(existing.total);
    const netTotal = netInvoiceTotal(new Prisma.Decimal(existing.invoice.total), newIssuedTotal);
    await tx.invoice.update({
      where: { id: existing.invoiceId },
      data: { status: deriveInvoiceStatus(netTotal, paid) },
    });

    return issued;
  });
  res.json(note);
});

// Cancelling an ISSUED credit note reverses its effect on the invoice's net outstanding -
// same dead-end convention as Invoice cancellation (issue a fresh CN instead of uncancelling).
creditNotesRouter.post("/:id/cancel", requirePermission(PERMISSION_KEY.MANAGE_CREDIT_NOTES), async (req: AuthenticatedRequest, res) => {
  const id = asString(req.params.id);
  const parsed = creditNoteCancelSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const existing = await prisma.creditNote.findUnique({ where: { id }, include: { invoice: { include: { payments: true } } } });
  if (!existing) return res.status(404).json({ error: "Credit note not found" });
  if (existing.status !== CREDIT_NOTE_STATUS.DRAFT && existing.status !== CREDIT_NOTE_STATUS.ISSUED) {
    return res.status(400).json({ error: "Only a draft or issued credit note can be cancelled" });
  }

  const note = await prisma.$transaction(async (tx) => {
    const cancelled = await tx.creditNote.update({
      where: { id },
      data: { status: CREDIT_NOTE_STATUS.CANCELLED, cancelledAt: new Date(), cancelReason: parsed.data.reason },
    });

    if (existing.status === CREDIT_NOTE_STATUS.ISSUED) {
      const remainingIssuedTotal = await issuedCreditNoteTotal(tx, existing.invoiceId);
      const paid = existing.invoice.payments.reduce((s, p) => s.plus(p.amount), new Prisma.Decimal(0));
      const netTotal = netInvoiceTotal(new Prisma.Decimal(existing.invoice.total), remainingIssuedTotal);
      await tx.invoice.update({ where: { id: existing.invoiceId }, data: { status: deriveInvoiceStatus(netTotal, paid) } });
    }

    return cancelled;
  });
  res.json(note);
});

// Hard-delete a draft credit note (never had a real CRN/... number) - mirrors Invoice's
// delete rule. An issued-then-cancelled credit note keeps its real number and stays forever.
creditNotesRouter.delete("/:id", requirePermission(PERMISSION_KEY.MANAGE_CREDIT_NOTES), async (req: AuthenticatedRequest, res) => {
  const id = asString(req.params.id);
  const existing = await prisma.creditNote.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Credit note not found" });
  if (existing.status !== CREDIT_NOTE_STATUS.DRAFT) {
    return res.status(400).json({ error: "Only a draft credit note can be deleted" });
  }
  await prisma.creditNote.delete({ where: { id } });
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Debit notes: internal-only, no statutory sequence, no issue/draft lifecycle -
// plain CRUD gated behind the same MANAGE_CREDIT_NOTES permission.
// ---------------------------------------------------------------------------

export const debitNotesRouter = Router();
debitNotesRouter.use(authenticate);

debitNotesRouter.get("/", requirePermission(PERMISSION_KEY.MANAGE_CREDIT_NOTES), async (req: AuthenticatedRequest, res) => {
  const where: Record<string, unknown> = {};
  if (typeof req.query.supplierId === "string") where.supplierId = req.query.supplierId;
  if (typeof req.query.billId === "string") where.billId = req.query.billId;

  const notes = await prisma.debitNote.findMany({
    where,
    include: {
      supplier: { select: { id: true, name: true } },
      bill: { select: { id: true, billNumber: true } },
    },
    orderBy: { noteDate: "desc" },
  });
  res.json(notes);
});

debitNotesRouter.post("/", requirePermission(PERMISSION_KEY.MANAGE_CREDIT_NOTES), async (req: AuthenticatedRequest, res) => {
  const parsed = debitNoteCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;

  const supplier = await prisma.supplier.findUnique({ where: { id: data.supplierId } });
  if (!supplier) return res.status(404).json({ error: "Supplier not found" });
  if (data.billId) {
    const bill = await prisma.bill.findUnique({ where: { id: data.billId } });
    if (!bill || bill.supplierId !== data.supplierId) {
      return res.status(400).json({ error: "Bill not found for this supplier" });
    }
  }

  const note = await prisma.debitNote.create({
    data: {
      noteNumber: data.noteNumber,
      supplierId: data.supplierId,
      billId: data.billId,
      reason: data.reason,
      noteDate: data.noteDate ? new Date(data.noteDate) : new Date(),
      amount: new Prisma.Decimal(String(data.amount)),
      notes: data.notes,
      createdById: req.auth!.userId,
    },
  });
  res.status(201).json(note);
});

debitNotesRouter.get("/:id", requirePermission(PERMISSION_KEY.MANAGE_CREDIT_NOTES), async (req: AuthenticatedRequest, res) => {
  const id = asString(req.params.id);
  const note = await prisma.debitNote.findUnique({
    where: { id },
    include: { supplier: { select: { id: true, name: true } }, bill: { select: { id: true, billNumber: true } } },
  });
  if (!note) return res.status(404).json({ error: "Debit note not found" });
  res.json(note);
});

debitNotesRouter.put("/:id", requirePermission(PERMISSION_KEY.MANAGE_CREDIT_NOTES), async (req: AuthenticatedRequest, res) => {
  const id = asString(req.params.id);
  const parsed = debitNoteUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;

  const existing = await prisma.debitNote.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Debit note not found" });

  const note = await prisma.debitNote.update({
    where: { id },
    data: {
      noteNumber: data.noteNumber,
      supplierId: data.supplierId,
      billId: data.billId,
      reason: data.reason,
      noteDate: data.noteDate ? new Date(data.noteDate) : undefined,
      amount: data.amount !== undefined ? new Prisma.Decimal(String(data.amount)) : undefined,
      notes: data.notes,
    },
  });
  res.json(note);
});

debitNotesRouter.delete("/:id", requirePermission(PERMISSION_KEY.MANAGE_CREDIT_NOTES), async (req: AuthenticatedRequest, res) => {
  const id = asString(req.params.id);
  const existing = await prisma.debitNote.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Debit note not found" });
  await prisma.debitNote.delete({ where: { id } });
  res.status(204).end();
});
