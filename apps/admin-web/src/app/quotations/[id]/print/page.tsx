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
  customer: { id: string; name: string; gstin?: string | null; state?: string | null; address?: string | null; contacts?: { name: string; phone: string | null; email: string | null }[] };
  createdBy: { id: string; name: string };
  lineItems: LineItem[];
}

interface Company { legalName?: string | null; address?: string | null; city?: string | null; pinCode?: string | null; state?: string | null; gstin?: string | null; pan?: string | null; email?: string | null; website?: string | null; phone?: string | null; bankName?: string | null; bankAccountNumber?: string | null; bankIfsc?: string | null; bankBranch?: string | null; quotationTerms?: string | null; invoiceTerms?: string | null; documentFooterNote?: string | null; logoDataUrl?: string | null; signatoryName?: string | null; signatoryDataUrl?: string | null; }

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
    <>
      <div className="k">Terms &amp; conditions</div>
      <ol>
        {bullets.map((line, i) => <li key={i}>{line}</li>)}
      </ol>
    </>
  );
}

function AttnBlock({ contact, validLabel, validValue }: { contact?: { name: string; phone: string | null; email: string | null }; validLabel: string; validValue: string | null }) {
  return (
    <div className="print-panel-attn">
      <div className="print-panel-label">Attn</div>
      {contact ? (
        <>
          <div className="name">{contact.name}</div>
          {contact.phone && <div className="line">Ph: {contact.phone}</div>}
          {contact.email && <div className="line">Email: {contact.email}</div>}
        </>
      ) : (
        <div className="line">-</div>
      )}
      {validValue && <div className="valid">{validLabel}: {validValue}</div>}
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

  // The browser's print header prints document.title (top-centre). Set it to the
  // quotation number so the printed page never shows the app name; restore on exit.
  useEffect(() => {
    if (!q) return;
    const prev = document.title;
    document.title = q.quoteNumber;
    return () => { document.title = prev; };
  }, [q]);

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

      <div className="print-running-header">
        <span>{company?.legalName ?? "Your Company"}</span>
        <span>{q.quoteNumber}</span>
      </div>
      <div className="print-running-footer">
        <span>{company?.legalName ?? "Your Company"}</span>
        <span>{q.quoteNumber}</span>
      </div>

      <div className="print-doc">
        <div className="print-header">
          <div className="print-co-block">
            {company?.logoDataUrl ? <img src={company.logoDataUrl} alt="logo" className="h-9 object-contain mb-1.5" /> : null}
            <div className="print-co-name">{company?.legalName ?? "Your Company"}</div>
            <address>
              {company?.address}
              {cityPinLine(company) && <><br />{cityPinLine(company)}</>}
              {contactLine(company) && <><br />{contactLine(company)}</>}
            </address>
          </div>
          <div className="print-title-block">
            <div className="print-doc-title">QUOTATION</div>
            <div className="print-meta">
              <div>No. <b>{q.quoteNumber}</b></div>
              <div>Date: <b>{formatDate(q.issueDate)}</b></div>
              {company?.gstin && <div>GSTIN: <b>{company.gstin}</b></div>}
              {company?.pan && <div>PAN: <b>{company.pan}</b></div>}
            </div>
          </div>
        </div>

        <div className="print-panels">
          <div className="print-panel-bill">
            <div className="print-panel-label">Quoted to</div>
            <div className="name">{q.customer.name}</div>
            <div className="addr">
              {q.customer.address}
              {q.placeOfSupply && <><br />{q.placeOfSupply}</>}
            </div>
            {q.customer.gstin && <div className="gstin">GSTIN: {q.customer.gstin}</div>}
          </div>
          <AttnBlock contact={q.customer.contacts?.[0]} validLabel="Validity" validValue={q.validUntil ? `${formatDate(q.validUntil)}` : null} />
        </div>

        <table className="print-table">
          <thead>
            <tr>
              <th style={{ width: 28 }}>#</th>
              <th>Description of material / service</th>
              <th style={{ width: 74 }}>SAC/HSN</th>
              <th className="num" style={{ width: 44 }}>Qty</th>
              <th className="num" style={{ width: 96 }}>Rate</th>
              <th className="num" style={{ width: 108 }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {q.lineItems.map((l, i) => (
              <tr key={l.id}>
                <td>{i + 1}</td>
                <td>{l.description}</td>
                <td>{l.hsnCode ?? "-"}</td>
                <td className="num">{l.quantity}</td>
                <td className="num">{formatINR(l.unitPrice)}</td>
                <td className="num">{formatINR(l.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="print-lower">
          <div className="print-words">
            <div className="k">Amount in words</div>
            <div className="v">{numberToIndianWords(parseFloat(q.total))}</div>
          </div>
          <div className="print-summary">
            <div className="row"><span>Subtotal</span><span>{formatINR(q.subtotal)}</span></div>
            {parseFloat(q.discountAmount) !== 0 && <div className="row"><span>Discount</span><span>-{formatINR(q.discountAmount)}</span></div>}
            {parseFloat(q.cgstAmount) !== 0 && <div className="row"><span>CGST</span><span>{formatINR(q.cgstAmount)}</span></div>}
            {parseFloat(q.sgstAmount) !== 0 && <div className="row"><span>SGST</span><span>{formatINR(q.sgstAmount)}</span></div>}
            {parseFloat(q.igstAmount) !== 0 && <div className="row"><span>IGST</span><span>{formatINR(q.igstAmount)}</span></div>}
            <div className="row total"><span>Grand total</span><span>{formatINR(q.total)}</span></div>
          </div>
        </div>

        <div className="print-bank-terms single">
          <div className="print-terms">
            {q.notes && <p className="mb-1"><span className="font-semibold">Notes:</span> {q.notes}</p>}
            <TermsBlock terms={termsText} />
          </div>
        </div>

        <div className="print-footer">
          <div className="print-footer-info">
            {company?.documentFooterNote && <div className="note">{company.documentFooterNote}</div>}
            {contactLine(company) && <div className="contact">{contactLine(company)}</div>}
            <div>Thank you for considering us.</div>
          </div>
          <div className="print-sig">
            {company?.signatoryDataUrl && <img src={company.signatoryDataUrl} alt="Signature" className="h-12 object-contain ml-auto mb-1" />}
            <p className="label">Authorised signatory{company?.signatoryName ? ` — ${company.signatoryName}` : ""}</p>
          </div>
        </div>
      </div>
    </PrintShell>
  );
}
