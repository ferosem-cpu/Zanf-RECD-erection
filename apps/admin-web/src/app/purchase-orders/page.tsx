"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/apiClient";
import { useAuth } from "@/components/AuthContext";
import { formatINR, formatDate, PO_STATUS_LABEL, statusPillClass } from "@/lib/finance";

interface PoRow {
  id: string;
  poNumber: string;
  status: string;
  orderDate: string;
  total: string;
  supplier: { id: string; name: string };
}
interface Supplier { id: string; name: string; gstin?: string | null; state?: string | null; }

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
  const [newSupplier, setNewSupplier] = useState({ name: "", gstin: "", state: "", contactName: "", contactPhone: "" });
  const [lines, setLines] = useState([{ description: "", hsnCode: "", quantity: "1", unitPrice: "", taxRatePct: "18" }]);

  function load() {
    api<PoRow[]>("/purchase-orders").then(setRows).catch((e) => setError(e instanceof Error ? e.message : "Failed"));
    if (canManage) api<Supplier[]>("/purchase-orders/suppliers").then(setSuppliers).catch(() => {});
  }
  useEffect(load, [canManage]);

  function addLine() { setLines((l) => [...l, { description: "", hsnCode: "", quantity: "1", unitPrice: "", taxRatePct: "18" }]); }
  function updateLine(i: number, patch: Partial<(typeof lines)[number]>) { setLines((l) => l.map((x, idx) => (idx === i ? { ...x, ...patch } : x))); }
  function removeLine(i: number) { setLines((l) => l.filter((_, idx) => idx !== i)); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setFormError(null);
    try {
      if (!supplierId) throw new Error("Please choose or create a supplier");
      await api("/purchase-orders", { method: "POST", body: JSON.stringify({
        supplierId,
        orderDate: new Date().toISOString(),
        lineItems: lines.map((l) => ({
          description: l.description, hsnCode: l.hsnCode || undefined,
          quantity: parseFloat(l.quantity) || 0, unitPrice: parseFloat(l.unitPrice) || 0, taxRatePct: parseFloat(l.taxRatePct) || 18,
        })),
      }) });
      setOpen(false);
      setLines([{ description: "", hsnCode: "", quantity: "1", unitPrice: "", taxRatePct: "18" }]);
      load();
    } catch (err) { setFormError(err instanceof Error ? err.message : "Failed"); }
    finally { setSaving(false); }
  }
  async function createSupplier() {
    try {
      const s = await api<Supplier>("/purchase-orders/suppliers", { method: "POST", body: JSON.stringify(newSupplier) });
      setSuppliers((prev) => [...prev, s]);
      setSupplierId(s.id);
      setNewSupplierOpen(false);
      setNewSupplier({ name: "", gstin: "", state: "", contactName: "", contactPhone: "" });
    } catch (err) { setFormError(err instanceof Error ? err.message : "Failed"); }
  }

  return (
    <div className="space-y-6 max-w-6xl" data-testid="purchase-orders-page">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight" style={{ color: "var(--text-heading)" }}>Purchase Orders</h1>
          <p className="mt-1 text-sm text-gray-500">Supplier POs, bills and payments made.</p>
        </div>
        {canManage && <button onClick={() => setOpen(true)} className="btn-primary px-4 py-2 text-sm self-start sm:self-auto">+ New PO</button>}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="card overflow-hidden table-desktop">
        <div className="table-scroll">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                <th className="px-4 py-3">PO #</th>
                <th className="px-4 py-3">Supplier</th>
                <th className="px-4 py-3">Order date</th>
                <th className="px-4 py-3">Total</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50/60">
                  <td className="px-4 py-3 font-mono text-xs font-semibold"><Link href={`/purchase-orders/${r.id}`} className="text-[var(--theme-accent)] hover:underline">{r.poNumber}</Link></td>
                  <td className="px-4 py-3">{r.supplier.name}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{formatDate(r.orderDate)}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{formatINR(r.total)}</td>
                  <td className="px-4 py-3"><span className={statusPillClass(r.status)}>{PO_STATUS_LABEL[r.status] ?? r.status}</span></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No purchase orders yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="cards-mobile">
        {rows.length === 0 ? (
          <div className="card p-6 text-center text-sm text-gray-400">No purchase orders yet.</div>
        ) : rows.map((r) => (
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
                    <input required placeholder="Supplier name" className="field w-full" value={newSupplier.name} onChange={(e) => setNewSupplier({ ...newSupplier, name: e.target.value })} />
                    <div className="grid grid-cols-2 gap-2">
                      <input placeholder="GSTIN" className="field" value={newSupplier.gstin} onChange={(e) => setNewSupplier({ ...newSupplier, gstin: e.target.value })} />
                      <input placeholder="State" className="field" value={newSupplier.state} onChange={(e) => setNewSupplier({ ...newSupplier, state: e.target.value })} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input placeholder="Contact name" className="field" value={newSupplier.contactName} onChange={(e) => setNewSupplier({ ...newSupplier, contactName: e.target.value })} />
                      <input placeholder="Contact phone" className="field" value={newSupplier.contactPhone} onChange={(e) => setNewSupplier({ ...newSupplier, contactPhone: e.target.value })} />
                    </div>
                    <button type="button" onClick={createSupplier} className="text-xs font-medium text-[var(--theme-accent)]">Save supplier</button>
                  </div>
                ) : (
                  <select required className="field w-full" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                    <option value="">Select a supplier</option>
                    {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Line items</label>
                  <button type="button" onClick={addLine} className="text-xs font-medium text-[var(--theme-accent)]">+ Add line</button>
                </div>
                <div className="space-y-2">
                  {lines.map((l, i) => (
                    <div key={i} className="rounded-lg border border-gray-200 p-3 space-y-2">
                      <input className="field" placeholder="Description" value={l.description} onChange={(e) => updateLine(i, { description: e.target.value })} required />
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
