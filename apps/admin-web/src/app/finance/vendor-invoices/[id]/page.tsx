"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/apiClient";
import { useAuth } from "@/components/AuthContext";
import { formatINR, formatDate, BILL_STATUS_LABEL, PAYMENT_METHOD_LABEL, statusPillClass } from "@/lib/finance";

interface LineItem { id: string; description: string; hsnCode?: string | null; quantity: string; unitPrice: string; taxRatePct: string; lineTotal: string; }
interface Allocation {
  id: string; amount: string; notes?: string | null;
  site: { id: string; address: string | null; companyName: string | null } | null;
  order: { id: string; orderNumber: string; customer: { id: string; name: string } } | null;
  invoice: { id: string; invoiceNumber: string; docType: string } | null;
}
interface Payment { id: string; amount: string; method: string; reference?: string | null; paidDate: string; notes?: string | null; }
interface AuditLog { id: string; action: string; summary: string; createdAt: string; actor: { name: string }; }
interface BillDetail {
  id: string; billNumber: string; status: string; billDate: string; dueDate?: string | null;
  sourceType?: string | null; attachmentUrl?: string | null; attachmentMimeType?: string | null;
  subtotal: string; taxAmount: string; total: string; notes?: string | null; rejectedReason?: string | null;
  supplier: { id: string; name: string; gstin?: string | null; state?: string | null; address?: string | null; contactName?: string | null; contactPhone?: string | null; contactEmail?: string | null };
  purchaseOrder?: { id: string; poNumber: string } | null;
  lineItems: LineItem[];
  allocations: Allocation[];
  payments: Payment[];
  auditLogs: AuditLog[];
  verifiedBy?: { id: string; name: string } | null;
  approvedBy?: { id: string; name: string } | null;
  amountPaid: string;
  balance: string;
}

