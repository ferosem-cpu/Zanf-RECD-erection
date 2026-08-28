"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/apiClient";
import { useAuth } from "@/components/AuthContext";
import { formatINR, formatDate, PAYMENT_METHOD_LABEL } from "@/lib/finance";
import { DataTable } from "@/components/DataTable";

interface Customer { id: string; name: string; }
interface OpenInvoice {
  id: string;
  invoiceNumber: string;
  issueDate: string;
  status: string;
  netTotal: string;
  amountPaid: string;
  balance: string;
}
interface AllocationRow {
  invoiceId: string;
  invoice: { id: string; invoiceNumber: string };
  amount: string;
}
interface PaymentRow {
  id: string;
  amount: string;
  tdsAmount: string;
  tdsCertificateRef?: string | null;
  method: string;
  reference?: string | null;
  receivedDate: string;
  notes?: string | null;
  customer: { id: string; name: string };
  allocations: AllocationRow[];
  allocatedAmount: string;
  unallocatedAmount: string;
}

const today = () => new Date().toISOString().slice(0, 10);
export default function PaymentsPage() {
  const { hasPermission } = useAuth();
  const canRecord = hasPermission("record_payments");

  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState("");
  const [openInvoices, setOpenInvoices] = useState<OpenInvoice[]>([]);
  const [amount, setAmount] = useState("");
  const [tdsAmount, setTdsAmount] = useState("");
  const [tdsCertificateRef, setTdsCertificateRef] = useState("");
  const [method, setMethod] = useState("bank_transfer");
  const [reference, setReference] = useState("");
  const [receivedDate, setReceivedDate] = useState(today());
  const [notes, setNotes] = useState("");
  const [allocations, setAllocations] = useState<Record<string, string>>({});

  function load() {
    api<PaymentRow[]>("/payments").then(setRows).catch((e) => setError(e instanceof Error ? e.message : "Failed"));
    api<Customer[]>("/customers").then(setCustomers).catch(() => {});
  }
  useEffect(load, []);

  function openModal() {
    setFormError(null);
    setCustomerId("");
    setOpenInvoices([]);
    setAmount("");
    setTdsAmount("");
    setTdsCertificateRef("");
    setMethod("bank_transfer");
    setReference("");
    setReceivedDate(today());
    setNotes("");
    setAllocations({});
    setOpen(true);
  }

  async function pickCustomer(id: string) {
    setCustomerId(id);
    setAllocations({});
    if (!id) { setOpenInvoices([]); return; }
    const all = await api<OpenInvoice[]>(`/invoices?customerId=${id}`).catch(() => []);
    const openOnes = all
      .filter((inv) => inv.status === "issued" || inv.status === "partially_paid")
      .sort((a, b) => new Date(a.issueDate).getTime() - new Date(b.issueDate).getTime());
    setOpenInvoices(openOnes);
  }

  // Auto-allocate oldest-first up to each invoice's outstanding balance, using cash only
  // (TDS settles pro-rata across whatever allocations exist once submitted - see
  // services/settlement.ts - so this fill only needs to reason about the cash amount).
  function autoAllocate(cash: number) {
    let remaining = cash;
    const next: Record<string, string> = {};
    for (const inv of openInvoices) {
      if (remaining <= 0) break;
      const balance = parseFloat(inv.balance);
      const take = Math.min(remaining, balance);
      if (take > 0.004) {
        next[inv.id] = take.toFixed(2);
        remaining -= take;
      }
    }
    setAllocations(next);
  }

  function onAmountChange(v: string) {
    setAmount(v);
    autoAllocate(parseFloat(v) || 0);
  }

  function setAllocation(invoiceId: string, v: string) {
    setAllocations((a) => ({ ...a, [invoiceId]: v }));
  }

  const totalAllocated = useMemo(
    () => Object.values(allocations).reduce((s, v) => s + (parseFloat(v) || 0), 0),
    [allocations],
  );
  const unallocated = (parseFloat(amount) || 0) - totalAllocated;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      await api("/payments", {
        method: "POST",
        body: JSON.stringify({
          customerId,
          amount: parseFloat(amount),
          tdsAmount: tdsAmount ? parseFloat(tdsAmount) : undefined,
          tdsCertificateRef: tdsCertificateRef || undefined,
          method,
          reference: reference || undefined,
          receivedDate: receivedDate ? new Date(receivedDate).toISOString() : undefined,
          notes: notes || undefined,
          allocations: Object.entries(allocations)
            .filter(([, v]) => parseFloat(v) > 0)
            .map(([invoiceId, v]) => ({ invoiceId, amount: parseFloat(v) })),
        }),
      });
      setOpen(false);
      load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to record payment");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6" data-testid="payments-page">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight" style={{ color: "var(--text-heading)" }}>Payments</h1>
          <p className="mt-1 text-sm text-gray-500">Every payment received, however it was split across invoices - unallocated amounts are customer advances.</p>
        </div>
        {canRecord && (
          <button onClick={openModal} className="btn-primary px-4 py-2 text-sm self-start sm:self-auto">+ Record payment</button>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <DataTable
        storageKey="payments"
        title="Payments"
        rows={rows}
        rowKey={(r) => r.id}
        emptyMessage="No payments recorded yet."
        columns={[
          { key: "customer", label: "Customer", accessor: (r) => r.customer.name, alwaysVisible: true },
          { key: "receivedDate", label: "Date", accessor: (r) => formatDate(r.receivedDate), filterType: "text" },
          { key: "amount", label: "Amount", accessor: (r) => r.amount, render: (r) => formatINR(r.amount) },
          { key: "tdsAmount", label: "TDS", accessor: (r) => r.tdsAmount, render: (r) => (Number(r.tdsAmount) > 0 ? formatINR(r.tdsAmount) : "—") },
          { key: "method", label: "Method", accessor: (r) => PAYMENT_METHOD_LABEL[r.method] ?? r.method },
          {
            key: "allocations",
            label: "Allocated to",
            accessor: (r) => r.allocations.map((a) => a.invoice.invoiceNumber).join(", "),
            render: (r) =>
              r.allocations.length === 0 ? (
                <span className="text-gray-400">Unallocated</span>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {r.allocations.map((a) => (
                    <Link key={a.invoiceId} href={`/invoices/${a.invoice.id}`} className="font-mono text-xs text-[var(--theme-accent)] hover:underline">
                      {a.invoice.invoiceNumber}
                    </Link>
                  ))}
                </div>
              ),
          },
          {
            key: "unallocatedAmount",
            label: "Advance",
            accessor: (r) => r.unallocatedAmount,
            render: (r) => (Number(r.unallocatedAmount) > 0.01 ? <span className="font-medium text-amber-600">{formatINR(r.unallocatedAmount)}</span> : "—"),
          },
        ]}
      >
        {(filteredRows) => (
          <div className="cards-mobile">
            {filteredRows.length === 0 ? (
              <div className="card p-6 text-center text-sm text-gray-400">
                {rows.length === 0 ? "No payments recorded yet." : "No rows match the current filters."}
              </div>
            ) : (
              filteredRows.map((r) => (
                <div key={r.id} className="data-card">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <span className="text-sm font-semibold text-gray-900">{r.customer.name}</span>
                    <span className="text-xs text-gray-500">{formatDate(r.receivedDate)}</span>
                  </div>
                  <div className="data-card-row"><span className="label">Amount</span><span className="value font-semibold">{formatINR(r.amount)}</span></div>
                  {Number(r.tdsAmount) > 0 && <div className="data-card-row"><span className="label">TDS</span><span className="value">{formatINR(r.tdsAmount)}</span></div>}
                  <div className="data-card-row">
                    <span className="label">Allocated to</span>
                    <span className="value">{r.allocations.length === 0 ? "Unallocated" : r.allocations.map((a) => a.invoice.invoiceNumber).join(", ")}</span>
                  </div>
                  {Number(r.unallocatedAmount) > 0.01 && (
                    <div className="data-card-row"><span className="label">Advance</span><span className="value font-medium text-amber-600">{formatINR(r.unallocatedAmount)}</span></div>
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
              <h3 className="text-lg font-semibold">Record payment</h3>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Customer</label>
                <select required className="field w-full" value={customerId} onChange={(e) => pickCustomer(e.target.value)}>
                  <option value="">Choose…</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Amount received (₹)</label>
                  <input type="number" step="0.01" required className="field w-full" value={amount} onChange={(e) => onAmountChange(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Date received</label>
                  <input type="date" required className="field w-full" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Method</label>
                  <select className="field w-full" value={method} onChange={(e) => setMethod(e.target.value)}>
                    <option value="bank_transfer">Bank Transfer</option>
                    <option value="upi">UPI</option>
                    <option value="cheque">Cheque</option>
                    <option value="cash">Cash</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Reference (UTR / cheque no)</label>
                  <input className="field w-full" value={reference} onChange={(e) => setReference(e.target.value)} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">TDS deducted (₹, optional)</label>
                  <input type="number" step="0.01" className="field w-full" value={tdsAmount} onChange={(e) => setTdsAmount(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">TDS certificate ref (optional)</label>
                  <input className="field w-full" value={tdsCertificateRef} onChange={(e) => setTdsCertificateRef(e.target.value)} disabled={!tdsAmount} />
                </div>
              </div>

              {customerId && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Allocate to invoices</label>
                    <button type="button" onClick={() => autoAllocate(parseFloat(amount) || 0)} className="text-xs font-medium text-[var(--theme-accent)]">Re-run auto-allocate</button>
                  </div>
                  {openInvoices.length === 0 ? (
                    <p className="text-xs text-gray-400">No open invoices for this customer - the full amount will sit as an advance.</p>
                  ) : (
                    <div className="space-y-2">
                      {openInvoices.map((inv) => (
                        <div key={inv.id} className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 p-2.5">
                          <div className="min-w-0">
                            <p className="font-mono text-xs font-semibold text-gray-900 truncate">{inv.invoiceNumber}</p>
                            <p className="text-[11px] text-gray-400">{formatDate(inv.issueDate)} · outstanding {formatINR(inv.balance)}</p>
                          </div>
                          <input
                            type="number"
                            step="0.01"
                            className="field w-32 text-right shrink-0"
                            placeholder="0.00"
                            value={allocations[inv.id] ?? ""}
                            onChange={(e) => setAllocation(inv.id, e.target.value)}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-sm flex justify-between">
                    <span className="text-gray-500">{unallocated > 0.01 ? "Unallocated (advance)" : "Fully allocated"}</span>
                    <span className={`font-semibold ${unallocated > 0.01 ? "text-amber-600" : ""}`}>{formatINR(String(Math.max(unallocated, 0)))}</span>
                  </div>
                  {unallocated < -0.01 && (
                    <p className="mt-1 text-xs text-red-600">Allocations exceed the amount received by {formatINR(String(-unallocated))} - reduce a row above.</p>
                  )}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
                <input className="field w-full" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>

              {formError && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{formError}</p>}
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm">Cancel</button>
                <button type="submit" disabled={saving || unallocated < -0.01} className="btn-primary px-4 py-2 text-sm">{saving ? "Saving…" : "Record payment"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
