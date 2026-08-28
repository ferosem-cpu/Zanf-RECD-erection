import { Router } from "express";
import { PERMISSION_KEY } from "@recd/shared";
import { prisma } from "../lib/prisma";
import { authenticate, requirePermission } from "../middleware/auth";
import { asString, asOptionalString } from "../lib/params";
import { buildCustomerLedger, buildSupplierLedger } from "../services/ledger";
import { buildGstr1, buildGstr3b } from "../services/gstExport";
import { buildCsv } from "../lib/csv";

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

function parseRequiredRange(req: any, res: any): { from: Date; to: Date } | null {
  const fromStr = asOptionalString(req.query.from);
  const toStr = asOptionalString(req.query.to);
  if (!fromStr || !toStr) {
    res.status(400).json({ error: "from and to (YYYY-MM-DD) are both required" });
    return null;
  }
  const from = new Date(fromStr);
  const to = new Date(toStr);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    res.status(400).json({ error: "from/to must be valid dates" });
    return null;
  }
  // Inclusive end-of-day so a same-day range and a "to" date with no time component
  // both include documents issued on that day.
  to.setUTCHours(23, 59, 59, 999);
  return { from, to };
}

// GSTR-1 B2B + CDNR for an issue-date range. ?format=csv streams two CSV sections
// (B2B rows, then a blank line, then CDNR rows) instead of the JSON shape.
ledgersRouter.get("/gst/gstr1", async (req, res) => {
  const range = parseRequiredRange(req, res);
  if (!range) return;
  const result = await buildGstr1(range.from, range.to);

  if (asOptionalString(req.query.format) === "csv") {
    const b2bCsv = buildCsv(
      ["Invoice No", "Invoice Date", "Customer", "GSTIN", "Place of Supply", "Rate %", "Taxable Value", "CGST", "SGST", "IGST", "Invoice Value"],
      result.b2b.map((r) => [r.invoiceNumber, r.invoiceDate.toISOString().slice(0, 10), r.customerName, r.customerGstin ?? "", r.placeOfSupply ?? "", r.taxRatePct, r.taxableValue, r.cgstAmount, r.sgstAmount, r.igstAmount, r.invoiceValue]),
    );
    const cdnrCsv = buildCsv(
      ["Note No", "Note Date", "Invoice No", "Customer", "GSTIN", "Place of Supply", "Rate %", "Taxable Value", "CGST", "SGST", "IGST", "Note Value"],
      result.cdnr.map((r) => [r.noteNumber, r.noteDate.toISOString().slice(0, 10), r.invoiceNumber, r.customerName, r.customerGstin ?? "", r.placeOfSupply ?? "", r.taxRatePct, r.taxableValue, r.cgstAmount, r.sgstAmount, r.igstAmount, r.noteValue]),
    );
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="gstr1-b2b-cdnr.csv"`);
    return res.send(`B2B\r\n${b2bCsv}\r\n\r\nCDNR\r\n${cdnrCsv}`);
  }

  res.json(result);
});

// GSTR-3B summary (3.1a output tax net of issued CNs, 4A eligible ITC) for a date range.
ledgersRouter.get("/gst/gstr3b", async (req, res) => {
  const range = parseRequiredRange(req, res);
  if (!range) return;
  const result = await buildGstr3b(range.from, range.to);

  if (asOptionalString(req.query.format) === "csv") {
    const csv = buildCsv(
      ["Field", "Value"],
      [
        ["Period from", range.from.toISOString().slice(0, 10)],
        ["Period to", range.to.toISOString().slice(0, 10)],
        ["Outward taxable value", result.outwardTaxableValue],
        ["Outward CGST", result.outwardCgst],
        ["Outward SGST", result.outwardSgst],
        ["Outward IGST", result.outwardIgst],
        ["Credit note taxable value", result.creditNoteTaxableValue],
        ["Credit note CGST", result.creditNoteCgst],
        ["Credit note SGST", result.creditNoteSgst],
        ["Credit note IGST", result.creditNoteIgst],
        ["Net taxable value (3.1a)", result.netTaxableValue],
        ["Net CGST", result.netCgst],
        ["Net SGST", result.netSgst],
        ["Net IGST", result.netIgst],
        ["Net output tax", result.netOutputTax],
        ["Eligible ITC (4A)", result.eligibleItc],
      ],
    );
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="gstr3b-summary.csv"`);
    return res.send(csv);
  }

  res.json(result);
});
