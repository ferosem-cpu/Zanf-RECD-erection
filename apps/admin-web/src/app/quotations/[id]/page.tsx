"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { api } from "@/lib/apiClient";
import { useAuth } from "@/components/AuthContext";
import { formatINR, formatDate, QUOTATION_STATUS_LABEL, statusPillClass } from "@/lib/finance";

interface LineItem {
  id: string;
  productId?: string | null;
  description: string;
  hsnCode?: string | null;
  quantity: string;
  unitPrice: string;
  discountPct: string;
  taxRatePct: string;
  lineTotal: string;
}
interface QuotationDetail {
  id: string;
  quoteNumber: string;
  status: string;
  issueDate: string;
  validUntil?: string | null;
  placeOfSupply?: string | null;
  subtotal: string;
  discountAmount: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  total: string;
  notes?: string | null;
  terms?: string | null;
  customer: { id: string; name: string };
  convertedOrderId?: string | null;
  lineItems: LineItem[];
  invoices: { id: string; invoiceNumber: string; docType: string; status: string }[];
}
interface Customer { id: string; name: string; state?: string | null; }
interface Product { id: string; name: string; model: string; }
type EditLine = { productId: string; description: string; hsnCode: string; quantity: string; unitPrice: string; discountPct: string; taxRatePct: string };

