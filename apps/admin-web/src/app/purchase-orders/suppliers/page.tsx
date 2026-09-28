"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/apiClient";
import { useAuth } from "@/components/AuthContext";
import { DataTable } from "@/components/DataTable";
import SupplierFields from "@/components/SupplierFields";
import { EMPTY_SUPPLIER_FORM, supplierAddressLines, supplierToForm, type Supplier, type SupplierFormValues } from "@/lib/supplier";

/** Reusable supplier records for purchase orders (and vendor invoices / ledgers, which share
 * the same Supplier table). Guarded by manage_purchase_orders like the rest of /purchase-orders. */
function SuppliersPageInner() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("manage_purchase_orders");
  const searchParams = useSearchParams();

  const [rows, setRows] = useState<Supplier[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Supplier | "new" | null>(null);
  const [form, setForm] = useState<SupplierFormValues>(EMPTY_SUPPLIER_FORM);
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  function load() {
    return api<Supplier[]>("/purchase-orders/suppliers")
      .then((list) => { setRows(list); return list; })
      .catch((e) => { setError(e instanceof Error ? e.message : "Failed"); return [] as Supplier[]; });
  }

  useEffect(() => {
    load().then((list) => {
      // Deep link from the PO form: /purchase-orders/suppliers?edit=<id>
      const editId = searchParams.get("edit");
      const target = editId ? list.find((s) => s.id === editId) : undefined;
      if (target && canManage) openEdit(target);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openNew() {
    setEditing("new"); setForm(EMPTY_SUPPLIER_FORM); setIsActive(true); setFormError(null);
  }
  function openEdit(s: Supplier) {
    setEditing(s); setForm(supplierToForm(s)); setIsActive(s.isActive !== false); setFormError(null);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setSaving(true); setFormError(null);
    try {
      if (editing === "new") {
        await api("/purchase-orders/suppliers", { method: "POST", body: JSON.stringify(form) });
        setMsg(`Supplier "${form.name}" added.`);
      } else {
        await api(`/purchase-orders/suppliers/${editing.id}`, { method: "PUT", body: JSON.stringify({ ...form, isActive }) });
        setMsg(`Supplier "${form.name}" updated.`);
      }
      setEditing(null);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save supplier");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-6xl" data-testid="suppliers-page">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <Link href="/purchase-orders" className="text-xs text-gray-500 hover:text-gray-700">← Back to purchase orders</Link>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight mt-1" style={{ color: "var(--text-heading)" }}>Suppliers</h1>
          <p className="mt-1 text-sm text-gray-500">Saved suppliers are reused on purchase orders, vendor invoices and ledgers.</p>
        </div>
        {canManage && <button onClick={openNew} className="btn-primary px-4 py-2 text-sm self-start sm:self-auto">+ New supplier</button>}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {msg && <div className="rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-700">{msg}</div>}

      <DataTable
        storageKey="suppliers"
        title="Suppliers"
        rows={rows}
        rowKey={(r) => r.id}
        emptyMessage="No suppliers yet."
        columns={[
          {
            key: "name",
            label: "Name",
            accessor: (r) => r.name,
            filterType: "text",
            alwaysVisible: true,
            render: (r) =>
              canManage ? (
                <button type="button" onClick={() => openEdit(r)} className="text-left font-semibold text-[var(--theme-accent)] hover:underline">{r.name}</button>
              ) : (
                <span className="font-semibold">{r.name}</span>
              ),
          },
          { key: "gstin", label: "GSTIN", accessor: (r) => r.gstin ?? "", filterType: "text" },
          { key: "address", label: "Address", accessor: (r) => supplierAddressLines(r).join(", "), filterType: "text", render: (r) => <span className="text-xs text-gray-600">{supplierAddressLines(r).join(", ") || "-"}</span> },
          { key: "state", label: "State", accessor: (r) => r.state ?? "", filterType: "text" },
          { key: "contact", label: "Contact", accessor: (r) => [r.contactName, r.contactPhone, r.contactEmail].filter(Boolean).join(" · ") },
          { key: "active", label: "Status", accessor: (r) => (r.isActive === false ? "Inactive" : "Active") },
        ]}
      >
        {(filteredRows) => (
          <div className="cards-mobile">
            {filteredRows.length === 0 ? (
              <div className="card p-6 text-center text-sm text-gray-400">{rows.length === 0 ? "No suppliers yet." : "No rows match the current filters."}</div>
            ) : filteredRows.map((r) => (
              <button key={r.id} type="button" onClick={() => canManage && openEdit(r)} className="data-card block w-full text-left">
                <p className="text-sm font-semibold text-gray-900">{r.name}</p>
                {r.gstin && <p className="text-xs text-gray-500">GSTIN: {r.gstin}</p>}
                <p className="text-xs text-gray-500">{supplierAddressLines(r).join(", ")}</p>
              </button>
            ))}
          </div>
        )}
      </DataTable>

      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">{editing === "new" ? "New supplier" : `Edit ${editing.name}`}</h3>
              <button onClick={() => setEditing(null)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <form onSubmit={save} className="space-y-4">
              <SupplierFields value={form} onChange={setForm} />
              {editing !== "new" && (
                <label className="flex items-center gap-2 text-sm text-gray-600">
                  <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                  Active (inactive suppliers are hidden from the new-PO picker)
                </label>
              )}
              {editing !== "new" && (
                <p className="text-xs text-gray-400">Address changes also show on existing POs for this supplier (the PO reads the current supplier record).</p>
              )}
              {formError && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{formError}</p>}
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setEditing(null)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary px-4 py-2 text-sm">{saving ? "Saving…" : "Save supplier"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SuppliersPage() {
  // useSearchParams needs a Suspense boundary for static prerendering (Next 15).
  return (
    <Suspense fallback={<p className="text-sm text-gray-500 p-4">Loading…</p>}>
      <SuppliersPageInner />
    </Suspense>
  );
}
