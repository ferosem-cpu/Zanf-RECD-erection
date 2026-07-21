import { Router } from "express";
import { Prisma } from "@prisma/client";
import { PERMISSION_KEY, INVOICE_STATUS, BILL_STATUS } from "@recd/shared";
import { prisma } from "../lib/prisma";
import { authenticate, requirePermission } from "../middleware/auth";
import { asString, asOptionalString } from "../lib/params";

export const financeDashboardRouter = Router();
financeDashboardRouter.use(authenticate);

const D = (n: number | string | Prisma.Decimal): Prisma.Decimal =>
  n instanceof Prisma.Decimal ? n : new Prisma.Decimal(String(n));

financeDashboardRouter.get("/summary", requirePermission(PERMISSION_KEY.VIEW_FINANCE_DASHBOARD), async (_req, res) => {
  const zero = new Prisma.Decimal(0);
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // Receivables: issued + partially_paid invoices.
  const invoices = await prisma.invoice.findMany({
    where: { status: { in: [INVOICE_STATUS.ISSUED, INVOICE_STATUS.PARTIALLY_PAID] } },
    include: { payments: { select: { amount: true } } },
  });
  let outstandingReceivables = zero;
  let overdueCount = 0;
  let overdueValue = zero;
  for (const inv of invoices) {
    const paid = inv.payments.reduce((s, p) => s.plus(D(p.amount)), zero);
    const balance = D(inv.total).minus(paid);
    outstandingReceivables = outstandingReceivables.plus(balance);
    if (inv.dueDate && inv.dueDate.getTime() < now.getTime()) {
      overdueCount += 1;
      overdueValue = overdueValue.plus(balance);
    }
  }

  const paymentsReceived = await prisma.paymentReceived.findMany({ where: { receivedDate: { gte: monthStart } } });
  const receivedThisMonth = paymentsReceived.reduce((s, p) => s.plus(D(p.amount)), zero);

  const bills = await prisma.bill.findMany({
    where: { status: { in: [BILL_STATUS.UNPAID, BILL_STATUS.PARTIALLY_PAID] } },
    include: { payments: { select: { amount: true } } },
  });
  let outstandingPayables = zero;
  for (const b of bills) {
    const paid = b.payments.reduce((s, p) => s.plus(D(p.amount)), zero);
    outstandingPayables = outstandingPayables.plus(D(b.total).minus(paid));
  }

  const expensesThisMonth = await prisma.expense.findMany({ where: { expenseDate: { gte: monthStart } } });
  const expensesSum = expensesThisMonth.reduce((s, e) => s.plus(D(e.amount)), zero);

  res.json({
    outstandingReceivables,
    outstandingPayables,
    receivedThisMonth,
    overdueInvoiceCount: overdueCount,
    overdueInvoiceValue: overdueValue,
    expensesThisMonth: expensesSum,
  });
});

financeDashboardRouter.get("/reports/receivables", requirePermission(PERMISSION_KEY.VIEW_FINANCE_DASHBOARD), async (_req, res) => {
  const now = new Date();
  const invoices = await prisma.invoice.findMany({
    where: { status: { in: [INVOICE_STATUS.ISSUED, INVOICE_STATUS.PARTIALLY_PAID] } },
    include: { payments: { select: { amount: true } }, customer: { select: { id: true, name: true } } },
  });

  const byCustomer = new Map<string, any>();
  for (const inv of invoices) {
    const paid = inv.payments.reduce((s, p) => s.plus(D(p.amount)), new Prisma.Decimal(0));
    const balance = D(inv.total).minus(paid);
    if (balance.lte(0)) continue;
    const anchor = inv.dueDate ?? inv.issueDate;
    const days = Math.floor((now.getTime() - anchor.getTime()) / 86_400_000);
    const bucket = days <= 0 ? "current" : days <= 30 ? "days0_30" : days <= 60 ? "days31_60" : days <= 90 ? "days61_90" : "days90Plus";

    let row = byCustomer.get(inv.customerId);
    if (!row) {
      row = { customerId: inv.customerId, customerName: inv.customer.name, outstanding: new Prisma.Decimal(0), current: new Prisma.Decimal(0), days0_30: new Prisma.Decimal(0), days31_60: new Prisma.Decimal(0), days61_90: new Prisma.Decimal(0), days90Plus: new Prisma.Decimal(0) };
      byCustomer.set(inv.customerId, row);
    }
    row.outstanding = row.outstanding.plus(balance);
    row[bucket] = row[bucket].plus(balance);
  }

  res.json(Array.from(byCustomer.values()));
});

