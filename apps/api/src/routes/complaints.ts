import { Router } from "express";
import { getFile } from "../lib/portalStorage";
import { createComplaintSchema, updateComplaintStatusSchema, PERMISSION_KEY, COMPLAINT_STATUS, ROLE_KEY } from "@recd/shared";
import { prisma } from "../lib/prisma";
import { authenticate, requirePermission, type AuthenticatedRequest } from "../middleware/auth";
import { send as sendNotification } from "../services/notifications/notificationService";
import { asString } from "../lib/params";
import { complaintListWhere, COMPLAINT_LIST_PERMISSIONS } from "../lib/complaintScope";
import { z } from "zod";
import { notifyPortalCustomers } from "../services/portalNotify";

export const complaintsRouter = Router();
complaintsRouter.use(authenticate);

/** Best-effort notify: a provider failure must never roll back an already-committed write. */
async function notifySafely(args: Parameters<typeof sendNotification>[0]) {
  try {
    await sendNotification(args);
  } catch (err) {
    console.error("Notification failed", err);
  }
}

complaintsRouter.get(
  "/",
  requirePermission(...COMPLAINT_LIST_PERMISSIONS),
  async (req: AuthenticatedRequest, res) => {
    // Scope the list to what the caller is allowed to see (see lib/complaintScope.ts).
    const where = complaintListWhere(req.auth!);

    const complaints = await prisma.complaint.findMany({
      where,
      include: {
        site: { include: { order: { include: { customer: true } } } },
        assignedTo: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json(complaints);
  },
);

/** Company-wide count-by-status - Owner/Admin and Management only (see project notes). */
complaintsRouter.get("/overview", requirePermission(PERMISSION_KEY.VIEW_COMPLAINTS_OVERVIEW), async (_req, res) => {
  const grouped = await prisma.complaint.groupBy({ by: ["status"], _count: { _all: true } });
  const counts: Record<string, number> = Object.fromEntries(Object.values(COMPLAINT_STATUS).map((s) => [s, 0]));
  for (const row of grouped) counts[row.status] = row._count._all;
  res.json({ countsByStatus: counts });
});

/** Field engineers a manager can assign a complaint to. */
complaintsRouter.get("/assignees", requirePermission(PERMISSION_KEY.MANAGE_COMPLAINTS), async (_req, res) => {
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

/** Object-level authorization: a customer may only raise complaints against their own sites.
 * Without this a customer could pass any siteId and attach a ticket to another customer's site
 * (and leak that customer's details back through their own complaint list). Shared by the REST
 * route and the in-app agent's create_complaint write tool, which re-checks this again at
 * confirm time even though it already checked at propose time (the site's owning order can't
 * realistically change in between, but re-verifying server-side is free and this is the one
 * check standing between a customer and another customer's data). */
export async function assertOwnSite(siteId: string, customerId: string) {
  const site = await prisma.site.findUnique({ where: { id: siteId }, include: { order: true } });
  if (!site) throw new Error("Site not found");
  if (site.order.customerId !== customerId) throw new Error("You can only raise complaints for your own sites");
  return site;
}

/** Creates the complaint and notifies Service Team - shared by the REST route above and the
 * agent's create_complaint write tool (see agentConversations.ts's executeConfirmedAction) so
 * an agent-raised ticket behaves identically to one raised through the normal UI. */
export async function createComplaintRecord(
  input: { siteId: string; category: string; description: string; severity: string },
  customerId: string,
) {
  await assertOwnSite(input.siteId, customerId);

  const ticketNumber = `TCK-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;
  const complaint = await prisma.complaint.create({
    data: {
      ticketNumber,
      customerId,
      siteId: input.siteId,
      category: input.category,
      description: input.description,
      severity: input.severity,
      status: COMPLAINT_STATUS.OPEN,
    },
  });

  const serviceTeamUsers = await prisma.user.findMany({ where: { role: { key: ROLE_KEY.SERVICE_TEAM } } });
  await Promise.all(
    serviceTeamUsers.map((u) => notifySafely({ recipientId: u.id, templateKey: "complaint_raised", data: { ticketNumber } })),
  );

  return complaint;
}

complaintsRouter.post("/", requirePermission(PERMISSION_KEY.RAISE_COMPLAINT), async (req: AuthenticatedRequest, res) => {
  const parsed = createComplaintSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (!req.auth!.customerId) return res.status(403).json({ error: "Only customers can raise complaints" });

  try {
    const complaint = await createComplaintRecord(parsed.data, req.auth!.customerId);
    res.status(201).json(complaint);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to raise complaint";
    res.status(message === "Site not found" ? 404 : 403).json({ error: message });
  }
});

complaintsRouter.patch(
  "/:id",
  requirePermission(PERMISSION_KEY.MANAGE_COMPLAINTS, PERMISSION_KEY.ACT_ASSIGNED_COMPLAINTS),
  async (req: AuthenticatedRequest, res) => {
    const parsed = updateComplaintStatusSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const id = asString(req.params.id);
    const existing = await prisma.complaint.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Complaint not found" });

    const canManage = req.auth!.permissions.has(PERMISSION_KEY.MANAGE_COMPLAINTS);
    // Field engineers may only touch tickets assigned to them, and may never reassign.
    if (!canManage && existing.assignedToId !== req.auth!.userId) {
      return res.status(403).json({ error: "This complaint is not assigned to you" });
    }

    const data: Record<string, unknown> = {
      status: parsed.data.status,
      rootCause: parsed.data.rootCause,
      resolutionNotes: parsed.data.resolutionNotes,
      closedAt: parsed.data.status === COMPLAINT_STATUS.CLOSED ? new Date() : parsed.data.status === COMPLAINT_STATUS.OPEN ? null : undefined,
    };
    if (canManage && parsed.data.assignedToId !== undefined) {
      data.assignedToId = parsed.data.assignedToId; // string to assign, null to unassign
    }

    const complaint = await prisma.complaint.update({
      where: { id },
      data,
      include: { customer: { include: { contacts: true } } },
    });

    // Notify the customer of the status change.
    const customerContact = complaint.customer.contacts[0];
    if (customerContact) {
      await notifySafely({
        recipientId: customerContact.id,
        templateKey: "complaint_status_updated",
        data: { ticketNumber: complaint.ticketNumber, status: complaint.status },
      });
    }
    // Customer Portal: e-mail the company's portal users when staff change the status (best effort).
    if (parsed.data.status && parsed.data.status !== existing.status) {
      void notifyPortalCustomers(existing.customerId, {
        templateKey: "portal_complaint_status",
        subject: "Complaint " + complaint.ticketNumber + " is now " + complaint.status.replace(/_/g, " "),
        lines: ["The status of your complaint " + complaint.ticketNumber + " is now: " + complaint.status.replace(/_/g, " ") + "."],
        path: "/complaints/" + existing.id,
      }).catch(() => undefined);
    }
    // Notify a newly-assigned engineer that a ticket has landed on their plate.
    if (canManage && typeof data.assignedToId === "string" && data.assignedToId !== existing.assignedToId) {
      await notifySafely({
        recipientId: data.assignedToId,
        templateKey: "complaint_assigned",
        data: { ticketNumber: complaint.ticketNumber },
      });
    }

    res.json(complaint);
  },
);

/** Customer Portal thread, staff side. Replies are hidden from the customer unless "visibleToCustomer" is ticked. */
complaintsRouter.get("/:id/comments", requirePermission(...COMPLAINT_LIST_PERMISSIONS), async (req: AuthenticatedRequest, res) => {
  if (req.auth!.customerId) return res.status(403).json({ error: "Forbidden" });
  const where = { id: asString(req.params.id), ...complaintListWhere(req.auth!) };
  const complaint = await prisma.complaint.findFirst({ where, select: { id: true } });
  if (!complaint) return res.status(404).json({ error: "Complaint not found" });
  const [comments, photos] = await Promise.all([
    prisma.complaintComment.findMany({ where: { complaintId: complaint.id }, orderBy: { createdAt: "asc" }, include: { attachments: { select: { id: true, mimeType: true } } } }),
    prisma.portalAttachment.findMany({ where: { complaintId: complaint.id }, select: { id: true, mimeType: true, kind: true } }),
  ]);
  res.json({ comments, photos });
});

complaintsRouter.get("/attachments/:attachmentId", requirePermission(...COMPLAINT_LIST_PERMISSIONS), async (req: AuthenticatedRequest, res) => {
  if (req.auth!.customerId) return res.status(403).json({ error: "Forbidden" });
  const a = await prisma.portalAttachment.findUnique({ where: { id: asString(req.params.attachmentId) }, select: { storagePath: true, mimeType: true, complaintId: true } });
  if (!a?.complaintId) return res.status(404).json({ error: "Not found" });
  const ok = await prisma.complaint.findFirst({ where: { id: a.complaintId, ...complaintListWhere(req.auth!) }, select: { id: true } });
  if (!ok) return res.status(404).json({ error: "Not found" });
  res.setHeader("Content-Type", a.mimeType);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(await getFile(a.storagePath));
});

complaintsRouter.post(
  "/:id/comments",
  requirePermission(PERMISSION_KEY.MANAGE_COMPLAINTS, PERMISSION_KEY.ACT_ASSIGNED_COMPLAINTS),
  async (req: AuthenticatedRequest, res) => {
    const parsed = z.object({ body: z.string().trim().min(1).max(4000), visibleToCustomer: z.boolean().default(false) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const existing = await prisma.complaint.findUnique({ where: { id: asString(req.params.id) } });
    if (!existing) return res.status(404).json({ error: "Complaint not found" });
    if (!req.auth!.permissions.has(PERMISSION_KEY.MANAGE_COMPLAINTS) && existing.assignedToId !== req.auth!.userId) {
      return res.status(403).json({ error: "This complaint is not assigned to you" });
    }
    const comment = await prisma.complaintComment.create({
      data: { complaintId: existing.id, authorUserId: req.auth!.userId, authorIsCustomer: false, body: parsed.data.body, visibleToCustomer: parsed.data.visibleToCustomer },
    });
    if (parsed.data.visibleToCustomer) {
      await notifyPortalCustomers(existing.customerId, {
        templateKey: "portal_complaint_reply",
        subject: "Update on your complaint " + existing.ticketNumber,
        lines: ["Zan-F has replied to your complaint " + existing.ticketNumber + ".", parsed.data.body],
        path: "/complaints/" + existing.id,
      }).catch((err) => console.error("portal reply e-mail failed", err instanceof Error ? err.message : "unknown"));
    }
    res.status(201).json(comment);
  },
);
