import { Router } from "express";
import {
  createWorkOrderSchema,
  updateWorkOrderSchema,
  PERMISSION_KEY,
  WORK_ORDER_STATUS,
  ROLE_KEY,
} from "@recd/shared";
import { prisma } from "../lib/prisma";
import { authenticate, requirePermission, type AuthenticatedRequest } from "../middleware/auth";
import { send as sendNotification } from "../services/notifications/notificationService";
import { asString } from "../lib/params";

export const workOrdersRouter = Router();
workOrdersRouter.use(authenticate);

/** Best-effort notify: a provider failure must never roll back an already-committed write. */
async function notifySafely(args: Parameters<typeof sendNotification>[0]) {
  try {
    await sendNotification(args);
  } catch (err) {
    console.error("Notification failed", err);
  }
}

const include = {
  site: { include: { order: { include: { customer: true } } } },
  assignedTo: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
};

workOrdersRouter.get(
  "/",
  requirePermission(PERMISSION_KEY.MANAGE_WORK_ORDERS, PERMISSION_KEY.ACT_ASSIGNED_WORK_ORDERS),
  async (req: AuthenticatedRequest, res) => {
    const { userId, permissions } = req.auth!;
    // Managers/dispatchers see everything; field engineers see only work orders assigned to them.
    const where = permissions.has(PERMISSION_KEY.MANAGE_WORK_ORDERS) ? {} : { assignedToId: userId };

    const workOrders = await prisma.workOrder.findMany({
      where,
      include,
      orderBy: { createdAt: "desc" },
    });
    res.json(workOrders);
  },
);

/** Field engineers a manager can assign a work order to. */
workOrdersRouter.get("/assignees", requirePermission(PERMISSION_KEY.MANAGE_WORK_ORDERS), async (_req, res) => {
  const engineers = await prisma.user.findMany({
    where: {
      isActive: true,
      role: { key: { in: [ROLE_KEY.ERECTION_ENGINEER, ROLE_KEY.COMMISSIONING_ENGINEER, ROLE_KEY.SERVICE_TEAM] } },
    },
    select: { id: true, name: true, role: { select: { name: true } } },
    orderBy: { name: "asc" },
  });
  res.json(engineers);
});

workOrdersRouter.get(
  "/:id",
  requirePermission(PERMISSION_KEY.MANAGE_WORK_ORDERS, PERMISSION_KEY.ACT_ASSIGNED_WORK_ORDERS),
  async (req: AuthenticatedRequest, res) => {
    const id = asString(req.params.id);
    const workOrder = await prisma.workOrder.findUnique({ where: { id }, include });
    if (!workOrder) return res.status(404).json({ error: "Work order not found" });

    const canManage = req.auth!.permissions.has(PERMISSION_KEY.MANAGE_WORK_ORDERS);
    if (!canManage && workOrder.assignedToId !== req.auth!.userId) {
      return res.status(403).json({ error: "This work order is not assigned to you" });
    }
    res.json(workOrder);
  },
);

workOrdersRouter.post("/", requirePermission(PERMISSION_KEY.MANAGE_WORK_ORDERS), async (req: AuthenticatedRequest, res) => {
  const parsed = createWorkOrderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const site = await prisma.site.findUnique({ where: { id: parsed.data.siteId } });
  if (!site) return res.status(404).json({ error: "Site not found" });

  const workOrderNumber = `WO-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;
  const status = parsed.data.assignedToId ? WORK_ORDER_STATUS.ASSIGNED : WORK_ORDER_STATUS.DRAFT;

  const workOrder = await prisma.workOrder.create({
    data: {
      workOrderNumber,
      siteId: parsed.data.siteId,
      taskType: parsed.data.taskType,
      title: parsed.data.title,
      instructions: parsed.data.instructions,
      scheduledDate: parsed.data.scheduledDate ? new Date(parsed.data.scheduledDate) : undefined,
      assignedToId: parsed.data.assignedToId,
      status,
      createdById: req.auth!.userId,
    },
    include,
  });

  if (workOrder.assignedToId) {
    await notifySafely({
      recipientId: workOrder.assignedToId,
      templateKey: "work_order_assigned",
      data: { workOrderNumber: workOrder.workOrderNumber, title: workOrder.title },
    });
  }

  res.status(201).json(workOrder);
});

workOrdersRouter.patch(
  "/:id",
  requirePermission(PERMISSION_KEY.MANAGE_WORK_ORDERS, PERMISSION_KEY.ACT_ASSIGNED_WORK_ORDERS),
  async (req: AuthenticatedRequest, res) => {
    const parsed = updateWorkOrderSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const id = asString(req.params.id);
    const existing = await prisma.workOrder.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Work order not found" });

    const canManage = req.auth!.permissions.has(PERMISSION_KEY.MANAGE_WORK_ORDERS);
    // Field engineers may only touch work orders assigned to them, and may never reassign,
    // retitle, or reschedule - just move the status forward and record completion details.
    if (!canManage) {
      if (existing.assignedToId !== req.auth!.userId) {
        return res.status(403).json({ error: "This work order is not assigned to you" });
      }
      if (
        parsed.data.title !== undefined ||
        parsed.data.instructions !== undefined ||
        parsed.data.taskType !== undefined ||
        parsed.data.scheduledDate !== undefined ||
        parsed.data.assignedToId !== undefined
      ) {
        return res.status(403).json({ error: "You can only update status and completion details" });
      }
    }

    const data: Record<string, unknown> = {};
    if (parsed.data.title !== undefined) data.title = parsed.data.title;
    if (parsed.data.instructions !== undefined) data.instructions = parsed.data.instructions;
    if (parsed.data.taskType !== undefined) data.taskType = parsed.data.taskType;
    if (parsed.data.scheduledDate !== undefined) {
      data.scheduledDate = parsed.data.scheduledDate ? new Date(parsed.data.scheduledDate) : null;
    }
    if (canManage && parsed.data.assignedToId !== undefined) {
      data.assignedToId = parsed.data.assignedToId; // string to (re)assign, null to unassign
    }
    if (parsed.data.completionNotes !== undefined) data.completionNotes = parsed.data.completionNotes;
    if (parsed.data.completionPhotoUrl !== undefined) data.completionPhotoUrl = parsed.data.completionPhotoUrl;

    if (parsed.data.status !== undefined) {
      data.status = parsed.data.status;
      if (parsed.data.status === WORK_ORDER_STATUS.IN_PROGRESS && !existing.startedAt) {
        data.startedAt = new Date();
      }
      if (parsed.data.status === WORK_ORDER_STATUS.COMPLETED) {
        data.completedAt = new Date();
      }
    }

    const workOrder = await prisma.workOrder.update({ where: { id }, data, include });

    if (canManage && typeof data.assignedToId === "string" && data.assignedToId !== existing.assignedToId) {
      await notifySafely({
        recipientId: data.assignedToId,
        templateKey: "work_order_assigned",
        data: { workOrderNumber: workOrder.workOrderNumber, title: workOrder.title },
      });
    }
    if (parsed.data.status === WORK_ORDER_STATUS.COMPLETED) {
      await notifySafely({
        recipientId: workOrder.createdById,
        templateKey: "work_order_completed",
        data: { workOrderNumber: workOrder.workOrderNumber, title: workOrder.title },
      });
    }

    res.json(workOrder);
  },
);
