// Supplier record helpers shared by the PO list/detail/print pages and the Suppliers page.

export interface Supplier {
  id: string;
  name: string;
  gstin?: string | null;
  pan?: string | null;
  state?: string | null;
  /** Address line 1 (kept as `address` for backward compatibility with older rows). */
  address?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  pincode?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  isActive?: boolean;
}

export type SupplierFormValues = {
  name: string;
  gstin: string;
  pan: string;
  state: string;
  address: string;
  addressLine2: string;
  city: string;
  pincode: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
};

export const EMPTY_SUPPLIER_FORM: SupplierFormValues = {
  name: "", gstin: "", pan: "", state: "", address: "", addressLine2: "", city: "", pincode: "",
  contactName: "", contactPhone: "", contactEmail: "",
};

export function supplierToForm(s: Supplier): SupplierFormValues {
  return {
    name: s.name ?? "",
    gstin: s.gstin ?? "",
    pan: s.pan ?? "",
    state: s.state ?? "",
    address: s.address ?? "",
    addressLine2: s.addressLine2 ?? "",
    city: s.city ?? "",
    pincode: s.pincode ?? "",
    contactName: s.contactName ?? "",
    contactPhone: s.contactPhone ?? "",
    contactEmail: s.contactEmail ?? "",
  };
}

/** Address as display lines: line 1 (may itself contain newlines on legacy rows), line 2,
 * "City - PIN", and the state (unless the city line already ends with it). */
export function supplierAddressLines(s: Partial<Supplier> | null | undefined): string[] {
  if (!s) return [];
  const lines: string[] = [];
  for (const part of [s.address, s.addressLine2]) {
    if (part) lines.push(...part.split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
  }
  const cityPin = [s.city, s.pincode].filter(Boolean).join(" - ");
  const state = s.state?.trim();
  const already = state && lines.concat(cityPin).some((l) => l.toLowerCase().includes(state.toLowerCase()));
  if (cityPin && state && !already) lines.push(`${cityPin}, ${state}`);
  else {
    if (cityPin) lines.push(cityPin);
    if (state && !already) lines.push(state);
  }
  return lines;
}

/** Mirrors normalizeStateForGst in @recd/shared (kept local so this stays a pure client helper). */
function normState(v: string | null | undefined): string | null {
  if (!v) return null;
  const n = v.toLowerCase().replace(/\(\s*\d+\s*\)/g, "").replace(/[^a-z]/g, "");
  return n || null;
}

/** Same rule as the API (routes/purchase-orders.ts poTaxStates): IGST only when both the
 * supplier's state and the place of supply are known and differ; otherwise CGST+SGST. */
export function poTaxMode(supplierState: string | null | undefined, placeOfSupply: string | null | undefined): "intra" | "inter" {
  const a = normState(supplierState);
  const b = normState(placeOfSupply);
  return a && b && a !== b ? "inter" : "intra";
}
