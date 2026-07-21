import { Prisma } from "@prisma/client";
import { FINANCE_DOC_TYPE, type FinanceDocType } from "@recd/shared";

const PREFIX_MAP: Record<FinanceDocType, string> = {
  [FINANCE_DOC_TYPE.QUOTATION]: "QTN",
  [FINANCE_DOC_TYPE.PROFORMA]: "PI",
  [FINANCE_DOC_TYPE.TAX_INVOICE]: "INV",
  [FINANCE_DOC_TYPE.PURCHASE_ORDER]: "PO",
};

/** Indian fiscal year: April–March. A date in Jan 2027 → "2026-27". */
export function fiscalYearFor(date: Date): string {
  const y = date.getFullYear();
  const startsInPrevious = date.getMonth() < 3; // Jan–Mar belongs to the previous FY start
  const startYear = startsInPrevious ? y - 1 : y;
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
  const seq = await tx.documentSequence.upsert({
    where: { docType_fiscalYear: { docType, fiscalYear } },
    update: { lastNumber: { increment: 1 } },
    create: { docType, fiscalYear, lastNumber: 1 },
  });
  const prefix = PREFIX_MAP[docType];
  return `${prefix}/${fiscalYear}/${String(seq.lastNumber).padStart(4, "0")}`;
}
