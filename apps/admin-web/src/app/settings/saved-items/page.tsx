"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/apiClient";
import { useAuth } from "@/components/AuthContext";
import { DataTable } from "@/components/DataTable";

interface SavedLineItem {
  id: string;
  name: string;
  hsnCode: string | null;
  standardPrice: string;
  taxRatePct: string;
  active: boolean;
}

// Saved items are always services/installation-type billing lines (never goods) - default the
// code to SAC 9987 (maintenance/repair/installation services) so a new item doesn't start blank.
const emptyForm = { name: "", hsnCode: "9987", standardPrice: "", taxRatePct: "18" };

export default function SavedItemsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("manage_settings");

  const [items, setItems] = useState<SavedLineItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SavedLineItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  function load() {
    api<SavedLineItem[]>("/saved-items?includeArchived=1")
      .then(setItems)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load saved items"));
  }

  useEffect(load, []);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setFormError(null);
    setOpen(true);
  }

  function openEdit(i: SavedLineItem) {
    setEditing(i);
    setForm({ name: i.name, hsnCode: i.hsnCode ?? "", standardPrice: i.standardPrice, taxRatePct: i.taxRatePct });
    setFormError(null);
    setOpen(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const body = {
        name: form.name,
        hsnCode: form.hsnCode || undefined,
        standardPrice: parseFloat(form.standardPrice),
        taxRatePct: form.taxRatePct ? parseFloat(form.taxRatePct) : undefined,
      };
      if (editing) {
        await api(`/saved-items/${editing.id}`, { method: "PUT", body: JSON.stringify(body) });
      } else {
        await api("/saved-items", { method: "POST", body: JSON.stringify(body) });
      }
      setOpen(false);
      setEditing(null);
      setForm(emptyForm);
      load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save item");
    } finally {
      setSaving(false);
    }
  }

  async function toggleArchive(i: SavedLineItem) {
    setArchivingId(i.id);
    setArchiveError(null);
    try {
      await api(`/saved-items/${i.id}/${i.active ? "archive" : "unarchive"}`, { method: "PATCH" });
      load();
    } catch (err) {
      setArchiveError(err instanceof Error ? err.message : "Failed to update item");
    } finally {
      setArchivingId(null);
    }
  }

  return (
    <div className="space-y-6 max-w-5xl" data-testid="saved-items-page">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight" style={{ color: "var(--text-heading)" }}>
            Saved Items
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Standard billing items (e.g. &quot;Installation labour&quot;, &quot;Crane hire&quot;) with a
            standard price and SAC/HSN code - the in-app assistant offers these as options when
            drafting a quotation, invoice, or purchase order.
          </p>
        </div>
        {canManage && (
          <button onClick={openCreate} className="btn-primary px-4 py-2 text-sm self-start sm:self-auto">
            + New saved item
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-600 print:hidden">{error}</p>}
      {archiveError && <p className="text-sm text-red-600">{archiveError}</p>}

      <DataTable
        storageKey="saved-items"
        title="Saved Items"
        rows={items}
        rowKey={(i) => i.id}
        emptyMessage="No saved items yet."
        columns={[
          { key: "name", label: "Name", accessor: (i) => i.name, alwaysVisible: true, filterType: "text" },
          { key: "hsnCode", label: "SAC/HSN code", accessor: (i) => i.hsnCode ?? "" },
          {
            key: "standardPrice",
            label: "Standard price",
            accessor: (i) => i.standardPrice,
            render: (i) => `₹${Number(i.standardPrice).toLocaleString("en-IN")}`,
          },
          { key: "taxRatePct", label: "Tax %", accessor: (i) => i.taxRatePct },
          {
            key: "active",
            label: "Status",
            accessor: (i) => (i.active ? "Active" : "Archived"),
            render: (i) => (
              <span className={i.active ? "text-green-700" : "text-gray-400"}>{i.active ? "Active" : "Archived"}</span>
            ),
          },
          ...(canManage
            ? [
                {
                  key: "actions",
                  label: "Actions",
                  align: "right" as const,
                  alwaysVisible: true,
                  filterable: false,
                  render: (i: SavedLineItem) => (
                    <>
                      <button onClick={() => openEdit(i)} className="text-sm font-medium text-blue-600 hover:text-blue-800 mr-3">
                        Edit
                      </button>
                      <button
                        onClick={() => toggleArchive(i)}
                        disabled={archivingId === i.id}
                        className="text-sm font-medium text-gray-600 hover:text-gray-800 disabled:opacity-50"
                      >
                        {archivingId === i.id ? "Working…" : i.active ? "Archive" : "Unarchive"}
                      </button>
                    </>
                  ),
                },
              ]
            : []),
        ]}
      >
        {(filteredItems) => (
          <div className="cards-mobile" data-testid="saved-items-mobile-cards">
            {filteredItems.length === 0 ? (
              <div className="card p-6 text-center text-sm text-gray-400">
                {items.length === 0 ? "No saved items yet." : "No rows match the current filters."}
              </div>
            ) : (
              filteredItems.map((i) => (
                <div key={i.id} className="data-card">
                  <p className="text-sm font-semibold text-gray-900 truncate">{i.name}</p>
                  <div className="data-card-row">
                    <span className="label">Standard price</span>
                    <span className="value">₹{Number(i.standardPrice).toLocaleString("en-IN")}</span>
                  </div>
                  {i.hsnCode && (
                    <div className="data-card-row">
                      <span className="label">SAC/HSN</span>
                      <span className="value">{i.hsnCode}</span>
                    </div>
                  )}
                  {canManage && (
                    <div className="mt-3 flex justify-end gap-4">
                      <button onClick={() => openEdit(i)} className="text-sm font-medium text-blue-600">Edit</button>
                      <button
                        onClick={() => toggleArchive(i)}
                        disabled={archivingId === i.id}
                        className="text-sm font-medium text-gray-600 disabled:opacity-50"
                      >
                        {archivingId === i.id ? "Working…" : i.active ? "Archive" : "Unarchive"}
                      </button>
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
              <h3 className="text-lg font-semibold">{editing ? "Edit saved item" : "New saved item"}</h3>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <form onSubmit={submit} className="space-y-3">
              <input
                required
                placeholder="Name, e.g. Installation labour"
                className="field w-full"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
              <input
                placeholder="SAC/HSN code (optional)"
                className="field w-full"
                value={form.hsnCode}
                onChange={(e) => setForm({ ...form, hsnCode: e.target.value })}
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  required
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="Standard price (₹)"
                  className="field"
                  value={form.standardPrice}
                  onChange={(e) => setForm({ ...form, standardPrice: e.target.value })}
                />
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="Tax rate % (default 18)"
                  className="field"
                  value={form.taxRatePct}
                  onChange={(e) => setForm({ ...form, taxRatePct: e.target.value })}
                />
              </div>

              {formError && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{formError}</p>}

              <div className="flex justify-end gap-3 pt-1">
                <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="btn-primary px-4 py-2 text-sm">
                  {saving ? (editing ? "Saving…" : "Creating…") : editing ? "Save changes" : "Create item"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
