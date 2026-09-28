"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/apiClient";
import { useAuth } from "@/components/AuthContext";
import { formatINR, formatDate, PO_STATUS_LABEL, statusPillClass } from "@/lib/finance";
import { DataTable } from "@/components/DataTable";
import SupplierFields from "@/components/SupplierFields";
import { DEFAULT_PO_SHIP_TO_ADDRESS, DEFAULT_PO_PLACE_OF_SUPPLY } from "@recd/shared";
import { EMPTY_SUPPLIER_FORM, poTaxMode, supplierAddressLines, type Supplier, type SupplierFormValues } from "@/lib/supplier";

interface PoRow {
  id: string;
  poNumber: string;
  status: string;
  orderDate: string;
  total: string;
  supplier: { id: string; name: string };
}

const todayIso = () => new Date().toISOString().slice(0, 10);
const emptyHeader = () => ({
  orderDate: todayIso(),
  expectedDate: "",
  vendorQuoteRef: "",
  vendorQuoteDate: "",
  shipToAddress: DEFAULT_PO_SHIP_TO_ADDRESS,
  placeOfSupply: DEFAULT_PO_PLACE_OF_SUPPLY,
  paymentTerms: "",
  notes: "",
});
/** yyyy-mm-dd from a date input -> ISO datetime the API's z.string().datetime() accepts. */
const dateToIso = (d: string) => (d ? new Date(`${d}T00:00:00`).toISOString() : undefined);

