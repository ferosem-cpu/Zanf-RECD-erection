/** In-app notification bell backing store. Reuses the existing NotificationLog table (see
 * services/notifications/notificationService.ts) - a channel:"in_app" row IS a bell entry;
 * this route just lists/reads them for the signed-in recipient and lets them mark read.
 * Every route here is scoped to the caller's own notifications - no admin override, same
 * personal-data posture as agentConversations.ts.
 */
import { Router } from "express";
import { prisma } from "../lib/prisma";
import { authenticate, type AuthenticatedRequest } from "../middleware/auth";
import { asString } from "../lib/params";

export const notificationsRouter = Router();
notificationsRouter.use(authenticate);

const RESULT_LIMIT = 30;

notificationsRouter.get("/", authenticate, async (req: AuthenticatedRequest, res) => {
  const [items, unreadCount] = await Promise.all([
    prisma.notificationLog.findMany({
      where: { recipientId: req.auth!.userId, channel: "in_app" },
      orderBy: { createdAt: "desc" },
      take: RESULT_LIMIT,
    }),
    prisma.notificationLog.count({
      where: { recipientId: req.auth!.userId, channel: "in_app", readAt: null },
    }),
  ]);
  res.json({ items, unreadCount });
});

notificationsRouter.post("/:id/read", async (req: AuthenticatedRequest, res) => {
  const id = asString(req.params.id);
  const item = await prisma.notificationLog.findUnique({ where: { id } });
  if (!item || item.recipientId !== req.auth!.userId) return res.status(404).json({ error: "Notification not found" });

  const updated = await prisma.notificationLog.update({
    where: { id },
    data: { readAt: item.readAt ?? new Date() },
  });
  res.json(updated);
});

notificationsRouter.post("/read-all", async (req: AuthenticatedRequest, res) => {
  await prisma.notificationLog.updateMany({
    where: { recipientId: req.auth!.userId, channel: "in_app", readAt: null },
    data: { readAt: new Date() },
  });
  res.json({ ok: true });
});
