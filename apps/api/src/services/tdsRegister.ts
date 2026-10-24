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

export interface VendorTdsRegisterPayment {
  id: string;
  amount: Prisma.Decimal | string | number;
  tdsAmount: Prisma.Decimal | string | number | null;
  tdsCertificateRef: string | null;
  paidDate: Date;
  supplier: { id: string; name: string; pan: string | null };
  bill: { billNumber: string } | null;
}

/**
 * The opposite direction to buildTdsRegister: TDS WE withheld from suppliers on vendor payments
 * (payable to the government; 26Q / Form 16A), from PaymentMade.tdsAmount. Kept as its own section
 * and own totals - never added to the customer-side (26AS receivable) totals above. cashPaid is the
 * cash only; bill value settled = cashPaid + tdsAmount (services/vendorPaymentTds.ts).
 */
export function buildVendorTdsRegister(payments: VendorTdsRegisterPayment[]) {
  const rows = payments
    .map((p) => ({
      paymentId: p.id,
      date: p.paidDate,
      supplierId: p.supplier.id,
      supplierName: p.supplier.name,
      supplierPan: p.supplier.pan,
      billNumber: p.bill?.billNumber ?? null,
      cashPaid: new Prisma.Decimal(String(p.amount)),
      tdsAmount: new Prisma.Decimal(String(p.tdsAmount ?? 0)),
      tdsCertificateRef: p.tdsCertificateRef,
    }))
    .filter((r) => r.tdsAmount.gt(0));

  const bySupplier = new Map<string, { supplierId: string; supplierName: string; supplierPan: string | null; cashPaid: Prisma.Decimal; tdsAmount: Prisma.Decimal }>();
  for (const r of rows) {
    const entry = bySupplier.get(r.supplierId) ?? {
      supplierId: r.supplierId, supplierName: r.supplierName, supplierPan: r.supplierPan, cashPaid: new Prisma.Decimal(0), tdsAmount: new Prisma.Decimal(0),
    };
    entry.cashPaid = entry.cashPaid.plus(r.cashPaid);
    entry.tdsAmount = entry.tdsAmount.plus(r.tdsAmount);
    bySupplier.set(r.supplierId, entry);
  }

  return {
    rows,
    totalsBySupplier: Array.from(bySupplier.values(), (s) => ({ ...s, cashPaid: s.cashPaid.toNumber(), tdsAmount: s.tdsAmount.toNumber() })),
    grandTotalTds: rows.reduce((s, r) => s.plus(r.tdsAmount), new Prisma.Decimal(0)).toNumber(),
  };
}
