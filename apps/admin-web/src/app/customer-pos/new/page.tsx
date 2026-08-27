"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/apiClient";
import { useAuth } from "@/components/AuthContext";
import { captureFile, type CapturedFile } from "@/lib/fileCapture";

interface Customer { id: string; name: string; gstin?: string | null; state?: string | null; }
interface OrderOption { id: string; orderNumber: string; customerId: string; }
interface InvoiceOption { id: string; invoiceNumber: string; customerId: string; }
interface ExtractedLineItem { description: string; hsnCode?: string; quantity?: number; unitPrice?: number; taxRatePct?: number; }
interface ExtractedCustomerPo {
  customerNameGuess?: string; gstinGuess?: string; poNumber?: string; poDate?: string;
  placeOfSupply?: string; workLocation?: string; scopeOfWork?: string; paymentDueDate?: string; customerRefCode?: string;
  sourceTypeGuess?: string; confidence?: string; lineItems: ExtractedLineItem[]; subtotal?: number; taxAmount?: number; total?: number; notes?: string;
}
interface CustomerCandidate { id: string; name: string; gstin?: string | null; score: number; }
interface ExtractResponse { available: boolean; error?: string; extraction?: ExtractedCustomerPo; customerCandidates?: CustomerCandidate[]; }

type Line = { description: string; hsnCode: string; quantity: string; unitPrice: string; taxRatePct: string };

const today = () => new Date().toISOString().slice(0, 10);
const emptyLine = (): Line => ({ description: "", hsnCode: "", quantity: "1", unitPrice: "", taxRatePct: "18" });

