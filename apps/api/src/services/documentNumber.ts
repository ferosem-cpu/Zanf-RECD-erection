import { Prisma } from "@prisma/client";
import { FINANCE_DOC_TYPE, type FinanceDocType } from "@recd/shared";

const PREFIX_MAP: Record<FinanceDocType, string> = {
  [FINANCE_DOC_TYPE.QUOTATION]: "QTN",
  [FINANCE_DOC_TYPE.PROFORMA]: "PI",
  [FINANCE_DOC_TYPE.TAX_INVOICE]: "INV",
  [FINANCE_DOC_TYPE.PURCHASE_ORDER]: "PO",
  [FINANCE_DOC_TYPE.CREDIT_NOTE]: "CRN",
};

/**
 * Every document type has its own independent counter per fiscal year. Proforma (PI/) and
 * Tax Invoice (INV/) used to share one "invoice" counter, which made tax invoice numbers jump
 * (INV/2026-27/0018 after INV/2026-27/0004). GST needs the tax invoice series to be
 * consecutive on its own, so they are now separate: "proforma" and "tax_invoice". The legacy
 * "invoice" row in DocumentSequence is left untouched for history and is no longer used.
 */
export const SEQUENCE_KEY: Record<FinanceDocType, string> = {
  [FINANCE_DOC_TYPE.QUOTATION]: FINANCE_DOC_TYPE.QUOTATION,
  [FINANCE_DOC_TYPE.PROFORMA]: "proforma",
  [FINANCE_DOC_TYPE.TAX_INVOICE]: "tax_invoice",
  [FINANCE_DOC_TYPE.PURCHASE_ORDER]: FINANCE_DOC_TYPE.PURCHASE_ORDER,
  [FINANCE_DOC_TYPE.CREDIT_NOTE]: FINANCE_DOC_TYPE.CREDIT_NOTE,
};

/** Calendar date in India (Asia/Kolkata) as "YYYY-MM-DD". */
export function istDateString(date: Date): string {
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/**
 * Indian fiscal year April–March, decided on the IST calendar date (so 31 Mar 19:00 UTC,
 * which is 1 Apr 00:30 IST, already belongs to the new year). A date in Jan 2027 → "2026-27".
 */
export function fiscalYearFor(date: Date): string {
  const [y, m] = istDateString(date).split("-").map(Number);
  const startYear = m < 4 ? y - 1 : y;
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
}

/**
 * Atomically allocate the next document number for a fiscal-year sequence, inside
 * the caller's transaction. Format: `QTN/2026-27/0001`. Never use random numbers —
 * GST invoice numbers must be consecutive and gap-free.
 */
export async function nextDocumentNumber(
  tx: Prisma.TransactionClient,
  docType: FinanceDocType,
  date: Date = new Date(),
): Promise<string> {
  const fiscalYear = fiscalYearFor(date);
  const sequenceKey = SEQUENCE_KEY[docType];
  const seq = await tx.documentSequence.upsert({
    where: { docType_fiscalYear: { docType: sequenceKey, fiscalYear } },
    update: { lastNumber: { increment: 1 } },
    create: { docType: sequenceKey, fiscalYear, lastNumber: 1 },
  });
  const prefix = PREFIX_MAP[docType];
  return `${prefix}/${fiscalYear}/${String(seq.lastNumber).padStart(4, "0")}`;
}
