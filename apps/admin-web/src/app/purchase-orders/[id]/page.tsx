"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { api } from "@/lib/apiClient";
import { useAuth } from "@/components/AuthContext";
import { formatINR, formatDate, PO_STATUS_LABEL, BILL_STATUS_LABEL, statusPillClass } from "@/lib/finance";

interface LineItem { id: string; description: string; hsnCode?: string | null; quantity: string; unitPrice: string; taxRatePct: string; lineTotal: string; }
interface Bill { id: string; billNumber: string; status: string; total: string; }
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
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const { id } = useParams<{ id: string }>();

  function load() {
    if (!id) return;
    setError(null);
    api<PoDetail>(`/purchase-orders/${id}`).then(setPo).catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }
  useEffect(load, [id]);

  async function doStatus(status: string) {
    setAction(status); setMsg(null);
    try { await api(`/purchase-orders/${id}/status`, { method: "POST", body: JSON.stringify({ status }) }); setMsg(`PO ${status}.`); load(); }
    catch (e) { setMsg(e instanceof Error ? e.message : "Failed"); } finally { setAction(null); }
  }

  const [billOpen, setBillOpen] = useState(false);
  const [bill, setBill] = useState({ billNumber: "", billDate: new Date().toISOString().slice(0, 10), dueDate: "", subtotal: "", taxAmount: "0", total: "" });
  async function createBill(e: React.FormEvent) {
    e.preventDefault();
    setAction("bill"); setMsg(null);
    try {
      await api("/purchase-orders/bills", { method: "POST", body: JSON.stringify({
        billNumber: bill.billNumber, supplierId: po!.supplier.id, purchaseOrderId: po!.id,
        billDate: new Date(bill.billDate).toISOString(),
        dueDate: bill.dueDate ? new Date(bill.dueDate).toISOString() : undefined,
        subtotal: parseFloat(bill.subtotal) || 0, taxAmount: parseFloat(bill.taxAmount) || 0, total: parseFloat(bill.total) || 0,
      }) });
      setBillOpen(false); setBill({ billNumber: "", billDate: new Date().toISOString().slice(0, 10), dueDate: "", subtotal: "", taxAmount: "0", total: "" });
      setMsg("Bill recorded."); load();
    } catch (e) { setMsg(e instanceof Error ? e.message : "Failed"); } finally { setAction(null); }
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
                <th className="px-4 py-3">HSN</th>
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
          {canManage && <button onClick={() => setBillOpen(true)} className="text-xs font-medium text-[var(--theme-accent)]">+ Record bill</button>}
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
        <button className="btn-primary px-4 py-2 text-sm" disabled={!!action} onClick={() => doStatus("issued")}>Issue PO</button>
      )}
      {canManage && po.status === "issued" && (
        <button className="rounded-lg border border-gray-300 px-4 py-2 text-sm" disabled={!!action} onClick={() => doStatus("received")}>Mark received</button>
      )}

      <button onClick={() => router.push(`/purchase-orders/${po.id}/print`)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm">Print</button>

      {billOpen && (
        <div className="modal-backdrop" onClick={() => setBillOpen(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Record bill</h3>
              <button onClick={() => setBillOpen(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <form onSubmit={createBill} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input required placeholder="Bill number" className="field" value={bill.billNumber} onChange={(e) => setBill({ ...bill, billNumber: e.target.value })} />
                <input type="date" required className="field" value={bill.billDate} onChange={(e) => setBill({ ...bill, billDate: e.target.value })} />
                <input type="date" className="field" value={bill.dueDate} onChange={(e) => setBill({ ...bill, dueDate: e.target.value })} placeholder="Due date" />
                <input type="number" step="0.01" placeholder="Tax amount" className="field" value={bill.taxAmount} onChange={(e) => setBill({ ...bill, taxAmount: e.target.value })} />
                <input type="number" step="0.01" required placeholder="Subtotal" className="field" value={bill.subtotal} onChange={(e) => setBill({ ...bill, subtotal: e.target.value })} />
                <input type="number" step="0.01" required placeholder="Total" className="field" value={bill.total} onChange={(e) => setBill({ ...bill, total: e.target.value })} />
              </div>
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setBillOpen(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm">Cancel</button>
                <button type="submit" disabled={!!action} className="btn-primary px-4 py-2 text-sm">{action ? "Saving…" : "Record bill"}</button>
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
