"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/apiClient";
import { useAuth } from "@/components/AuthContext";
import { formatINR, formatDate } from "@/lib/finance";
import { DataTable } from "@/components/DataTable";

interface DebitNoteRow {
  id: string;
  noteNumber: string;
  reason: string;
  noteDate: string;
  amount: string;
  supplier: { id: string; name: string };
  bill: { id: string; billNumber: string } | null;
}

interface Supplier { id: string; name: string; }
interface Bill { id: string; billNumber: string; supplierId: string; }

const today = () => new Date().toISOString().slice(0, 10);

export default function DebitNotesPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("manage_credit_notes");

  const [rows, setRows] = useState<DebitNoteRow[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({ supplierId: "", billId: "", noteNumber: "", reason: "", noteDate: today(), amount: "", notes: "" });

  function load() {
    api<DebitNoteRow[]>("/debit-notes").then(setRows).catch((e) => setError(e instanceof Error ? e.message : "Failed"));
    if (canManage) {
      api<Supplier[]>("/purchase-orders/suppliers").then(setSuppliers).catch(() => {});
      api<Bill[]>("/bills").then(setBills).catch(() => {});
    }
  }
  useEffect(load, [canManage]);

  async function remove(id: string) {
    if (!confirm("Delete this debit note? This can't be undone.")) return;
    try {
      await api(`/debit-notes/${id}`, { method: "DELETE" });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete debit note");
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      if (!form.supplierId) throw new Error("Please choose a supplier");
      if (!form.noteNumber) throw new Error("Please enter a note number");
      const payload = {
        supplierId: form.supplierId,
        billId: form.billId || undefined,
        noteNumber: form.noteNumber,
        reason: form.reason,
        noteDate: new Date(form.noteDate).toISOString(),
        amount: parseFloat(form.amount) || 0,
        notes: form.notes || undefined,
      };
      await api("/debit-notes", { method: "POST", body: JSON.stringify(payload) });
      setOpen(false);
      setForm({ supplierId: "", billId: "", noteNumber: "", reason: "", noteDate: today(), amount: "", notes: "" });
      load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create debit note");
    } finally {
      setSaving(false);
    }
  }

  const billsForSupplier = bills.filter((b) => b.supplierId === form.supplierId);

  return (
    <div className="space-y-6 max-w-4xl" data-testid="debit-notes-page">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight" style={{ color: "var(--text-heading)" }}>Debit Notes</h1>
          <p className="mt-1 text-sm text-gray-500">Internal record of amounts debited against a supplier (shortfall, rejection, deduction). No statutory numbering.</p>
        </div>
        {canManage && (
          <button onClick={() => setOpen(true)} className="btn-primary px-4 py-2 text-sm self-start sm:self-auto">
            + New debit note
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-600 print:hidden">{error}</p>}

      <DataTable
        storageKey="debit-notes"
        title="Debit Notes"
        rows={rows}
        rowKey={(r) => r.id}
        emptyMessage="No debit notes yet."
        columns={[
          { key: "noteNumber", label: "Note #", accessor: (r) => r.noteNumber, filterType: "text", alwaysVisible: true },
          { key: "supplier", label: "Supplier", accessor: (r) => r.supplier.name },
          { key: "bill", label: "Against bill", accessor: (r) => r.bill?.billNumber ?? "—" },
          { key: "noteDate", label: "Date", accessor: (r) => formatDate(r.noteDate), filterType: "text" },
          { key: "amount", label: "Amount", accessor: (r) => r.amount, filterType: "text", render: (r) => formatINR(r.amount) },
          { key: "reason", label: "Reason", accessor: (r) => r.reason },
          ...(canManage
            ? [
                {
                  key: "actions",
                  label: "",
                  align: "right" as const,
                  alwaysVisible: true,
                  filterable: false,
                  render: (r: DebitNoteRow) => <button onClick={() => remove(r.id)} className="text-xs text-red-500">Delete</button>,
                },
              ]
            : []),
        ]}
      >
        {(filteredRows) => (
          <div className="cards-mobile">
            {filteredRows.length === 0 ? (
              <div className="card p-6 text-center text-sm text-gray-400">
                {rows.length === 0 ? "No debit notes yet." : "No rows match the current filters."}
              </div>
            ) : (
              filteredRows.map((r) => (
                <div key={r.id} className="data-card">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <span className="font-mono text-xs font-semibold text-gray-900">{r.noteNumber}</span>
                    <span className="value font-semibold">{formatINR(r.amount)}</span>
                  </div>
                  <p className="text-sm font-semibold text-gray-900 truncate">{r.supplier.name}</p>
                  <div className="data-card-row"><span className="label">Reason</span><span className="value">{r.reason}</span></div>
                  {canManage && (
                    <div className="mt-2 text-right">
                      <button onClick={() => remove(r.id)} className="text-xs text-red-500">Delete</button>
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
              <h3 className="text-lg font-semibold">New debit note</h3>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Supplier</label>
                  <select required className="field w-full" value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value, billId: "" })}>
                    <option value="">Select a supplier</option>
                    {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Against bill (optional)</label>
                  <select className="field w-full" value={form.billId} onChange={(e) => setForm({ ...form, billId: e.target.value })}>
                    <option value="">None</option>
                    {billsForSupplier.map((b) => <option key={b.id} value={b.id}>{b.billNumber}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Note number</label>
                  <input required className="field w-full" value={form.noteNumber} onChange={(e) => setForm({ ...form, noteNumber: e.target.value })} placeholder="e.g. DN-2026-001" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Date</label>
                  <input type="date" required className="field w-full" value={form.noteDate} onChange={(e) => setForm({ ...form, noteDate: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Amount (₹)</label>
                  <input type="number" step="0.01" required className="field w-full" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Reason</label>
                  <input required className="field w-full" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="e.g. Short delivery on PO-..." />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
                  <input className="field w-full" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                </div>
              </div>

              {formError && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{formError}</p>}
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary px-4 py-2 text-sm">{saving ? "Saving…" : "Save"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
