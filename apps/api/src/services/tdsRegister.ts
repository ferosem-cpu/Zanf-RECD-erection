import { Prisma } from "@prisma/client";
import { isLegacyTdsPayment, splitPayment } from "./paymentSplit";

export interface TdsRegisterPayment {
  id: string;
  amount: Prisma.Decimal | string | number;
  tdsAmount: Prisma.Decimal | string | number;
  method: string;
  tdsCertificateRef: string | null;
  receivedDate: Date;
  customer: { id: string; name: string };
  invoice: { invoiceNumber: string } | null;
  allocations: { invoice: { invoiceNumber: string } }[];
}

/**
 * 26AS reconciliation rows from payments that carry TDS in either shape (see paymentSplit.ts):
 * current rows (cash in amount, TDS in tdsAmount) and legacy "TDS Deducted" rows (whole amount
 * is TDS, so grossAmount = 0). grossAmount is cash only; invoice value settled = gross + TDS.
 */
export function buildTdsRegister(payments: TdsRegisterPayment[]) {
  const rows = payments
    .map((p) => {
      const { cash, tds } = splitPayment(p);
      return {
        paymentId: p.id,
        date: p.receivedDate,
        customerId: p.customer.id,
        customerName: p.customer.name,
        invoiceNumbers: p.invoice ? [p.invoice.invoiceNumber] : p.allocations.map((a) => a.invoice.invoiceNumber),
        grossAmount: cash,
        tdsAmount: tds,
        tdsCertificateRef: p.tdsCertificateRef,
        legacyTdsEntry: isLegacyTdsPayment(p),
      };
    })
    .filter((r) => r.tdsAmount.gt(0));

  const totalsByCustomer = new Map<string, { customerId: string; customerName: string; grossAmount: Prisma.Decimal; tdsAmount: Prisma.Decimal }>();
  for (const r of rows) {
    const entry = totalsByCustomer.get(r.customerId) ?? {
      customerId: r.customerId, customerName: r.customerName, grossAmount: new Prisma.Decimal(0), tdsAmount: new Prisma.Decimal(0),
    };
    entry.grossAmount = entry.grossAmount.plus(r.grossAmount);
    entry.tdsAmount = entry.tdsAmount.plus(r.tdsAmount);
    totalsByCustomer.set(r.customerId, entry);
  }

  return {
    rows,
    totalsByCustomer: Array.from(totalsByCustomer.values(), (c) => ({
      ...c, grossAmount: c.grossAmount.toNumber(), tdsAmount: c.tdsAmount.toNumber(),
    })),
    grandTotalTds: rows.reduce((s, r) => s.plus(r.tdsAmount), new Prisma.Decimal(0)).toNumber(),
  };
}
