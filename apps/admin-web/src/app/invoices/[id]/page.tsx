"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { api } from "@/lib/apiClient";
import { useAuth } from "@/components/AuthContext";
import { formatINR, formatDate, INVOICE_STATUS_LABEL, PAYMENT_METHOD_LABEL, statusPillClass } from "@/lib/finance";

interface LineItem { id: string; description: string; hsnCode?: string | null; quantity: string; unitPrice: string; discountPct: string; taxRatePct: string; lineTotal: string; }
interface Payment { id: string; amount: string; method: string; reference?: string | null; receivedDate: string; notes?: string | null; }
interface EditLog { id: string; summary: string; editedAt: string; editedBy: { name: string } }
interface InvoiceDetail {
  id: string;
  invoiceNumber: string;
  docType: string;
  status: string;
  issueDate: string;
  dueDate?: string | null;
  placeOfSupply?: string | null;
  subtotal: string;
  discountAmount: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  total: string;
  amountPaid: string;
  balance: string;
  overdue: boolean;
  notes?: string | null;
  terms?: string | null;
  cancelReason?: string | null;
  customer: { id: string; name: string };
  lineItems: LineItem[];
  payments: Payment[];
  editLogs: EditLog[];
}
interface Customer { id: string; name: string; state?: string | null; }

