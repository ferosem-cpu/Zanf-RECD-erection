"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/apiClient";
import { useAuth } from "@/components/AuthContext";
import { formatINR, formatDate, QUOTATION_STATUS_LABEL, statusPillClass } from "@/lib/finance";
import { DataTable } from "@/components/DataTable";

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
  // This customer's negotiated product prices (productId -> price), fetched whenever
  // form.customerId changes - used to auto-fill an empty unitPrice when a product is picked,
  // same "only fill if still empty" guard as the description auto-fill below.
  const [customerProductPrices, setCustomerProductPrices] = useState<Record<string, string>>({});

  function load() {
    api<QuotationRow[]>("/quotations").then(setRows).catch((e) => setError(e instanceof Error ? e.message : "Failed"));
    if (canManage) {
      api<Product[]>("/meta/products").then(setProducts).catch(() => {});
      // Customers require manage_orders; finance may not have it, so fall back to a customer list endpoint if available.
      api<Customer[]>("/customers").then(setCustomers).catch(() => {});
    }
  }
  useEffect(load, [canManage]);

  useEffect(() => {
    if (!form.customerId) {
      setCustomerProductPrices({});
      return;
    }
    api<{ products: { productId: string; price: string }[] }>(`/customer-pricing?customerId=${form.customerId}`)
      .then((data) => setCustomerProductPrices(Object.fromEntries(data.products.map((p) => [p.productId, p.price]))))
      .catch(() => setCustomerProductPrices({}));
  }, [form.customerId]);

  async function remove(id: string) {
    if (!confirm("Delete this quotation? This can't be undone.")) return;
    try {
      await api(`/quotations/${id}`, { method: "DELETE" });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete quotation");
    }
  }

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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 print:hidden">
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

      {error && <p className="text-sm text-red-600 print:hidden">{error}</p>}

      <DataTable
        storageKey="quotations"
        title="Quotations"
        rows={rows}
        rowKey={(r) => r.id}
        emptyMessage="No quotations yet."
        columns={[
          {
            key: "quoteNumber",
            label: "Quote #",
            accessor: (r) => r.quoteNumber,
            filterType: "text",
            alwaysVisible: true,
            render: (r) => <Link href={`/quotations/${r.id}`} className="font-mono text-xs font-semibold text-[var(--theme-accent)] hover:underline">{r.quoteNumber}</Link>,
          },
          { key: "customer", label: "Customer", accessor: (r) => r.customer.name },
          { key: "issueDate", label: "Issue date", accessor: (r) => formatDate(r.issueDate), filterType: "text" },
          { key: "total", label: "Total", accessor: (r) => r.total, filterType: "text", render: (r) => formatINR(r.total) },
          { key: "status", label: "Status", accessor: (r) => QUOTATION_STATUS_LABEL[r.status] ?? r.status, render: (r) => <span className={statusPillClass(r.status)}>{QUOTATION_STATUS_LABEL[r.status] ?? r.status}</span> },
          ...(canManage
            ? [
                {
                  key: "actions",
                  label: "",
                  align: "right" as const,
                  alwaysVisible: true,
                  filterable: false,
                  render: (r: QuotationRow) => <button onClick={() => remove(r.id)} className="text-xs text-red-500">Delete</button>,
                },
              ]
            : []),
        ]}
      >
        {(filteredRows) => (
          <div className="cards-mobile">
            {filteredRows.length === 0 ? (
              <div className="card p-6 text-center text-sm text-gray-400">
                {rows.length === 0 ? "No quotations yet." : "No rows match the current filters."}
              </div>
            ) : (
              filteredRows.map((r) => (
                <div key={r.id} className="data-card">
                  <Link href={`/quotations/${r.id}`} className="block">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <span className="font-mono text-xs font-semibold text-gray-900">{r.quoteNumber}</span>
                      <span className={statusPillClass(r.status)}>{QUOTATION_STATUS_LABEL[r.status] ?? r.status}</span>
                    </div>
                    <p className="text-sm font-semibold text-gray-900 truncate">{r.customer.name}</p>
                    <div className="data-card-row"><span className="label">Total</span><span className="value font-semibold">{formatINR(r.total)}</span></div>
                  </Link>
                  {canManage && (
                    <div className="mt-2 text-right">
                      <button onClick={() => remove(r.id)} className="text-xs text-red-500">Delete</button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </DataTable>

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
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <select
                          className="field"
                          value={l.productId}
                          onChange={(e) => {
                            const pid = e.target.value;
                            const p = products.find((x) => x.id === pid);
                            updateLine(i, {
                              productId: pid,
                              description: p && !l.description ? `${p.name} (${p.model})` : l.description,
                              unitPrice: p && customerProductPrices[pid] && !l.unitPrice ? customerProductPrices[pid] : l.unitPrice,
                            });
                          }}
                        >
                          <option value="">No product (free text line)</option>
                          {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.model})</option>)}
                        </select>
                        <input className="field" placeholder="Description" value={l.description} onChange={(e) => updateLine(i, { description: e.target.value })} required />
                        <input className="field" placeholder="HSN" value={l.hsnCode} onChange={(e) => updateLine(i, { hsnCode: e.target.value })} required />
                      </div>
                      {!l.productId && (
                        <p className="text-[11px] text-amber-600">No product selected — this line can't be converted into an order later. Pick a product if this quotation might turn into an order.</p>
                      )}
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
