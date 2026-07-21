"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { api } from "@/lib/apiClient";
import { useAuth } from "@/components/AuthContext";
import { formatINR, formatDate, INVOICE_STATUS_LABEL, PAYMENT_METHOD_LABEL, statusPillClass } from "@/lib/finance";

interface LineItem { id: string; description: string; hsnCode?: string | null; quantity: string; unitPrice: string; discountPct: string; taxRatePct: string; lineTotal: string; }
interface Payment { id: string; amount: string; method: string; reference?: string | null; receivedDate: string; notes?: string | null; }
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
}

export default function InvoiceDetailPage() {
  const router = useRouter();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("manage_invoices");
  const canRecord = hasPermission("record_payments");

  const [inv, setInv] = useState<InvoiceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const { id } = useParams<{ id: string }>();

  function load() {
    if (!id) return;
    setError(null);
    api<InvoiceDetail>(`/invoices/${id}`).then(setInv).catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }
  useEffect(load, [id]);

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

      {canManage && inv.status === "draft" && (
        <button className="btn-primary px-4 py-2 text-sm" disabled={!!action} onClick={issue}>Issue invoice</button>
      )}
      {canManage && (inv.status === "draft" || inv.status === "issued") && (
        <button className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-red-600" disabled={!!action} onClick={cancel}>Cancel invoice</button>
      )}
      {canRecord && (inv.status === "issued" || inv.status === "partially_paid") && (
        <button className="btn-primary px-4 py-2 text-sm" onClick={() => setPayOpen(true)}>Record payment</button>
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
