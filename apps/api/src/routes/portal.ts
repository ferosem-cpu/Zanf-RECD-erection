import { Router } from "express";
import { Prisma } from "@prisma/client";
import { authenticate, type AuthenticatedRequest } from "../middleware/auth";
import { prisma } from "../lib/prisma";

/**
 * Customer portal finance read endpoints. Customers see ONLY their own issued
 * invoices (never drafts) with paid/outstanding amounts. Scoped hard by
 * req.auth.customerId, exactly like the complaint portal fix.
 */
export const portalRouter = Router();
portalRouter.use(authenticate);

portalRouter.get("/invoices", async (req: AuthenticatedRequest, res) => {
  const customerId = req.auth!.customerId;
  if (!customerId) return res.status(403).json({ error: "Customer access only" });

  const invoices = await prisma.invoice.findMany({
    where: { customerId, status: { in: ["issued", "partially_paid", "paid"] } },
    include: { payments: { select: { amount: true } } },
    orderBy: { issueDate: "desc" },
  });

  const now = new Date();
  const rows = invoices.map((inv) => {
    const paid = inv.payments.reduce((s, p) => s.plus(new Prisma.Decimal(p.amount)), new Prisma.Decimal(0));
    const balance = new Prisma.Decimal(inv.total).minus(paid);
    const overdue =
      (inv.status === "issued" || inv.status === "partially_paid") && !!inv.dueDate && inv.dueDate.getTime() < now.getTime();
    return {
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      docType: inv.docType,
      status: inv.status,
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      total: inv.total,
      amountPaid: paid,
      balance,
      overdue,
    };
  });
  res.json(rows);
});
