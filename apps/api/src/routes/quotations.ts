import { Router } from "express";
import { Prisma } from "@prisma/client";
import {
  PERMISSION_KEY,
  QUOTATION_STATUS,
  INVOICE_DOC_TYPE,
  FINANCE_DOC_TYPE,
  quotationCreateSchema,
  quotationUpdateSchema,
  quotationStatusSchema,
  createInvoiceFromQuotationSchema,
  STAGE_KEY,
} from "@recd/shared";
import { prisma } from "../lib/prisma";
import { authenticate, requirePermission, type AuthenticatedRequest } from "../middleware/auth";
import { asString } from "../lib/params";
import { computeDocumentTotals } from "../services/taxCalc";
import { nextDocumentNumber } from "../services/documentNumber";

export const quotationsRouter = Router();
quotationsRouter.use(authenticate);

function mapLineItemInput(line: {
  productId?: string;
  description: string;
  hsnCode?: string | null;
  quantity: number;
  unitPrice: number;
  discountPct: number;
  taxRatePct: number;
}) {
  const lineTotal = new Prisma.Decimal(
    String(line.quantity * line.unitPrice * (1 - line.discountPct / 100)),
  ).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  return {
    productId: line.productId,
    description: line.description,
    hsnCode: line.hsnCode,
    quantity: new Prisma.Decimal(String(line.quantity)),
    unitPrice: new Prisma.Decimal(String(line.unitPrice)),
    discountPct: new Prisma.Decimal(String(line.discountPct)),
    taxRatePct: new Prisma.Decimal(String(line.taxRatePct)),
    lineTotal,
    sortOrder: 0,
  };
}

async function createQuotationRecord(
  tx: Prisma.TransactionClient,
  input: ReturnType<typeof quotationCreateSchema.parse>,
  createdById: string,
  quoteNumber: string,
  companyState?: string | null,
) {
  const totals = computeDocumentTotals(
    input.lineItems.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, discountPct: l.discountPct, taxRatePct: l.taxRatePct })),
    companyState,
    input.placeOfSupply,
  );
  return tx.quotation.create({
    data: {
      quoteNumber,
      customerId: input.customerId,
      status: QUOTATION_STATUS.DRAFT,
      issueDate: input.issueDate ? new Date(input.issueDate) : new Date(),
      validUntil: input.validUntil ? new Date(input.validUntil) : null,
      placeOfSupply: input.placeOfSupply,
      subtotal: totals.subtotal,
      discountAmount: totals.discountAmount,
      cgstAmount: totals.cgstAmount,
      sgstAmount: totals.sgstAmount,
      igstAmount: totals.igstAmount,
      total: totals.total,
      notes: input.notes,
      terms: input.terms,
      createdById,
      lineItems: { create: input.lineItems.map(mapLineItemInput) },
    },
    include: { lineItems: true, customer: true, createdBy: { select: { id: true, name: true } } },
  });
}

quotationsRouter.get(
  "/",
  requirePermission(PERMISSION_KEY.MANAGE_QUOTATIONS),
  async (req: AuthenticatedRequest, res) => {
    const where: Record<string, unknown> = {};
    if (typeof req.query.status === "string") where.status = req.query.status;
    if (typeof req.query.customerId === "string") where.customerId = req.query.customerId;

    const quotations = await prisma.quotation.findMany({
      where,
      include: { customer: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.json(quotations);
  },
);

quotationsRouter.post(
  "/",
  requirePermission(PERMISSION_KEY.MANAGE_QUOTATIONS),
  async (req: AuthenticatedRequest, res) => {
    const parsed = quotationCreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const company = await prisma.companySettings.findUnique({ where: { id: "singleton" } });
    const quoteNumber = await prisma.$transaction((tx) =>
      nextDocumentNumber(tx, FINANCE_DOC_TYPE.QUOTATION),
    );

    const quotation = await prisma.$transaction((tx) =>
      createQuotationRecord(tx, parsed.data, req.auth!.userId, quoteNumber, company?.state),
    );
    res.status(201).json(quotation);
  },
);

quotationsRouter.get(
  "/:id",
  requirePermission(PERMISSION_KEY.MANAGE_QUOTATIONS),
  async (req: AuthenticatedRequest, res) => {
    const id = asString(req.params.id);
    const quotation = await prisma.quotation.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, name: true, gstin: true, state: true, address: true } },
        createdBy: { select: { id: true, name: true } },
        lineItems: { orderBy: { sortOrder: "asc" } },
        invoices: { select: { id: true, invoiceNumber: true, docType: true, status: true } },
      },
    });
    if (!quotation) return res.status(404).json({ error: "Quotation not found" });
    res.json(quotation);
  },
);

