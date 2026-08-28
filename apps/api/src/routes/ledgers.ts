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

// 26AS reconciliation view: every payment with TDS deducted, for a given Indian fiscal
// year (Apr-Mar), grouped so the CA can tie it against Form 26AS. fy is "2026-27" style
// (see fiscalYearFor); defaults to the fiscal year containing today.
ledgersRouter.get("/tds", async (req, res) => {
  const fy = asOptionalString(req.query.fy);
  let startYear: number;
  if (fy) {
    const match = /^(\d{4})-\d{2}$/.exec(fy);
    if (!match) return res.status(400).json({ error: "fy must look like 2026-27" });
    startYear = Number(match[1]);
  } else {
    const now = new Date();
    startYear = now.getMonth() < 3 ? now.getFullYear() - 1 : now.getFullYear();
  }
  const from = new Date(Date.UTC(startYear, 3, 1)); // Apr 1
  const to = new Date(Date.UTC(startYear + 1, 2, 31, 23, 59, 59, 999)); // Mar 31

  const payments = await prisma.paymentReceived.findMany({
    where: { tdsAmount: { gt: 0 }, receivedDate: { gte: from, lte: to } },
    select: {
      id: true,
      amount: true,
      tdsAmount: true,
      tdsCertificateRef: true,
      receivedDate: true,
      customer: { select: { id: true, name: true } },
      invoice: { select: { invoiceNumber: true } },
      allocations: { select: { invoice: { select: { invoiceNumber: true } } } },
    },
    orderBy: { receivedDate: "asc" },
  });

  const rows = payments.map((p) => ({
    paymentId: p.id,
    date: p.receivedDate,
    customerId: p.customer.id,
    customerName: p.customer.name,
    invoiceNumbers: p.invoice
      ? [p.invoice.invoiceNumber]
      : p.allocations.map((a) => a.invoice.invoiceNumber),
    grossAmount: p.amount, // cash received; the invoice(s) settled = grossAmount + tdsAmount
    tdsAmount: p.tdsAmount,
    tdsCertificateRef: p.tdsCertificateRef,
  }));

  const totalsByCustomer = new Map<string, { customerId: string; customerName: string; grossAmount: number; tdsAmount: number }>();
  for (const r of rows) {
    const key = r.customerId;
    const entry = totalsByCustomer.get(key) ?? { customerId: r.customerId, customerName: r.customerName, grossAmount: 0, tdsAmount: 0 };
    entry.grossAmount += Number(r.grossAmount);
    entry.tdsAmount += Number(r.tdsAmount);
    totalsByCustomer.set(key, entry);
  }

  res.json({
    fiscalYear: `${startYear}-${String(startYear + 1).slice(-2)}`,
    rows,
    totalsByCustomer: Array.from(totalsByCustomer.values()),
    grandTotalTds: rows.reduce((s, r) => s + Number(r.tdsAmount), 0),
  });
});
