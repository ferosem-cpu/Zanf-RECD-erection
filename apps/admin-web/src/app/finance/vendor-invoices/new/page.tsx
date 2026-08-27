"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/apiClient";
import { useAuth } from "@/components/AuthContext";
import { captureFile, type CapturedFile } from "@/lib/fileCapture";

interface Supplier { id: string; name: string; gstin?: string | null; state?: string | null; vendorId?: string | null; }
interface Vendor { id: string; name: string; status: string; }
interface SiteOption { id: string; address: string | null; companyName: string | null; order: { id: string; orderNumber: string; customer: { id: string; name: string } }; }
interface InvoiceOption { id: string; invoiceNumber: string; docType: string; customerId: string; }
interface ExtractedLineItem { description: string; hsnCode?: string; quantity?: number; unitPrice?: number; taxRatePct?: number; }
interface ExtractedBill {
  supplierNameGuess?: string; gstinGuess?: string; billNumber?: string; billDate?: string; dueDate?: string;
  sourceTypeGuess?: string; confidence?: string; lineItems: ExtractedLineItem[]; subtotal?: number; taxAmount?: number; total?: number; notes?: string;
}
interface SupplierCandidate { id: string; name: string; gstin?: string | null; source: "supplier" | "vendor"; score: number; }
interface ExtractResponse { available: boolean; error?: string; extraction?: ExtractedBill; supplierCandidates?: SupplierCandidate[]; }

type Line = { description: string; hsnCode: string; quantity: string; unitPrice: string; taxRatePct: string };
type Allocation = { siteId: string; orderId: string; invoiceId: string; amount: string; notes: string };

const today = () => new Date().toISOString().slice(0, 10);
const emptyLine = (): Line => ({ description: "", hsnCode: "", quantity: "1", unitPrice: "", taxRatePct: "18" });
const emptyAllocation = (): Allocation => ({ siteId: "", orderId: "", invoiceId: "", amount: "", notes: "" });

