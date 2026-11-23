"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/apiClient";
import { accessLabel, locationOptions, type LocationRow } from "@/lib/customerLocations";

interface Contact { id: string; name: string; email: string | null; phone: string | null; isActive: boolean; customerLocationId: string | null }

/** Customer Portal access for one customer: its locations (branches) and the people who sign in to the portal, each limited to one location or none (= customer admin). */
export function CustomerPortalAccess({ customerId, canManage }: { customerId: string; canManage: boolean }) {
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newLoc, setNewLoc] = useState("");
  const [nu, setNu] = useState({ name: "", email: "", phone: "", customerLocationId: "" });

  const load = useCallback(async () => {
    try {
      const [l, c] = await Promise.all([api<LocationRow[]>("/customers/" + customerId + "/locations"), api<Contact[]>("/customers/" + customerId + "/contacts")]);
      setLocations(l); setContacts(c);
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not load portal access"); }
  }, [customerId]);
  useEffect(() => { void load(); }, [load]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setErr(null);
    try { await fn(); await load(); } catch (e) { setErr(e instanceof Error ? e.message : "Something went wrong"); } finally { setBusy(false); }
  }
  const put = (url: string, body: unknown) => api(url, { method: "PUT", body: JSON.stringify(body) });

  return (
    <section className="card p-5 space-y-5" data-testid="customer-portal-access">
      <div>
        <h2 className="text-sm font-semibold">Customer Portal access</h2>
        <p className="text-xs text-gray-500">A portal user with no location is a customer admin and sees every site of this customer. A user with a location sees only that location&apos;s sites, orders and complaints.</p>
      </div>
      {err && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{err}</div>}

      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Locations</h3>
        {locations.length === 0 && <p className="text-sm text-gray-400">No locations yet. Add one for each branch or plant (for example Bangalore, Mangalore, Mysore).</p>}
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
          {locations.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <span className={"font-medium " + (l.active ? "" : "text-gray-400 line-through")}>{l.name}</span>
              <span className="text-xs text-gray-400">{l.userCount ?? 0} user{l.userCount === 1 ? "" : "s"} · {l.siteCount ?? 0} site{l.siteCount === 1 ? "" : "s"}</span>
              {!l.active && <span className="badge">Deactivated</span>}
              {canManage && (
                <span className="ml-auto flex gap-2">
                  <button type="button" className="text-xs font-medium text-[var(--theme-accent)] disabled:opacity-50" disabled={busy}
                    onClick={() => { const n = window.prompt("Rename location", l.name); if (n && n.trim() && n.trim() !== l.name) void run(() => put("/customers/" + customerId + "/locations/" + l.id, { name: n.trim() })); }}>Rename</button>
                  <button type="button" className="text-xs font-medium text-gray-600 disabled:opacity-50" disabled={busy}
                    onClick={() => { if (l.active && !window.confirm("Deactivate " + l.name + "? Its portal users will not be able to sign in until it is reactivated or they are moved.")) return; void run(() => put("/customers/" + customerId + "/locations/" + l.id, { active: !l.active })); }}>{l.active ? "Deactivate" : "Reactivate"}</button>
                </span>)}
            </li>))}
        </ul>
        {canManage && (
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!newLoc.trim()) return; void run(async () => { await api("/customers/" + customerId + "/locations", { method: "POST", body: JSON.stringify({ name: newLoc.trim() }) }); setNewLoc(""); }); }}>
            <input className="input flex-1" placeholder="New location name, e.g. Bangalore" value={newLoc} maxLength={80} onChange={(e) => setNewLoc(e.target.value)} aria-label="New location name" />
            <button className="btn-primary" disabled={busy || !newLoc.trim()}>Add location</button>
          </form>)}
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Portal users</h3>
        {contacts.length === 0 && <p className="text-sm text-gray-400">No portal users yet.</p>}
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
          {contacts.map((c) => (
            <li key={c.id} className="space-y-1 px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className={"font-medium " + (c.isActive ? "" : "text-gray-400 line-through")}>{c.name}</span>
                <span className="text-xs text-gray-500">{c.email ?? "no e-mail"}{c.phone ? " · " + c.phone : ""}</span>
                {!c.isActive && <span className="badge">Inactive</span>}
                <span className="ml-auto text-xs text-gray-500">{accessLabel(locations, c.customerLocationId)}</span>
              </div>
              {canManage && (
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-xs text-gray-500" htmlFor={"loc-" + c.id}>Location</label>
                  <select id={"loc-" + c.id} className="input !py-1 text-xs" value={c.customerLocationId ?? ""} disabled={busy}
                    onChange={(e) => void run(() => put("/customers/" + customerId + "/contacts/" + c.id, { customerLocationId: e.target.value || null }))}>
                    <option value="">None - customer admin (all locations)</option>
                    {locationOptions(locations, c.customerLocationId).map((l) => <option key={l.id} value={l.id}>{l.name}{l.active ? "" : " (deactivated)"}</option>)}
                  </select>
                  <button type="button" className="text-xs font-medium text-gray-600 disabled:opacity-50" disabled={busy}
                    onClick={() => void run(() => put("/customers/" + customerId + "/contacts/" + c.id, { isActive: !c.isActive }))}>{c.isActive ? "Deactivate user" : "Reactivate user"}</button>
                </div>)}
            </li>))}
        </ul>
        {canManage && (
          <form className="grid gap-2 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void run(async () => {
            await api("/customers/" + customerId + "/contacts", { method: "POST", body: JSON.stringify({ name: nu.name.trim(), email: nu.email.trim(), ...(nu.phone.trim() ? { phone: nu.phone.trim() } : {}), customerLocationId: nu.customerLocationId || null }) });
            setNu({ name: "", email: "", phone: "", customerLocationId: "" });
          }); }}>
            <input className="input" placeholder="Name" value={nu.name} onChange={(e) => setNu({ ...nu, name: e.target.value })} aria-label="New portal user name" required />
            <input className="input" type="email" placeholder="E-mail (used to sign in)" value={nu.email} onChange={(e) => setNu({ ...nu, email: e.target.value })} aria-label="New portal user e-mail" required />
            <input className="input" placeholder="Mobile (for WhatsApp codes)" value={nu.phone} onChange={(e) => setNu({ ...nu, phone: e.target.value })} aria-label="New portal user mobile" />
            <select className="input" value={nu.customerLocationId} onChange={(e) => setNu({ ...nu, customerLocationId: e.target.value })} aria-label="New portal user location">
              <option value="">No location - customer admin</option>
              {locationOptions(locations).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <button className="btn-primary sm:col-span-2" disabled={busy || !nu.name.trim() || !nu.email.trim()}>Add portal user</button>
          </form>)}
      </div>
    </section>
  );
}