quotationsRouter.put(
  "/:id",
  requirePermission(PERMISSION_KEY.MANAGE_QUOTATIONS),
  async (req: AuthenticatedRequest, res) => {
    const id = asString(req.params.id);
    const parsed = quotationUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const data = parsed.data;

    const existing = await prisma.quotation.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Quotation not found" });
    if (existing.status !== QUOTATION_STATUS.DRAFT) {
      return res.status(400).json({ error: "Only draft quotations can be edited" });
    }

    const company = await prisma.companySettings.findUnique({ where: { id: "singleton" } });
    const quotation = await prisma.$transaction(async (tx) => {
      if (data.lineItems) {
        const totals = computeDocumentTotals(
          data.lineItems.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, discountPct: l.discountPct, taxRatePct: l.taxRatePct })),
          company?.state,
          data.placeOfSupply ?? existing.placeOfSupply,
        );
        await tx.quotationLineItem.deleteMany({ where: { quotationId: id } });
        return tx.quotation.update({
          where: { id },
          data: {
            customerId: data.customerId,
            validUntil: data.validUntil ? new Date(data.validUntil) : existing.validUntil,
            placeOfSupply: data.placeOfSupply,
            notes: data.notes,
            terms: data.terms,
            subtotal: totals.subtotal,
            discountAmount: totals.discountAmount,
            cgstAmount: totals.cgstAmount,
            sgstAmount: totals.sgstAmount,
            igstAmount: totals.igstAmount,
            total: totals.total,
            lineItems: { create: data.lineItems.map(mapLineItemInput) },
          },
          include: { lineItems: true },
        });
      }
      return tx.quotation.update({
        where: { id },
        data: {
          customerId: data.customerId,
          validUntil: data.validUntil ? new Date(data.validUntil) : existing.validUntil,
          placeOfSupply: data.placeOfSupply,
          notes: data.notes,
          terms: data.terms,
        },
        include: { lineItems: true },
      });
    });
    res.json(quotation);
  },
);

quotationsRouter.post(
  "/:id/status",
  requirePermission(PERMISSION_KEY.MANAGE_QUOTATIONS),
  async (req: AuthenticatedRequest, res) => {
    const id = asString(req.params.id);
    const parsed = quotationStatusSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const existing = await prisma.quotation.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Quotation not found" });
    // Allowed transitions: draft -> sent -> accepted | rejected, or draft -> expired.
    const allowed: Record<string, string[]> = {
      [QUOTATION_STATUS.DRAFT]: [QUOTATION_STATUS.SENT, QUOTATION_STATUS.EXPIRED],
      [QUOTATION_STATUS.SENT]: [QUOTATION_STATUS.ACCEPTED, QUOTATION_STATUS.REJECTED],
    };
    const next = parsed.data.status;
    if (!allowed[existing.status]?.includes(next)) {
      return res.status(400).json({ error: `Cannot transition quotation from ${existing.status} to ${next}` });
    }

    const quotation = await prisma.quotation.update({
      where: { id },
      data: { status: parsed.data.status },
      include: { customer: { select: { id: true, name: true, contacts: { select: { id: true } } } } },
    });

    if (parsed.data.status === QUOTATION_STATUS.SENT) {
      const contact = quotation.customer.contacts[0];
      if (contact) {
        try {
          const { send } = await import("../services/notifications/notificationService");
          await send({ recipientId: contact.id, templateKey: "quotation_sent", data: { quoteNumber: quotation.quoteNumber } });
        } catch (err) {
          console.error("Notification failed", err);
        }
      }
    }
    res.json(quotation);
  },
);

