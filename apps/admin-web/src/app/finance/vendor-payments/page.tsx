"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, downloadFileFromApi, openFileFromApi } from "@/lib/apiClient";
import { useAuth } from "@/components/AuthContext";
import { formatINR, formatDate, PAYMENT_METHOD_LABEL } from "@/lib/finance";
import { MAX_ATTACHMENTS, fileSize, addFiles, uploadAttachments, PendingFiles, AttachmentPicker } from "@/components/PaymentAttachments";
import { DataTable } from "@/components/DataTable";

interface Supplier { id: string; name: string; }
interface SiteOption { id: string; address: string | null; companyName: string | null; order: { id: string; orderNumber: string; customer: { id: string; name: string } } }
interface OpenBill {
  id: string;
  billNumber: string;
  billDate: string;
  status: string;
  total: string;
  amountPaid: string;
  balance: string;
  allocations?: { order: { id: string; orderNumber: string } | null }[];
}
interface PaymentAttachment { id: string; fileName: string; mimeType: string; sizeBytes: number; }
interface PaymentMadeRow {
  id: string;
  /** Cash paid. */
  amount: string;
  /** TDS withheld from the supplier - settles the bill alongside the cash. */
  tdsAmount?: string | null;
  tdsCertificateRef?: string | null;
  method: string;
  reference?: string | null;
  paidDate: string;
  notes?: string | null;
  supplier: { id: string; name: string };
  bill: { id: string; billNumber: string } | null;
  orderTags: { id: string; order: { id: string; orderNumber: string } }[];
  attachments?: PaymentAttachment[];
}

const tdsOf = (r: PaymentMadeRow) => parseFloat(r.tdsAmount ?? "0") || 0;
const attachmentPath = (paymentId: string, a: PaymentAttachment) => `/bills/payments/${paymentId}/attachments/${a.id}`;

/** Bill option label annotated with its own allocated order number(s), if any, so the admin
 * can visually match a tagged advance against the bill it's actually for. */
function billOrderLabel(b: OpenBill) {
  const orderNumbers = Array.from(new Set((b.allocations ?? []).map((a) => a.order?.orderNumber).filter((v): v is string => !!v)));
  return orderNumbers.length ? ` · Order ${orderNumbers.join(", ")}` : "";
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <dt className="text-xs font-medium text-gray-500">{label}</dt>
      <dd className="text-right text-gray-900">{children}</dd>
    </div>
  );
}

const today = () => new Date().toISOString().slice(0, 10);