export default function NewVendorInvoicePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefillSupplierId = searchParams.get("supplierId") ?? "";
  const prefillPurchaseOrderId = searchParams.get("purchaseOrderId") ?? "";
  const { hasPermission } = useAuth();
  const canCapture = hasPermission("record_vendor_invoice") || hasPermission("approve_vendor_invoice");

  const [step, setStep] = useState<1 | 2>(1);
  const [captured, setCaptured] = useState<CapturedFile | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extraction, setExtraction] = useState<ExtractedBill | null>(null);
  const [extractNote, setExtractNote] = useState<string | null>(null);
  const [supplierCandidates, setSupplierCandidates] = useState<SupplierCandidate[]>([]);

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [invoicesByCustomer, setInvoicesByCustomer] = useState<Record<string, InvoiceOption[]>>({});

  const [sourceType, setSourceType] = useState<"printed" | "handwritten" | "digital">("printed");
  const [supplierId, setSupplierId] = useState(prefillSupplierId);
  const [supplierMode, setSupplierMode] = useState<"existing" | "vendor" | "new">("existing");
  const [vendorPickId, setVendorPickId] = useState("");
  const [newSupplier, setNewSupplier] = useState({ name: "", gstin: "", state: "", contactName: "", contactPhone: "" });
  const [billNumber, setBillNumber] = useState("");
  const [billDate, setBillDate] = useState(today());
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [allocations, setAllocations] = useState<Allocation[]>([]);

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!canCapture) return;
    api<Supplier[]>("/purchase-orders/suppliers").then(setSuppliers).catch(() => {});
    api<Vendor[]>("/vendors").then((v) => setVendors(v.filter((x) => x.status === "approved"))).catch(() => {});
    api<SiteOption[]>("/meta/sites").then(setSites).catch(() => {});
  }, [canCapture]);

  async function loadInvoicesFor(customerId: string) {
    if (!customerId || invoicesByCustomer[customerId]) return;
    try {
      const list = await api<InvoiceOption[]>(`/invoices?customerId=${customerId}`);
      setInvoicesByCustomer((prev) => ({ ...prev, [customerId]: list }));
    } catch {
      // Leave the dropdown empty rather than blocking the whole flow.
    }
  }

  async function onFileSelected(file: File) {
    setCaptureError(null);
    try {
      const cap = await captureFile(file);
      setCaptured(cap);
    } catch (err) {
      setCaptureError(err instanceof Error ? err.message : "Could not read this file");
    }
  }

  async function extractWithAi() {
    if (!captured) return;
    setExtracting(true);
    setExtractNote(null);
    try {
      const res = await api<ExtractResponse>("/bills/extract", {
        method: "POST",
        body: JSON.stringify({ fileDataUrl: captured.dataUrl, mimeType: captured.mimeType }),
      });
      if (!res.available || !res.extraction) {
        setExtractNote(res.error || "AI extraction isn't available right now - please fill in the details manually.");
      } else {
        applyExtraction(res.extraction);
        const candidates = res.supplierCandidates ?? [];
        setSupplierCandidates(candidates);
        // No fuzzy match against existing suppliers/vendors means this is very likely a payee
        // we haven't seen before - jump straight to "New" so the name/GSTIN the AI already
        // read off the scan shows up pre-filled instead of a human retyping it.
        if (candidates.length === 0 && res.extraction.supplierNameGuess) {
          setSupplierMode("new");
        }
        if (res.extraction.confidence === "low") {
          setExtractNote("The AI wasn't fully confident reading this document (especially if handwritten) - please double-check every field before saving.");
        }
      }
    } catch (err) {
      setExtractNote(err instanceof Error ? err.message : "AI extraction failed - please fill in the details manually.");
    } finally {
      setExtracting(false);
      goToReview();
    }
  }

  function applyExtraction(ex: ExtractedBill) {
    setExtraction(ex);
    // Carry the raw supplier name/GSTIN reading into the "New supplier" fields too - if this
    // payee doesn't fuzzy-match anything we already have on file, the human shouldn't have to
    // retype what the AI already read off the scan; they still review/confirm before saving.
    if (ex.supplierNameGuess || ex.gstinGuess) {
      setNewSupplier((prev) => ({
        ...prev,
        name: ex.supplierNameGuess ?? prev.name,
        gstin: ex.gstinGuess ?? prev.gstin,
      }));
    }
    if (ex.billNumber) setBillNumber(ex.billNumber);
    if (ex.billDate) setBillDate(ex.billDate.slice(0, 10));
    if (ex.dueDate) setDueDate(ex.dueDate.slice(0, 10));
    if (ex.sourceTypeGuess) setSourceType(ex.sourceTypeGuess as typeof sourceType);
    if (ex.notes) setNotes(ex.notes);
    if (ex.lineItems.length > 0) {
      setLines(ex.lineItems.map((li) => ({
        description: li.description,
        hsnCode: li.hsnCode ?? "",
        quantity: li.quantity != null ? String(li.quantity) : "1",
        unitPrice: li.unitPrice != null ? String(li.unitPrice) : "",
        taxRatePct: li.taxRatePct != null ? String(li.taxRatePct) : "18",
      })));
    }
  }

  function goToReview() { setStep(2); }
  function skipToManualEntry() { setExtractNote(null); setStep(2); }

  function addLine() { setLines((l) => [...l, emptyLine()]); }
  function updateLine(i: number, patch: Partial<Line>) { setLines((l) => l.map((x, idx) => (idx === i ? { ...x, ...patch } : x))); }
  function removeLine(i: number) { setLines((l) => l.filter((_, idx) => idx !== i)); }

  const total = lines.reduce((s, l) => {
    const qty = parseFloat(l.quantity) || 0, price = parseFloat(l.unitPrice) || 0, tax = parseFloat(l.taxRatePct) || 0;
    return s + qty * price * (1 + tax / 100);
  }, 0);
  const allocatedSoFar = allocations.reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);
  const remaining = total - allocatedSoFar;

  function addAllocation() { setAllocations((a) => [...a, emptyAllocation()]); }
  function updateAllocation(i: number, patch: Partial<Allocation>) {
    setAllocations((a) => a.map((x, idx) => {
      if (idx !== i) return x;
      const next = { ...x, ...patch };
      return next;
    }));
  }
  function removeAllocation(i: number) { setAllocations((a) => a.filter((_, idx) => idx !== i)); }

  function onSiteChosen(i: number, siteId: string) {
    const site = sites.find((s) => s.id === siteId);
    updateAllocation(i, { siteId, orderId: site?.order.id ?? "", invoiceId: "" });
    if (site) loadInvoicesFor(site.order.customer.id);
  }

  async function createSupplierFromVendor() {
    setFormError(null);
    try {
      const s = await api<Supplier>("/purchase-orders/suppliers/from-vendor", { method: "POST", body: JSON.stringify({ vendorId: vendorPickId }) });
      setSuppliers((prev) => (prev.some((p) => p.id === s.id) ? prev : [...prev, s]));
      setSupplierId(s.id);
      setSupplierMode("existing");
    } catch (err) { setFormError(err instanceof Error ? err.message : "Failed to create supplier from this vendor"); }
  }
  async function createNewSupplier() {
    setFormError(null);
    try {
      const s = await api<Supplier>("/purchase-orders/suppliers", { method: "POST", body: JSON.stringify(newSupplier) });
      setSuppliers((prev) => [...prev, s]);
      setSupplierId(s.id);
      setSupplierMode("existing");
    } catch (err) { setFormError(err instanceof Error ? err.message : "Failed to create supplier"); }
  }

  async function save() {
    setFormError(null);
    if (!supplierId) { setFormError("Please choose or create a supplier"); return; }
    if (!billNumber.trim()) { setFormError("Please enter the bill number"); return; }
    if (lines.some((l) => !l.description.trim() || !l.unitPrice)) { setFormError("Every line item needs a description and unit price"); return; }
    const cleanAllocations = allocations.filter((a) => a.siteId || a.orderId || a.invoiceId).map((a) => ({
      siteId: a.siteId || undefined,
      orderId: a.orderId || undefined,
      invoiceId: a.invoiceId || undefined,
      amount: parseFloat(a.amount) || 0,
      notes: a.notes || undefined,
    }));
    if (cleanAllocations.some((a) => !a.amount || a.amount <= 0)) { setFormError("Every allocation row needs an amount greater than zero"); return; }

    setSaving(true);
    try {
      const bill = await api<{ id: string }>("/bills", {
        method: "POST",
        body: JSON.stringify({
          billNumber: billNumber.trim(),
          supplierId,
          purchaseOrderId: prefillPurchaseOrderId || undefined,
          sourceType,
          attachmentUrl: captured?.dataUrl,
          attachmentMimeType: captured?.mimeType,
          extractionRaw: extraction ?? undefined,
          billDate: new Date(billDate).toISOString(),
          dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
          notes: notes || undefined,
          lineItems: lines.map((l) => ({
            description: l.description,
            hsnCode: l.hsnCode || undefined,
            quantity: parseFloat(l.quantity) || 0,
            unitPrice: parseFloat(l.unitPrice) || 0,
            taxRatePct: parseFloat(l.taxRatePct) || 18,
          })),
          allocations: cleanAllocations.length > 0 ? cleanAllocations : undefined,
        }),
      });
      router.push(`/finance/vendor-invoices/${bill.id}`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save this vendor invoice");
    } finally {
      setSaving(false);
    }
  }

  if (!canCapture) return <p className="text-sm text-gray-500 p-4">You don&apos;t have permission to capture vendor invoices.</p>;

  return (
    <div className="space-y-6 max-w-6xl" data-testid="new-vendor-invoice-page">
      <div>
        <a href="/finance/vendor-invoices" className="text-xs text-gray-500 hover:text-gray-700">← Back to vendor invoices</a>
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight mt-1" style={{ color: "var(--text-heading)" }}>New Vendor Invoice</h1>
      </div>

      {step === 1 && (
        <div className="card p-6 max-w-xl space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Upload a photo or scan (or a PDF)</label>
            <input
              type="file"
              accept="image/*,application/pdf"
              capture="environment"
              className="field w-full"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onFileSelected(f); }}
            />
            {captureError && <p className="mt-2 text-sm text-red-600">{captureError}</p>}
          </div>

          {captured && (
            <div className="rounded-lg border border-gray-200 p-3">
              {captured.mimeType === "application/pdf" ? (
                <p className="text-sm text-gray-600">PDF selected ({Math.round(captured.sizeBytes / 1024)} KB).</p>
              ) : (
                <img src={captured.dataUrl} alt="Bill preview" className="max-h-64 w-full rounded object-contain bg-gray-50" />
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={!captured || extracting}
              onClick={extractWithAi}
              className="btn-primary px-4 py-2 text-sm disabled:opacity-50"
            >
              {extracting ? "Reading with AI…" : "Extract with AI"}
            </button>
            <button type="button" onClick={skipToManualEntry} className="rounded-lg border border-gray-300 px-4 py-2 text-sm">
              Skip - enter manually
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-600">Scan</h2>
            {captured ? (
              captured.mimeType === "application/pdf" ? (
                <div className="card p-6 text-sm text-gray-500">PDF attached ({Math.round(captured.sizeBytes / 1024)} KB) - open the saved invoice later to view it.</div>
              ) : (
                <img src={captured.dataUrl} alt="Bill preview" className="w-full rounded-lg border border-gray-200 object-contain bg-gray-50" />
              )
            ) : (
              <div className="card p-6 text-sm text-gray-400">No file attached - entered manually.</div>
            )}
            <button type="button" onClick={() => setStep(1)} className="text-xs font-medium text-[var(--theme-accent)]">← Re-upload / re-extract</button>
          </div>

          <div className="space-y-4">
            {extractNote && <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">{extractNote}</div>}

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">How was this document produced?</label>
              <select className="field w-full" value={sourceType} onChange={(e) => setSourceType(e.target.value as typeof sourceType)}>
                <option value="printed">Printed</option>
                <option value="handwritten">Handwritten</option>
                <option value="digital">Digital / emailed</option>
              </select>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="block text-xs font-medium text-gray-500">Payee (supplier or vendor)</label>
                <div className="flex gap-2 text-xs font-medium text-[var(--theme-accent)]">
                  <button type="button" onClick={() => setSupplierMode("existing")}>Existing</button>
                  <button type="button" onClick={() => setSupplierMode("vendor")}>From vendor</button>
                  <button type="button" onClick={() => setSupplierMode("new")}>New</button>
                </div>
              </div>
              {supplierMode === "existing" && (
                <>
                  <select className="field w-full" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                    <option value="">Select a supplier</option>
                    {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  {supplierCandidates.length > 0 && !supplierId && (
                    <div className="mt-2 space-y-1">
                      <p className="text-xs text-gray-400">AI-suggested matches:</p>
                      {supplierCandidates.map((c) => (
                        <button key={`${c.source}-${c.id}`} type="button" onClick={() => c.source === "supplier" ? setSupplierId(c.id) : (setSupplierMode("vendor"), setVendorPickId(c.id))}
                          className="mr-2 rounded-full border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50">
                          {c.name} {c.source === "vendor" ? "(vendor)" : ""}
                        </button>
                      ))}
                    </div>
                  )}
                  {!supplierId && supplierCandidates.length === 0 && extraction?.supplierNameGuess && (
                    <p className="mt-2 text-xs text-gray-400">
                      AI read the payee as &quot;{extraction.supplierNameGuess}&quot;{extraction.gstinGuess ? ` (GSTIN ${extraction.gstinGuess})` : ""} - none of that matched an
                      existing supplier or vendor.{" "}
                      <button type="button" onClick={() => setSupplierMode("new")} className="font-medium text-[var(--theme-accent)] hover:underline">
                        Add as a new supplier
                      </button>
                    </p>
                  )}
                </>
              )}
              {supplierMode === "vendor" && (
                <div className="space-y-2 rounded-lg border border-gray-200 p-3">
                  <select className="field w-full" value={vendorPickId} onChange={(e) => setVendorPickId(e.target.value)}>
                    <option value="">Select an approved vendor</option>
                    {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                  <button type="button" disabled={!vendorPickId} onClick={createSupplierFromVendor} className="text-xs font-medium text-[var(--theme-accent)] disabled:opacity-50">
                    Create supplier from this vendor
                  </button>
                </div>
              )}
              {supplierMode === "new" && (
                <div className="space-y-2 rounded-lg border border-gray-200 p-3">
                  <input placeholder="Supplier name" className="field w-full" value={newSupplier.name} onChange={(e) => setNewSupplier({ ...newSupplier, name: e.target.value })} />
                  <div className="grid grid-cols-2 gap-2">
                    <input placeholder="GSTIN" className="field" value={newSupplier.gstin} onChange={(e) => setNewSupplier({ ...newSupplier, gstin: e.target.value })} />
                    <input placeholder="State" className="field" value={newSupplier.state} onChange={(e) => setNewSupplier({ ...newSupplier, state: e.target.value })} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input placeholder="Contact name" className="field" value={newSupplier.contactName} onChange={(e) => setNewSupplier({ ...newSupplier, contactName: e.target.value })} />
                    <input placeholder="Contact phone" className="field" value={newSupplier.contactPhone} onChange={(e) => setNewSupplier({ ...newSupplier, contactPhone: e.target.value })} />
                  </div>
                  <button type="button" onClick={createNewSupplier} className="text-xs font-medium text-[var(--theme-accent)]">Save supplier</button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Bill number</label>
                <input className="field w-full" value={billNumber} onChange={(e) => setBillNumber(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Bill date</label>
                <input type="date" className="field w-full" value={billDate} onChange={(e) => setBillDate(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Due date (optional)</label>
                <input type="date" className="field w-full" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Line items</label>
                <button type="button" onClick={addLine} className="text-xs font-medium text-[var(--theme-accent)]">+ Add line</button>
              </div>
              <div className="space-y-2">
                {lines.map((l, i) => (
                  <div key={i} className="rounded-lg border border-gray-200 p-3 space-y-2">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input className="field" placeholder="Description" value={l.description} onChange={(e) => updateLine(i, { description: e.target.value })} />
                      <input className="field" placeholder="SAC/HSN" value={l.hsnCode} onChange={(e) => updateLine(i, { hsnCode: e.target.value })} />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <input type="number" step="0.01" className="field" placeholder="Qty" value={l.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} />
                      <input type="number" step="0.01" className="field" placeholder="Unit price" value={l.unitPrice} onChange={(e) => updateLine(i, { unitPrice: e.target.value })} />
                      <input type="number" step="0.01" className="field" placeholder="Tax %" value={l.taxRatePct} onChange={(e) => updateLine(i, { taxRatePct: e.target.value })} />
                    </div>
                    {lines.length > 1 && <button type="button" onClick={() => removeLine(i)} className="text-xs text-red-500">Remove</button>}
                  </div>
                ))}
              </div>
              <p className="mt-2 text-right text-sm font-semibold">Total: ₹{total.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</p>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
              <textarea className="field w-full" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Allocations (which site/order/invoice this cost is for)</label>
                <button type="button" onClick={addAllocation} className="text-xs font-medium text-[var(--theme-accent)]">+ Add allocation</button>
              </div>
              <p className={`text-xs mb-2 ${remaining < -0.005 ? "text-red-600" : "text-gray-400"}`}>
                Remaining to allocate: ₹{remaining.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
              </p>
              <div className="space-y-2">
                {allocations.map((a, i) => {
                  const site = sites.find((s) => s.id === a.siteId);
                  const invoiceOptions = site ? invoicesByCustomer[site.order.customer.id] ?? [] : [];
                  return (
                    <div key={i} className="rounded-lg border border-gray-200 p-3 space-y-2">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <select className="field" value={a.siteId} onChange={(e) => onSiteChosen(i, e.target.value)}>
                          <option value="">Select a site</option>
                          {sites.map((s) => (
                            <option key={s.id} value={s.id}>{(s.companyName || s.address || s.id)} - {s.order.orderNumber} ({s.order.customer.name})</option>
                          ))}
                        </select>
                        <input type="number" step="0.01" className="field" placeholder="Amount" value={a.amount} onChange={(e) => updateAllocation(i, { amount: e.target.value })} />
                      </div>
                      {site && (
                        <select className="field w-full" value={a.invoiceId} onChange={(e) => updateAllocation(i, { invoiceId: e.target.value })}>
                          <option value="">(optional) Link to one of {site.order.customer.name}&apos;s invoices</option>
                          {invoiceOptions.map((inv) => <option key={inv.id} value={inv.id}>{inv.invoiceNumber}</option>)}
                        </select>
                      )}
                      <input className="field w-full" placeholder="Notes (optional)" value={a.notes} onChange={(e) => updateAllocation(i, { notes: e.target.value })} />
                      <button type="button" onClick={() => removeAllocation(i)} className="text-xs text-red-500">Remove</button>
                    </div>
                  );
                })}
                {allocations.length === 0 && <p className="text-sm text-gray-400">No allocations yet - optional, but recommended for job costing.</p>}
              </div>
            </div>

            {formError && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{formError}</p>}
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => router.push("/finance/vendor-invoices")} className="rounded-lg border border-gray-300 px-4 py-2 text-sm">Cancel</button>
              <button type="button" disabled={saving} onClick={save} className="btn-primary px-4 py-2 text-sm">{saving ? "Saving…" : "Save vendor invoice"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
