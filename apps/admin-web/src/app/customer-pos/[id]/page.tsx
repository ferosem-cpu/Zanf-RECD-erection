"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/apiClient";
import { useAuth } from "@/components/AuthContext";
import { formatINR, formatDate, CUSTOMER_PO_STATUS_LABEL, statusPillClass } from "@/lib/finance";

interface LineItem { id: string; description: string; hsnCode?: string | null; quantity: string; unitPrice: string; taxRatePct: string; lineTotal: string; }
interface AuditLog { id: string; action: string; summary: string; createdAt: string; actor: { name: string }; }
interface CustomerPoDetail {
  id: string; poNumber: string; poDate: string; status: string;
  sourceType?: string | null; attachmentUrl?: string | null; attachmentMimeType?: string | null;
  subtotal: string; taxAmount: string; total: string; notes?: string | null;
  placeOfSupply?: string | null; workLocation?: string | null; scopeOfWork?: string | null;
  paymentDueDate?: string | null; customerRefCode?: string | null;
  customer: { id: string; name: string; gstin?: string | null; state?: string | null };
  order: { id: string; orderNumber: string; site?: { id: string; address: string | null; companyName: string | null } | null } | null;
  invoice: { id: string; invoiceNumber: string; docType: string; status: string } | null;
  lineItems: LineItem[];
  auditLogs: AuditLog[];
  recordedBy: { id: string; name: string };
}
interface OrderOption { id: string; orderNumber: string; customerId: string; }
interface InvoiceOption { id: string; invoiceNumber: string; customerId: string; }

