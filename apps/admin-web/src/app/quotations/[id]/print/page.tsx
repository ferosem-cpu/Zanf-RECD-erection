"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/apiClient";
import { formatINR, formatDate, numberToIndianWords } from "@/lib/finance";

interface LineItem { id: string; description: string; hsnCode?: string | null; quantity: string; unitPrice: string; discountPct: string; taxRatePct: string; lineTotal: string; }
interface QuotationDetail {
  id: string; quoteNumber: string; status: string; issueDate: string; validUntil?: string | null;
  placeOfSupply?: string | null; subtotal: string; discountAmount: string; cgstAmount: string; sgstAmount: string; igstAmount: string; total: string;
  notes?: string | null; terms?: string | null;
  customer: { id: string; name: string; gstin?: string | null; state?: string | null; address?: string | null };
  createdBy: { id: string; name: string };
  lineItems: LineItem[];
}

interface Company { legalName?: string | null; address?: string | null; city?: string | null; pinCode?: string | null; state?: string | null; gstin?: string | null; pan?: string | null; email?: string | null; website?: string | null; phone?: string | null; bankName?: string | null; bankAccountNumber?: string | null; bankIfsc?: string | null; bankBranch?: string | null; quotationTerms?: string | null; invoiceTerms?: string | null; logoDataUrl?: string | null; signatoryName?: string | null; signatoryDataUrl?: string | null; }

/** "City, Pin Code" / "City" / "Pin Code" — whichever parts are set. */
function cityPinLine(company: Company | undefined): string {
  return [company?.city, company?.pinCode].filter(Boolean).join(" - ");
}

/** "email · website · phone" contact line — whichever parts are set. */
function contactLine(company: Company | undefined): string {
  return [company?.email, company?.website, company?.phone].filter(Boolean).join("  ·  ");
}

/** Splits free-text terms into bullet lines: one bullet per non-empty line, leading "-"/"•" markers stripped. */
function termsToBullets(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n|\s+-\s+/)
    .map((line) => line.trim().replace(/^[-•]\s*/, ""))
    .filter((line) => line.length > 0);
}

function TermsBlock({ terms }: { terms: string }) {
  const bullets = termsToBullets(terms);
  if (bullets.length === 0) return null;
  return (
    <div className="mb-1">
      <span className="font-semibold">Terms:</span>
      <ul className="list-disc pl-5 mt-0.5 space-y-0.5">
        {bullets.map((line, i) => <li key={i}>{line}</li>)}
      </ul>
    </div>
  );
}

