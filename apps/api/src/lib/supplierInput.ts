/** String fields a supplier form may send; "" is stored as null so an edit can clear a value. */
const SUPPLIER_TEXT_FIELDS = [
  "gstin", "pan", "state", "address", "addressLine2", "city", "pincode", "contactName", "contactEmail", "contactPhone",
] as const;

export function normalizeSupplierInput<T extends Record<string, unknown>>(data: T): T {
  const out: Record<string, unknown> = { ...data };
  for (const key of SUPPLIER_TEXT_FIELDS) {
    const v = out[key];
    if (typeof v === "string") {
      const trimmed = v.trim();
      out[key] = trimmed === "" ? null : trimmed;
    }
  }
  if (typeof out.gstin === "string") out.gstin = out.gstin.toUpperCase();
  if (typeof out.pan === "string") out.pan = out.pan.toUpperCase();
  if (typeof out.pincode === "string") out.pincode = out.pincode.replace(/\s+/g, "");
  if (typeof out.name === "string") out.name = out.name.trim();
  return out as T;
}