export default function QuotationDetailPage() {
  const router = useRouter();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("manage_quotations");

  const [q, setQ] = useState<QuotationDetail | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const { id } = useParams<{ id: string }>();

  function load() {
    if (!id) return;
    setError(null);
    api<QuotationDetail>(`/quotations/${id}`).then(setQ).catch((e) => setError(e instanceof Error ? e.message : "Failed"));
    if (canManage) {
      api<Customer[]>("/customers").then(setCustomers).catch(() => {});
      api<Product[]>("/meta/products").then(setProducts).catch(() => {});
    }
  }
  useEffect(load, [id, canManage]);

  async function doStatus(status: string) {
    setAction(status);
    setMsg(null);
    try {
      await api(`/quotations/${id}/status`, { method: "POST", body: JSON.stringify({ status }) });
      setMsg(`Quotation marked ${status}.`);
      load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setAction(null);
    }
  }
  async function convert() {
    setAction("convert");
    setMsg(null);
    try {
      const order = await api<{ orderNumber: string }>(`/quotations/${id}/convert-to-order`, { method: "POST", body: "{}" });
      setMsg(`Order ${order.orderNumber} created from this quotation.`);
      load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setAction(null);
    }
  }
  async function createInvoice(docType: "proforma" | "tax_invoice") {
    setAction("invoice-" + docType);
    setMsg(null);
    try {
      await api(`/quotations/${id}/create-invoice`, { method: "POST", body: JSON.stringify({ docType }) });
      setMsg(`${docType === "proforma" ? "Proforma" : "Tax invoice"} created from this quotation.`);
      load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setAction(null);
    }
  }

  // Editing - only draft quotations can be edited (enforced server-side too); once sent,
  // corrections should go through a fresh revision rather than a silent rewrite.
  const [editOpen, setEditOpen] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ customerId: "", placeOfSupply: "", validUntil: "", notes: "", terms: "" });
  const [editLines, setEditLines] = useState<EditLine[]>([]);

  function openEdit() {
    if (!q) return;
    setEditError(null);
    setEditForm({
      customerId: q.customer.id,
      placeOfSupply: q.placeOfSupply ?? "",
      validUntil: q.validUntil ? q.validUntil.slice(0, 10) : "",
      notes: q.notes ?? "",
      terms: q.terms ?? "",
    });
    setEditLines(q.lineItems.map((l) => ({
      productId: l.productId ?? "",
      description: l.description,
      hsnCode: l.hsnCode ?? "",
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discountPct: l.discountPct,
      taxRatePct: l.taxRatePct,
    })));
    setEditOpen(true);
  }
  function addEditLine() {
    setEditLines((l) => [...l, { productId: "", description: "", hsnCode: "", quantity: "1", unitPrice: "", discountPct: "0", taxRatePct: "18" }]);
  }
  function updateEditLine(i: number, patch: Partial<EditLine>) {
    setEditLines((l) => l.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  }
  function removeEditLine(i: number) {
    setEditLines((l) => l.filter((_, idx) => idx !== i));
  }
  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!q) return;
    setEditError(null);
    setAction("edit");
    try {
      await api(`/quotations/${id}`, { method: "PUT", body: JSON.stringify({
        customerId: editForm.customerId,
        placeOfSupply: editForm.placeOfSupply || undefined,
        validUntil: editForm.validUntil ? new Date(editForm.validUntil).toISOString() : undefined,
        notes: editForm.notes || undefined,
        terms: editForm.terms || undefined,
        lineItems: editLines.map((l) => ({
          productId: l.productId || undefined,
          description: l.description,
          hsnCode: l.hsnCode || undefined,
          quantity: parseFloat(l.quantity) || 0,
          unitPrice: parseFloat(l.unitPrice) || 0,
          discountPct: parseFloat(l.discountPct) || 0,
          taxRatePct: parseFloat(l.taxRatePct) || 18,
        })),
      }) });
      setEditOpen(false);
      setMsg("Quotation updated."); load();
    } catch (err) { setEditError(err instanceof Error ? err.message : "Failed to update quotation"); } finally { setAction(null); }
  }

  if (error) return <p className="text-sm text-red-600 p-4">{error}</p>;
  if (!q) return <p className="text-sm text-gray-500 p-4">Loading…</p>;

  return (
    <div className="space-y-6 max-w-4xl" data-testid="quotation-detail">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <LinkBack />
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight mt-1" style={{ color: "var(--text-heading)" }}>{q.quoteNumber}</h1>
          <p className="text-sm text-gray-500">{q.customer.name} · Issued {formatDate(q.issueDate)}</p>
        </div>
        <span className={statusPillClass(q.status)}>{QUOTATION_STATUS_LABEL[q.status] ?? q.status}</span>
      </div>

      {msg && <div className="rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-700">{msg}</div>}

      <div className="card overflow-hidden">
        <div className="table-scroll">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3">HSN</th>
                <th className="px-4 py-3">Qty</th>
                <th className="px-4 py-3">Unit price</th>
                <th className="px-4 py-3">Tax %</th>
                <th className="px-4 py-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {q.lineItems.map((l) => (
                <tr key={l.id}>
                  <td className="px-4 py-3">{l.description}</td>
                  <td className="px-4 py-3 text-gray-500">{l.hsnCode ?? "-"}</td>
                  <td className="px-4 py-3">{l.quantity}</td>
                  <td className="px-4 py-3">{formatINR(l.unitPrice)}</td>
                  <td className="px-4 py-3">{l.taxRatePct}%</td>
                  <td className="px-4 py-3 text-right font-medium">{formatINR(l.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t px-4 py-3 space-y-1 text-sm">
          <Row label="Subtotal" value={formatINR(q.subtotal)} />
          <Row label="CGST" value={formatINR(q.cgstAmount)} />
          <Row label="SGST" value={formatINR(q.sgstAmount)} />
          <Row label="IGST" value={formatINR(q.igstAmount)} />
          <Row label="Total" value={formatINR(q.total)} bold />
        </div>
      </div>

      {q.notes && <p className="text-sm text-gray-600"><span className="font-medium">Notes: </span>{q.notes}</p>}

      {canManage && q.status === "draft" && (
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary px-4 py-2 text-sm" disabled={!!action} onClick={() => doStatus("sent")}>Mark sent</button>
          <button className="rounded-lg border border-gray-300 px-4 py-2 text-sm" disabled={!!action} onClick={openEdit}>Edit quotation</button>
        </div>
      )}
      {canManage && q.status === "sent" && (
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary px-4 py-2 text-sm" disabled={!!action} onClick={() => doStatus("accepted")}>Mark accepted</button>
          <button className="rounded-lg border border-gray-300 px-4 py-2 text-sm" disabled={!!action} onClick={() => doStatus("rejected")}>Reject</button>
        </div>
      )}
      {canManage && q.status === "accepted" && (
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary px-4 py-2 text-sm" disabled={!!action} onClick={convert}>Convert to order</button>
          <button className="rounded-lg border border-gray-300 px-4 py-2 text-sm" disabled={!!action} onClick={() => createInvoice("proforma")}>Create proforma</button>
          <button className="rounded-lg border border-gray-300 px-4 py-2 text-sm" disabled={!!action} onClick={() => createInvoice("tax_invoice")}>Create tax invoice</button>
        </div>
      )}

      {q.invoices.length > 0 && (
        <div className="card p-4">
          <h2 className="text-sm font-semibold mb-2">Linked invoices</h2>
          <ul className="text-sm space-y-1">
            {q.invoices.map((inv) => (
              <li key={inv.id}>
                <a href={`/invoices/${inv.id}`} className="text-[var(--theme-accent)] hover:underline">{inv.invoiceNumber}</a> · {inv.docType} · {inv.status}
              </li>
            ))}
          </ul>
        </div>
      )}

      <button onClick={() => router.push(`/quotations/${q.id}/print`)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm">Print</button>

      {editOpen && q && (
        <div className="modal-backdrop" onClick={() => setEditOpen(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Edit quotation</h3>
              <button onClick={() => setEditOpen(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <form onSubmit={saveEdit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Customer</label>
                  <select required className="field w-full" value={editForm.customerId} onChange={(e) => {
                    const cid = e.target.value;
                    const c = customers.find((x) => x.id === cid);
                    setEditForm({ ...editForm, customerId: cid, placeOfSupply: c?.state ?? editForm.placeOfSupply });
                  }}>
                    {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Place of supply (state)</label>
                  <input className="field w-full" value={editForm.placeOfSupply} onChange={(e) => setEditForm({ ...editForm, placeOfSupply: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Valid until</label>
                  <input type="date" className="field w-full" value={editForm.validUntil} onChange={(e) => setEditForm({ ...editForm, validUntil: e.target.value })} />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Line items</label>
                  <button type="button" onClick={addEditLine} className="text-xs font-medium text-[var(--theme-accent)]">+ Add line</button>
                </div>
                <div className="space-y-2">
                  {editLines.map((l, i) => (
                    <div key={i} className="rounded-lg border border-gray-200 p-3 space-y-2">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <select
                          className="field"
                          value={l.productId}
                          onChange={(e) => {
                            const pid = e.target.value;
                            const p = products.find((x) => x.id === pid);
                            updateEditLine(i, {
                              productId: pid,
                              description: p && !l.description ? `${p.name} (${p.model})` : l.description,
                            });
                          }}
                        >
                          <option value="">No product (free text line)</option>
                          {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.model})</option>)}
                        </select>
                        <input className="field" placeholder="Description" value={l.description} onChange={(e) => updateEditLine(i, { description: e.target.value })} required />
                        <input className="field" placeholder="HSN" value={l.hsnCode} onChange={(e) => updateEditLine(i, { hsnCode: e.target.value })} required />
                      </div>
                      {!l.productId && (
                        <p className="text-[11px] text-amber-600">No product selected — this line can't be converted into an order later. Pick a product if this quotation might turn into an order.</p>
                      )}
                      <div className="grid grid-cols-4 gap-2">
                        <input type="number" step="0.01" className="field" placeholder="Qty" value={l.quantity} onChange={(e) => updateEditLine(i, { quantity: e.target.value })} />
                        <input type="number" step="0.01" className="field" placeholder="Unit price" value={l.unitPrice} onChange={(e) => updateEditLine(i, { unitPrice: e.target.value })} />
                        <input type="number" step="0.01" className="field" placeholder="Discount %" value={l.discountPct} onChange={(e) => updateEditLine(i, { discountPct: e.target.value })} />
                        <input type="number" step="0.01" className="field" placeholder="Tax %" value={l.taxRatePct} onChange={(e) => updateEditLine(i, { taxRatePct: e.target.value })} />
                      </div>
                      <button type="button" onClick={() => removeEditLine(i)} className="text-xs text-red-500">Remove</button>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
                <textarea className="field w-full" rows={2} value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Terms</label>
                <textarea className="field w-full" rows={2} value={editForm.terms} onChange={(e) => setEditForm({ ...editForm, terms: e.target.value })} />
              </div>

              {editError && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{editError}</p>}
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setEditOpen(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={!!action} className="btn-primary px-4 py-2 text-sm">{action === "edit" ? "Saving…" : "Save changes"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function LinkBack() {
  return (
    <a href="/quotations" className="text-xs text-gray-500 hover:text-gray-700">← Back to quotations</a>
  );
}
function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-500">{label}</span>
      <span className={bold ? "font-semibold" : ""}>{value}</span>
    </div>
  );
}