function PrintShell({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Auto-trigger print shortly after mount (user can also click Download PDF).
  }, []);
  return (
    <div className="min-h-screen bg-white p-6 sm:p-10 print:p-0">
      <div className="max-w-3xl mx-auto print:max-w-full">
        <div className="flex justify-end mb-4 print:hidden">
          <button onClick={() => window.print()} className="btn-primary px-4 py-2 text-sm">Download PDF</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function CompanyBlock({ company }: { company?: Company }) {
  return (
    <div className="mb-6">
      {company?.logoDataUrl ? (
        <img src={company.logoDataUrl} alt="logo" className="h-12 object-contain mb-2" />
      ) : null}
      <h1 className="text-lg font-bold">{company?.legalName ?? "Your Company"}</h1>
      {company?.address && <p className="text-xs text-gray-600 whitespace-pre-line">{company.address}</p>}
      {cityPinLine(company) && <p className="text-xs text-gray-600">{cityPinLine(company)}</p>}
      {contactLine(company) && <p className="text-xs text-gray-600 mt-0.5">{contactLine(company)}</p>}
      <div className="text-xs text-gray-600 mt-1">
        {company?.gstin && <p>GSTIN: {company.gstin}</p>}
        {company?.pan && <p>PAN: {company.pan}</p>}
      </div>
    </div>
  );
}

function TotalsBlock({ subtotal, discountAmount, cgstAmount, sgstAmount, igstAmount, total }: { subtotal: string; discountAmount: string; cgstAmount: string; sgstAmount: string; igstAmount: string; total: string }) {
  const showDiscount = parseFloat(discountAmount) !== 0;
  return (
    <div className="mt-4 ml-auto w-full sm:w-72 text-sm">
      <div className="flex justify-between py-1"><span>Subtotal</span><span>{formatINR(subtotal)}</span></div>
      {showDiscount && <div className="flex justify-between py-1"><span>Discount</span><span>-{formatINR(discountAmount)}</span></div>}
      {parseFloat(cgstAmount) !== 0 && <div className="flex justify-between py-1"><span>CGST</span><span>{formatINR(cgstAmount)}</span></div>}
      {parseFloat(sgstAmount) !== 0 && <div className="flex justify-between py-1"><span>SGST</span><span>{formatINR(sgstAmount)}</span></div>}
      {parseFloat(igstAmount) !== 0 && <div className="flex justify-between py-1"><span>IGST</span><span>{formatINR(igstAmount)}</span></div>}
      <div className="flex justify-between py-1 font-bold border-t border-gray-300 mt-1"><span>Total</span><span>{formatINR(total)}</span></div>
      <p className="text-xs text-gray-500 mt-1">({numberToIndianWords(parseFloat(total))})</p>
    </div>
  );
}

export default function QuotationPrintPage() {
  const { id } = useParams<{ id: string }>();
  const [q, setQ] = useState<QuotationDetail | null>(null);
  const [company, setCompany] = useState<Company | undefined>(undefined);
  const [termsText, setTermsText] = useState("");
  const [termsInitialized, setTermsInitialized] = useState(false);
  const [editingTerms, setEditingTerms] = useState(false);
  const [savingTerms, setSavingTerms] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api<QuotationDetail>(`/quotations/${id}`).then(setQ).catch(() => {});
    api<Company>("/settings").then(setCompany).catch(() => {});
  }, [id]);

  // Seed the editable terms once both the quotation and company settings have loaded:
  // per-quotation terms win if set, otherwise fall back to the company default.
  useEffect(() => {
    if (termsInitialized || !q || company === undefined) return;
    setTermsText(q.terms ?? company?.quotationTerms ?? "");
    setTermsInitialized(true);
  }, [q, company, termsInitialized]);

  async function saveTerms() {
    if (!q) return;
    setSavingTerms(true); setSaveMsg(null);
    try {
      await api(`/quotations/${q.id}`, { method: "PUT", body: JSON.stringify({ terms: termsText }) });
      setSaveMsg("Saved to this quotation.");
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSavingTerms(false);
    }
  }

  function resetTerms() {
    setTermsText(company?.quotationTerms ?? "");
    setSaveMsg(null);
  }

  if (!q) return <p className="text-sm text-gray-500 p-4">Loading…</p>;

  return (
    <PrintShell>
      <div className="print:hidden mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-gray-700">Terms &amp; conditions for this quotation</p>
          <button onClick={() => setEditingTerms((v) => !v)} className="text-xs text-blue-600 hover:underline">
            {editingTerms ? "Done editing" : "Edit before printing"}
          </button>
        </div>
        {editingTerms && (
          <div className="mt-2 space-y-2">
            <textarea
              className="field w-full text-xs"
              rows={5}
              value={termsText}
              onChange={(e) => { setTermsText(e.target.value); setSaveMsg(null); }}
              placeholder="One line per bullet point…"
            />
            <div className="flex items-center gap-3">
              <button onClick={resetTerms} className="text-xs text-gray-500 hover:underline">Reset to company default</button>
              {q.status === "draft" && (
                <button onClick={saveTerms} disabled={savingTerms} className="btn-primary px-3 py-1 text-xs">
                  {savingTerms ? "Saving…" : "Save to this quotation"}
                </button>
              )}
              {saveMsg && <span className="text-xs text-gray-500">{saveMsg}</span>}
            </div>
            {q.status !== "draft" && (
              <p className="text-xs text-gray-400">This quotation is no longer a draft — the edit above only changes what prints now, it isn't saved to the record.</p>
            )}
          </div>
        )}
      </div>

      <CompanyBlock company={company} />
      <div className="flex justify-between items-start mb-4">
        <div>
          <h2 className="text-xl font-bold">QUOTATION</h2>
          <p className="text-sm">{q.quoteNumber}</p>
          <p className="text-xs text-gray-500">Date: {formatDate(q.issueDate)}</p>
          {q.validUntil && <p className="text-xs text-gray-500">Valid until: {formatDate(q.validUntil)}</p>}
        </div>
        <div className="text-right text-sm">
          <p className="font-semibold">{q.customer.name}</p>
          {q.customer.address && <p className="text-gray-600 whitespace-pre-line">{q.customer.address}</p>}
          {q.customer.gstin && <p className="text-xs text-gray-500">GSTIN: {q.customer.gstin}</p>}
          {q.placeOfSupply && <p className="text-xs text-gray-500">Place of supply: {q.placeOfSupply}</p>}
        </div>
      </div>

      <table className="w-full border-collapse text-sm border border-gray-300">
        <thead>
          <tr className="bg-gray-100 text-left">
            <th className="border px-2 py-1">#</th>
            <th className="border px-2 py-1">Description</th>
            <th className="border px-2 py-1">HSN</th>
            <th className="border px-2 py-1">Qty</th>
            <th className="border px-2 py-1">Rate</th>
            <th className="border px-2 py-1">Tax%</th>
            <th className="border px-2 py-1 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {q.lineItems.map((l, i) => (
            <tr key={l.id}>
              <td className="border px-2 py-1">{i + 1}</td>
              <td className="border px-2 py-1">{l.description}</td>
              <td className="border px-2 py-1">{l.hsnCode ?? "-"}</td>
              <td className="border px-2 py-1">{l.quantity}</td>
              <td className="border px-2 py-1">{formatINR(l.unitPrice)}</td>
              <td className="border px-2 py-1">{l.taxRatePct}%</td>
              <td className="border px-2 py-1 text-right">{formatINR(l.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <TotalsBlock subtotal={q.subtotal} discountAmount={q.discountAmount} cgstAmount={q.cgstAmount} sgstAmount={q.sgstAmount} igstAmount={q.igstAmount} total={q.total} />

      {(q.notes || termsText) && (
        <div className="text-xs text-gray-600 mt-6">
          {q.notes && <p className="mb-1"><span className="font-semibold">Notes:</span> {q.notes}</p>}
          <TermsBlock terms={termsText} />
        </div>
      )}

      <div className="mt-10 flex justify-between items-end text-xs text-gray-500">
        <div className="whitespace-pre-line">
          <p className="font-semibold">{company?.legalName}</p>
          {company?.address && <p>{company.address}</p>}
          {cityPinLine(company) && <p>{cityPinLine(company)}</p>}
          {contactLine(company) && <p>{contactLine(company)}</p>}
        </div>
        <div className="text-right">
          {company?.signatoryDataUrl && <img src={company.signatoryDataUrl} alt="Signature" className="h-14 object-contain ml-auto mb-1" />}
          <p>Authorised signatory{company?.signatoryName ? ` — ${company.signatoryName}` : ""}</p>
          <p className="mt-6">{q.createdBy?.name}</p>
        </div>
      </div>
    </PrintShell>
  );
}
