import { Router } from "express";
import { createOrderSchema, PERMISSION_KEY, STAGE_KEY } from "@recd/shared";
import { prisma } from "../lib/prisma";
import { authenticate, requirePermission, type AuthenticatedRequest } from "../middleware/auth";
import { asString } from "../lib/params";

export const ordersRouter = Router();
ordersRouter.use(authenticate);

ordersRouter.get("/", requirePermission(PERMISSION_KEY.MANAGE_ORDERS), async (req: AuthenticatedRequest, res) => {
  const where = req.auth!.customerId ? { customerId: req.auth!.customerId } : {};
  const orders = await prisma.order.findMany({
    where,
    include: { customer: true, product: true, site: { include: { currentStage: true } } },
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

ordersRouter.post("/", requirePermission(PERMISSION_KEY.MANAGE_ORDERS), async (req: AuthenticatedRequest, res) => {
  const parsed = createOrderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;

  const firstStage = await prisma.stageDefinition.findUniqueOrThrow({ where: { key: STAGE_KEY.ORDER_RECEIVED } });
  const orderNumber = `ORD-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

  const order = await prisma.order.create({
    data: {
      orderNumber,
      customerId: data.customerId,
      productId: data.productId,
      quantity: data.quantity,
      value: data.value,
      orderDate: new Date(data.orderDate),
      promisedDeliveryDate: data.promisedDeliveryDate ? new Date(data.promisedDeliveryDate) : undefined,
      plannedExhaustHookupType: data.plannedExhaustHookupType,
      salesEngineerId: req.auth!.userId,
      site: { create: { currentStageId: firstStage.id } },
    },
    include: { site: true },
  });

  res.status(201).json(order);
});
