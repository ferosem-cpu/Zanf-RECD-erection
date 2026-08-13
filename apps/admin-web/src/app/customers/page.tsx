"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/apiClient";
import { useAuth } from "@/components/AuthContext";

interface Customer {
  id: string;
  name: string;
  address: string | null;
  gstin: string | null;
  state: string | null;
  contacts: { id: string; name: string; phone: string | null; email: string | null }[];
}

export default function CustomersPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("manage_orders");

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    address: "",
    contactName: "",
    contactPhone: "",
    contactEmail: "",
  });

  function load() {
    api<Customer[]>("/customers")
      .then(setCustomers)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load customers"));
  }

  useEffect(load, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      await api("/customers", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          address: form.address || undefined,
          contactName: form.contactName,
          contactPhone: form.contactPhone,
          contactEmail: form.contactEmail || undefined,
        }),
      });
      setOpen(false);
      setForm({ name: "", address: "", contactName: "", contactPhone: "", contactEmail: "" });
      load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create customer");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-5xl" data-testid="customers-page">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight" style={{ color: "var(--text-heading)" }}>Customers</h1>
          <p className="mt-1 text-sm text-gray-500">Companies we're contracted with. Each can have multiple orders and sites.</p>
        </div>
        {canManage && (
          <button
            data-testid="customers-new-button"
            onClick={() => setOpen(true)}
            className="btn-primary px-4 py-2 text-sm self-start sm:self-auto"
          >
            + New customer
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* Desktop / tablet: table */}
      <div className="card overflow-hidden table-desktop">
        <div className="table-scroll">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Address</th>
                <th className="px-4 py-3">Primary contact</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {customers.map((c) => {
                const contact = c.contacts[0];
                return (
                  <tr key={c.id} className="hover:bg-gray-50/60">
                    <td className="px-4 py-3 font-medium">{c.name}</td>
                    <td className="px-4 py-3 text-gray-500">{c.address ?? "-"}</td>
                    <td className="px-4 py-3 text-gray-500">
                      {contact ? (
                        <>
                          {contact.name}
                          {contact.phone && <> · {contact.phone}</>}
                        </>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                );
              })}
              {customers.length === 0 && (
                <tr><td colSpan={3} className="px-4 py-8 text-center text-gray-400">No customers yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile: card stack */}
      <div className="cards-mobile" data-testid="customers-mobile-cards">
        {customers.length === 0 ? (
          <div className="card p-6 text-center text-sm text-gray-400">No customers yet.</div>
        ) : (
          customers.map((c) => {
            const contact = c.contacts[0];
            return (
              <div key={c.id} className="data-card">
                <p className="text-sm font-semibold text-gray-900 truncate">{c.name}</p>
                <p className="text-xs text-gray-500 mb-2 truncate">{c.address ?? "No address on file"}</p>
                {contact && (
                  <div className="data-card-row">
                    <span className="label">Contact</span>
                    <span className="value">{contact.name}{contact.phone && ` · ${contact.phone}`}</span>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">New customer</h3>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <form onSubmit={submit} className="space-y-3">
              <input required placeholder="Company name" className="field w-full" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <textarea placeholder="Address (optional)" rows={2} className="field w-full" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input required placeholder="Contact name" className="field" value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
                <input required placeholder="Contact phone (login)" className="field" value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} />
              </div>
              <input type="email" placeholder="Contact email (optional)" className="field w-full" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} />
              <p className="text-[11px] text-gray-400">The phone number is what the customer uses to log in with their Order ID.</p>

              {formError && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{formError}</p>}

              <div className="flex justify-end gap-3 pt-1">
                <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary px-4 py-2 text-sm">{saving ? "Creating…" : "Create customer"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
