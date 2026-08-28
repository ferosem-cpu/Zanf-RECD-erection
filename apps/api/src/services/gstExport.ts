// Phase D of docs/ACCOUNTING_LITE_PLAN.md — GST return export builders. Pure query +
// computation, no new tables (every field these read already exists: gstin on
// Customer/CompanySettings, placeOfSupply + cgst/sgst/igstAmount on Invoice/CreditNote,
// taxRatePct + lineTotal on the line-item tables). Read-only: never writes anything.
import { Prisma } from "@prisma/client";
import { INVOICE_DOC_TYPE, INVOICE_STATUS, CREDIT_NOTE_STATUS, BILL_STATUS } from "@recd/shared";
import { prisma } from "../lib/prisma";

const D = (n: number | string | Prisma.Decimal): Prisma.Decimal =>
  n instanceof Prisma.Decimal ? n : new Prisma.Decimal(String(n));
const ZERO = new Prisma.Decimal(0);

/** Group a document's line items by tax rate, summing each rate's taxable value
 * (post-discount lineTotal). GSTR-1's B2B/CDNR CSVs need one row per invoice PER RATE,
 * not one row per invoice — most invoices have a single rate so this usually collapses
 * to one row anyway. */
function groupByRate(lineItems: { taxRatePct: Prisma.Decimal; lineTotal: Prisma.Decimal }[]): Map<string, Prisma.Decimal> {
  const byRate = new Map<string, Prisma.Decimal>();
  for (const li of lineItems) {
    const key = li.taxRatePct.toString();
    byRate.set(key, (byRate.get(key) ?? ZERO).plus(D(li.lineTotal)));
  }
  return byRate;
}

export interface Gstr1B2bRow {
  invoiceNumber: string;
  invoiceDate: Date;
  customerName: string;
  customerGstin: string | null;
  placeOfSupply: string | null;
  taxRatePct: string;
  taxableValue: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  invoiceValue: string;
}

export interface Gstr1CdnrRow {
  noteNumber: string;
  noteDate: Date;
  invoiceNumber: string;
  customerName: string;
  customerGstin: string | null;
  placeOfSupply: string | null;
  taxRatePct: string;
  taxableValue: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  noteValue: string;
}

export interface Gstr1Result {
  from: Date;
  to: Date;
  b2b: Gstr1B2bRow[];
  cdnr: Gstr1CdnrRow[];
}

/** GSTR-1 B2B (outward tax invoices) + CDNR (issued credit notes) for an issue-date range.
 * Interstate vs intra-state is read off the document itself (igstAmount > 0 means the
 * document was already computed as interstate at issue time; never re-derived from a
 * company/customer state comparison here) - per-rate tax is then split CGST+SGST 50/50
 * or IGST wholesale accordingly. */
export async function buildGstr1(from: Date, to: Date): Promise<Gstr1Result> {
  const invoices = await prisma.invoice.findMany({
    where: {
      docType: INVOICE_DOC_TYPE.TAX_INVOICE,
      status: { in: [INVOICE_STATUS.ISSUED, INVOICE_STATUS.PARTIALLY_PAID, INVOICE_STATUS.PAID] },
      issueDate: { gte: from, lte: to },
    },
    include: { customer: { select: { name: true, gstin: true } }, lineItems: true },
    orderBy: { issueDate: "asc" },
  });

  const b2b: Gstr1B2bRow[] = [];
  for (const inv of invoices) {
    const interstate = D(inv.igstAmount).greaterThan(0);
    for (const [rateStr, taxableValue] of groupByRate(inv.lineItems)) {
      const taxAmount = taxableValue.times(rateStr).div(100);
      b2b.push({
        invoiceNumber: inv.invoiceNumber,
        invoiceDate: inv.issueDate,
        customerName: inv.customer.name,
        customerGstin: inv.customer.gstin,
        placeOfSupply: inv.placeOfSupply,
        taxRatePct: rateStr,
        taxableValue: taxableValue.toFixed(2),
        cgstAmount: interstate ? "0.00" : taxAmount.div(2).toFixed(2),
        sgstAmount: interstate ? "0.00" : taxAmount.div(2).toFixed(2),
        igstAmount: interstate ? taxAmount.toFixed(2) : "0.00",
        invoiceValue: D(inv.total).toFixed(2),
      });
    }
  }

  const creditNotes = await prisma.creditNote.findMany({
    where: { status: CREDIT_NOTE_STATUS.ISSUED, issueDate: { gte: from, lte: to } },
    include: {
      customer: { select: { name: true, gstin: true } },
      invoice: { select: { invoiceNumber: true } },
      lineItems: true,
    },
    orderBy: { issueDate: "asc" },
  });

  const cdnr: Gstr1CdnrRow[] = [];
  for (const cn of creditNotes) {
    const interstate = D(cn.igstAmount).greaterThan(0);
    for (const [rateStr, taxableValue] of groupByRate(cn.lineItems)) {
      const taxAmount = taxableValue.times(rateStr).div(100);
      cdnr.push({
        noteNumber: cn.noteNumber,
        noteDate: cn.issueDate,
        invoiceNumber: cn.invoice.invoiceNumber,
        customerName: cn.customer.name,
        customerGstin: cn.customer.gstin,
        placeOfSupply: cn.placeOfSupply,
        taxRatePct: rateStr,
        taxableValue: taxableValue.toFixed(2),
        cgstAmount: interstate ? "0.00" : taxAmount.div(2).toFixed(2),
        sgstAmount: interstate ? "0.00" : taxAmount.div(2).toFixed(2),
        igstAmount: interstate ? taxAmount.toFixed(2) : "0.00",
        noteValue: D(cn.total).toFixed(2),
      });
    }
  }

  return { from, to, b2b, cdnr };
}