export default function NewCustomerPoPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefillCustomerId = searchParams.get("customerId") ?? "";
  const prefillOrderId = searchParams.get("orderId") ?? "";
  const { hasPermission } = useAuth();
  const canManage = hasPermission("manage_orders");

  const [step, setStep] = useState<1 | 2>(1);
  const [captured, setCaptured] = useState<CapturedFile | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extraction, setExtraction] = useState<ExtractedCustomerPo | null>(null);
  const [extractNote, setExtractNote] = useState<string | null>(null);
  const [customerCandidates, setCustomerCandidates] = useState<CustomerCandidate[]>([]);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [orders, setOrders] = useState<OrderOption[]>([]);
  const [invoices, setInvoices] = useState<InvoiceOption[]>([]);

  const [sourceType, setSourceType] = useState<"printed" | "handwritten" | "digital">("printed");
  const [customerId, setCustomerId] = useState(prefillCustomerId);
  const [orderId, setOrderId] = useState(prefillOrderId);
  const [invoiceId, setInvoiceId] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [poDate, setPoDate] = useState(today());
  const [placeOfSupply, setPlaceOfSupply] = useState("");
  const [workLocation, setWorkLocation] = useState("");
  const [scopeOfWork, setScopeOfWork] = useState("");
  const [paymentDueDate, setPaymentDueDate] = useState("");
  const [customerRefCode, setCustomerRefCode] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([emptyLine()]);

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!canManage) return;
    api<Customer[]>("/customers").then(setCustomers).catch(() => {});
    api<{ id: string; orderNumber: string; customerId: string }[]>("/orders").then(setOrders).catch(() => {});
  }, [canManage]);

  useEffect(() => {
    if (!customerId) { setInvoices([]); return; }
    api<InvoiceOption[]>(`/invoices?customerId=${customerId}`).then(setInvoices).catch(() => setInvoices([]));
  }, [customerId]);

  const ordersForCustomer = orders.filter((o) => o.customerId === customerId);

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
      const res = await api<ExtractResponse>("/customer-purchase-orders/extract", {
        method: "POST",
        body: JSON.stringify({ fileDataUrl: captured.dataUrl, mimeType: captured.mimeType }),
      });
      if (!res.available || !res.extraction) {
        setExtractNote(res.error || "AI extraction isn't available right now - please fill in the details manually.");
      } else {
        applyExtraction(res.extraction);
        setCustomerCandidates(res.customerCandidates ?? []);
        if (res.extraction.confidence === "low") {
          setExtractNote("The AI wasn't fully confident reading this document (especially if handwritten) - please double-check every field before saving.");
        }
      }
    } catch (err) {
      setExtractNote(err instanceof Error ? err.message : "AI extraction failed - please fill in the details manually.");
    } finally {
      setExtracting(false);
      setStep(2);
    }
  }

  function applyExtraction(ex: ExtractedCustomerPo) {
    setExtraction(ex);
    if (ex.poNumber) setPoNumber(ex.poNumber);
    if (ex.poDate) setPoDate(ex.poDate.slice(0, 10));
    if (ex.placeOfSupply) setPlaceOfSupply(ex.placeOfSupply);
    if (ex.workLocation) setWorkLocation(ex.workLocation);
    if (ex.scopeOfWork) setScopeOfWork(ex.scopeOfWork);
    if (ex.paymentDueDate) setPaymentDueDate(ex.paymentDueDate.slice(0, 10));
    if (ex.customerRefCode) setCustomerRefCode(ex.customerRefCode);
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

  function skipToManualEntry() { setExtractNote(null); setStep(2); }
  function addLine() { setLines((l) => [...l, emptyLine()]); }
  function updateLine(i: number, patch: Partial<Line>) { setLines((l) => l.map((x, idx) => (idx === i ? { ...x, ...patch } : x))); }
  function removeLine(i: number) { setLines((l) => l.filter((_, idx) => idx !== i)); }

  const total = lines.reduce((s, l) => {
    const qty = parseFloat(l.quantity) || 0, price = parseFloat(l.unitPrice) || 0, tax = parseFloat(l.taxRatePct) || 0;
    return s + qty * price * (1 + tax / 100);
  }, 0);

  async function save() {
    setFormError(null);
    if (!customerId) { setFormError("Please choose the customer this PO is from"); return; }
    if (!poNumber.trim()) { setFormError("Please enter the PO number"); return; }
    if (lines.some((l) => !l.description.trim() || !l.unitPrice)) { setFormError("Every line item needs a description and unit price"); return; }
    if (orderId) {
      const order = orders.find((o) => o.id === orderId);
      if (order && order.customerId !== customerId) { setFormError("That order does not belong to the selected customer"); return; }
    }
    if (invoiceId) {
      const invoice = invoices.find((i) => i.id === invoiceId);
      if (invoice && invoice.customerId !== customerId) { setFormError("That invoice does not belong to the selected customer"); return; }
    }

    setSaving(true);
    try {
      const po = await api<{ id: string }>("/customer-purchase-orders", {
        method: "POST",
        body: JSON.stringify({
          poNumber: poNumber.trim(),
          poDate: new Date(poDate).toISOString(),
          customerId,
          orderId: orderId || undefined,
          invoiceId: invoiceId || undefined,
          placeOfSupply: placeOfSupply || undefined,
          workLocation: workLocation || undefined,
          scopeOfWork: scopeOfWork || undefined,
          paymentDueDate: paymentDueDate ? new Date(paymentDueDate).toISOString() : undefined,
          customerRefCode: customerRefCode || undefined,
          notes: notes || undefined,
          sourceType,
          attachmentUrl: captured?.dataUrl,
          attachmentMimeType: captured?.mimeType,
          extractionRaw: extraction ?? undefined,
          lineItems: lines.map((l) => ({
            description: l.description,
            hsnCode: l.hsnCode || undefined,
            quantity: parseFloat(l.quantity) || 0,
            unitPrice: parseFloat(l.unitPrice) || 0,
            taxRatePct: parseFloat(l.taxRatePct) || 18,
          })),
        }),
      });
      router.push(`/customer-pos/${po.id}`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save this customer purchase order");
    } finally {
      setSaving(false);
    }
  }

  if (!canManage) return <p className="text-sm text-gray-500 p-4">You don&apos;t have permission to record customer purchase orders.</p>;

  return (
    <div className="space-y-6 max-w-6xl" data-testid="new-customer-po-page">
      <div>
        <a href="/customer-pos" className="text-xs text-gray-500 hover:text-gray-700">← Back to Customer POs</a>
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight mt-1" style={{ color: "var(--text-heading)" }}>Record Customer PO</h1>
        <p className="mt-1 text-sm text-gray-500">Optional - recording this never blocks creating or invoicing an order.</p>
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
                <img src={captured.dataUrl} alt="PO preview" className="max-h-64 w-full rounded object-contain bg-gray-50" />
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            <button type="button" disabled={!captured || extracting} onClick={extractWithAi} className="btn-primary px-4 py-2 text-sm disabled:opacity-50">
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
                <div className="card p-6 text-sm text-gray-500">PDF attached ({Math.round(captured.sizeBytes / 1024)} KB) - open the saved PO later to view it.</div>
              ) : (
                <img src={captured.dataUrl} alt="PO preview" className="w-full rounded-lg border border-gray-200 object-contain bg-gray-50" />
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
              <label className="block text-xs font-medium text-gray-500 mb-1">Customer (who sent us this PO)</label>
              <select className="field w-full" value={customerId} onChange={(e) => { setCustomerId(e.target.value); setOrderId(""); setInvoiceId(""); }}>
                <option value="">Select a customer</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {customerCandidates.length > 0 && !customerId && (
                <div className="mt-2 space-y-1">
                  <p className="text-xs text-gray-400">AI-suggested matches:</p>
                  {customerCandidates.map((c) => (
                    <button key={c.id} type="button" onClick={() => setCustomerId(c.id)} className="mr-2 rounded-full border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50">
                      {c.name}
                    </button>
                  ))}
                </div>
              )}
              {!customerId && customerCandidates.length === 0 && extraction?.customerNameGuess && (
                <p className="mt-2 text-xs text-gray-400">
                  AI read the customer as &quot;{extraction.customerNameGuess}&quot;
                  {extraction.gstinGuess ? ` (GSTIN ${extraction.gstinGuess})` : ""} - none of that matched an existing customer.{" "}
                  <a href="/customers" target="_blank" rel="noreferrer" className="font-medium text-[var(--theme-accent)] hover:underline">Add them as a customer first</a>, then come back and select them here.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Order (optional)</label>
                <select className="field w-full" value={orderId} onChange={(e) => setOrderId(e.target.value)} disabled={!customerId}>
                  <option value="">(none yet)</option>
                  {ordersForCustomer.map((o) => <option key={o.id} value={o.id}>{o.orderNumber}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Invoice (optional)</label>
                <select className="field w-full" value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} disabled={!customerId}>
                  <option value="">(none yet)</option>
                  {invoices.map((i) => <option key={i.id} value={i.id}>{i.invoiceNumber}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">PO number</label>
                <input className="field w-full" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">PO date</label>
                <input type="date" className="field w-full" value={poDate} onChange={(e) => setPoDate(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Work location / site</label>
                <input className="field w-full" value={workLocation} onChange={(e) => setWorkLocation(e.target.value)} placeholder="e.g. AAI-TRZ" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Place of supply</label>
                <input className="field w-full" value={placeOfSupply} onChange={(e) => setPlaceOfSupply(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Payment due date (optional)</label>
                <input type="date" className="field w-full" value={paymentDueDate} onChange={(e) => setPaymentDueDate(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Customer ref/vendor code (optional)</label>
                <input className="field w-full" value={customerRefCode} onChange={(e) => setCustomerRefCode(e.target.value)} />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Scope of work (optional)</label>
              <textarea className="field w-full" rows={2} value={scopeOfWork} onChange={(e) => setScopeOfWork(e.target.value)} />
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

            {formError && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{formError}</p>}
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => router.push("/customer-pos")} className="rounded-lg border border-gray-300 px-4 py-2 text-sm">Cancel</button>
              <button type="button" disabled={saving} onClick={save} className="btn-primary px-4 py-2 text-sm">{saving ? "Saving…" : "Save customer PO"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