export default function PurchaseOrdersPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("manage_purchase_orders");

  const [rows, setRows] = useState<PoRow[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState("");
  const [newSupplierOpen, setNewSupplierOpen] = useState(false);
  const [newSupplier, setNewSupplier] = useState<SupplierFormValues>(EMPTY_SUPPLIER_FORM);
  const [savingSupplier, setSavingSupplier] = useState(false);
  const [header, setHeader] = useState(emptyHeader);
  const [lines, setLines] = useState([{ description: "", hsnCode: "", quantity: "1", unitPrice: "", taxRatePct: "18" }]);

  function load() {
    api<PoRow[]>("/purchase-orders").then(setRows).catch((e) => setError(e instanceof Error ? e.message : "Failed"));
    if (canManage) api<Supplier[]>("/purchase-orders/suppliers").then(setSuppliers).catch(() => {});
  }
  useEffect(load, [canManage]);

  // "Edit supplier details" opens the Suppliers page in a new tab; pick up any edits made
  // there when the user comes back to this tab with the PO form still open.
  useEffect(() => {
    if (!open || !canManage) return;
    const refresh = () => { api<Supplier[]>("/purchase-orders/suppliers").then(setSuppliers).catch(() => {}); };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [open, canManage]);

  function addLine() { setLines((l) => [...l, { description: "", hsnCode: "", quantity: "1", unitPrice: "", taxRatePct: "18" }]); }
  function updateLine(i: number, patch: Partial<(typeof lines)[number]>) { setLines((l) => l.map((x, idx) => (idx === i ? { ...x, ...patch } : x))); }
  function removeLine(i: number) { setLines((l) => l.filter((_, idx) => idx !== i)); }

  const selectedSupplier = suppliers.find((s) => s.id === supplierId) ?? null;
  const taxMode = poTaxMode(selectedSupplier?.state, header.placeOfSupply);

  function openNew() {
    setFormError(null);
    setHeader(emptyHeader());
    setOpen(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setFormError(null);
    try {
      if (!supplierId) throw new Error(newSupplierOpen ? "Save the new supplier first (Save supplier), then create the PO" : "Please choose or create a supplier");
      await api("/purchase-orders", { method: "POST", body: JSON.stringify({
        supplierId,
        orderDate: dateToIso(header.orderDate) ?? new Date().toISOString(),
        expectedDate: dateToIso(header.expectedDate),
        vendorQuoteRef: header.vendorQuoteRef || undefined,
        vendorQuoteDate: dateToIso(header.vendorQuoteDate),
        shipToAddress: header.shipToAddress || undefined,
        placeOfSupply: header.placeOfSupply || undefined,
        paymentTerms: header.paymentTerms || undefined,
        notes: header.notes || undefined,
        lineItems: lines.map((l) => ({
          description: l.description, hsnCode: l.hsnCode || undefined,
          quantity: parseFloat(l.quantity) || 0, unitPrice: parseFloat(l.unitPrice) || 0, taxRatePct: parseFloat(l.taxRatePct) || 18,
        })),
      }) });
      setOpen(false);
      setLines([{ description: "", hsnCode: "", quantity: "1", unitPrice: "", taxRatePct: "18" }]);
      setHeader(emptyHeader());
      load();
    } catch (err) { setFormError(err instanceof Error ? err.message : "Failed"); }
    finally { setSaving(false); }
  }
  async function createSupplier() {
    if (!newSupplier.name.trim()) { setFormError("Supplier name is required"); return; }
    setSavingSupplier(true); setFormError(null);
    try {
      const s = await api<Supplier>("/purchase-orders/suppliers", { method: "POST", body: JSON.stringify(newSupplier) });
      setSuppliers((prev) => [...prev, s].sort((a, b) => a.name.localeCompare(b.name)));
      setSupplierId(s.id);
      setNewSupplierOpen(false);
      setNewSupplier(EMPTY_SUPPLIER_FORM);
    } catch (err) { setFormError(err instanceof Error ? err.message : "Failed"); }
    finally { setSavingSupplier(false); }
  }

  return (
    <div className="space-y-6 max-w-6xl" data-testid="purchase-orders-page">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight" style={{ color: "var(--text-heading)" }}>Purchase Orders</h1>
          <p className="mt-1 text-sm text-gray-500">Supplier POs, bills and payments made.</p>
        </div>
        {canManage && (
          <div className="flex gap-2 self-start sm:self-auto">
            <Link href="/purchase-orders/suppliers" className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Suppliers</Link>
            <button onClick={openNew} className="btn-primary px-4 py-2 text-sm">+ New PO</button>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-600 print:hidden">{error}</p>}

      <DataTable
        storageKey="purchase-orders"
        title="Purchase Orders"
        rows={rows}
        rowKey={(r) => r.id}
        emptyMessage="No purchase orders yet."
        columns={[
          {
            key: "poNumber",
            label: "PO #",
            accessor: (r) => r.poNumber,
            filterType: "text",
            alwaysVisible: true,
            render: (r) => <Link href={`/purchase-orders/${r.id}`} className="font-mono text-xs font-semibold text-[var(--theme-accent)] hover:underline">{r.poNumber}</Link>,
          },
          { key: "supplier", label: "Supplier", accessor: (r) => r.supplier.name },
          { key: "orderDate", label: "Order date", accessor: (r) => formatDate(r.orderDate), filterType: "text" },
          { key: "total", label: "Total", accessor: (r) => r.total, filterType: "text", render: (r) => formatINR(r.total) },
          { key: "status", label: "Status", accessor: (r) => PO_STATUS_LABEL[r.status] ?? r.status, render: (r) => <span className={statusPillClass(r.status)}>{PO_STATUS_LABEL[r.status] ?? r.status}</span> },
        ]}
      >
        {(filteredRows) => (
          <div className="cards-mobile">
            {filteredRows.length === 0 ? (
              <div className="card p-6 text-center text-sm text-gray-400">
                {rows.length === 0 ? "No purchase orders yet." : "No rows match the current filters."}
              </div>
            ) : filteredRows.map((r) => (
              <Link key={r.id} href={`/purchase-orders/${r.id}`} className="data-card block">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <span className="font-mono text-xs font-semibold text-gray-900">{r.poNumber}</span>
                  <span className={statusPillClass(r.status)}>{PO_STATUS_LABEL[r.status] ?? r.status}</span>
                </div>
                <p className="text-sm font-semibold text-gray-900 truncate">{r.supplier.name}</p>
                <div className="data-card-row"><span className="label">Total</span><span className="value font-semibold">{formatINR(r.total)}</span></div>
              </Link>
            ))}
          </div>
        )}
      </DataTable>

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">New purchase order</h3>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="block text-xs font-medium text-gray-500">Supplier</label>
                  <button type="button" onClick={() => setNewSupplierOpen((v) => !v)} className="text-xs font-medium text-[var(--theme-accent)]">{newSupplierOpen ? "Choose existing" : "+ New supplier"}</button>
                </div>
                {newSupplierOpen ? (
                  <div className="space-y-2 rounded-lg border border-gray-200 p-3">
                    <SupplierFields value={newSupplier} onChange={setNewSupplier} />
                    <button type="button" onClick={createSupplier} disabled={savingSupplier} className="btn-primary px-3 py-1.5 text-xs">{savingSupplier ? "Saving…" : "Save supplier"}</button>
                  </div>
                ) : (
                  <>
                    <select required className="field w-full" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                      <option value="">Select a supplier</option>
                      {suppliers.filter((s) => s.isActive !== false || s.id === supplierId).map((s) => <option key={s.id} value={s.id}>{s.name}{s.city ? ` — ${s.city}` : ""}</option>)}
                    </select>
                    {selectedSupplier && (
                      <div className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600" data-testid="po-supplier-preview">
                        {supplierAddressLines(selectedSupplier).map((l, i) => <div key={i}>{l}</div>)}
                        {selectedSupplier.gstin && <div className="font-medium text-gray-700">GSTIN: {selectedSupplier.gstin}</div>}
                        {supplierAddressLines(selectedSupplier).length === 0 && <div className="text-amber-700">No address on file for this supplier yet.</div>}
                        <Link href={`/purchase-orders/suppliers?edit=${selectedSupplier.id}`} target="_blank" className="mt-1 inline-block font-medium text-[var(--theme-accent)]">Edit supplier details</Link>
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">PO date</label>
                  <input type="date" required className="field w-full" value={header.orderDate} onChange={(e) => setHeader({ ...header, orderDate: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Expected delivery</label>
                  <input type="date" className="field w-full" value={header.expectedDate} onChange={(e) => setHeader({ ...header, expectedDate: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Vendor quotation no.</label>
                  <input className="field w-full" placeholder="e.g. PASQ/1611/26-27" value={header.vendorQuoteRef} onChange={(e) => setHeader({ ...header, vendorQuoteRef: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Vendor quotation date</label>
                  <input type="date" className="field w-full" value={header.vendorQuoteDate} onChange={(e) => setHeader({ ...header, vendorQuoteDate: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Place of supply</label>
                  <input className="field w-full" placeholder="e.g. Tamil Nadu" value={header.placeOfSupply} onChange={(e) => setHeader({ ...header, placeOfSupply: e.target.value })} />
                  <p className="mt-1 text-[11px] text-gray-400">
                    Tax: {taxMode === "inter" ? "IGST (supplier state differs from place of supply)" : "CGST + SGST"}
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Payment terms</label>
                  <input className="field w-full" placeholder="e.g. 100% against delivery" value={header.paymentTerms} onChange={(e) => setHeader({ ...header, paymentTerms: e.target.value })} />
                </div>
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="block text-xs font-medium text-gray-500">Ship to / delivery address</label>
                  {header.shipToAddress !== DEFAULT_PO_SHIP_TO_ADDRESS && (
                    <button type="button" onClick={() => setHeader({ ...header, shipToAddress: DEFAULT_PO_SHIP_TO_ADDRESS })} className="text-xs font-medium text-[var(--theme-accent)]">Use Zan-F address</button>
                  )}
                </div>
                <textarea className="field w-full text-xs" rows={5} value={header.shipToAddress} onChange={(e) => setHeader({ ...header, shipToAddress: e.target.value })} />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Line items</label>
                  <button type="button" onClick={addLine} className="text-xs font-medium text-[var(--theme-accent)]">+ Add line</button>
                </div>
                <div className="space-y-2">
                  {lines.map((l, i) => (
                    <div key={i} className="rounded-lg border border-gray-200 p-3 space-y-2">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <input className="field" placeholder="Description" value={l.description} onChange={(e) => updateLine(i, { description: e.target.value })} required />
                        <input className="field" placeholder="SAC/HSN" value={l.hsnCode} onChange={(e) => updateLine(i, { hsnCode: e.target.value })} required />
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <input type="number" step="0.01" className="field" placeholder="Qty" value={l.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} />
                        <input type="number" step="0.01" className="field" placeholder="Unit price" value={l.unitPrice} onChange={(e) => updateLine(i, { unitPrice: e.target.value })} />
                        <input type="number" step="0.01" className="field" placeholder="Tax %" value={l.taxRatePct} onChange={(e) => updateLine(i, { taxRatePct: e.target.value })} />
                      </div>
                      <button type="button" onClick={() => removeLine(i)} className="text-xs text-red-500">Remove</button>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
                <textarea className="field w-full" rows={2} value={header.notes} onChange={(e) => setHeader({ ...header, notes: e.target.value })} />
              </div>

              {formError && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{formError}</p>}
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary px-4 py-2 text-sm">{saving ? "Creating…" : "Create PO"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
