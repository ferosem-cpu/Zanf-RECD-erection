"use client";

import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/apiClient";
import { useAuth } from "@/components/AuthContext";
import { formatINR, formatDate, CREDIT_NOTE_STATUS_LABEL, CREDIT_NOTE_REASON_LABEL, statusPillClass } from "@/lib/finance";
import { DataTable } from "@/components/DataTable";

interface CreditNoteRow {
  id: string;
  noteNumber: string;
  status: string;
  issueDate: string;
  total: string;
  customer: { id: string; name: string };
  invoice: { id: string; invoiceNumber: string };
}

interface InvoiceOption {
  id: string;
  invoiceNumber: string;
  docType: string;
  status: string;
  total: string;
  customer: { id: string; name: string };
}

interface Product {
  id: string;
  name: string;
  model: string;
}

const today = () => new Date().toISOString().slice(0, 10);

function CreditNotesInner() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("manage_credit_notes");
  const searchParams = useSearchParams();
  const invoiceIdFromQuery = searchParams.get("invoice") ?? "";

  const [rows, setRows] = useState<CreditNoteRow[]>([]);
  const [invoices, setInvoices] = useState<InvoiceOption[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({
    invoiceId: invoiceIdFromQuery,
    reason: "return",
    issueDate: today(),
    notes: "",
  });
  const [lines, setLines] = useState([
    { productId: "", description: "", hsnCode: "", quantity: "1", unitPrice: "", discountPct: "0", taxRatePct: "18" },
  ]);

  function load() {
    api<CreditNoteRow[]>("/credit-notes").then(setRows).catch((e) => setError(e instanceof Error ? e.message : "Failed"));
    if (canManage) {
      api<InvoiceOption[]>("/invoices?docType=tax_invoice").then((all) =>
        setInvoices(all.filter((inv) => inv.status === "issued" || inv.status === "partially_paid" || inv.status === "paid")),
      ).catch(() => {});
      api<Product[]>("/meta/products").then(setProducts).catch(() => {});
    }
  }
  useEffect(load, [canManage]);

  useEffect(() => {
    if (invoiceIdFromQuery) setForm((f) => ({ ...f, invoiceId: invoiceIdFromQuery }));
  }, [invoiceIdFromQuery]);

  function addLine() {
    setLines((l) => [...l, { productId: "", description: "", hsnCode: "", quantity: "1", unitPrice: "", discountPct: "0", taxRatePct: "18" }]);
  }
  function updateLine(i: number, patch: Partial<(typeof lines)[number]>) {
    setLines((l) => l.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  }
  function removeLine(i: number) {
    setLines((l) => l.filter((_, idx) => idx !== i));
  }

  async function issue(id: string) {
    if (!confirm("Issue this credit note? It will get a real CRN number and immediately reduce the invoice's outstanding balance.")) return;
    try {
      await api(`/credit-notes/${id}/issue`, { method: "POST" });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to issue credit note");
    }
  }

  async function cancel(id: string) {
    const reason = prompt("Reason for cancelling this credit note?");
    if (!reason) return;
    try {
      await api(`/credit-notes/${id}/cancel`, { method: "POST", body: JSON.stringify({ reason }) });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel credit note");
    }
  }

  async function removeDraft(id: string) {
    if (!confirm("Delete this draft credit note? This can't be undone.")) return;
    try {
      await api(`/credit-notes/${id}`, { method: "DELETE" });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete credit note");
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      if (!form.invoiceId) throw new Error("Please choose an invoice");
      const payload = {
        invoiceId: form.invoiceId,
        reason: form.reason,
        issueDate: new Date(form.issueDate).toISOString(),
        notes: form.notes || undefined,
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
      await api("/credit-notes", { method: "POST", body: JSON.stringify(payload) });
      setOpen(false);
      setLines([{ productId: "", description: "", hsnCode: "", quantity: "1", unitPrice: "", discountPct: "0", taxRatePct: "18" }]);
      load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create credit note");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-6xl" data-testid="credit-notes-page">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight" style={{ color: "var(--text-heading)" }}>Credit Notes</h1>
          <p className="mt-1 text-sm text-gray-500">Reduce an issued tax invoice&apos;s outstanding balance for a return, rate correction, or discount.</p>
        </div>
        {canManage && (
          <button onClick={() => setOpen(true)} className="btn-primary px-4 py-2 text-sm self-start sm:self-auto">
            + New credit note
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-600 print:hidden">{error}</p>}

      <DataTable
        storageKey="credit-notes"
        title="Credit Notes"
        rows={rows}
        rowKey={(r) => r.id}
        emptyMessage="No credit notes yet."
        columns={[
          {
            key: "noteNumber",
            label: "CN #",
            accessor: (r) => r.noteNumber,
            filterType: "text",
            alwaysVisible: true,
            render: (r) => <span className="font-mono text-xs font-semibold text-[var(--theme-accent)]">{r.noteNumber}</span>,
          },
          { key: "customer", label: "Customer", accessor: (r) => r.customer.name },
          {
            key: "invoice",
            label: "Against invoice",
            accessor: (r) => r.invoice.invoiceNumber,
            render: (r) => <Link href={`/invoices/${r.invoice.id}`} className="font-mono text-xs text-[var(--theme-accent)] hover:underline">{r.invoice.invoiceNumber}</Link>,
          },
          { key: "issueDate", label: "Date", accessor: (r) => formatDate(r.issueDate), filterType: "text" },
          { key: "total", label: "Total", accessor: (r) => r.total, filterType: "text", render: (r) => formatINR(r.total) },
          { key: "status", label: "Status", accessor: (r) => CREDIT_NOTE_STATUS_LABEL[r.status] ?? r.status, render: (r) => <span className={statusPillClass(r.status)}>{CREDIT_NOTE_STATUS_LABEL[r.status] ?? r.status}</span> },
          ...(canManage
            ? [
                {
                  key: "actions",
                  label: "",
                  align: "right" as const,
                  alwaysVisible: true,
                  filterable: false,
                  render: (r: CreditNoteRow) => (
                    <div className="flex justify-end gap-3">
                      {r.status === "draft" && (
                        <>
                          <button onClick={() => issue(r.id)} className="text-xs font-medium text-[var(--theme-accent)]">Issue</button>
                          <button onClick={() => removeDraft(r.id)} className="text-xs text-red-500">Delete</button>
                        </>
                      )}
                      {r.status === "issued" && <button onClick={() => cancel(r.id)} className="text-xs text-red-500">Cancel</button>}
                    </div>
                  ),
                },
              ]
            : []),
        ]}
      >
        {(filteredRows) => (
          <div className="cards-mobile">
            {filteredRows.length === 0 ? (
              <div className="card p-6 text-center text-sm text-gray-400">
                {rows.length === 0 ? "No credit notes yet." : "No rows match the current filters."}
              </div>
            ) : (
              filteredRows.map((r) => (
                <div key={r.id} className="data-card">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <span className="font-mono text-xs font-semibold text-gray-900">{r.noteNumber}</span>
                    <span className={statusPillClass(r.status)}>{CREDIT_NOTE_STATUS_LABEL[r.status] ?? r.status}</span>
                  </div>
                  <p className="text-sm font-semibold text-gray-900 truncate">{r.customer.name}</p>
                  <div className="data-card-row"><span className="label">Against</span><span className="value font-mono">{r.invoice.invoiceNumber}</span></div>
                  <div className="data-card-row"><span className="label">Total</span><span className="value font-semibold">{formatINR(r.total)}</span></div>
                  {canManage && (
                    <div className="mt-2 flex justify-end gap-3">
                      {r.status === "draft" && (
                        <>
                          <button onClick={() => issue(r.id)} className="text-xs font-medium text-[var(--theme-accent)]">Issue</button>
                          <button onClick={() => removeDraft(r.id)} className="text-xs text-red-500">Delete</button>
                        </>
                      )}
                      {r.status === "issued" && <button onClick={() => cancel(r.id)} className="text-xs text-red-500">Cancel</button>}
                    </div>
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
              <h3 className="text-lg font-semibold">New credit note</h3>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Against invoice</label>
                  <select required className="field w-full" value={form.invoiceId} onChange={(e) => setForm({ ...form, invoiceId: e.target.value })}>
                    <option value="">Select a tax invoice</option>
                    {invoices.map((inv) => (
                      <option key={inv.id} value={inv.id}>{inv.invoiceNumber} — {inv.customer.name} ({formatINR(inv.total)})</option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] text-gray-400">Only issued tax invoices are listed — proforma invoices can&apos;t carry a credit note.</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Reason</label>
                  <select className="field w-full" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}>
                    {Object.entries(CREDIT_NOTE_REASON_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Issue date</label>
                  <input type="date" required className="field w-full" value={form.issueDate} onChange={(e) => setForm({ ...form, issueDate: e.target.value })} />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
                  <input className="field w-full" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
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
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <select
                          className="field"
                          value={l.productId}
                          onChange={(e) => {
                            const pid = e.target.value;
                            const p = products.find((x) => x.id === pid);
                            updateLine(i, { productId: pid, description: p && !l.description ? `${p.name} (${p.model})` : l.description });
                          }}
                        >
                          <option value="">No product (free text line)</option>
                          {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.model})</option>)}
                        </select>
                        <input className="field" placeholder="Description" value={l.description} onChange={(e) => updateLine(i, { description: e.target.value })} required />
                        <input className="field" placeholder="SAC/HSN" value={l.hsnCode} onChange={(e) => updateLine(i, { hsnCode: e.target.value })} required />
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

              <p className="text-xs text-gray-400">Saved as a draft first — issue it from the list once you&apos;ve checked the amounts. Total credit notes against an invoice can&apos;t exceed the invoice total.</p>

              {formError && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{formError}</p>}
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary px-4 py-2 text-sm">{saving ? "Saving…" : "Save draft"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CreditNotesPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-gray-400">Loading…</div>}>
      <CreditNotesInner />
    </Suspense>
  );
}
