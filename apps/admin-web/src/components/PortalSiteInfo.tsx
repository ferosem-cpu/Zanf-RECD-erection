"use client";

import { useEffect, useState } from "react";
import { api, openFileFromApi } from "@/lib/apiClient";

export interface PortalSiteFields {
  id: string;
  source?: string | null;
  installPriority?: string | null;
  priorityReason?: string | null;
  requestedStartDate?: string | null;
  requestedCompletionDate?: string | null;
  addressParts?: { line?: string; area?: string | null; city?: string; district?: string | null; state?: string; pincode?: string } | null;
  dgLocation?: string | null;
  accessNotes?: string | null;
  dgCapacityKva?: string | null;
  dgModel?: string | null;
}
interface Item { id: string; kind: string; documentTypeKey: string | null; fileName: string | null; mimeType: string; sizeBytes: number }

const KIND_LABEL: Record<string, string> = { po: "PO document", site_photo: "Site photo", document: "Formality document", priority_document: "Priority document", complaint_photo: "Complaint photo" };
const CLASS: Record<string, string> = { critical: "status-pill status-pill-error", high: "status-pill status-pill-warning", normal: "status-pill", low: "status-pill" };
const day = (s?: string | null) => (s ? new Date(s).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" }) : "—");

/** Customer Portal details for a site: priority (editable by staff), requested dates, address parts, DG location, access notes, files. */
export function PortalSiteInfo({ site, canEdit }: { site: PortalSiteFields; canEdit: boolean }) {
  const [items, setItems] = useState<Item[]>([]);
  const [priority, setPriority] = useState(site.installPriority ?? "");
  const [reason, setReason] = useState(site.priorityReason ?? "");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    api<{ items: Item[] }>(`/sites/${site.id}/portal-attachments`).then((r) => setItems(r.items)).catch(() => {});
  }, [site.id]);

  const hasPortalData = site.source === "portal" || site.installPriority || items.length > 0;
  if (!hasPortalData && !canEdit) return null;

  async function save() {
    setMsg(null);
    try {
      await api(`/sites/${site.id}/priority`, { method: "PATCH", body: JSON.stringify({ installPriority: priority, priorityReason: reason }) });
      setMsg("Saved");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Could not save");
    }
  }

  const p = site.addressParts;
  return (
    <section className="card p-5 space-y-3" data-testid="portal-site-info">
      <h2 className="text-sm font-semibold">Customer portal details {site.source === "portal" && <span className="status-pill status-pill-warning ml-2">Portal</span>}</h2>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
        <div><dt className="inline text-gray-500">Priority: </dt><dd className="inline">{site.installPriority ? <span className={CLASS[site.installPriority] ?? "status-pill"}>{site.installPriority}</span> : "not set"}{site.priorityReason ? " — " + site.priorityReason : ""}</dd></div>
        <div><dt className="inline text-gray-500">Start by: </dt><dd className="inline">{day(site.requestedStartDate)}</dd></div>
        <div><dt className="inline text-gray-500">Complete by: </dt><dd className="inline">{day(site.requestedCompletionDate)}</dd></div>
        <div><dt className="inline text-gray-500">DG location: </dt><dd className="inline">{site.dgLocation ?? "—"}</dd></div>
        {p && <div className="sm:col-span-2"><dt className="inline text-gray-500">Address: </dt><dd className="inline">{[p.line, p.area, p.city, p.district, p.state, p.pincode].filter(Boolean).join(", ")}</dd></div>}
        {site.accessNotes && <div className="sm:col-span-2"><dt className="inline text-gray-500">Access notes: </dt><dd className="inline whitespace-pre-wrap">{site.accessNotes}</dd></div>}
      </dl>
      {canEdit && (
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Priority</label>
            <select className="field" value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="">Not set</option>
              <option value="critical">Critical</option><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option>
            </select>
          </div>
          <input className="field flex-1 min-w-[12rem]" placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button type="button" className="btn-primary px-3 py-1.5 text-sm" disabled={!priority} onClick={save}>Save priority</button>
          {msg && <span className="text-xs text-gray-500">{msg}</span>}
        </div>
      )}
      {items.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">Files from customer</h3>
          <div className="flex flex-wrap gap-2">
            {items.map((i) => (
              <button key={i.id} type="button" className="rounded-lg border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50" onClick={() => openFileFromApi(`/sites/portal-attachments/${i.id}/content`)}>
                {KIND_LABEL[i.kind] ?? i.kind}{i.documentTypeKey ? " (" + i.documentTypeKey.replace(/_/g, " ") + ")" : ""}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