export default function CustomerPoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("manage_orders");

  const [po, setPo] = useState<CustomerPoDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [linkOpen, setLinkOpen] = useState<"order" | "invoice" | null>(null);
  const [orders, setOrders] = useState<OrderOption[]>([]);
  const [invoices, setInvoices] = useState<InvoiceOption[]>([]);
  const [pickId, setPickId] = useState("");

  function load() {
    if (!id) return;
    setError(null);
    api<CustomerPoDetail>(`/customer-purchase-orders/${id}`).then(setPo).catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }
  useEffect(load, [id]);

  function openLink(kind: "order" | "invoice") {
    setPickId("");
    setLinkOpen(kind);
    if (kind === "order" && orders.length === 0) api<OrderOption[]>("/orders").then(setOrders).catch(() => {});
    if (kind === "invoice" && po) api<InvoiceOption[]>(`/invoices?customerId=${po.customer.id}`).then(setInvoices).catch(() => {});
  }

  async function submitLink() {
    if (!pickId) return;
    setAction("link"); setMsg(null);
    try {
      const body = linkOpen === "order" ? { orderId: pickId } : { invoiceId: pickId };
      await api(`/customer-purchase-orders/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      setLinkOpen(null);
      setMsg("Updated."); load();
    } catch (err) { setMsg(err instanceof Error ? err.message : "Failed"); } finally { setAction(null); }
  }

  async function unlink(kind: "order" | "invoice") {
    setAction(`unlink-${kind}`); setMsg(null);
    try {
      const body = kind === "order" ? { orderId: null } : { invoiceId: null };
      await api(`/customer-purchase-orders/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      setMsg("Updated."); load();
    } catch (err) { setMsg(err instanceof Error ? err.message : "Failed"); } finally { setAction(null); }
  }

  async function cancelPo() {
    setAction("cancel"); setMsg(null);
    try {
      await api(`/customer-purchase-orders/${id}/cancel`, { method: "POST" });
      setMsg("Cancelled."); load();
    } catch (err) { setMsg(err instanceof Error ? err.message : "Failed"); } finally { setAction(null); }
  }

  if (error) return <p className="text-sm text-red-600 p-4">{error}</p>;
  if (!po) return <p className="text-sm text-gray-500 p-4">Loading…</p>;

  const ordersForCustomer = orders.filter((o) => o.customerId === po.customer.id);

  return (
    <div className="space-y-6 max-w-5xl" data-testid="customer-po-detail">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <a href="/customer-pos" className="text-xs text-gray-500 hover:text-gray-700">← Back to Customer POs</a>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight mt-1" style={{ color: "var(--text-heading)" }}>{po.poNumber}</h1>
          <p className="text-sm text-gray-500">{po.customer.name}</p>
        </div>
        <span className={statusPillClass(po.status)}>{CUSTOMER_PO_STATUS_LABEL[po.status] ?? po.status}</span>
      </div>

      {msg && <div className="rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-700">{msg}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-600">Scan</h2>
          {po.attachmentUrl ? (
            po.attachmentMimeType === "application/pdf" ? (
              <a href={po.attachmentUrl} target="_blank" rel="noreferrer" className="card p-6 block text-sm text-[var(--theme-accent)] hover:underline">Open attached PDF</a>
            ) : (
              <a href={po.attachmentUrl} target="_blank" rel="noreferrer">
                <img src={po.attachmentUrl} alt="PO scan" className="w-full rounded-lg border border-gray-200 object-contain bg-gray-50" />
              </a>
            )
          ) : (
            <div className="card p-6 text-sm text-gray-400">No scan attached - entered manually.</div>
          )}
        </div>

        <div className="space-y-4">
          <div className="card p-4 space-y-1 text-sm">
            <Row label="PO date" value={formatDate(po.poDate)} />
            {po.sourceType && <Row label="Source" value={po.sourceType} />}
            {po.workLocation && <Row label="Work location" value={po.workLocation} />}
            {po.placeOfSupply && <Row label="Place of supply" value={po.placeOfSupply} />}
            {po.scopeOfWork && <Row label="Scope of work" value={po.scopeOfWork} />}
            {po.paymentDueDate && <Row label="Payment due" value={formatDate(po.paymentDueDate)} />}
            {po.customerRefCode && <Row label="Customer ref code" value={po.customerRefCode} />}
            <Row label="Customer GSTIN" value={po.customer.gstin ?? "-"} />
          </div>

          <div className="card p-4 space-y-1 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Order</span>
              {po.order ? (
                <span className="flex items-center gap-2">
                  <a href={`/orders/${po.order.id}`} className="font-medium text-[var(--theme-accent)] hover:underline">{po.order.orderNumber}</a>
                  {canManage && <button onClick={() => unlink("order")} disabled={!!action} className="text-xs text-red-500">Unlink</button>}
                </span>
              ) : canManage ? (
                <button onClick={() => openLink("order")} className="text-xs font-medium text-[var(--theme-accent)]">+ Link to order</button>
              ) : <span className="text-gray-400">-</span>}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Invoice</span>
              {po.invoice ? (
                <span className="flex items-center gap-2">
                  <a href={`/invoices/${po.invoice.id}`} className="font-medium text-[var(--theme-accent)] hover:underline">{po.invoice.invoiceNumber}</a>
                  {canManage && <button onClick={() => unlink("invoice")} disabled={!!action} className="text-xs text-red-500">Unlink</button>}
                </span>
              ) : canManage ? (
                <button onClick={() => openLink("invoice")} className="text-xs font-medium text-[var(--theme-accent)]">+ Link to invoice</button>
              ) : <span className="text-gray-400">-</span>}
            </div>
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
                  {po.lineItems.map((l) => (
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
              <Row label="Subtotal" value={formatINR(po.subtotal)} />
              <Row label="Tax" value={formatINR(po.taxAmount)} />
              <Row label="Total" value={formatINR(po.total)} bold />
            </div>
          </div>

          {po.notes && (
            <div className="card p-4 text-sm">
              <h2 className="text-sm font-semibold mb-1">Notes</h2>
              <p className="text-gray-600 whitespace-pre-wrap">{po.notes}</p>
            </div>
          )}

          {canManage && po.status !== "cancelled" && (
            <button className="text-xs text-red-500" disabled={!!action} onClick={cancelPo}>Cancel this customer PO</button>
          )}

          <div className="card p-4">
            <h2 className="text-sm font-semibold mb-2">Audit trail</h2>
            <ol className="space-y-2 text-sm">
              {po.auditLogs.map((a) => (
                <li key={a.id} className="border-b pb-2">
                  <div>{a.summary}</div>
                  <div className="text-xs text-gray-400">{a.actor.name} · {new Date(a.createdAt).toLocaleString()}</div>
                </li>
              ))}
              {po.auditLogs.length === 0 && <p className="text-sm text-gray-400">No activity yet.</p>}
            </ol>
          </div>
        </div>
      </div>

      {linkOpen && (
        <div className="modal-backdrop" onClick={() => setLinkOpen(null)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">{linkOpen === "order" ? "Link to an order" : "Link to an invoice"}</h3>
            <div className="space-y-4">
              <select className="field w-full" value={pickId} onChange={(e) => setPickId(e.target.value)}>
                <option value="">Select {linkOpen === "order" ? "an order" : "an invoice"}</option>
                {(linkOpen === "order" ? ordersForCustomer : invoices).map((o) => (
                  <option key={o.id} value={o.id}>{"orderNumber" in o ? o.orderNumber : o.invoiceNumber}</option>
                ))}
              </select>
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setLinkOpen(null)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm">Cancel</button>
                <button type="button" disabled={!pickId || !!action} onClick={submitLink} className="btn-primary px-4 py-2 text-sm">Link</button>
              </div>
            </div>
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
