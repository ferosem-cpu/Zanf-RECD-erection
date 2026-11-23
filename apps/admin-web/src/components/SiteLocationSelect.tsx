"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/apiClient";
import { locationOptions, type LocationRow } from "@/lib/customerLocations";

/** Which of the customer's locations a site belongs to (staff). Portal users limited to a location only see their location's sites. */
export function SiteLocationSelect({ siteId, customerId, initialLocationId, canEdit }: { siteId: string; customerId: string; initialLocationId: string | null; canEdit: boolean }) {
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [value, setValue] = useState(initialLocationId ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { api<LocationRow[]>("/customers/" + customerId + "/locations").then(setLocations).catch(() => {}); }, [customerId]);
  if (locations.length === 0 && !initialLocationId) return null; // customers without locations see nothing new
  async function save(v: string) {
    setMsg(null);
    try { await api("/sites/" + siteId + "/location", { method: "PUT", body: JSON.stringify({ customerLocationId: v || null }) }); setValue(v); setMsg("Saved"); }
    catch (e) { setMsg(e instanceof Error ? e.message : "Could not save"); }
  }
  return (
    <section className="card p-5 space-y-2" data-testid="site-location">
      <h2 className="text-sm font-semibold">Customer location</h2>
      <p className="text-xs text-gray-500">Portal users limited to a location see only the sites of their location. Unassigned sites are visible to customer admins only.</p>
      <div className="flex flex-wrap items-center gap-2">
        <select className="input max-w-xs" value={value} disabled={!canEdit} onChange={(e) => void save(e.target.value)} aria-label="Customer location">
          <option value="">Unassigned (customer admins only)</option>
          {locationOptions(locations, value || null).map((l) => <option key={l.id} value={l.id}>{l.name}{l.active ? "" : " (deactivated)"}</option>)}
        </select>
        {msg && <span className="text-xs text-gray-500" role="status">{msg}</span>}
      </div>
    </section>
  );
}