export interface Gstr3bResult {
  from: Date;
  to: Date;
  outwardTaxableValue: string;
  outwardCgst: string;
  outwardSgst: string;
  outwardIgst: string;
  creditNoteTaxableValue: string;
  creditNoteCgst: string;
  creditNoteSgst: string;
  creditNoteIgst: string;
  /** 3.1a net of issued credit notes - the actual output-tax liability for the period. */
  netTaxableValue: string;
  netCgst: string;
  netSgst: string;
  netIgst: string;
  netOutputTax: string;
  /** 4A: eligible ITC from vendor bills recorded (approved or further along the workflow -
   * excludes uploaded/verified-only, rejected, and cancelled) in the period, by billDate. */
  eligibleItc: string;
}

/** GSTR-3B summary for an issue/bill-date range: 3.1a output tax (tax invoices minus
 * issued credit notes) and 4A eligible ITC (vendor bills). Informational only - this is a
 * summary aid, not a filing-ready return; a CA still reconciles and files GSTR-3B. */
export async function buildGstr3b(from: Date, to: Date): Promise<Gstr3bResult> {
  const invoices = await prisma.invoice.findMany({
    where: {
      docType: INVOICE_DOC_TYPE.TAX_INVOICE,
      status: { in: [INVOICE_STATUS.ISSUED, INVOICE_STATUS.PARTIALLY_PAID, INVOICE_STATUS.PAID] },
      issueDate: { gte: from, lte: to },
    },
    select: { subtotal: true, discountAmount: true, cgstAmount: true, sgstAmount: true, igstAmount: true },
  });
  let outwardTaxableValue = ZERO, outwardCgst = ZERO, outwardSgst = ZERO, outwardIgst = ZERO;
  for (const inv of invoices) {
    outwardTaxableValue = outwardTaxableValue.plus(D(inv.subtotal)).minus(D(inv.discountAmount));
    outwardCgst = outwardCgst.plus(D(inv.cgstAmount));
    outwardSgst = outwardSgst.plus(D(inv.sgstAmount));
    outwardIgst = outwardIgst.plus(D(inv.igstAmount));
  }

  const creditNotes = await prisma.creditNote.findMany({
    where: { status: CREDIT_NOTE_STATUS.ISSUED, issueDate: { gte: from, lte: to } },
    select: { subtotal: true, cgstAmount: true, sgstAmount: true, igstAmount: true },
  });
  let cnTaxableValue = ZERO, cnCgst = ZERO, cnSgst = ZERO, cnIgst = ZERO;
  for (const cn of creditNotes) {
    cnTaxableValue = cnTaxableValue.plus(D(cn.subtotal));
    cnCgst = cnCgst.plus(D(cn.cgstAmount));
    cnSgst = cnSgst.plus(D(cn.sgstAmount));
    cnIgst = cnIgst.plus(D(cn.igstAmount));
  }

  const bills = await prisma.bill.findMany({
    where: {
      status: { in: [BILL_STATUS.APPROVED, BILL_STATUS.PARTIALLY_PAID, BILL_STATUS.PAID] },
      billDate: { gte: from, lte: to },
    },
    select: { taxAmount: true },
  });
  const eligibleItc = bills.reduce((s, b) => s.plus(D(b.taxAmount)), ZERO);

  const netTaxableValue = outwardTaxableValue.minus(cnTaxableValue);
  const netCgst = outwardCgst.minus(cnCgst);
  const netSgst = outwardSgst.minus(cnSgst);
  const netIgst = outwardIgst.minus(cnIgst);

  return {
    from,
    to,
    outwardTaxableValue: outwardTaxableValue.toFixed(2),
    outwardCgst: outwardCgst.toFixed(2),
    outwardSgst: outwardSgst.toFixed(2),
    outwardIgst: outwardIgst.toFixed(2),
    creditNoteTaxableValue: cnTaxableValue.toFixed(2),
    creditNoteCgst: cnCgst.toFixed(2),
    creditNoteSgst: cnSgst.toFixed(2),
    creditNoteIgst: cnIgst.toFixed(2),
    netTaxableValue: netTaxableValue.toFixed(2),
    netCgst: netCgst.toFixed(2),
    netSgst: netSgst.toFixed(2),
    netIgst: netIgst.toFixed(2),
    netOutputTax: netCgst.plus(netSgst).plus(netIgst).toFixed(2),
    eligibleItc: eligibleItc.toFixed(2),
  };
}
