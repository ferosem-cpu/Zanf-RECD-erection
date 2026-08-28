import { Router } from "express";
import { PERMISSION_KEY } from "@recd/shared";
import { prisma } from "../lib/prisma";
import { authenticate, requirePermission } from "../middleware/auth";
import { asString, asOptionalString } from "../lib/params";
import { buildCustomerLedger, buildSupplierLedger } from "../services/ledger";

export const ledgersRouter = Router();
ledgersRouter.use(authenticate);
ledgersRouter.use(requirePermission(PERMISSION_KEY.VIEW_LEDGERS));

ledgersRouter.get("/customer/:id", async (req, res) => {
  const id = asString(req.params.id);
  const customer = await prisma.customer.findUnique({ where: { id }, select: { id: true } });
  if (!customer) return res.status(404).json({ error: "Customer not found" });
  const fromStr = asOptionalString(req.query.from);
  const toStr = asOptionalString(req.query.to);
  const statement = await buildCustomerLedger(id, fromStr ? new Date(fromStr) : undefined, toStr ? new Date(toStr) : undefined);
  res.json(statement);
});

ledgersRouter.get("/supplier/:id", async (req, res) => {
  const id = asString(req.params.id);
  const supplier = await prisma.supplier.findUnique({ where: { id }, select: { id: true } });
  if (!supplier) return res.status(404).json({ error: "Supplier not found" });
  const fromStr = asOptionalString(req.query.from);
  const toStr = asOptionalString(req.query.to);
  const statement = await buildSupplierLedger(id, fromStr ? new Date(fromStr) : undefined, toStr ? new Date(toStr) : undefined);
  res.json(statement);
});