quotationsRouter.post(
  "/:id/convert-to-order",
  requirePermission(PERMISSION_KEY.MANAGE_QUOTATIONS, PERMISSION_KEY.MANAGE_ORDERS),
  async (req: AuthenticatedRequest, res) => {
    const id = asString(req.params.id);
    const quotation = await prisma.quotation.findUnique({
      where: { id },
      include: {
        lineItems: { orderBy: { sortOrder: "asc" } },
        customer: { select: { id: true } },
      },
    });
    if (!quotation) return res.status(404).json({ error: "Quotation not found" });
    if (quotation.status !== QUOTATION_STATUS.ACCEPTED) {
      return res.status(400).json({ error: "Only accepted quotations can be converted to an order" });
    }

    const firstLine = quotation.lineItems[0];
    if (!firstLine?.productId) {
      return res.status(400).json({ error: "Quotation needs at least one line with a product to create an order" });
    }

    const firstStage = await prisma.stageDefinition.findUniqueOrThrow({ where: { key: STAGE_KEY.ORDER_RECEIVED } });
    const order = await prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          orderNumber: `ORD-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
          customerId: quotation.customerId,
          productId: firstLine.productId!,
          quantity: Number(firstLine.quantity),
          value: quotation.total,
          orderDate: new Date(),
          salesEngineerId: req.auth!.userId,
          site: { create: { currentStageId: firstStage.id } },
        },
        include: { site: true },
      });
      await tx.quotation.update({
        where: { id },
        data: { status: QUOTATION_STATUS.CONVERTED, convertedOrderId: created.id },
      });
      return created;
    });
    res.status(201).json(order);
  },
);

quotationsRouter.post(
  "/:id/create-invoice",
  requirePermission(PERMISSION_KEY.MANAGE_QUOTATIONS, PERMISSION_KEY.MANAGE_INVOICES),
  async (req: AuthenticatedRequest, res) => {
    const id = asString(req.params.id);
    const parsed = createInvoiceFromQuotationSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const quotation = await prisma.quotation.findUnique({
      where: { id },
      include: { lineItems: { orderBy: { sortOrder: "asc" } }, customer: { select: { id: true } } },
    });
    if (!quotation) return res.status(404).json({ error: "Quotation not found" });

    const company = await prisma.companySettings.findUnique({ where: { id: "singleton" } });
    const invoice = await prisma.$transaction(async (tx) => {
      const created = await tx.invoice.create({
        data: {
          docType: parsed.data.docType,
          invoiceNumber: `DRAFT-${crypto.randomUUID()}`,
          customerId: quotation.customerId,
          quotationId: quotation.id,
          status: QUOTATION_STATUS.DRAFT,
          issueDate: new Date(),
          placeOfSupply: quotation.placeOfSupply,
          subtotal: quotation.subtotal,
          discountAmount: quotation.discountAmount,
          cgstAmount: quotation.cgstAmount,
          sgstAmount: quotation.sgstAmount,
          igstAmount: quotation.igstAmount,
          total: quotation.total,
          notes: quotation.notes,
          terms: quotation.terms,
          createdById: req.auth!.userId,
          lineItems: {
            create: quotation.lineItems.map((l, i) => ({
              productId: l.productId,
              description: l.description,
              hsnCode: l.hsnCode,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              discountPct: l.discountPct,
              taxRatePct: l.taxRatePct,
              lineTotal: l.lineTotal,
              sortOrder: i,
            })),
          },
        },
      });
      // Number is assigned only on issue; keep an internal placeholder for now.
      await tx.invoice.update({ where: { id: created.id }, data: { invoiceNumber: `DRAFT-${created.id}` } });
      return tx.invoice.findUniqueOrThrow({
        where: { id: created.id },
        include: { lineItems: true, customer: { select: { id: true, name: true } } },
      });
    });
    res.status(201).json(invoice);
  },
);
