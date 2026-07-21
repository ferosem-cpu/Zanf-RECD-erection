import { Prisma } from "@prisma/client";

export interface FinanceLineItemInput {
  quantity: number;
  unitPrice: number;
  discountPct: number;
  taxRatePct: number;
}

export interface DocumentTotals {
  subtotal: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  cgstAmount: Prisma.Decimal;
  sgstAmount: Prisma.Decimal;
  igstAmount: Prisma.Decimal;
  total: Prisma.Decimal;
}

const round2 = (n: number): Prisma.Decimal => new Prisma.Decimal(n).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

/**
 * Pre-tax line total: qty * unitPrice * (1 - discountPct/100), rounded to 2dp.
 * The discount reduces the taxable base but is reported separately on the doc.
 */
export function computeLineTotal(quantity: number, unitPrice: number, discountPct: number): Prisma.Decimal {
  const gross = quantity * unitPrice;
  const discounted = gross * (1 - discountPct / 100);
  return round2(discounted);
}

/**
 * Sum line totals into document-level tax split. Intra-state (same state, or either
 * state missing → default to intra-state to be safe for B2C-ish flows) splits each
 * line's tax into CGST + SGST halves; inter-state puts all tax into IGST.
 */
export function computeDocumentTotals(
  lines: FinanceLineItemInput[],
  companyState?: string | null,
  placeOfSupply?: string | null,
): DocumentTotals {
  let subtotal = new Prisma.Decimal(0);
  let discountAmount = new Prisma.Decimal(0);
  let cgst = new Prisma.Decimal(0);
  let sgst = new Prisma.Decimal(0);
  let igst = new Prisma.Decimal(0);

  // Intra-state when both states are present and equal. Per the plan (§5.2), if
  // either state is missing we default to intra-state (CGST + SGST halves) rather
  // than assuming inter-state — the supplier's company state is the deciding factor.
  const sameState = !companyState || !placeOfSupply || companyState === placeOfSupply;

  for (const line of lines) {
    const gross = line.quantity * line.unitPrice;
    const lineTotal = computeLineTotal(line.quantity, line.unitPrice, line.discountPct);
    discountAmount = discountAmount.plus(round2(gross - lineTotal.toNumber()));
    subtotal = subtotal.plus(lineTotal);

    const taxAmount = lineTotal.toNumber() * (line.taxRatePct / 100);
    if (sameState) {
      cgst = cgst.plus(round2(taxAmount / 2));
      sgst = sgst.plus(round2(taxAmount / 2));
    } else {
      igst = igst.plus(round2(taxAmount));
    }
  }

  const total = subtotal.plus(cgst).plus(sgst).plus(igst);
  return {
    subtotal: round2(subtotal.toNumber()),
    discountAmount: round2(discountAmount.toNumber()),
    cgstAmount: cgst,
    sgstAmount: sgst,
    igstAmount: igst,
    total: round2(total.toNumber()),
  };
}
