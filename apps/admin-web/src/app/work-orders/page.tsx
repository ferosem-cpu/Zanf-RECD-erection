"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/apiClient";
import { useAuth } from "@/components/AuthContext";
import { WORK_ORDER_STATUS } from "@recd/shared";

interface WorkOrderRow {
  id: string;
  workOrderNumber: string;
  taskType: string;
  title: string;
  instructions: string | null;
  status: string;
  scheduledDate: string | null;
  completionNotes: string | null;
  completionPhotoUrl: string | null;
  site: { order: { customer: { name: string } } };
  assignedTo: { id: string; name: string } | null;
  createdBy: { id: string; name: string };
}

interface Assignee {
  id: string;
  name: string;
  role: { name: string };
}

interface SiteOption {
  id: string;
  address: string | null;
  order: { customer: { name: string } };
}

const STATUS_VALUES = Object.values(WORK_ORDER_STATUS);

function pretty(s: string) {
  return s.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusBadge(status: string) {
  if (status === "completed") return "status-pill status-pill-success";
  if (status === "cancelled") return "status-pill status-pill-error";
  return "status-pill status-pill-warning";
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const today = () => new Date().toISOString().slice(0, 10);

export default function WorkOrdersPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("manage_work_orders");

  const [workOrders, setWorkOrders] = useState<WorkOrderRow[]>([]);
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [taskTypes, setTaskTypes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Create modal (managers)
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({
    siteId: "",
    taskType: "installation",
    title: "",
    instructions: "",
    scheduledDate: today(),
    assignedToId: "",
  });

  // Edit/status modal (managers + assignees)
  const [editing, setEditing] = useState<WorkOrderRow | null>(null);
  const [editForm, setEditForm] = useState({ status: "", assignedToId: "", completionNotes: "" });
  const [completionPhoto, setCompletionPhoto] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  function load() {
    api<WorkOrderRow[]>("/work-orders").then(setWorkOrders).catch((err) => setError(err instanceof Error ? err.message : "Failed to load work orders"));
    if (canManage) {
      api<Assignee[]>("/work-orders/assignees").then(setAssignees).catch(() => {});
      api<SiteOption[]>("/sites").then(setSites).catch(() => {});
      api<string[]>("/meta/work-order-task-types").then(setTaskTypes).catch(() => {});
    }
  }

  useEffect(load, [canManage]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      if (!form.siteId) throw new Error("Please choose a site");
      if (!form.title.trim()) throw new Error("Please enter a title");

      await api("/work-orders", {
        method: "POST",
        body: JSON.stringify({
          siteId: form.siteId,
          taskType: form.taskType,
          title: form.title,
          instructions: form.instructions || undefined,
          scheduledDate: form.scheduledDate ? new Date(form.scheduledDate).toISOString() : undefined,
          assignedToId: form.assignedToId || undefined,
        }),
      });
      setOpen(false);
      setForm((f) => ({ ...f, title: "", instructions: "", assignedToId: "" }));
      load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create work order");
    } finally {
      setSaving(false);
    }
  }

  function openEditor(w: WorkOrderRow) {
    setEditing(w);
    setEditError(null);
    setCompletionPhoto(null);
    setEditForm({
      status: w.status,
      assignedToId: w.assignedTo?.id ?? "",
      completionNotes: w.completionNotes ?? "",
    });
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setEditSaving(true);
    setEditError(null);
    try {
      const body: Record<string, unknown> = { status: editForm.status };
      if (canManage) body.assignedToId = editForm.assignedToId || null;
      if (editForm.status === "completed") {
        body.completionNotes = editForm.completionNotes || undefined;
        if (completionPhoto) body.completionPhotoUrl = completionPhoto;
      }
      await api(`/work-orders/${editing.id}`, { method: "PATCH", body: JSON.stringify(body) });
      setEditing(null);
      load();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to update work order");
    } finally {
      setEditSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-5xl" data-testid="work-orders-page">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight" style={{ color: "var(--text-heading)" }}>Work Orders</h1>
          <p className="mt-1 text-sm text-gray-500">
            {canManage ? "Dispatch and track field tasks at each site." : "Tasks assigned to you. Update status as you work them."}
          </p>
        </div>
        {canManage && (
          <button
            data-testid="work-orders-new-button"
            onClick={() => setOpen(true)}
            className="btn-primary px-4 py-2 text-sm self-start sm:self-auto"
          >
            + New work order
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* Desktop table */}
      <div className="card overflow-hidden table-desktop">
        <div className="table-scroll">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                <th className="px-4 py-3">WO #</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Task</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Assigned to</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {workOrders.map((w) => (
                <tr key={w.id} className="hover:bg-gray-50/60">
                  <td className="px-4 py-3 font-mono text-xs font-semibold">{w.workOrderNumber}</td>
                  <td className="px-4 py-3">{w.site.order.customer.name}</td>
                  <td className="px-4 py-3">{w.title}</td>
                  <td className="px-4 py-3 capitalize">{pretty(w.taskType)}</td>
                  <td className="px-4 py-3">
                    <span className={statusBadge(w.status)}>{pretty(w.status)}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{w.assignedTo?.name ?? "Unassigned"}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => openEditor(w)}
                      className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium hover:bg-gray-50"
                    >
                      {canManage ? "Manage" : "Update"}
                    </button>
                  </td>
                </tr>
              ))}
              {workOrders.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No work orders yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile cards */}
      <div className="cards-mobile" data-testid="work-orders-mobile-cards">
        {workOrders.length === 0 ? (
          <div className="card p-6 text-center text-sm text-gray-400">No work orders yet.</div>
        ) : (
          workOrders.map((w) => (
            <div key={w.id} className="data-card" data-testid={`work-order-card-${w.workOrderNumber}`}>
              <div className="flex items-start justify-between gap-3 mb-2">
                <span className="font-mono text-xs font-semibold text-gray-900">{w.workOrderNumber}</span>
                <span className={statusBadge(w.status)}>{pretty(w.status)}</span>
              </div>
              <p className="text-sm font-semibold text-gray-900 truncate">{w.title}</p>
              <p className="text-xs text-gray-500 truncate">{w.site.order.customer.name} · {pretty(w.taskType)}</p>
              <p className="text-xs text-gray-500 mt-1">Assigned: {w.assignedTo?.name ?? "Unassigned"}</p>
              <button
                onClick={() => openEditor(w)}
                className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold hover:bg-gray-50"
                data-testid={`work-order-action-${w.workOrderNumber}`}
              >
                {canManage ? "Manage" : "Update"}
              </button>
            </div>
          ))
        )}
      </div>

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">New work order</h3>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Site</label>
                <select required className="field w-full" value={form.siteId} onChange={(e) => setForm({ ...form, siteId: e.target.value })}>
                  <option value="">Select a site</option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>{s.order.customer.name}{s.address ? ` — ${s.address}` : ""}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Task type</label>
                  <select className="field w-full" value={form.taskType} onChange={(e) => setForm({ ...form, taskType: e.target.value })}>
                    {taskTypes.map((t) => (
                      <option key={t} value={t}>{pretty(t)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Scheduled date</label>
                  <input type="date" className="field w-full" value={form.scheduledDate} onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })} />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Title</label>
                <input required placeholder="e.g. Install RECD unit" className="field w-full" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Instructions</label>
                <textarea rows={3} className="field w-full" value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Assign to</label>
                <select className="field w-full" value={form.assignedToId} onChange={(e) => setForm({ ...form, assignedToId: e.target.value })}>
                  <option value="">Unassigned (save as draft)</option>
                  {assignees.map((a) => (
                    <option key={a.id} value={a.id}>{a.name} ({a.role.name})</option>
                  ))}
                </select>
              </div>

              {formError && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{formError}</p>}

              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary px-4 py-2 text-sm">{saving ? "Creating…" : "Create work order"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold">{editing.workOrderNumber}</h3>
                <p className="text-xs text-gray-500">{editing.title}</p>
              </div>
              <button onClick={() => setEditing(null)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>

            {editing.instructions && (
              <p className="mb-4 rounded-lg bg-gray-50 p-3 text-sm text-gray-700 border border-gray-100">{editing.instructions}</p>
            )}

            <form onSubmit={saveEdit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
                  <select className="field w-full" value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}>
                    {STATUS_VALUES.map((s) => (
                      <option key={s} value={s}>{pretty(s)}</option>
                    ))}
                  </select>
                </div>
                {canManage && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Assign to</label>
                    <select className="field w-full" value={editForm.assignedToId} onChange={(e) => setEditForm({ ...editForm, assignedToId: e.target.value })}>
                      <option value="">Unassigned</option>
                      {assignees.map((a) => (
                        <option key={a.id} value={a.id}>{a.name} ({a.role.name})</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {editForm.status === "completed" && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Completion notes</label>
                    <textarea rows={3} className="field w-full" value={editForm.completionNotes} onChange={(e) => setEditForm({ ...editForm, completionNotes: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Completion photo</label>
                    <input
                      type="file"
                      accept="image/*"
                      className="field w-full"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (file) setCompletionPhoto(await fileToDataUrl(file));
                      }}
                    />
                    {(completionPhoto || editing.completionPhotoUrl) && (
                      <img src={completionPhoto ?? editing.completionPhotoUrl ?? undefined} alt="Completion" className="mt-2 h-24 w-full rounded object-cover" />
                    )}
                  </div>
                </>
              )}

              {editError && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{editError}</p>}

              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setEditing(null)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={editSaving} className="btn-primary px-4 py-2 text-sm">{editSaving ? "Saving…" : "Save"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