export default function InvoiceDetailPage() {
  const router = useRouter();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("manage_invoices");
  const canRecord = hasPermission("record_payments");

  const [inv, setInv] = useState<InvoiceDetail | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const { id } = useParams<{ id: string }>();

  function load() {
    if (!id) return;
    setError(null);
    api<InvoiceDetail>(`/invoices/${id}`).then(setInv).catch((e) => setError(e instanceof Error ? e.message : "Failed"));
    if (canManage) api<Customer[]>("/customers").then(setCustomers).catch(() => {});
  }
  useEffect(load, [id, canManage]);

  async function issue() {
    setAction("issue"); setMsg(null);
    try { await api(`/invoices/${id}/issue`, { method: "POST", body: "{}" }); setMsg("Invoice issued."); load(); }
    catch (e) { setMsg(e instanceof Error ? e.message : "Failed"); } finally { setAction(null); }
  }
  async function cancel() {
    const reason = window.prompt("Reason for cancellation?");
    if (!reason) return;
    setAction("cancel"); setMsg(null);
    try { await api(`/invoices/${id}/cancel`, { method: "POST", body: JSON.stringify({ reason }) }); setMsg("Invoice cancelled."); load(); }
    catch (e) { setMsg(e instanceof Error ? e.message : "Failed"); } finally { setAction(null); }
  }

  const [payOpen, setPayOpen] = useState(false);
  const [pay, setPay] = useState({ amount: "", method: "bank_transfer", reference: "", notes: "" });
  async function recordPayment(e: React.FormEvent) {
    e.preventDefault();
    setAction("pay"); setMsg(null);
    try {
      await api(`/invoices/${id}/payments`, { method: "POST", body: JSON.stringify({
        amount: parseFloat(pay.amount),
        method: pay.method,
        reference: pay.reference || undefined,
        notes: pay.notes || undefined,
      }) });
      setPayOpen(false); setPay({ amount: "", method: "bank_transfer", reference: "", notes: "" });
      setMsg("Payment recorded."); load();
    } catch (e) { setMsg(e instanceof Error ? e.message : "Failed"); } finally { setAction(null); }
  }

  // Editing - available for any non-cancelled invoice, including issued/paid ones. Edits to
  // an already-issued invoice are logged server-side (InvoiceEditLog) so the correction stays
  // visible rather than silently rewriting the document - see the "Edit history" card below.
  const [editOpen, setEditOpen] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ customerId: "", placeOfSupply: "", issueDate: "", dueDate: "", notes: "", terms: "" });
  const [editLines, setEditLines] = useState<{ description: string; hsnCode: string; quantity: string; unitPrice: string; discountPct: string; taxRatePct: string }[]>([]);

  function openEdit() {
    if (!inv) return;
    setEditError(null);
    setEditForm({
      customerId: inv.customer.id,
      placeOfSupply: inv.placeOfSupply ?? "",
      issueDate: inv.issueDate.slice(0, 10),
      dueDate: inv.dueDate ? inv.dueDate.slice(0, 10) : "",
      notes: inv.notes ?? "",
      terms: inv.terms ?? "",
    });
    setEditLines(inv.lineItems.map((l) => ({
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
    setEditLines((l) => [...l, { description: "", hsnCode: "", quantity: "1", unitPrice: "", discountPct: "0", taxRatePct: "18" }]);
  }
  function updateEditLine(i: number, patch: Partial<(typeof editLines)[number]>) {
    setEditLines((l) => l.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  }
  function removeEditLine(i: number) {
    setEditLines((l) => l.filter((_, idx) => idx !== i));
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!inv) return;
    setEditError(null);
    if (inv.status !== "draft") {
      const ok = window.confirm(
        `This invoice is already ${INVOICE_STATUS_LABEL[inv.status] ?? inv.status}. Changes will be recorded in the edit history below. Continue?`,
      );
      if (!ok) return;
    }
    setAction("edit");
    try {
      await api(`/invoices/${id}`, { method: "PUT", body: JSON.stringify({
        customerId: editForm.customerId,
        placeOfSupply: editForm.placeOfSupply || undefined,
        issueDate: new Date(editForm.issueDate).toISOString(),
        dueDate: editForm.dueDate ? new Date(editForm.dueDate).toISOString() : undefined,
        notes: editForm.notes || undefined,
        terms: editForm.terms || undefined,
        lineItems: editLines.map((l) => ({
          description: l.description,
          hsnCode: l.hsnCode || undefined,
          quantity: parseFloat(l.quantity) || 0,
          unitPrice: parseFloat(l.unitPrice) || 0,
          discountPct: parseFloat(l.discountPct) || 0,
          taxRatePct: parseFloat(l.taxRatePct) || 18,
        })),
      }) });
      setEditOpen(false);
      setMsg("Invoice updated."); load();
    } catch (err) { setEditError(err instanceof Error ? err.message : "Failed to update invoice"); } finally { setAction(null); }
  }

  if (error) return <p className="text-sm text-red-600 p-4">{error}</p>;
  if (!inv) return <p className="text-sm text-gray-500 p-4">Loading…</p>;

  return (
    <div className="space-y-6 max-w-4xl" data-testid="invoice-detail">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <a href="/invoices" className="text-xs text-gray-500 hover:text-gray-700">← Back to invoices</a>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight mt-1" style={{ color: "var(--text-heading)" }}>{inv.invoiceNumber}</h1>
          <p className="text-sm text-gray-500">{inv.docType === "tax_invoice" ? "Tax invoice" : "Proforma"} · {inv.customer.name}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={statusPillClass(inv.status)}>{INVOICE_STATUS_LABEL[inv.status] ?? inv.status}</span>
          {inv.overdue && <span className="text-xs text-red-600 font-medium">Overdue</span>}
        </div>
      </div>

      {msg && <div className="rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-700">{msg}</div>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="Total" value={formatINR(inv.total)} />
        <Kpi label="Paid" value={formatINR(inv.amountPaid)} />
        <Kpi label="Balance" value={formatINR(inv.balance)} accent />
        <Kpi label="Due" value={inv.dueDate ? formatDate(inv.dueDate) : "—"} />
      </div>

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
              {inv.lineItems.map((l) => (
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
          <Row label="Subtotal" value={formatINR(inv.subtotal)} />
          <Row label="CGST" value={formatINR(inv.cgstAmount)} />
          <Row label="SGST" value={formatINR(inv.sgstAmount)} />
          <Row label="IGST" value={formatINR(inv.igstAmount)} />
          <Row label="Total" value={formatINR(inv.total)} bold />
        </div>
      </div>

      {inv.status === "cancelled" && inv.cancelReason && (
        <p className="text-sm text-red-600"><span className="font-medium">Cancelled: </span>{inv.cancelReason}</p>
      )}

      <div className="card p-4">
        <h2 className="text-sm font-semibold mb-2">Payment history</h2>
        {inv.payments.length === 0 ? (
          <p className="text-sm text-gray-400">No payments recorded yet.</p>
        ) : (
          <div className="space-y-2 text-sm">
            {inv.payments.map((p) => (
              <div key={p.id} className="flex justify-between border-b pb-2">
                <div>
                  <span className="font-medium">{formatINR(p.amount)}</span>
                  <span className="text-gray-500 ml-2">{PAYMENT_METHOD_LABEL[p.method] ?? p.method}</span>
                  {p.reference && <span className="text-gray-400 ml-2">({p.reference})</span>}
                </div>
                <span className="text-gray-500">{formatDate(p.receivedDate)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {inv.editLogs.length > 0 && (
        <div className="card p-4">
          <h2 className="text-sm font-semibold mb-2">Edit history</h2>
          <div className="space-y-2 text-sm">
            {inv.editLogs.map((e) => (
              <div key={e.id} className="border-b pb-2 last:border-b-0 last:pb-0">
                <p className="text-gray-700">{e.summary}</p>
                <p className="text-xs text-gray-400 mt-0.5">{e.editedBy.name} · {formatDate(e.editedAt)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {canManage && inv.status === "draft" && (
        <button className="btn-primary px-4 py-2 text-sm" disabled={!!action} onClick={issue}>Issue invoice</button>
      )}
      {canManage && (inv.status === "draft" || inv.status === "issued") && (
        <button className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-red-600" disabled={!!action} onClick={cancel}>Cancel invoice</button>
      )}
      {canRecord && (inv.status === "issued" || inv.status === "partially_paid") && (
        <button className="btn-primary px-4 py-2 text-sm" onClick={() => setPayOpen(true)}>Record payment</button>
      )}
      {canManage && inv.status !== "cancelled" && (
        <button className="rounded-lg border border-gray-300 px-4 py-2 text-sm" onClick={openEdit}>Edit invoice</button>
      )}

      <button onClick={() => router.push(`/invoices/${inv.id}/print`)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm">Print</button>

      {payOpen && (
        <div className="modal-backdrop" onClick={() => setPayOpen(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Record payment</h3>
              <button onClick={() => setPayOpen(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <form onSubmit={recordPayment} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Amount (₹)</label>
                <input type="number" step="0.01" required className="field w-full" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} placeholder={inv.balance} />
                <p className="text-xs text-gray-400 mt-1">Outstanding balance: {formatINR(inv.balance)}</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Method</label>
                <select className="field w-full" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="upi">UPI</option>
                  <option value="cheque">Cheque</option>
                  <option value="cash">Cash</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Reference (UTR / cheque no)</label>
                <input className="field w-full" value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} />
              </div>
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setPayOpen(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm">Cancel</button>
                <button type="submit" disabled={!!action} className="btn-primary px-4 py-2 text-sm">{action ? "Saving…" : "Record"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editOpen && inv && (
        <div className="modal-backdrop" onClick={() => setEditOpen(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Edit invoice</h3>
              <button onClick={() => setEditOpen(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            {inv.status !== "draft" && (
              <div className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-xs text-amber-800 mb-4">
                This invoice has already been {INVOICE_STATUS_LABEL[inv.status] ?? inv.status}. Any change you save here will be
                added to the Edit history below, visible to everyone with invoice access.
              </div>
            )}
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
                  <label className="block text-xs font-medium text-gray-500 mb-1">Issue date</label>
                  <input type="date" required className="field w-full" value={editForm.issueDate} onChange={(e) => setEditForm({ ...editForm, issueDate: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Due date</label>
                  <input type="date" className="field w-full" value={editForm.dueDate} onChange={(e) => setEditForm({ ...editForm, dueDate: e.target.value })} />
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
                        <input className="field" placeholder="HSN" value={l.hsnCode} onChange={(e) => updateEditLine(i, { hsnCode: e.target.value })} />
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

function Kpi({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="card p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-base font-semibold ${accent ? "text-[var(--theme-accent)]" : ""}`}>{value}</p>
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
