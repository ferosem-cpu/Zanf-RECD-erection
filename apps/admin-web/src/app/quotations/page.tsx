"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/apiClient";
import { useAuth } from "@/components/AuthContext";
import { formatINR, formatDate, QUOTATION_STATUS_LABEL, statusPillClass } from "@/lib/finance";

interface QuotationRow {
  id: string;
  quoteNumber: string;
  status: string;
  issueDate: string;
  validUntil?: string | null;
  total: string;
  customer: { id: string; name: string };
}

interface Customer {
  id: string;
  name: string;
  state?: string | null;
}

interface Product {
  id: string;
  name: string;
  model: string;
}

const today = () => new Date().toISOString().slice(0, 10);

export default function QuotationsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("manage_quotations");

  const [rows, setRows] = useState<QuotationRow[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({
    customerId: "",
    placeOfSupply: "",
    issueDate: today(),
    validUntil: "",
    notes: "",
    terms: "",
  });
  const [lines, setLines] = useState([
    { productId: "", description: "", hsnCode: "", quantity: "1", unitPrice: "", discountPct: "0", taxRatePct: "18" },
  ]);

  function load() {
    api<QuotationRow[]>("/quotations").then(setRows).catch((e) => setError(e instanceof Error ? e.message : "Failed"));
    if (canManage) {
      api<Product[]>("/meta/products").then(setProducts).catch(() => {});
      // Customers require manage_orders; finance may not have it, so fall back to a customer list endpoint if available.
      api<Customer[]>("/customers").then(setCustomers).catch(() => {});
    }
  }
  useEffect(load, [canManage]);

  function addLine() {
    setLines((l) => [...l, { productId: "", description: "", hsnCode: "", quantity: "1", unitPrice: "", discountPct: "0", taxRatePct: "18" }]);
  }
  function updateLine(i: number, patch: Partial<(typeof lines)[number]>) {
    setLines((l) => l.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  }
  function removeLine(i: number) {
    setLines((l) => l.filter((_, idx) => idx !== i));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      if (!form.customerId) throw new Error("Please choose a customer");
      const payload = {
        customerId: form.customerId,
        placeOfSupply: form.placeOfSupply || undefined,
        issueDate: new Date(form.issueDate).toISOString(),
        validUntil: form.validUntil ? new Date(form.validUntil).toISOString() : undefined,
        notes: form.notes || undefined,
        terms: form.terms || undefined,
        lineItems: lines.map((l) => ({
          productId: l.productId || undefined,
          description: l.description,
          hsnCode: l.hsnCode || undefined,
          quantity: parseFloat(l.quantity) || 0,
          unitPrice: parseFloat(l.unitPrice) || 0,
          discountPct: parseFloat(l.discountPct) || 0,
          taxRatePct: parseFloat(l.taxRatePct) || 18,
        })),
      };
      await api("/quotations", { method: "POST", body: JSON.stringify(payload) });
      setOpen(false);
      setLines([{ productId: "", description: "", hsnCode: "", quantity: "1", unitPrice: "", discountPct: "0", taxRatePct: "18" }]);
      load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create quotation");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-6xl" data-testid="quotations-page">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight" style={{ color: "var(--text-heading)" }}>Quotations</h1>
          <p className="mt-1 text-sm text-gray-500">Price quotes sent to customers before invoicing.</p>
        </div>
        {canManage && (
          <button data-testid="quotations-new-button" onClick={() => setOpen(true)} className="btn-primary px-4 py-2 text-sm self-start sm:self-auto">
            + New quotation
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="card overflow-hidden table-desktop">
        <div className="table-scroll">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                <th className="px-4 py-3">Quote #</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Issue date</th>
                <th className="px-4 py-3">Total</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50/60">
                  <td className="px-4 py-3 font-mono text-xs font-semibold"><Link href={`/quotations/${r.id}`} className="text-[var(--theme-accent)] hover:underline">{r.quoteNumber}</Link></td>
                  <td className="px-4 py-3">{r.customer.name}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{formatDate(r.issueDate)}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{formatINR(r.total)}</td>
                  <td className="px-4 py-3"><span className={statusPillClass(r.status)}>{QUOTATION_STATUS_LABEL[r.status] ?? r.status}</span></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No quotations yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="cards-mobile">
        {rows.length === 0 ? (
          <div className="card p-6 text-center text-sm text-gray-400">No quotations yet.</div>
        ) : (
          rows.map((r) => (
            <Link key={r.id} href={`/quotations/${r.id}`} className="data-card block">
              <div className="flex items-start justify-between gap-3 mb-2">
                <span className="font-mono text-xs font-semibold text-gray-900">{r.quoteNumber}</span>
                <span className={statusPillClass(r.status)}>{QUOTATION_STATUS_LABEL[r.status] ?? r.status}</span>
              </div>
              <p className="text-sm font-semibold text-gray-900 truncate">{r.customer.name}</p>
              <div className="data-card-row"><span className="label">Total</span><span className="value font-semibold">{formatINR(r.total)}</span></div>
            </Link>
          ))
        )}
      </div>

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">New quotation</h3>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Customer</label>
                  <select required className="field w-full" value={form.customerId} onChange={(e) => {
                    const cid = e.target.value;
                    const c = customers.find((x) => x.id === cid);
                    setForm({ ...form, customerId: cid, placeOfSupply: c?.state ?? form.placeOfSupply });
                  }}>
                    <option value="">Select a customer</option>
                    {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Place of supply (state)</label>
                  <input className="field w-full" value={form.placeOfSupply} onChange={(e) => setForm({ ...form, placeOfSupply: e.target.value })} placeholder="e.g. Tamil Nadu" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Issue date</label>
                  <input type="date" required className="field w-full" value={form.issueDate} onChange={(e) => setForm({ ...form, issueDate: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Valid until</label>
                  <input type="date" className="field w-full" value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} />
                </div>
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
                        <input className="field" placeholder="HSN" value={l.hsnCode} onChange={(e) => updateLine(i, { hsnCode: e.target.value })} />
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

              {formError && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{formError}</p>}
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary px-4 py-2 text-sm">{saving ? "Creating…" : "Create quotation"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