financeDashboardRouter.get("/reports/payables", requirePermission(PERMISSION_KEY.VIEW_FINANCE_DASHBOARD), async (_req, res) => {
  const now = new Date();
  const bills = await prisma.bill.findMany({
    where: { status: { in: [BILL_STATUS.UNPAID, BILL_STATUS.PARTIALLY_PAID] } },
    include: { payments: { select: { amount: true } }, supplier: { select: { id: true, name: true } } },
  });

  const bySupplier = new Map<string, any>();
  for (const b of bills) {
    const paid = b.payments.reduce((s, p) => s.plus(D(p.amount)), new Prisma.Decimal(0));
    const balance = D(b.total).minus(paid);
    if (balance.lte(0)) continue;
    const anchor = b.dueDate ?? b.billDate;
    const days = Math.floor((now.getTime() - anchor.getTime()) / 86_400_000);
    const bucket = days <= 0 ? "current" : days <= 30 ? "days0_30" : days <= 60 ? "days31_60" : days <= 90 ? "days61_90" : "days90Plus";

    let row = bySupplier.get(b.supplierId);
    if (!row) {
      row = { supplierId: b.supplierId, supplierName: b.supplier.name, outstanding: new Prisma.Decimal(0), current: new Prisma.Decimal(0), days0_30: new Prisma.Decimal(0), days31_60: new Prisma.Decimal(0), days61_90: new Prisma.Decimal(0), days90Plus: new Prisma.Decimal(0) };
      bySupplier.set(b.supplierId, row);
    }
    row.outstanding = row.outstanding.plus(balance);
    row[bucket] = row[bucket].plus(balance);
  }

  res.json(Array.from(bySupplier.values()));
});

financeDashboardRouter.get("/reports/gst-summary", requirePermission(PERMISSION_KEY.VIEW_FINANCE_DASHBOARD), async (req, res) => {
  const from = asOptionalString(req.query.from);
  const to = asOptionalString(req.query.to);

  const taxInvoices = await prisma.invoice.findMany({
    where: { docType: "tax_invoice", status: { in: [INVOICE_STATUS.ISSUED, INVOICE_STATUS.PARTIALLY_PAID, INVOICE_STATUS.PAID] }, issueDate: from || to ? { gte: from ? new Date(from) : undefined, lte: to ? new Date(to) : undefined } : undefined },
  });
  const bills = await prisma.bill.findMany({
    where: { billDate: from || to ? { gte: from ? new Date(from) : undefined, lte: to ? new Date(to) : undefined } : undefined },
  });

  const rows = new Map<string, any>();
  const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

  for (const inv of taxInvoices) {
    const m = monthKey(inv.issueDate);
    if (!rows.has(m)) rows.set(m, { month: m, taxableValue: new Prisma.Decimal(0), cgst: new Prisma.Decimal(0), sgst: new Prisma.Decimal(0), igst: new Prisma.Decimal(0) });
    const r = rows.get(m);
    r.taxableValue = r.taxableValue.plus(D(inv.subtotal));
    r.cgst = r.cgst.plus(D(inv.cgstAmount));
    r.sgst = r.sgst.plus(D(inv.sgstAmount));
    r.igst = r.igst.plus(D(inv.igstAmount));
  }
  for (const b of bills) {
    const m = monthKey(b.billDate);
    if (!rows.has(m)) rows.set(m, { month: m, taxableValue: new Prisma.Decimal(0), cgst: new Prisma.Decimal(0), sgst: new Prisma.Decimal(0), igst: new Prisma.Decimal(0) });
    const r = rows.get(m);
    r.taxableValue = r.taxableValue.plus(D(b.subtotal));
    r.cgst = r.cgst.plus(D(b.taxAmount).div(2));
    r.sgst = r.sgst.plus(D(b.taxAmount).div(2));
    r.igst = r.igst.plus(0);
  }

  res.json(Array.from(rows.values()).sort((a, b) => a.month.localeCompare(b.month)));
});

financeDashboardRouter.get("/reports/monthly-revenue", requirePermission(PERMISSION_KEY.VIEW_FINANCE_DASHBOARD), async (req, res) => {
  const months = parseInt(asString(req.query.months ?? "12"), 10) || 12;
  const now = new Date();
  const rows: any[] = [];
  const paymentsByMonth = new Map<string, Prisma.Decimal>();
  const expensesByMonth = new Map<string, Prisma.Decimal>();

  const startMonth = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
  const payments = await prisma.paymentReceived.findMany({ where: { receivedDate: { gte: startMonth } } });
  for (const p of payments) {
    const m = `${p.receivedDate.getFullYear()}-${String(p.receivedDate.getMonth() + 1).padStart(2, "0")}`;
    paymentsByMonth.set(m, (paymentsByMonth.get(m) ?? new Prisma.Decimal(0)).plus(D(p.amount)));
  }
  const expenses = await prisma.expense.findMany({ where: { expenseDate: { gte: startMonth } } });
  for (const e of expenses) {
    const m = `${e.expenseDate.getFullYear()}-${String(e.expenseDate.getMonth() + 1).padStart(2, "0")}`;
    expensesByMonth.set(m, (expensesByMonth.get(m) ?? new Prisma.Decimal(0)).plus(D(e.amount)));
  }

  for (let i = 0; i < months; i++) {
    const d = new Date(startMonth.getFullYear(), startMonth.getMonth() + i, 1);
    const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    rows.push({ month: m, revenue: paymentsByMonth.get(m) ?? new Prisma.Decimal(0), expenses: expensesByMonth.get(m) ?? new Prisma.Decimal(0) });
  }
  res.json(rows);
});