export default function VendorPaymentsPage() {
  const { hasPermission } = useAuth();
  const canRecord = hasPermission("record_payments");

  const [rows, setRows] = useState<PaymentMadeRow[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState("");
  const [openBills, setOpenBills] = useState<OpenBill[]>([]);
  const [billId, setBillId] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("bank_transfer");
  const [reference, setReference] = useState("");
  const [paidDate, setPaidDate] = useState(today());
  const [notes, setNotes] = useState("");
  // Optional order tag(s): which order(s) this payment/advance is for, so it's easy to find
  // and manually match against a bill for the same order later. Picked by site (the same
  // picker pattern as the vendor-invoice allocations editor) since orders aren't otherwise
  // browsable from here.
  const [orderTagIds, setOrderTagIds] = useState<string[]>([]);
  const [orderTagToAdd, setOrderTagToAdd] = useState("");
  // Optional TDS withheld (bill payments only) and supporting documents.
  const [tdsAmount, setTdsAmount] = useState("");
  const [tdsCertificateRef, setTdsCertificateRef] = useState("");
  const [files, setFiles] = useState<File[]>([]);

  // Edit modal (details, TDS, attachments - the cash amount/bill stay fixed)
  const [editFor, setEditFor] = useState<PaymentMadeRow | null>(null);
  const [editMethod, setEditMethod] = useState("bank_transfer");
  const [editReference, setEditReference] = useState("");
  const [editPaidDate, setEditPaidDate] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editTds, setEditTds] = useState("");
  const [editTdsRef, setEditTdsRef] = useState("");
  const [editRemoveIds, setEditRemoveIds] = useState<string[]>([]);
  const [editFiles, setEditFiles] = useState<File[]>([]);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  // Apply-advance mini modal
  const [applyFor, setApplyFor] = useState<PaymentMadeRow | null>(null);
  const [applyBills, setApplyBills] = useState<OpenBill[]>([]);
  const [applyBillId, setApplyBillId] = useState("");
  const [applyAmount, setApplyAmount] = useState("");
  const [applySaving, setApplySaving] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  // Detail drawer
  const [detail, setDetail] = useState<PaymentMadeRow | null>(null);
  const drawerCloseRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  function openDetail(row: PaymentMadeRow) {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    setDetail(row);
  }
  function closeDetail() {
    setDetail(null);
    returnFocusRef.current?.focus();
  }
  useEffect(() => {
    if (!detail) return;
    drawerCloseRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDetail();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [detail]);

  function load() {
    api<PaymentMadeRow[]>("/bills/payments").then(setRows).catch((e) => setError(e instanceof Error ? e.message : "Failed"));
    api<Supplier[]>("/purchase-orders/suppliers").then(setSuppliers).catch(() => {});
    api<SiteOption[]>("/meta/sites").then(setSites).catch(() => {});
  }
  useEffect(load, []);

  function openModal() {
    setFormError(null);
    setError(null);
    setSupplierId("");
    setOpenBills([]);
    setBillId("");
    setAmount("");
    setMethod("bank_transfer");
    setReference("");
    setPaidDate(today());
    setNotes("");
    setOrderTagIds([]);
    setOrderTagToAdd("");
    setTdsAmount("");
    setTdsCertificateRef("");
    setFiles([]);
    setOpen(true);
  }

  async function viewAttachment(paymentId: string, a: PaymentAttachment) {
    setFileError(null);
    try { await openFileFromApi(attachmentPath(paymentId, a)); } catch (err) { setFileError(err instanceof Error ? err.message : "Could not open the file"); }
  }
  async function downloadAttachment(paymentId: string, a: PaymentAttachment) {
    setFileError(null);
    try { await downloadFileFromApi(`${attachmentPath(paymentId, a)}?download=1`, {}, a.fileName); } catch (err) { setFileError(err instanceof Error ? err.message : "Could not download the file"); }
  }

  function openEdit(row: PaymentMadeRow) {
    setEditError(null);
    setEditFor(row);
    setEditMethod(row.method);
    setEditReference(row.reference ?? "");
    setEditPaidDate(row.paidDate.slice(0, 10));
    setEditNotes(row.notes ?? "");
    setEditTds(tdsOf(row) ? String(tdsOf(row)) : "");
    setEditTdsRef(row.tdsCertificateRef ?? "");
    setEditRemoveIds([]);
    setEditFiles([]);
  }

  async function submitEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editFor) return;
    setEditSaving(true);
    setEditError(null);
    try {
      const updated = await api<PaymentMadeRow>(`/bills/payments/${editFor.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          method: editMethod,
          reference: editReference || null,
          paidDate: editPaidDate ? new Date(editPaidDate).toISOString() : undefined,
          notes: editNotes || null,
          ...(editFor.bill ? { tdsAmount: parseFloat(editTds) || 0, tdsCertificateRef: editTdsRef || null } : {}),
          removeAttachmentIds: editRemoveIds.length ? editRemoveIds : undefined,
        }),
      });
      const failed = await uploadAttachments(editFor.id, editFiles);
      load();
      if (failed.length) {
        setEditFor(updated);
        setEditFiles([]);
        setEditRemoveIds([]);
        setEditError(`Saved, but these files were not attached: ${failed.join("; ")}`);
        return;
      }
      setEditFor(null);
      setDetail(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to save changes");
    } finally {
      setEditSaving(false);
    }
  }

  function addOrderTag() {
    if (!orderTagToAdd || orderTagIds.includes(orderTagToAdd)) return;
    setOrderTagIds([...orderTagIds, orderTagToAdd]);
    setOrderTagToAdd("");
  }
  function removeOrderTag(orderId: string) {
    setOrderTagIds(orderTagIds.filter((id) => id !== orderId));
  }
  function orderNumberFor(orderId: string) {
    return sites.find((s) => s.order.id === orderId)?.order.orderNumber ?? orderId;
  }

  async function pickSupplier(id: string) {
    setSupplierId(id);
    setBillId("");
    if (!id) { setOpenBills([]); return; }
    const all = await api<OpenBill[]>(`/bills?supplierId=${id}`).catch(() => []);
    setOpenBills(all.filter((b) => b.status === "approved" || b.status === "partially_paid"));
  }

  const selectedBill = openBills.find((b) => b.id === billId);
  const amountNum = parseFloat(amount) || 0;
  // TDS only applies to a bill payment; it settles the bill alongside the cash (server rule in
  // services/vendorPaymentTds.ts), so the cash that fits on the bill is balance - TDS.
  const tdsNum = selectedBill ? parseFloat(tdsAmount) || 0 : 0;
  const cashRoom = selectedBill ? Math.max(0, parseFloat(selectedBill.balance) - tdsNum) : 0;
  const willAdvance = selectedBill ? Math.max(0, amountNum - cashRoom) : amountNum;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const created = await api<{ paymentId?: string | null }>("/bills/payments", {
        method: "POST",
        body: JSON.stringify({
          supplierId,
          billId: billId || undefined,
          amount: amountNum,
          tdsAmount: tdsNum > 0 ? tdsNum : undefined,
          tdsCertificateRef: tdsNum > 0 && tdsCertificateRef ? tdsCertificateRef : undefined,
          method,
          reference: reference || undefined,
          paidDate: paidDate ? new Date(paidDate).toISOString() : undefined,
          notes: notes || undefined,
          orderIds: orderTagIds.length ? orderTagIds : undefined,
        }),
      });
      const failed = created.paymentId ? await uploadAttachments(created.paymentId, files) : files.map((f) => f.name);
      load();
      if (failed.length) {
        // The payment is saved - don't let a retry record it twice. Attach the rest via Edit.
        setOpen(false);
        setError(`Payment recorded, but these files were not attached (use Edit on the payment to retry): ${failed.join("; ")}`);
        return;
      }
      setOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to record payment");
    } finally {
      setSaving(false);
    }
  }

  async function openApply(row: PaymentMadeRow) {
    setApplyError(null);
    setApplyFor(row);
    setApplyBillId("");
    setApplyAmount(row.amount);
    const all = await api<OpenBill[]>(`/bills?supplierId=${row.supplier.id}`).catch(() => []);
    setApplyBills(all.filter((b) => b.status === "approved" || b.status === "partially_paid"));
  }

  const applySelectedBill = applyBills.find((b) => b.id === applyBillId);

  async function submitApply(e: React.FormEvent) {
    e.preventDefault();
    if (!applyFor) return;
    setApplySaving(true);
    setApplyError(null);
    try {
      await api(`/bills/${applyBillId}/apply-advance`, {
        method: "POST",
        body: JSON.stringify({ paymentId: applyFor.id, amount: parseFloat(applyAmount) }),
      });
      setApplyFor(null);
      load();
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : "Failed to apply advance");
    } finally {
      setApplySaving(false);
    }
  }

  return (
    <div className="space-y-6" data-testid="vendor-payments-page">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight" style={{ color: "var(--text-heading)" }}>Vendor Payments</h1>
          <p className="mt-1 text-sm text-gray-500">Every payment made to a supplier - pick a bill to pay it down, or leave it unpicked to hold the money as a standing advance. Paying more than a bill&apos;s balance automatically splits the extra into an advance.</p>
        </div>
        {canRecord && (
          <button onClick={openModal} className="btn-primary px-4 py-2 text-sm self-start sm:self-auto">+ Record vendor payment</button>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <DataTable
        storageKey="vendor-payments"
        title="Vendor Payments"
        rows={rows}
        rowKey={(r) => r.id}
        emptyMessage="No vendor payments recorded yet."
        onRowClick={openDetail}
        columns={[
          { key: "supplier", label: "Supplier", accessor: (r) => r.supplier.name, alwaysVisible: true },
          { key: "paidDate", label: "Date", accessor: (r) => formatDate(r.paidDate), filterType: "text" },
          { key: "amount", label: "Amount", accessor: (r) => r.amount, render: (r) => formatINR(r.amount) },
          { key: "tds", label: "TDS", accessor: (r) => String(tdsOf(r)), render: (r) => (tdsOf(r) ? formatINR(String(tdsOf(r))) : <span className="text-gray-300">—</span>) },
          { key: "method", label: "Method", accessor: (r) => PAYMENT_METHOD_LABEL[r.method] ?? r.method },
          {
            key: "attachments",
            label: "Files",
            accessor: (r) => String(r.attachments?.length ?? 0),
            render: (r) => (r.attachments?.length ? <span className="text-xs text-gray-600">{r.attachments.length} file{r.attachments.length === 1 ? "" : "s"}</span> : <span className="text-gray-300">—</span>),
          },
          {
            key: "bill",
            label: "Applied to",
            accessor: (r) => r.bill?.billNumber ?? "",
            render: (r) =>
              r.bill ? (
                <Link href={`/finance/vendor-invoices/${r.bill.id}`} className="font-mono text-xs text-[var(--theme-accent)] hover:underline">
                  {r.bill.billNumber}
                </Link>
              ) : (
                <span className="font-medium text-amber-600">Standing advance</span>
              ),
          },
          {
            key: "orderTags",
            label: "Order tag(s)",
            accessor: (r) => r.orderTags.map((t) => t.order.orderNumber).join(", "),
            render: (r) =>
              r.orderTags.length ? (
                <div className="flex flex-wrap gap-1">
                  {r.orderTags.map((t) => (
                    <span key={t.id} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{t.order.orderNumber}</span>
                  ))}
                </div>
              ) : <span className="text-gray-300">—</span>,
          },
          {
            key: "actions",
            label: "",
            accessor: () => "",
            render: (r) =>
              !r.bill && canRecord ? (
                <button onClick={() => openApply(r)} className="text-xs font-medium text-[var(--theme-accent)] hover:underline">
                  Apply to a bill
                </button>
              ) : null,
          },
        ]}
      >
        {(filteredRows) => (
          <div className="cards-mobile">
            {filteredRows.length === 0 ? (
              <div className="card p-6 text-center text-sm text-gray-400">
                {rows.length === 0 ? "No vendor payments recorded yet." : "No rows match the current filters."}
              </div>
            ) : (
              filteredRows.map((r) => (
                <div key={r.id} className="data-card">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <span className="text-sm font-semibold text-gray-900">{r.supplier.name}</span>
                    <span className="text-xs text-gray-500">{formatDate(r.paidDate)}</span>
                  </div>
                  <div className="data-card-row"><span className="label">Amount</span><span className="value font-semibold">{formatINR(r.amount)}</span></div>
                  {tdsOf(r) > 0 && (
                    <div className="data-card-row"><span className="label">TDS</span><span className="value">{formatINR(String(tdsOf(r)))}</span></div>
                  )}
                  <div className="data-card-row">
                    <span className="label">Applied to</span>
                    <span className="value">{r.bill ? r.bill.billNumber : <span className="font-medium text-amber-600">Standing advance</span>}</span>
                  </div>
                  {r.orderTags.length > 0 && (
                    <div className="data-card-row">
                      <span className="label">Order tag(s)</span>
                      <span className="value">{r.orderTags.map((t) => t.order.orderNumber).join(", ")}</span>
                    </div>
                  )}
                  <div className="mt-2 flex gap-4">
                    <button onClick={() => openDetail(r)} className="text-xs font-medium text-[var(--theme-accent)] hover:underline">View details</button>
                    {!r.bill && canRecord && (
                      <button onClick={() => openApply(r)} className="text-xs font-medium text-[var(--theme-accent)] hover:underline">Apply to a bill</button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </DataTable>


      {detail && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40 print:hidden" onClick={closeDetail}>
          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="vendor-payment-detail-title"
            data-testid="vendor-payment-detail"
            className="h-full w-full max-w-md overflow-y-auto bg-white p-5 shadow-2xl sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 id="vendor-payment-detail-title" className="text-lg font-semibold">Vendor payment</h3>
                <p className="text-sm text-gray-500">{detail.supplier.name}</p>
              </div>
              <button ref={drawerCloseRef} onClick={closeDetail} aria-label="Close details" className="text-gray-400 hover:text-gray-600">✕</button>
            </div>

            <dl className="divide-y divide-gray-100 text-sm">
              <DetailRow label="Amount"><span className="text-base font-semibold">{formatINR(detail.amount)}</span></DetailRow>
              {tdsOf(detail) > 0 && (
                <>
                  <DetailRow label="TDS deducted">{formatINR(String(tdsOf(detail)))}</DetailRow>
                  <DetailRow label="Settles on bill">{formatINR(String(parseFloat(detail.amount) + tdsOf(detail)))}</DetailRow>
                  <DetailRow label="TDS certificate ref">{detail.tdsCertificateRef || <span className="text-gray-300">—</span>}</DetailRow>
                </>
              )}
              <DetailRow label="Date paid">{formatDate(detail.paidDate)}</DetailRow>
              <DetailRow label="Method">{PAYMENT_METHOD_LABEL[detail.method] ?? detail.method}</DetailRow>
              <DetailRow label="Reference">{detail.reference || <span className="text-gray-300">—</span>}</DetailRow>
              <DetailRow label="Applied to">
                {detail.bill ? (
                  <Link href={`/finance/vendor-invoices/${detail.bill.id}`} className="font-mono text-xs text-[var(--theme-accent)] hover:underline">
                    {detail.bill.billNumber}
                  </Link>
                ) : (
                  <span className="font-medium text-amber-600">Standing advance</span>
                )}
              </DetailRow>
              <DetailRow label="Order tag(s)">
                {detail.orderTags.length ? (
                  <div className="flex flex-wrap justify-end gap-1">
                    {detail.orderTags.map((t) => (
                      <span key={t.id} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{t.order.orderNumber}</span>
                    ))}
                  </div>
                ) : <span className="text-gray-300">—</span>}
              </DetailRow>
              <DetailRow label="Notes">{detail.notes || <span className="text-gray-300">—</span>}</DetailRow>
            </dl>

            <div className="mt-5">
              <h4 className="mb-2 text-xs font-medium text-gray-500">Attachments</h4>
              {detail.attachments?.length ? (
                <ul className="space-y-2" data-testid="vendor-payment-attachments">
                  {detail.attachments.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2 text-sm">
                      <span className="min-w-0">
                        <span className="block truncate text-gray-900">{a.fileName}</span>
                        <span className="text-xs text-gray-400">{a.mimeType === "application/pdf" ? "PDF" : "Image"} · {fileSize(a.sizeBytes)}</span>
                      </span>
                      <span className="flex shrink-0 gap-3">
                        <button onClick={() => viewAttachment(detail.id, a)} className="text-xs font-medium text-[var(--theme-accent)] hover:underline">View</button>
                        <button onClick={() => downloadAttachment(detail.id, a)} className="text-xs font-medium text-[var(--theme-accent)] hover:underline">Download</button>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-gray-300">No files attached.</p>
              )}
              {fileError && <p className="mt-2 text-sm text-red-600">{fileError}</p>}
            </div>

            <div className="mt-6 flex justify-end gap-3">
              {canRecord && (
                <button onClick={() => { const row = detail; setDetail(null); openEdit(row); }} className="rounded-lg border border-gray-300 px-4 py-2 text-sm">Edit</button>
              )}
              {!detail.bill && canRecord && (
                <button
                  onClick={() => { const row = detail; setDetail(null); openApply(row); }}
                  className="btn-primary px-4 py-2 text-sm"
                >
                  Apply to a bill
                </button>
              )}
              <button onClick={closeDetail} className="rounded-lg border border-gray-300 px-4 py-2 text-sm">Close</button>
            </div>
          </aside>
        </div>
      )}

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Record vendor payment</h3>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Supplier</label>
                <select required className="field w-full" value={supplierId} onChange={(e) => pickSupplier(e.target.value)}>
                  <option value="">Choose…</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>

              {supplierId && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Bill (optional - leave blank for a pure advance)</label>
                  <select className="field w-full" value={billId} onChange={(e) => setBillId(e.target.value)}>
                    <option value="">No bill - hold as advance</option>
                    {openBills.map((b) => (
                      <option key={b.id} value={b.id}>{b.billNumber} · outstanding {formatINR(b.balance)}{billOrderLabel(b)}</option>
                    ))}
                  </select>
                  {openBills.length === 0 && <p className="mt-1 text-xs text-gray-400">No open bills for this supplier - the full amount will be held as an advance.</p>}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Order tag(s) (optional - which order this payment is for, so it&apos;s easy to match against that order&apos;s bill later)</label>
                <div className="flex gap-2">
                  <select className="field flex-1" value={orderTagToAdd} onChange={(e) => setOrderTagToAdd(e.target.value)}>
                    <option value="">Choose an order…</option>
                    {sites.filter((s) => !orderTagIds.includes(s.order.id)).map((s) => (
                      <option key={s.order.id} value={s.order.id}>{s.order.orderNumber} · {s.order.customer.name}</option>
                    ))}
                  </select>
                  <button type="button" onClick={addOrderTag} disabled={!orderTagToAdd} className="rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:opacity-40">+ Add</button>
                </div>
                {orderTagIds.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {orderTagIds.map((id) => (
                      <span key={id} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">
                        {orderNumberFor(id)}
                        <button type="button" onClick={() => removeOrderTag(id)} className="text-gray-400 hover:text-gray-600">✕</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Amount paid (₹)</label>
                  <input type="number" step="0.01" required className="field w-full" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Date paid</label>
                  <input type="date" required className="field w-full" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Method</label>
                  <select className="field w-full" value={method} onChange={(e) => setMethod(e.target.value)}>
                    <option value="bank_transfer">Bank Transfer</option>
                    <option value="upi">UPI</option>
                    <option value="cheque">Cheque</option>
                    <option value="cash">Cash</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Reference (UTR / cheque no)</label>
                  <input className="field w-full" value={reference} onChange={(e) => setReference(e.target.value)} />
                </div>
              </div>

              {selectedBill && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">TDS deducted (₹, optional)</label>
                    <input type="number" step="0.01" min="0" className="field w-full" value={tdsAmount} onChange={(e) => setTdsAmount(e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">TDS certificate / challan ref</label>
                    <input className="field w-full" value={tdsCertificateRef} onChange={(e) => setTdsCertificateRef(e.target.value)} disabled={!tdsNum} />
                  </div>
                  <p className="col-span-2 -mt-1 text-xs text-gray-400">TDS you withheld settles the bill along with the cash: bill balance = total − cash − TDS.</p>
                </div>
              )}

              {selectedBill && (amountNum > 0 || tdsNum > 0) && (
                <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm flex justify-between">
                  <span className="text-gray-500">{willAdvance > 0.01 ? "Applied to bill + advance" : "Applied to bill"}</span>
                  <span className="font-semibold">
                    {formatINR(String(Math.min(amountNum, cashRoom)))}
                    {tdsNum > 0 && <span> + {formatINR(String(tdsNum))} TDS</span>}
                    {willAdvance > 0.01 && <span className="text-amber-600"> + {formatINR(String(willAdvance))} advance</span>}
                  </span>
                </div>
              )}
              {selectedBill && tdsNum > parseFloat(selectedBill.balance) + 0.01 && (
                <p className="text-xs text-red-600">TDS can&apos;t exceed the bill&apos;s outstanding balance ({formatINR(selectedBill.balance)}).</p>
              )}
              {!billId && amountNum > 0 && (
                <p className="text-xs text-gray-400">The full {formatINR(String(amountNum))} will be held as a standing advance for this supplier.</p>
              )}

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
                <input className="field w-full" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>

              <AttachmentPicker files={files} onChange={setFiles} />

              {formError && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{formError}</p>}
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm">Cancel</button>
                <button type="submit" disabled={saving || (!!selectedBill && tdsNum > parseFloat(selectedBill.balance) + 0.01)} className="btn-primary px-4 py-2 text-sm">{saving ? "Saving…" : "Record payment"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editFor && (
        <div className="modal-backdrop" onClick={() => setEditFor(null)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()} data-testid="vendor-payment-edit">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Edit vendor payment</h3>
              <button onClick={() => setEditFor(null)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <p className="mb-4 text-sm text-gray-500">
              {editFor.supplier.name} · {formatINR(editFor.amount)} {editFor.bill ? <>against {editFor.bill.billNumber}</> : "(standing advance)"}.
              The amount and bill can&apos;t be changed here.
            </p>
            <form onSubmit={submitEdit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Method</label>
                  <select className="field w-full" value={editMethod} onChange={(e) => setEditMethod(e.target.value)}>
                    <option value="bank_transfer">Bank Transfer</option>
                    <option value="upi">UPI</option>
                    <option value="cheque">Cheque</option>
                    <option value="cash">Cash</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Date paid</label>
                  <input type="date" required className="field w-full" value={editPaidDate} onChange={(e) => setEditPaidDate(e.target.value)} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Reference (UTR / cheque no)</label>
                <input className="field w-full" value={editReference} onChange={(e) => setEditReference(e.target.value)} />
              </div>
              {editFor.bill ? (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">TDS deducted (₹)</label>
                    <input type="number" step="0.01" min="0" className="field w-full" value={editTds} onChange={(e) => setEditTds(e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">TDS certificate / challan ref</label>
                    <input className="field w-full" value={editTdsRef} onChange={(e) => setEditTdsRef(e.target.value)} />
                  </div>
                </div>
              ) : (
                <p className="text-xs text-gray-400">A standing advance carries no TDS - apply it to a bill first.</p>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
                <input className="field w-full" value={editNotes} onChange={(e) => setEditNotes(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Attachments</label>
                {(editFor.attachments ?? []).length > 0 && (
                  <ul className="mb-2 space-y-1">
                    {(editFor.attachments ?? []).map((a) => {
                      const removing = editRemoveIds.includes(a.id);
                      return (
                        <li key={a.id} className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-1.5 text-xs">
                          <span className={`truncate ${removing ? "text-gray-400 line-through" : "text-gray-700"}`}>{a.fileName} · {fileSize(a.sizeBytes)}</span>
                          <button
                            type="button"
                            onClick={() => setEditRemoveIds(removing ? editRemoveIds.filter((x) => x !== a.id) : [...editRemoveIds, a.id])}
                            className="shrink-0 text-xs font-medium text-[var(--theme-accent)] hover:underline"
                          >
                            {removing ? "Keep" : "Remove"}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {(() => {
                  const keep = (editFor.attachments ?? []).length - editRemoveIds.length;
                  return (
                    <>
                      <input
                        type="file"
                        multiple
                        accept="image/*,application/pdf"
                        className="block w-full text-sm"
                        disabled={keep + editFiles.length >= MAX_ATTACHMENTS}
                        onChange={(e) => { setEditFiles(addFiles(editFiles, e.target.files, keep)); e.target.value = ""; }}
                      />
                      <p className="mt-1 text-xs text-gray-400">Images or PDF, max {MAX_ATTACHMENTS} per payment.</p>
                    </>
                  );
                })()}
                <PendingFiles files={editFiles} onRemove={(i) => setEditFiles(editFiles.filter((_, j) => j !== i))} />
              </div>
              {editError && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{editError}</p>}
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setEditFor(null)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm">Cancel</button>
                <button type="submit" disabled={editSaving} className="btn-primary px-4 py-2 text-sm">{editSaving ? "Saving…" : "Save changes"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {applyFor && (
        <div className="modal-backdrop" onClick={() => setApplyFor(null)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Apply advance to a bill</h3>
              <button onClick={() => setApplyFor(null)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <p className="mb-1 text-sm text-gray-500">
              {applyFor.supplier.name} has a standing advance of {formatINR(applyFor.amount)}.
            </p>
            {applyFor.orderTags.length > 0 && (
              <p className="mb-3 text-xs text-gray-500">
                Tagged for order{applyFor.orderTags.length > 1 ? "s" : ""}: {" "}
                {applyFor.orderTags.map((t) => (
                  <span key={t.id} className="mr-1 rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-700">{t.order.orderNumber}</span>
                ))}
                — look for a bill against the same order below.
              </p>
            )}
            <form onSubmit={submitApply} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Bill</label>
                <select required className="field w-full" value={applyBillId} onChange={(e) => setApplyBillId(e.target.value)}>
                  <option value="">Choose…</option>
                  {applyBills.map((b) => (
                    <option key={b.id} value={b.id}>{b.billNumber} · outstanding {formatINR(b.balance)}{billOrderLabel(b)}</option>
                  ))}
                </select>
                {applyBills.length === 0 && <p className="mt-1 text-xs text-gray-400">No open bills for this supplier yet.</p>}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Amount to apply (₹)</label>
                <input type="number" step="0.01" required className="field w-full" value={applyAmount} onChange={(e) => setApplyAmount(e.target.value)} />
                {applySelectedBill && (
                  <p className="mt-1 text-xs text-gray-400">Bill outstanding: {formatINR(applySelectedBill.balance)} · Advance available: {formatINR(applyFor.amount)}</p>
                )}
              </div>
              {applyError && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{applyError}</p>}
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setApplyFor(null)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm">Cancel</button>
                <button type="submit" disabled={applySaving || !applyBillId} className="btn-primary px-4 py-2 text-sm">{applySaving ? "Applying…" : "Apply"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
