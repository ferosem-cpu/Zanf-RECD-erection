"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/apiClient";
import { useAuth } from "@/components/AuthContext";
import { formatINR, formatDate, INVOICE_STATUS_LABEL, statusPillClass } from "@/lib/finance";

interface InvoiceRow {
  id: string;
  invoiceNumber: string;
  docType: string;
  status: string;
  issueDate: string;
  dueDate?: string | null;
  total: string;
  amountPaid: string;
  balance: string;
  overdue: boolean;
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

export default function InvoicesPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("manage_invoices");

  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [docType, setDocType] = useState("");
  const [status, setStatus] = useState("");

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({
    docType: "proforma",
    customerId: "",
    placeOfSupply: "",
    issueDate: today(),
    dueDate: "",
    notes: "",
    terms: "",
  });
  const [lines, setLines] = useState([
    { productId: "", description: "", hsnCode: "", quantity: "1", unitPrice: "", discountPct: "0", taxRatePct: "18" },
  ]);

  function load() {
    const qs = new URLSearchParams();
    if (docType) qs.set("docType", docType);
    if (status) qs.set("status", status);
    const q = qs.toString();
    api<InvoiceRow[]>(`/invoices${q ? "?" + q : ""}`).then(setRows).catch((e) => setError(e instanceof Error ? e.message : "Failed"));
    if (canManage) {
      api<Product[]>("/meta/products").then(setProducts).catch(() => {});
      api<Customer[]>("/customers").then(setCustomers).catch(() => {});
    }
  }
  useEffect(load, [docType, status, canManage]);

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
        docType: form.docType,
        customerId: form.customerId,
        placeOfSupply: form.placeOfSupply || undefined,
        issueDate: new Date(form.issueDate).toISOString(),
        dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : undefined,
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
      await api("/invoices", { method: "POST", body: JSON.stringify(payload) });
      setOpen(false);
      setLines([{ productId: "", description: "", hsnCode: "", quantity: "1", unitPrice: "", discountPct: "0", taxRatePct: "18" }]);
      load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create invoice");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-6xl" data-testid="invoices-page">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight" style={{ color: "var(--text-heading)" }}>Invoices</h1>
          <p className="mt-1 text-sm text-gray-500">Proforma and tax invoices with payment status.</p>
        </div>
        {canManage && (
          <button data-testid="invoices-new-button" onClick={() => setOpen(true)} className="btn-primary px-4 py-2 text-sm self-start sm:self-auto">
            + New invoice
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <select className="field w-auto" value={docType} onChange={(e) => setDocType(e.target.value)}>
          <option value="">All types</option>
          <option value="proforma">Proforma</option>
          <option value="tax_invoice">Tax invoice</option>
        </select>
        <select className="field w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="issued">Issued</option>
          <option value="partially_paid">Partially paid</option>
          <option value="paid">Paid</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="card overflow-hidden table-desktop">
        <div className="table-scroll">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                <th className="px-4 py-3">Invoice #</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Issue date</th>
                <th className="px-4 py-3">Total</th>
                <th className="px-4 py-3">Balance</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => (
                <tr key={r.id} className={r.overdue ? "bg-red-50/40 hover:bg-red-50/60" : "hover:bg-gray-50/60"}>
                  <td className="px-4 py-3 font-mono text-xs font-semibold"><Link href={`/invoices/${r.id}`} className="text-[var(--theme-accent)] hover:underline">{r.invoiceNumber}</Link></td>
                  <td className="px-4 py-3 text-gray-500">{r.docType === "tax_invoice" ? "Tax" : "Proforma"}</td>
                  <td className="px-4 py-3">{r.customer.name}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{formatDate(r.issueDate)}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{formatINR(r.total)}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{formatINR(r.balance)}</td>
                  <td className="px-4 py-3">
                    <span className={statusPillClass(r.status)}>{INVOICE_STATUS_LABEL[r.status] ?? r.status}</span>
                    {r.overdue && <span className="ml-2 text-xs text-red-600 font-medium">Overdue</span>}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No invoices yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="cards-mobile">
        {rows.length === 0 ? (
          <div className="card p-6 text-center text-sm text-gray-400">No invoices yet.</div>
        ) : (
          rows.map((r) => (
            <Link key={r.id} href={`/invoices/${r.id}`} className="data-card block">
              <div className="flex items-start justify-between gap-3 mb-2">
                <span className="font-mono text-xs font-semibold text-gray-900">{r.invoiceNumber}</span>
                <span className={statusPillClass(r.status)}>{INVOICE_STATUS_LABEL[r.status] ?? r.status}</span>
              </div>
              <p className="text-sm font-semibold text-gray-900 truncate">{r.customer.name}</p>
              <div className="data-card-row"><span className="label">Balance</span><span className="value font-semibold">{formatINR(r.balance)}</span></div>
            </Link>
          ))
        )}
      </div>

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">New invoice</h3>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Type</label>
                  <select className="field w-full" value={form.docType} onChange={(e) => setForm({ ...form, docType: e.target.value })}>
                    <option value="proforma">Proforma</option>
                    <option value="tax_invoice">Tax invoice</option>
                  </select>
                </div>
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
                  <label className="block text-xs font-medium text-gray-500 mb-1">Due date</label>
                  <input type="date" className="field w-full" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
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
                <button type="submit" disabled={saving} className="btn-primary px-4 py-2 text-sm">{saving ? "Creating…" : "Create invoice"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
