"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { api } from "@/lib/apiClient";
import { useAuth } from "@/components/AuthContext";
import { formatINR, formatDate, QUOTATION_STATUS_LABEL, statusPillClass } from "@/lib/finance";

interface LineItem {
  id: string;
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

export default function QuotationDetailPage() {
  const router = useRouter();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("manage_quotations");

  const [q, setQ] = useState<QuotationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const { id } = useParams<{ id: string }>();

  function load() {
    if (!id) return;
    setError(null);
    api<QuotationDetail>(`/quotations/${id}`).then(setQ).catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }
  useEffect(load, [id]);

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
