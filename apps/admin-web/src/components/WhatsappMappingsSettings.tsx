"use client";

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/apiClient";
import { useAuth } from "@/components/AuthContext";
import {
  eligibleUsers, enableBlocker, looksLikePhone, mappingStatus, toggleRequest,
  type MappingRow, type UserOption,
} from "@/lib/whatsappMappings";

const EMPTY_FORM = { userId: "", phone: "", note: "", enableNow: true };

/** Super Admin only: which staff phone numbers may talk to the Zan WhatsApp agent.
 * Uses the existing /whatsapp/mappings API (super_admin + manage_settings). New numbers are
 * created switched off by the API; "Enable now" calls /:id/enable straight after. */
export default function WhatsappMappingsSettings() {
  const { user, hasPermission } = useAuth();
  const canManage = user?.role.key === "super_admin" && hasPermission("manage_settings");

  const [rows, setRows] = useState<MappingRow[] | null>(null);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ mappings: MappingRow[] }>("/whatsapp/mappings");
      setRows(data.mappings);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const loadUsers = useCallback(async () => {
    try {
      setUsers(eligibleUsers(await api<UserOption[]>("/users")));
    } catch {
      setUsers([]); // /users needs manage_users; the form then explains it
    }
  }, []);

  useEffect(() => {
    if (canManage) {
      load();
      loadUsers();
    }
  }, [canManage, load, loadUsers]);

  if (!canManage) return null;

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!form.userId) return setError("Choose a user.");
    if (!looksLikePhone(form.phone)) return setError("Enter the phone as +<country code><number>, or a 10-digit Indian mobile.");
    await run("add", async () => {
      const { mapping } = await api<{ mapping: MappingRow }>("/whatsapp/mappings", {
        method: "POST",
        body: JSON.stringify({ userId: form.userId, phone: form.phone.trim(), note: form.note.trim() || undefined }),
      });
      if (form.enableNow) await api(`/whatsapp/mappings/${mapping.id}/enable`, { method: "POST" });
      setForm(EMPTY_FORM);
      setShowForm(false);
    });
  }

  function remove(r: MappingRow) {
    if (!confirm(`Remove WhatsApp access for ${r.phoneE164}${r.user ? ` (${r.user.name})` : ""}?`)) return;
    run(r.id, () => api(`/whatsapp/mappings/${r.id}`, { method: "DELETE" }));
  }

  return (
    <section className="card p-4 sm:p-6">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-base sm:text-lg font-semibold">WhatsApp numbers</h2>
        <button className="btn-primary px-3 py-1.5 text-sm" onClick={() => setShowForm(true)}>
          + Add number
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-5">
        Staff numbers allowed to use the Zan agent on WhatsApp. Messages from numbers that are not
        listed here, or are switched off, are ignored. Each user can have one number switched on.
        The number must also be on the bridge allowlist.
      </p>

      {error && (
        <p className="mb-4 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>
      )}

      {rows === null ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-400">No numbers added yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-medium text-gray-500 border-b border-gray-100">
                <th className="py-2 pr-3">WhatsApp on</th>
                <th className="py-2 pr-3">Phone</th>
                <th className="py-2 pr-3">User</th>
                <th className="py-2 pr-3">Role</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Note</th>
                <th className="py-2 pr-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const blocker = enableBlocker(r, rows);
                const status = mappingStatus(r);
                return (
                  <tr key={r.id} className="border-b border-gray-50">
                    <td className="py-2 pr-3">
                      <input
                        type="checkbox"
                        aria-label={`WhatsApp on for ${r.user?.name ?? "this number"}`}
                        checked={r.enabled}
                        disabled={busy === r.id || (!r.enabled && !!blocker)}
                        title={!r.enabled && blocker ? blocker : undefined}
                        onChange={(e) => {
                          const req = toggleRequest(r, rows, e.target.checked);
                          if (req && "path" in req) run(r.id, () => api(req.path, { method: "POST" }));
                        }}
                      />
                    </td>
                    <td className="py-2 pr-3 font-medium whitespace-nowrap">{r.phoneE164}</td>
                    <td className="py-2 pr-3">
                      {r.user?.name ?? "Unknown user"}
                      {r.user && !r.user.isActive && <span className="ml-1 text-xs text-amber-600">(inactive)</span>}
                    </td>
                    <td className="py-2 pr-3 text-gray-500">{r.user?.roleKey ?? "-"}</td>
                    <td className="py-2 pr-3">
                      <span className={`badge ${status === "On" ? "badge-accent" : ""}`}>{status}</span>
                    </td>
                    <td className="py-2 pr-3 text-gray-500">{r.note ?? ""}</td>
                    <td className="py-2 pr-3 text-right space-x-2 whitespace-nowrap">
                      {r.enabled && (
                        <button
                          className="text-xs text-gray-500 hover:text-gray-700"
                          disabled={busy === r.id}
                          onClick={() => run(r.id, () => api(`/whatsapp/mappings/${r.id}/${r.aiPaused ? "unpause" : "pause"}`, { method: "POST" }))}
                        >
                          {r.aiPaused ? "Resume AI" : "Pause AI"}
                        </button>
                      )}
                      <button className="text-xs text-red-500 hover:text-red-700" disabled={busy === r.id} onClick={() => remove(r)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <form onSubmit={add} className="mt-5 pt-5 border-t border-gray-100 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="User">
              <select className="field w-full" required value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })}>
                <option value="">Select a staff user…</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}{u.role?.name ? ` - ${u.role.name}` : ""}
                  </option>
                ))}
              </select>
              {users.length === 0 && (
                <p className="text-xs text-amber-600 mt-1">No eligible users loaded (needs active staff with a WhatsApp role).</p>
              )}
            </Field>
            <Field label="WhatsApp phone number">
              <input
                className="field w-full"
                required
                inputMode="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="+91 98765 43210"
              />
            </Field>
          </div>
          <Field label="Note (optional)">
            <input
              className="field w-full"
              maxLength={500}
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              placeholder="e.g. Pilot test"
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.enableNow} onChange={(e) => setForm({ ...form, enableNow: e.target.checked })} />
            Switch on now
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="px-4 py-2 text-sm text-gray-500" onClick={() => { setShowForm(false); setForm(EMPTY_FORM); }}>
              Cancel
            </button>
            <button type="submit" disabled={busy === "add"} className="btn-primary px-4 py-2 text-sm">
              {busy === "add" ? "Saving…" : "Save number"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  );
}
