/** E-mail every active customer user (with an e-mail) of a company, recording each send in NotificationLog.
 * Used for: visible staff replies on complaints, complaint status changes made by staff, site reaching Commissioned. */
import { prisma } from "../lib/prisma";
import { mailCustomer } from "./portalMail";

export async function notifyPortalCustomers(customerId: string, m: { templateKey: string; subject: string; lines: string[]; path: string }): Promise<number> {
  if ((process.env.PORTAL_ENABLED ?? "").trim().toLowerCase() !== "true") return 0;
  const users = await prisma.user.findMany({ where: { customerId, isActive: true, email: { not: null }, role: { key: "customer" } }, select: { id: true, email: true } });
  let sent = 0;
  for (const u of users) {
    const ok = await mailCustomer({ to: u.email!, subject: m.subject, lines: m.lines, path: m.path });
    await prisma.notificationLog.create({ data: { recipientId: u.id, channel: "email", templateKey: m.templateKey, payload: { path: m.path }, status: ok ? "sent" : "failed", sentAt: ok ? new Date() : null } }).catch(() => undefined);
    if (ok) sent++;
  }
  return sent;
}
