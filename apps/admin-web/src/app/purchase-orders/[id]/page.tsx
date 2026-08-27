"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import { api } from "@/lib/apiClient";
import { useAuth } from "@/components/AuthContext";
import { formatINR, formatDate, PO_STATUS_LABEL, BILL_STATUS_LABEL, statusPillClass } from "@/lib/finance";

interface LineItem { id: string; description: string; hsnCode?: string | null; quantity: string; unitPrice: string; taxRatePct: string; lineTotal: string; }
interface Bill { id: string; billNumber: string; status: string; total: string; }
interface Supplier { id: string; name: string; }
type EditLine = { description: string; hsnCode: string; quantity: string; unitPrice: string; taxRatePct: string };
interface PoDetail {
  id: string;
  poNumber: string;
  status: string;
  orderDate: string;
  expectedDate?: string | null;
  subtotal: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  total: string;
  notes?: string | null;
  terms?: string | null;
  supplier: { id: string; name: string; gstin?: string | null; state?: string | null; address?: string | null };
  lineItems: LineItem[];
  bills: Bill[];
}

export default function PurchaseOrderDetailPage() {
  const router = useRouter();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("manage_purchase_orders");
  const canRecord = hasPermission("record_payments");

  const [po, setPo] = useState<PoDetail | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const { id } = useParams<{ id: string }>();

  function load() {
    if (!id) return;
    setError(null);
    api<PoDetail>(`/purchase-orders/${id}`).then(setPo).catch((e) => setError(e instanceof Error ? e.message : "Failed"));
    if (canManage) api<Supplier[]>("/purchase-orders/suppliers").then(setSuppliers).catch(() => {});
  }
  useEffect(load, [id, canManage]);

  async function doStatus(status: string) {
    setAction(status); setMsg(null);
    try { await api(`/purchase-orders/${id}/status`, { method: "POST", body: JSON.stringify({ status }) }); setMsg(`PO ${status}.`); load(); }
    catch (e) { setMsg(e instanceof Error ? e.message : "Failed"); } finally { setAction(null); }
  }

  // Editing - only draft POs can be edited (enforced server-side too).
  const [editOpen, setEditOpen] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ supplierId: "", expectedDate: "", notes: "", terms: "" });
  const [editLines, setEditLines] = useState<EditLine[]>([]);

  function openEdit() {
    if (!po) return;
    setEditError(null);
    setEditForm({
      supplierId: po.supplier.id,
      expectedDate: po.expectedDate ? po.expectedDate.slice(0, 10) : "",
      notes: po.notes ?? "",
      terms: po.terms ?? "",
    });
    setEditLines(po.lineItems.map((l) => ({
      description: l.description,
      hsnCode: l.hsnCode ?? "",
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      taxRatePct: l.taxRatePct,
    })));
    setEditOpen(true);
  }
  function addEditLine() {
    setEditLines((l) => [...l, { description: "", hsnCode: "", quantity: "1", unitPrice: "", taxRatePct: "18" }]);
  }
  function updateEditLine(i: number, patch: Partial<EditLine>) {
    setEditLines((l) => l.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  }
  function removeEditLine(i: number) {
    setEditLines((l) => l.filter((_, idx) => idx !== i));
  }
  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!po) return;
    setEditError(null);
    setAction("edit");
    try {
      await api(`/purchase-orders/${id}`, { method: "PUT", body: JSON.stringify({
        supplierId: editForm.supplierId,
        expectedDate: editForm.expectedDate ? new Date(editForm.expectedDate).toISOString() : undefined,
        notes: editForm.notes || undefined,
        terms: editForm.terms || undefined,
        lineItems: editLines.map((l) => ({
          description: l.description,
          hsnCode: l.hsnCode || undefined,
          quantity: parseFloat(l.quantity) || 0,
          unitPrice: parseFloat(l.unitPrice) || 0,
          taxRatePct: parseFloat(l.taxRatePct) || 18,
        })),
      }) });
      setEditOpen(false);
      setMsg("Purchase order updated."); load();
    } catch (err) { setEditError(err instanceof Error ? err.message : "Failed to update PO"); } finally { setAction(null); }
  }

  if (error) return <p className="text-sm text-red-600 p-4">{error}</p>;
  if (!po) return <p className="text-sm text-gray-500 p-4">Loading…</p>;

  return (
    <div className="space-y-6 max-w-4xl" data-testid="po-detail">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <a href="/purchase-orders" className="text-xs text-gray-500 hover:text-gray-700">← Back to purchase orders</a>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight mt-1" style={{ color: "var(--text-heading)" }}>{po.poNumber}</h1>
          <p className="text-sm text-gray-500">{po.supplier.name}</p>
        </div>
        <span className={statusPillClass(po.status)}>{PO_STATUS_LABEL[po.status] ?? po.status}</span>
      </div>

      {msg && <div className="rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-700">{msg}</div>}

      <div className="card overflow-hidden">
        <div className="table-scroll">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3">SAC/HSN</th>
                <th className="px-4 py-3">Qty</th>
                <th className="px-4 py-3">Unit price</th>
                <th className="px-4 py-3">Tax %</th>
                <th className="px-4 py-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {po.lineItems.map((l) => (
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
          <Row label="Subtotal" value={formatINR(po.subtotal)} />
          <Row label="CGST" value={formatINR(po.cgstAmount)} />
          <Row label="SGST" value={formatINR(po.sgstAmount)} />
          <Row label="IGST" value={formatINR(po.igstAmount)} />
          <Row label="Total" value={formatINR(po.total)} bold />
        </div>
      </div>

      <div className="card p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold">Bills from supplier</h2>
          {canManage && (
            <Link
              href={`/finance/vendor-invoices/new?supplierId=${po.supplier.id}&purchaseOrderId=${po.id}`}
              className="text-xs font-medium text-[var(--theme-accent)]"
            >
              + Record vendor invoice
            </Link>
          )}
        </div>
        {po.bills.length === 0 ? (
          <p className="text-sm text-gray-400">No bills recorded yet.</p>
        ) : (
          <ul className="text-sm space-y-1">
            {po.bills.map((b) => (
              <li key={b.id} className="flex justify-between border-b pb-2">
                <span><span className="font-medium">{b.billNumber}</span> <span className={statusPillClass(b.status)}>{BILL_STATUS_LABEL[b.status] ?? b.status}</span></span>
                <span>{formatINR(b.total)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {canManage && po.status === "draft" && (
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary px-4 py-2 text-sm" disabled={!!action} onClick={() => doStatus("issued")}>Issue PO</button>
          <button className="rounded-lg border border-gray-300 px-4 py-2 text-sm" disabled={!!action} onClick={openEdit}>Edit PO</button>
        </div>
      )}
      {canManage && po.status === "issued" && (
        <button className="rounded-lg border border-gray-300 px-4 py-2 text-sm" disabled={!!action} onClick={() => doStatus("received")}>Mark received</button>
      )}

      <button onClick={() => router.push(`/purchase-orders/${po.id}/print`)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm">Print</button>

      {editOpen && po && (
        <div className="modal-backdrop" onClick={() => setEditOpen(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Edit purchase order</h3>
              <button onClick={() => setEditOpen(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <form onSubmit={saveEdit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Supplier</label>
                  <select required className="field w-full" value={editForm.supplierId} onChange={(e) => setEditForm({ ...editForm, supplierId: e.target.value })}>
                    {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Expected date</label>
                  <input type="date" className="field w-full" value={editForm.expectedDate} onChange={(e) => setEditForm({ ...editForm, expectedDate: e.target.value })} />
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
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <input className="field" placeholder="Description" value={l.description} onChange={(e) => updateEditLine(i, { description: e.target.value })} required />
                        <input className="field" placeholder="SAC/HSN" value={l.hsnCode} onChange={(e) => updateEditLine(i, { hsnCode: e.target.value })} required />
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <input type="number" step="0.01" className="field" placeholder="Qty" value={l.quantity} onChange={(e) => updateEditLine(i, { quantity: e.target.value })} />
                        <input type="number" step="0.01" className="field" placeholder="Unit price" value={l.unitPrice} onChange={(e) => updateEditLine(i, { unitPrice: e.target.value })} />
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

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-500">{label}</span>
      <span className={bold ? "font-semibold" : ""}>{value}</span>
    </div>
  );
}
