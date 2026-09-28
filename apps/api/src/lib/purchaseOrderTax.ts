import { normalizeStateForGst } from "@recd/shared";

/** The two states handed to computeDocumentTotals for a PO. GST on a purchase is intra-state
 * (CGST+SGST) when the supplier's state equals the place of supply, inter-state (IGST)
 * otherwise. To stay backward compatible (POs have always been CGST+SGST), IGST is only used
 * when BOTH the supplier's state and the PO's place of supply are known and differ; if either
 * is blank we pass nothing and computeDocumentTotals keeps the intra-state default. */
export function poTaxStates(supplierState: string | null | undefined, placeOfSupply: string | null | undefined): [string | undefined, string | undefined] {
  const from = normalizeStateForGst(supplierState);
  const to = normalizeStateForGst(placeOfSupply);
  if (!from || !to) return [undefined, undefined];
  return [from, to];
}
