"use client";

import type { SupplierFormValues } from "@/lib/supplier";

/** The supplier form fields (name, GSTIN, PAN, state, address lines, city, PIN, contact).
 * Used by the "+ New supplier" panel in the PO form and by the Suppliers page. */
export default function SupplierFields({
  value,
  onChange,
}: {
  value: SupplierFormValues;
  onChange: (next: SupplierFormValues) => void;
}) {
  const set = (patch: Partial<SupplierFormValues>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-2">
      <input required placeholder="Supplier name *" className="field w-full" value={value.name} onChange={(e) => set({ name: e.target.value })} />
      <div className="grid grid-cols-2 gap-2">
        <input placeholder="GSTIN" className="field" value={value.gstin} onChange={(e) => set({ gstin: e.target.value.toUpperCase() })} maxLength={20} />
        <input placeholder="PAN" className="field" value={value.pan} onChange={(e) => set({ pan: e.target.value.toUpperCase() })} maxLength={20} />
      </div>
      <input placeholder="Address line 1 (building, street)" className="field w-full" value={value.address} onChange={(e) => set({ address: e.target.value })} />
      <input placeholder="Address line 2 (area, landmark)" className="field w-full" value={value.addressLine2} onChange={(e) => set({ addressLine2: e.target.value })} />
      <div className="grid grid-cols-3 gap-2">
        <input placeholder="City" className="field" value={value.city} onChange={(e) => set({ city: e.target.value })} />
        <input placeholder="PIN code" className="field" inputMode="numeric" value={value.pincode} onChange={(e) => set({ pincode: e.target.value })} maxLength={7} />
        <input placeholder="State (e.g. Tamil Nadu)" className="field" value={value.state} onChange={(e) => set({ state: e.target.value })} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <input placeholder="Contact name" className="field" value={value.contactName} onChange={(e) => set({ contactName: e.target.value })} />
        <input placeholder="Phone" className="field" value={value.contactPhone} onChange={(e) => set({ contactPhone: e.target.value })} />
        <input type="email" placeholder="Email" className="field" value={value.contactEmail} onChange={(e) => set({ contactEmail: e.target.value })} />
      </div>
    </div>
  );
}