export default function VendorInvoiceDetailPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const { hasPermission } = useAuth();
  const canApprove = hasPermission("approve_vendor_invoice");
  const canRecordPayment = hasPermission("record_payments");

  const [bill, setBill] = useState<BillDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [pay, setPay] = useState({ amount: "", method: "bank_transfer", reference: "", paidDate: new Date().toISOString().slice(0, 10), notes: "" });

  function load() {
    if (!id) return;
    setError(null);
    api<BillDetail>(`/bills/${id}`).then(setBill).catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }
  useEffect(load, [id]);

  async function doAction(path: string, body?: unknown) {
    setAction(path); setMsg(null);
    try {
      await api(`/bills/${id}/${path}`, { method: "POST", body: body ? JSON.stringify(body) : undefined });
      setMsg("Updated.");
      load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Failed");
    } finally {
      setAction(null);
    }
  }

  async function submitReject(e: React.FormEvent) {
    e.preventDefault();
    await doAction("reject", { reason: rejectReason });
    setRejectOpen(false);
    setRejectReason("");
  }

  async function submitPayment(e: React.FormEvent) {
    e.preventDefault();
    setAction("payment"); setMsg(null);
    try {
      await api(`/bills/${id}/payments`, { method: "POST", body: JSON.stringify({
        amount: parseFloat(pay.amount) || 0, method: pay.method, reference: pay.reference || undefined,
        paidDate: new Date(pay.paidDate).toISOString(), notes: pay.notes || undefined,
      }) });
      setPayOpen(false);
      setPay({ amount: "", method: "bank_transfer", reference: "", paidDate: new Date().toISOString().slice(0, 10), notes: "" });
      setMsg("Payment recorded."); load();
    } catch (err) { setMsg(err instanceof Error ? err.message : "Failed"); } finally { setAction(null); }
  }

  if (error) return <p className="text-sm text-red-600 p-4">{error}</p>;
  if (!bill) return <p className="text-sm text-gray-500 p-4">Loading…</p>;

  const timeline = [
    ...bill.auditLogs.map((a) => ({ id: a.id, when: a.createdAt, who: a.actor.name, text: a.summary })),
    ...bill.payments.map((p) => ({ id: `payment-${p.id}`, when: p.paidDate, who: PAYMENT_METHOD_LABEL[p.method] ?? p.method, text: `Payment recorded: ${formatINR(p.amount)}${p.reference ? ` (ref ${p.reference})` : ""}` })),
  ].sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());

  return (
    <div className="space-y-6 max-w-5xl" data-testid="vendor-invoice-detail">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <a href="/finance/vendor-invoices" className="text-xs text-gray-500 hover:text-gray-700">← Back to vendor invoices</a>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight mt-1" style={{ color: "var(--text-heading)" }}>{bill.billNumber}</h1>
          <p className="text-sm text-gray-500">{bill.supplier.name}</p>
        </div>
        <span className={statusPillClass(bill.status)}>{BILL_STATUS_LABEL[bill.status] ?? bill.status}</span>
      </div>

      {msg && <div className="rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-700">{msg}</div>}
      {bill.status === "rejected" && bill.rejectedReason && (
        <div className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">Rejected: {bill.rejectedReason}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-600">Scan</h2>
          {bill.attachmentUrl ? (
            bill.attachmentMimeType === "application/pdf" ? (
              <a href={bill.attachmentUrl} target="_blank" rel="noreferrer" className="card p-6 block text-sm text-[var(--theme-accent)] hover:underline">Open attached PDF</a>
            ) : (
              <a href={bill.attachmentUrl} target="_blank" rel="noreferrer">
                <img src={bill.attachmentUrl} alt="Bill scan" className="w-full rounded-lg border border-gray-200 object-contain bg-gray-50" />
              </a>
            )
          ) : (
            <div className="card p-6 text-sm text-gray-400">No scan attached - entered manually.</div>
          )}
        </div>

        <div className="space-y-4">
          <div className="card p-4 space-y-1 text-sm">
            <Row label="Bill date" value={formatDate(bill.billDate)} />
            {bill.dueDate && <Row label="Due date" value={formatDate(bill.dueDate)} />}
            {bill.sourceType && <Row label="Source" value={bill.sourceType} />}
            {bill.purchaseOrder && <Row label="Purchase order" value={bill.purchaseOrder.poNumber} />}
            <Row label="Supplier GSTIN" value={bill.supplier.gstin ?? "-"} />
          </div>

          <div className="card overflow-hidden">
            <div className="table-scroll">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                    <th className="px-4 py-3">Description</th>
                    <th className="px-4 py-3">Qty</th>
                    <th className="px-4 py-3">Unit price</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {bill.lineItems.map((l) => (
                    <tr key={l.id}>
                      <td className="px-4 py-3">{l.description}</td>
                      <td className="px-4 py-3">{l.quantity}</td>
                      <td className="px-4 py-3">{formatINR(l.unitPrice)}</td>
                      <td className="px-4 py-3 text-right font-medium">{formatINR(l.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t px-4 py-3 space-y-1 text-sm">
              <Row label="Subtotal" value={formatINR(bill.subtotal)} />
              <Row label="Tax" value={formatINR(bill.taxAmount)} />
              <Row label="Total" value={formatINR(bill.total)} bold />
              <Row label="Paid" value={formatINR(bill.amountPaid)} />
              <Row label="Balance" value={formatINR(bill.balance)} bold />
            </div>
          </div>

          <div className="card p-4">
            <h2 className="text-sm font-semibold mb-2">Allocations</h2>
            {bill.allocations.length === 0 ? (
              <p className="text-sm text-gray-400">No allocations recorded.</p>
            ) : (
              <ul className="text-sm space-y-1">
                {bill.allocations.map((a) => (
                  <li key={a.id} className="flex justify-between border-b pb-2">
                    <span>
                      {a.site && <>{a.site.companyName || a.site.address}</>}
                      {a.order && <span className="text-gray-500"> · {a.order.orderNumber} ({a.order.customer.name})</span>}
                      {a.invoice && <span className="text-gray-400"> · linked to {a.invoice.invoiceNumber}</span>}
                    </span>
                    <span className="font-medium">{formatINR(a.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {canApprove && bill.status === "uploaded" && (
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary px-4 py-2 text-sm" disabled={!!action} onClick={() => doAction("verify")}>Verify</button>
              <button className="rounded-lg border border-red-300 text-red-600 px-4 py-2 text-sm" disabled={!!action} onClick={() => setRejectOpen(true)}>Reject</button>
            </div>
          )}
          {canApprove && bill.status === "verified" && (
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary px-4 py-2 text-sm" disabled={!!action} onClick={() => doAction("approve")}>Approve</button>
              <button className="rounded-lg border border-red-300 text-red-600 px-4 py-2 text-sm" disabled={!!action} onClick={() => setRejectOpen(true)}>Reject</button>
            </div>
          )}
          {canApprove && ["uploaded", "verified", "approved"].includes(bill.status) && bill.payments.length === 0 && (
            <button className="text-xs text-red-500" disabled={!!action} onClick={() => doAction("cancel")}>Cancel this vendor invoice</button>
          )}
          {canRecordPayment && (bill.status === "approved" || bill.status === "partially_paid") && (
            <button className="rounded-lg border border-gray-300 px-4 py-2 text-sm" onClick={() => setPayOpen(true)}>Record payment</button>
          )}

          <div className="card p-4">
            <h2 className="text-sm font-semibold mb-2">Audit trail</h2>
            <ol className="space-y-2 text-sm">
              {timeline.map((t) => (
                <li key={t.id} className="border-b pb-2">
                  <div>{t.text}</div>
                  <div className="text-xs text-gray-400">{t.who} · {new Date(t.when).toLocaleString()}</div>
                </li>
              ))}
              {timeline.length === 0 && <p className="text-sm text-gray-400">No activity yet.</p>}
            </ol>
          </div>
        </div>
      </div>

      {rejectOpen && (
        <div className="modal-backdrop" onClick={() => setRejectOpen(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">Reject vendor invoice</h3>
            <form onSubmit={submitReject} className="space-y-4">
              <textarea required className="field w-full" rows={3} placeholder="Reason for rejection" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setRejectOpen(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm">Cancel</button>
                <button type="submit" disabled={!!action} className="btn-primary px-4 py-2 text-sm">Reject</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {payOpen && (
        <div className="modal-backdrop" onClick={() => setPayOpen(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">Record payment</h3>
            <form onSubmit={submitPayment} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <input type="number" step="0.01" required placeholder="Amount" className="field" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} />
                <select className="field" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="upi">UPI</option>
                  <option value="cheque">Cheque</option>
                  <option value="cash">Cash</option>
                  <option value="other">Other</option>
                </select>
                <input type="date" className="field" value={pay.paidDate} onChange={(e) => setPay({ ...pay, paidDate: e.target.value })} />
                <input placeholder="Reference" className="field" value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} />
              </div>
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setPayOpen(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm">Cancel</button>
                <button type="submit" disabled={!!action} className="btn-primary px-4 py-2 text-sm">{action === "payment" ? "Saving…" : "Record payment"}</button>
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
