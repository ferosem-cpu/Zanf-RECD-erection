"use client";

import { useCallback, useEffect, useState } from "react";
import { api, openFileFromApi } from "@/lib/apiClient";

interface Comment {
  id: string;
  body: string;
  authorIsCustomer: boolean;
  visibleToCustomer: boolean;
  createdAt: string;
  attachments: { id: string; mimeType: string }[];
}
interface Photo { id: string; mimeType: string; kind: string }

/** Customer Portal complaint thread (staff side). A reply is hidden from the customer unless "Visible to customer" is ticked. */
export function ComplaintThread({ complaintId, canReply }: { complaintId: string; canReply: boolean }) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [body, setBody] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ comments: Comment[]; photos: Photo[] }>(`/complaints/${complaintId}/comments`)
      .then((r) => { setComments(r.comments); setPhotos(r.photos); })
      .catch(() => {});
  }, [complaintId]);
  useEffect(load, [load]);

  async function send() {
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/complaints/${complaintId}/comments`, { method: "POST", body: JSON.stringify({ body, visibleToCustomer: visible }) });
      setBody("");
      setVisible(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send");
    } finally {
      setBusy(false);
    }
  }

  if (!comments.length && !photos.length && !canReply) return null;
  return (
    <div className="mb-4 space-y-3" data-testid="complaint-thread">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Conversation (customer portal)</h4>
      {photos.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {photos.map((p, i) => (
            <button key={p.id} type="button" className="rounded-lg border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50" onClick={() => openFileFromApi(`/complaints/attachments/${p.id}`)}>
              Photo {i + 1}
            </button>
          ))}
        </div>
      )}
      <ul className="space-y-2">
        {comments.map((c) => (
          <li key={c.id} className={"rounded-lg border p-2 text-sm " + (c.authorIsCustomer ? "bg-white border-gray-200" : c.visibleToCustomer ? "bg-green-50 border-green-200" : "bg-yellow-50 border-yellow-200")}>
            <div className="mb-0.5 text-[0.6875rem] text-gray-500">
              {c.authorIsCustomer ? "Customer" : c.visibleToCustomer ? "Zan-F reply (visible to customer)" : "Internal note (not visible to customer)"} · {new Date(c.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
            </div>
            <div className="whitespace-pre-wrap">{c.body}</div>
          </li>
        ))}
      </ul>
      {canReply && (
        <div className="space-y-2">
          <textarea rows={2} className="field w-full" placeholder="Write a reply or internal note" value={body} onChange={(e) => setBody(e.target.value)} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} /> Visible to customer (they will be e-mailed)
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="button" disabled={busy || !body.trim()} onClick={send} className="btn-primary px-3 py-1.5 text-sm">{busy ? "Sending…" : "Add to thread"}</button>
        </div>
      )}
    </div>
  );
}
