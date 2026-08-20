"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/apiClient";
import { useAuth } from "@/components/AuthContext";
import { formatINR, formatDate, PAYMENT_METHOD_LABEL } from "@/lib/finance";
import { DataTable } from "@/components/DataTable";

interface Cat { id: string; key: string; label: string; }
interface ExpenseRow {
  id: string;
  description: string;
  amount: string;
  expenseDate: string;
  method: string;
  category: { id: string; key: string; label: string };
}

const today = () => new Date().toISOString().slice(0, 10);

export default function ExpensesPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("manage_expenses");

  const [rows, setRows] = useState<ExpenseRow[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({ categoryId: "", description: "", amount: "", expenseDate: today(), method: "cash" });

  const [editId, setEditId] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editFormError, setEditFormError] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ categoryId: "", description: "", amount: "", expenseDate: today(), method: "cash" });

  function load() {
    api<ExpenseRow[]>("/expenses").then(setRows).catch((e) => setError(e instanceof Error ? e.message : "Failed"));
    if (canManage) api<Cat[]>("/meta/expense-categories").then(setCats).catch(() => {});
  }
  useEffect(load, [canManage]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setFormError(null);
    try {
      if (!form.categoryId) throw new Error("Please choose a category");
      await api("/expenses", { method: "POST", body: JSON.stringify({
        categoryId: form.categoryId, description: form.description,
        amount: parseFloat(form.amount) || 0, expenseDate: new Date(form.expenseDate).toISOString(), method: form.method,
      }) });
      setOpen(false);
      setForm({ categoryId: "", description: "", amount: "", expenseDate: today(), method: "cash" });
      load();
    } catch (err) { setFormError(err instanceof Error ? err.message : "Failed"); }
    finally { setSaving(false); }
  }
  async function remove(id: string) {
    if (!confirm("Delete this expense?")) return;
    await api(`/expenses/${id}`, { method: "DELETE" }).catch(() => {});
    load();
  }

  function openEdit(r: ExpenseRow) {
    setEditFormError(null);
    setEditForm({
      categoryId: r.category.id,
      description: r.description,
      amount: r.amount,
      expenseDate: r.expenseDate.slice(0, 10),
      method: r.method,
    });
    setEditId(r.id);
  }
  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editId) return;
    setEditSaving(true); setEditFormError(null);
    try {
      if (!editForm.categoryId) throw new Error("Please choose a category");
      await api(`/expenses/${editId}`, { method: "PUT", body: JSON.stringify({
        categoryId: editForm.categoryId, description: editForm.description,
        amount: parseFloat(editForm.amount) || 0, expenseDate: new Date(editForm.expenseDate).toISOString(), method: editForm.method,
      }) });
      setEditId(null);
      load();
    } catch (err) { setEditFormError(err instanceof Error ? err.message : "Failed"); }
    finally { setEditSaving(false); }
  }

  const total = rows.reduce((s, r) => s + parseFloat(r.amount), 0);

  return (
    <div className="space-y-6 max-w-5xl" data-testid="expenses-page">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight" style={{ color: "var(--text-heading)" }}>Expenses</h1>
          <p className="mt-1 text-sm text-gray-500">Non-PO spend book. Total: {formatINR(total)}</p>
        </div>
        {canManage && <button onClick={() => setOpen(true)} className="btn-primary px-4 py-2 text-sm self-start sm:self-auto">+ Add expense</button>}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <DataTable
        storageKey="expenses"
        rows={rows}
        rowKey={(r) => r.id}
        emptyMessage="No expenses yet."
        columns={[
          { key: "date", label: "Date", accessor: (r) => formatDate(r.expenseDate), filterType: "text", alwaysVisible: true },
          { key: "category", label: "Category", accessor: (r) => r.category.label },
          { key: "description", label: "Description", accessor: (r) => r.description, filterType: "text" },
          { key: "method", label: "Method", accessor: (r) => PAYMENT_METHOD_LABEL[r.method] ?? r.method },
          { key: "amount", label: "Amount", accessor: (r) => r.amount, filterType: "text", render: (r) => <span className="font-medium">{formatINR(r.amount)}</span> },
          ...(canManage
            ? [
                {
                  key: "actions",
                  label: "",
                  align: "right" as const,
                  alwaysVisible: true,
                  filterable: false,
                  render: (r: ExpenseRow) => (
                    <>
                      <button onClick={() => openEdit(r)} className="text-xs font-medium text-[var(--theme-accent)] mr-3">Edit</button>
                      <button onClick={() => remove(r.id)} className="text-xs text-red-500">Delete</button>
                    </>
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
                {rows.length === 0 ? "No expenses yet." : "No rows match the current filters."}
              </div>
            ) : filteredRows.map((r) => (
              <div key={r.id} className="data-card">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <span className="text-sm font-semibold text-gray-900">{r.category.label}</span>
                  <span className="font-semibold">{formatINR(r.amount)}</span>
                </div>
                <p className="text-sm text-gray-600 truncate">{r.description}</p>
                <div className="data-card-row"><span className="label">Date</span><span className="value">{formatDate(r.expenseDate)}</span></div>
                <div className="data-card-row"><span className="label">Method</span><span className="value">{PAYMENT_METHOD_LABEL[r.method] ?? r.method}</span></div>
                {canManage && (
                  <div className="mt-3 flex gap-2">
                    <button onClick={() => openEdit(r)} className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium">Edit</button>
                    <button onClick={() => remove(r.id)} className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-red-500">Delete</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </DataTable>

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Add expense</h3>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Category</label>
                <select required className="field w-full" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                  <option value="">Select a category</option>
                  {cats.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Description</label>
                <input required className="field w-full" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Amount (₹)</label>
                  <input type="number" step="0.01" required className="field w-full" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Date</label>
                  <input type="date" required className="field w-full" value={form.expenseDate} onChange={(e) => setForm({ ...form, expenseDate: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Method</label>
                <select className="field w-full" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="upi">UPI</option>
                  <option value="cheque">Cheque</option>
                  <option value="cash">Cash</option>
                  <option value="other">Other</option>
                </select>
              </div>
              {formError && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{formError}</p>}
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary px-4 py-2 text-sm">{saving ? "Saving…" : "Add expense"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editId && (
        <div className="modal-backdrop" onClick={() => setEditId(null)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Edit expense</h3>
              <button onClick={() => setEditId(null)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <form onSubmit={saveEdit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Category</label>
                <select required className="field w-full" value={editForm.categoryId} onChange={(e) => setEditForm({ ...editForm, categoryId: e.target.value })}>
                  <option value="">Select a category</option>
                  {cats.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Description</label>
                <input required className="field w-full" value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Amount (₹)</label>
                  <input type="number" step="0.01" required className="field w-full" value={editForm.amount} onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Date</label>
                  <input type="date" required className="field w-full" value={editForm.expenseDate} onChange={(e) => setEditForm({ ...editForm, expenseDate: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Method</label>
                <select className="field w-full" value={editForm.method} onChange={(e) => setEditForm({ ...editForm, method: e.target.value })}>
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="upi">UPI</option>
                  <option value="cheque">Cheque</option>
                  <option value="cash">Cash</option>
                  <option value="other">Other</option>
                </select>
              </div>
              {editFormError && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{editFormError}</p>}
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setEditId(null)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={editSaving} className="btn-primary px-4 py-2 text-sm">{editSaving ? "Saving…" : "Save changes"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
