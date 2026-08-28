import { Router } from "express";
import { Prisma } from "@prisma/client";
import { PERMISSION_KEY, INVOICE_STATUS, paymentReceivedCreateSchema, paymentAllocationCreateSchema } from "@recd/shared";
import { prisma } from "../lib/prisma";
import { authenticate, requirePermission, type AuthenticatedRequest } from "../middleware/auth";
import { asString } from "../lib/params";
import { recomputeInvoiceSettlement } from "../services/settlement";

export const paymentsRouter = Router();
paymentsRouter.use(authenticate);

const D = (n: number | string | Prisma.Decimal): Prisma.Decimal =>
  n instanceof Prisma.Decimal ? n : new Prisma.Decimal(String(n));

/**
 * The general payment-recording endpoint (Phase C): one PaymentReceived can be split
 * across several invoices, or left partly/fully unallocated as a customer advance.
 * `POST /invoices/:id/payments` (routes/invoices.ts) remains as sugar for the common
 * single-invoice case and still works unchanged.
 */
paymentsRouter.post("/", requirePermission(PERMISSION_KEY.RECORD_PAYMENTS), async (req: AuthenticatedRequest, res) => {
  const parsed = paymentReceivedCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;

  const customer = await prisma.customer.findUnique({ where: { id: data.customerId }, select: { id: true } });
  if (!customer) return res.status(404).json({ error: "Customer not found" });

  const invoiceIds = [...new Set(data.allocations.map((a) => a.invoiceId))];
  if (invoiceIds.length > 0) {
    const invoices = await prisma.invoice.findMany({ where: { id: { in: invoiceIds } }, select: { id: true, customerId: true, status: true } });
    const byId = new Map(invoices.map((inv) => [inv.id, inv]));
    for (const invId of invoiceIds) {
      const inv = byId.get(invId);
      if (!inv) return res.status(404).json({ error: `Invoice ${invId} not found` });
      if (inv.customerId !== data.customerId) return res.status(400).json({ error: `Invoice ${invId} does not belong to this customer` });
      if (inv.status !== INVOICE_STATUS.ISSUED && inv.status !== INVOICE_STATUS.PARTIALLY_PAID) {
        return res.status(400).json({ error: `Invoice ${invId} is not open for payment (status: ${inv.status})` });
      }
    }
  }

  try {
    const payment = await prisma.$transaction(async (tx) => {
      const created = await tx.paymentReceived.create({
        data: {
          customerId: data.customerId,
          amount: D(data.amount),
          tdsAmount: D(data.tdsAmount ?? 0),
          tdsCertificateRef: data.tdsCertificateRef,
          method: data.method,
          reference: data.reference,
          receivedDate: data.receivedDate ? new Date(data.receivedDate) : new Date(),
          notes: data.notes,
          recordedById: req.auth!.userId,
          allocations: {
            create: data.allocations.map((a) => ({ invoiceId: a.invoiceId, amount: D(a.amount) })),
          },
        },
        include: { allocations: true },
      });

      for (const invId of invoiceIds) {
        const { outstanding } = await recomputeInvoiceSettlement(tx, invId);
        if (outstanding.isNegative()) {
          throw Object.assign(new Error(`Allocation exceeds invoice ${invId}'s outstanding balance`), { statusCode: 400 });
        }
      }

      return created;
    });
    res.status(201).json(payment);
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode === 400) return res.status(400).json({ error: (err as Error).message });
    throw err;
  }
});

paymentsRouter.get("/", requirePermission(PERMISSION_KEY.RECORD_PAYMENTS, PERMISSION_KEY.MANAGE_INVOICES), async (req: AuthenticatedRequest, res) => {
  const where: Record<string, unknown> = {};
  if (typeof req.query.customerId === "string") where.customerId = req.query.customerId;

  const payments = await prisma.paymentReceived.findMany({
    where,
    include: {
      customer: { select: { id: true, name: true } },
      allocations: { include: { invoice: { select: { id: true, invoiceNumber: true } } } },
    },
    orderBy: { receivedDate: "desc" },
  });

  const rows = payments.map((p) => {
    const allocated = p.allocations.reduce((s, a) => s.plus(a.amount), new Prisma.Decimal(0));
    return {
      ...p,
      allocatedAmount: allocated,
      unallocatedAmount: D(p.amount).minus(allocated),
    };
  });
  res.json(rows);
});

paymentsRouter.post(
  "/:id/allocations",
  requirePermission(PERMISSION_KEY.RECORD_PAYMENTS),
  async (req: AuthenticatedRequest, res) => {
    const paymentId = asString(req.params.id);
    const parsed = paymentAllocationCreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const data = parsed.data;

    const payment = await prisma.paymentReceived.findUnique({
      where: { id: paymentId },
      include: { allocations: true },
    });
    if (!payment) return res.status(404).json({ error: "Payment not found" });

    const invoice = await prisma.invoice.findUnique({ where: { id: data.invoiceId }, select: { id: true, customerId: true, status: true } });
    if (!invoice) return res.status(404).json({ error: "Invoice not found" });
    if (invoice.customerId !== payment.customerId) {
      return res.status(400).json({ error: "Invoice does not belong to this payment's customer" });
    }
    if (invoice.status !== INVOICE_STATUS.ISSUED && invoice.status !== INVOICE_STATUS.PARTIALLY_PAID) {
      return res.status(400).json({ error: `Invoice is not open for payment (status: ${invoice.status})` });
    }

    const alreadyAllocated = payment.allocations.reduce((s, a) => s.plus(a.amount), new Prisma.Decimal(0));
    const unallocated = D(payment.amount).minus(alreadyAllocated);
    const amount = D(data.amount);
    if (amount.greaterThan(unallocated.plus(0.01))) {
      return res.status(400).json({ error: "Allocation exceeds this payment's unallocated balance" });
    }

    try {
      const allocation = await prisma.$transaction(async (tx) => {
        const existing = payment.allocations.find((a) => a.invoiceId === data.invoiceId);
        const created = existing
          ? await tx.paymentAllocation.update({ where: { id: existing.id }, data: { amount: existing.amount.plus(amount) } })
          : await tx.paymentAllocation.create({ data: { paymentId, invoiceId: data.invoiceId, amount } });

        const { outstanding } = await recomputeInvoiceSettlement(tx, data.invoiceId);
        if (outstanding.isNegative()) {
          throw Object.assign(new Error("Allocation exceeds the invoice's outstanding balance"), { statusCode: 400 });
        }
        return created;
      });
      res.status(201).json(allocation);
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 400) return res.status(400).json({ error: (err as Error).message });
      throw err;
    }
  },
);
