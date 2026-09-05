import { Router } from "express";
import { addOrderLineItemSchema, createOrderSchema, PERMISSION_KEY, ROLE_KEY, STAGE_KEY } from "@recd/shared";
import { prisma } from "../lib/prisma";
import { authenticate, requirePermission, type AuthenticatedRequest } from "../middleware/auth";
import { asString } from "../lib/params";
import { send as sendNotification } from "../services/notifications/notificationService";
import { sendEmail } from "../lib/email";
import { renderEmail } from "../services/notifications/emailTemplates";

export const ordersRouter = Router();
ordersRouter.use(authenticate);

ordersRouter.get("/", requirePermission(PERMISSION_KEY.MANAGE_ORDERS), async (req: AuthenticatedRequest, res) => {
  const where = req.auth!.customerId ? { customerId: req.auth!.customerId } : {};
  const orders = await prisma.order.findMany({
    where,
    include: { customer: true, product: true, site: { include: { currentStage: true } }, lineItems: { include: { product: true } } },
    orderBy: { createdAt: "desc" },
  });
  res.json(orders);
});

ordersRouter.get("/:id", requirePermission(PERMISSION_KEY.MANAGE_ORDERS), async (req: AuthenticatedRequest, res) => {
  const orderId = asString(req.params.id);
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      customer: { include: { contacts: { select: { id: true, name: true, phone: true, email: true } } } },
      product: true,
      salesEngineer: { select: { id: true, name: true } },
      site: { include: { currentStage: true, assignedEngineer: true, vendor: true } },
      lineItems: { include: { product: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!order) return res.status(404).json({ error: "Order not found" });
  if (req.auth!.customerId && order.customerId !== req.auth!.customerId) {
    return res.status(403).json({ error: "Forbidden" });
  }

  // A customer can have multiple orders, each with its own site - surface the sibling
  // sites here so an order's page shows the customer's full site footprint, not just this one.
  const otherSites = await prisma.site.findMany({
    where: { order: { customerId: order.customerId }, NOT: { id: order.site?.id } },
    include: { currentStage: true, order: { select: { orderNumber: true } } },
    orderBy: { createdAt: "desc" },
  });

  res.json({ ...order, otherCustomerSites: otherSites });
});

/**
 * Staff (Sales/Management/Super Admin, via MANAGE_ORDERS) create a fully-specified order.
 * Customers (via PLACE_ORDER) self-submit a request from the Customer Portal - no price is
 * ever set by the customer (`value` stays null pending Sales review), the order is flagged
 * `requestedByCustomer`, and Management + Super Admin get an in-app popup while info@zanf.org
 * gets an email, so someone actually notices and follows up on pricing/scheduling.
 */
ordersRouter.post("/", requirePermission(PERMISSION_KEY.MANAGE_ORDERS, PERMISSION_KEY.PLACE_ORDER), async (req: AuthenticatedRequest, res) => {
  const parsed = createOrderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;

  // A customer is anyone signed in with a customerId - staff accounts never have one. Customer
  // submissions are pinned to their own customerId regardless of what the body says, and never
  // get to set commercial figures or claim a sales engineer for themselves.
  const isCustomer = !!req.auth!.customerId;
  if (isCustomer && data.customerId !== req.auth!.customerId) {
    return res.status(403).json({ error: "You can only place an order for your own account." });
  }

  const firstStage = await prisma.stageDefinition.findUniqueOrThrow({ where: { key: STAGE_KEY.ORDER_RECEIVED } });
  const orderNumber = `ORD-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

  const order = await prisma.order.create({
    data: {
      orderNumber,
      customerId: isCustomer ? req.auth!.customerId! : data.customerId,
      productId: data.productId,
      quantity: data.quantity,
      value: isCustomer ? undefined : data.value,
      orderDate: data.orderDate ? new Date(data.orderDate) : undefined,
      promisedDeliveryDate: data.promisedDeliveryDate ? new Date(data.promisedDeliveryDate) : undefined,
      plannedExhaustHookupType: isCustomer ? undefined : data.plannedExhaustHookupType,
      salesEngineerId: isCustomer ? undefined : req.auth!.userId,
      requestedByCustomer: isCustomer,
      customerNotes: isCustomer ? data.customerNotes : undefined,
      site: { create: { currentStageId: firstStage.id, address: isCustomer ? data.siteAddress : undefined } },
    },
    include: { site: true, customer: { select: { name: true } }, product: { select: { name: true, model: true } } },
  });

  if (isCustomer) {
    const managers = await prisma.user.findMany({
      where: { isActive: true, role: { key: { in: [ROLE_KEY.MANAGEMENT, ROLE_KEY.OWNER_ADMIN, ROLE_KEY.SUPER_ADMIN] } } },
      select: { id: true },
    });

    const notificationData = {
      orderId: order.id,
      orderNumber: order.orderNumber,
      customer: order.customer.name,
      product: `${order.product.name} (${order.product.model})`,
      quantity: order.quantity,
      notes: order.customerNotes,
    };

    // In-app popup only, per spec - management/super admin don't need a separate email on
    // top of the one going to info@zanf.org below.
    await Promise.all(
      managers.map((m) =>
        sendNotification({ recipientId: m.id, templateKey: "new_order_placed", data: notificationData, channels: ["in_app"] }),
      ),
    );

    // Fixed company mailbox, not a per-user notification - always info@zanf.org regardless
    // of who's configured as the "email" in CompanySettings.
    try {
      const { subject, text, html } = renderEmail("new_order_placed", notificationData);
      await sendEmail({ to: "info@zanf.org", subject, text, html });
    } catch (err) {
      console.error("Failed to email info@zanf.org about new customer order request", err);
    }
  }

  res.status(201).json(order);
});

/** Adds another RECD unit to an existing order (same order/site, e.g. a 500kva + a 380kva
 *  delivered together) - the alternative to POST /sites/:id/clone-order, which instead
 *  creates a fully separate order+site for the second unit. */
ordersRouter.post("/:id/line-items", requirePermission(PERMISSION_KEY.MANAGE_ORDERS), async (req: AuthenticatedRequest, res) => {
  const parsed = addOrderLineItemSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const orderId = asString(req.params.id);
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return res.status(404).json({ error: "Order not found" });
  if (req.auth!.customerId && order.customerId !== req.auth!.customerId) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const lineItem = await prisma.orderLineItem.create({
    data: { orderId, productId: parsed.data.productId, quantity: parsed.data.quantity },
    include: { product: true },
  });

  res.status(201).json(lineItem);
});

ordersRouter.delete("/:id/line-items/:lineItemId", requirePermission(PERMISSION_KEY.MANAGE_ORDERS), async (req: AuthenticatedRequest, res) => {
  const orderId = asString(req.params.id);
  const lineItemId = asString(req.params.lineItemId);
  const lineItem = await prisma.orderLineItem.findUnique({ where: { id: lineItemId } });
  if (!lineItem || lineItem.orderId !== orderId) return res.status(404).json({ error: "Line item not found" });

  await prisma.orderLineItem.delete({ where: { id: lineItemId } });
  res.status(204).end();
});

/**
 * Delete an order and its site (and the site's own operational records - stage events,
 * photos, pending actions, work orders, contacts, document requirements, delivery status).
 * Refuses if anything with real business/financial history points at this order or its
 * site (invoices, a quotation converted into it, purchase orders, expenses, complaints) -
 * those need to be resolved or removed first, since silently cascading them away would
 * destroy audit trail the finance module depends on.
 */
ordersRouter.delete("/:id", requirePermission(PERMISSION_KEY.MANAGE_ORDERS), async (req: AuthenticatedRequest, res) => {
  const orderId = asString(req.params.id);
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { site: true } });
  if (!order) return res.status(404).json({ error: "Order not found" });
  if (req.auth!.customerId && order.customerId !== req.auth!.customerId) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const siteId = order.site?.id;
  const [invoiceCount, quotationCount, poByOrderCount, poBySiteCount, expenseCount, complaintCount] = await Promise.all([
    prisma.invoice.count({ where: { orderId } }),
    prisma.quotation.count({ where: { convertedOrderId: orderId } }),
    prisma.purchaseOrder.count({ where: { orderId } }),
    siteId ? prisma.purchaseOrder.count({ where: { siteId } }) : Promise.resolve(0),
    siteId ? prisma.expense.count({ where: { siteId } }) : Promise.resolve(0),
    siteId ? prisma.complaint.count({ where: { siteId } }) : Promise.resolve(0),
  ]);

  const blockers: string[] = [];
  if (invoiceCount) blockers.push(`${invoiceCount} invoice(s)`);
  if (quotationCount) blockers.push(`${quotationCount} quotation(s) converted from this order`);
  if (poByOrderCount + poBySiteCount) blockers.push(`${poByOrderCount + poBySiteCount} purchase order(s)`);
  if (expenseCount) blockers.push(`${expenseCount} expense(s)`);
  if (complaintCount) blockers.push(`${complaintCount} complaint(s)`);
  if (blockers.length) {
    return res.status(400).json({
      error: `Cannot delete this order - it has linked records: ${blockers.join(", ")}. Resolve or remove those first.`,
    });
  }

  await prisma.$transaction(async (tx) => {
    if (siteId) {
      await tx.siteContact.deleteMany({ where: { siteId } });
      await tx.siteDocumentRequirement.deleteMany({ where: { siteId } });
      await tx.recdDelivery.deleteMany({ where: { siteId } });
      await tx.sitePhoto.deleteMany({ where: { siteId } });
      await tx.siteStageEvent.deleteMany({ where: { siteId } });
      await tx.pendingAction.deleteMany({ where: { siteId } });
      await tx.workOrder.deleteMany({ where: { siteId } });
      await tx.site.delete({ where: { id: siteId } });
    }
    await tx.order.delete({ where: { id: orderId } });
  });

  res.status(204).send();
});
