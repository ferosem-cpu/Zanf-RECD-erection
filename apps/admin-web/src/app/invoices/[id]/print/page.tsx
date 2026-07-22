"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/apiClient";
import { formatINR, formatDate, numberToIndianWords } from "@/lib/finance";

interface LineItem { id: string; description: string; hsnCode?: string | null; quantity: string; unitPrice: string; discountPct: string; taxRatePct: string; lineTotal: string; }
interface InvoiceDetail {
  id: string; invoiceNumber: string; docType: string; status: string; issueDate: string; dueDate?: string | null;
  placeOfSupply?: string | null; subtotal: string; discountAmount: string; cgstAmount: string; sgstAmount: string; igstAmount: string; total: string;
  notes?: string | null; terms?: string | null; cancelReason?: string | null;
  customer: { id: string; name: string; gstin?: string | null; state?: string | null; address?: string | null; contacts?: { name: string; phone: string | null; email: string | null }[] };
  lineItems: LineItem[];
}
interface Company { legalName?: string | null; address?: string | null; city?: string | null; pinCode?: string | null; state?: string | null; gstin?: string | null; pan?: string | null; email?: string | null; website?: string | null; phone?: string | null; bankName?: string | null; bankAccountNumber?: string | null; bankIfsc?: string | null; bankBranch?: string | null; invoiceTerms?: string | null; documentFooterNote?: string | null; logoDataUrl?: string | null; signatoryName?: string | null; signatoryDataUrl?: string | null; }

/** "City, Pin Code" / "City" / "Pin Code" — whichever parts are set. */
function cityPinLine(company: Company | undefined): string {
  return [company?.city, company?.pinCode].filter(Boolean).join(" - ");
}

/** "email · website · phone" contact line — whichever parts are set. */
function contactLine(company: Company | undefined): string {
  return [company?.email, company?.website, company?.phone].filter(Boolean).join("  ·  ");
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

/**
 * Splits free-text terms into bullet lines. Handles both real newlines (new terms
 * typed one-per-line) and legacy single-paragraph text using " - " as an inline
 * separator (e.g. "- Point one. - Point two.") - both become one <li> each.
 */
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

function PrintShell({ children }: { children: React.ReactNode }) {
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

export default function InvoicePrintPage() {
  const { id } = useParams<{ id: string }>();
  const [inv, setInv] = useState<InvoiceDetail | null>(null);
  const [company, setCompany] = useState<Company | undefined>(undefined);
  const [termsText, setTermsText] = useState("");
  const [termsInitialized, setTermsInitialized] = useState(false);
  const [editingTerms, setEditingTerms] = useState(false);
  const [savingTerms, setSavingTerms] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api<InvoiceDetail>(`/invoices/${id}`).then(setInv).catch(() => {});
    api<Company>("/settings").then(setCompany).catch(() => {});
  }, [id]);

  // The browser's print header prints document.title (top-centre). Set it to the
  // invoice number so the printed page never shows the app name; restore on exit.
  useEffect(() => {
    if (!inv) return;
    const prev = document.title;
    document.title = inv.invoiceNumber;
    return () => { document.title = prev; };
  }, [inv]);

  // Seed the editable terms once both the invoice and company settings have loaded:
  // per-invoice terms win if set, otherwise fall back to the company default.
  useEffect(() => {
    if (termsInitialized || !inv || company === undefined) return;
    setTermsText(inv.terms ?? company?.invoiceTerms ?? "");
    setTermsInitialized(true);
  }, [inv, company, termsInitialized]);

  async function saveTerms() {
    if (!inv) return;
    setSavingTerms(true); setSaveMsg(null);
    try {
      await api(`/invoices/${inv.id}`, { method: "PUT", body: JSON.stringify({ terms: termsText }) });
      setSaveMsg("Saved to this invoice.");
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSavingTerms(false);
    }
  }

  function resetTerms() {
    setTermsText(company?.invoiceTerms ?? "");
    setSaveMsg(null);
  }

  if (!inv) return <p className="text-sm text-gray-500 p-4">Loading…</p>;
  const isCancelled = inv.status === "cancelled";

  return (
    <PrintShell>
      <div className="print:hidden mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-gray-700">Terms &amp; conditions for this invoice</p>
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
              {inv.status === "draft" && (
                <button onClick={saveTerms} disabled={savingTerms} className="btn-primary px-3 py-1 text-xs">
                  {savingTerms ? "Saving…" : "Save to this invoice"}
                </button>
              )}
              {saveMsg && <span className="text-xs text-gray-500">{saveMsg}</span>}
            </div>
            {inv.status !== "draft" && (
              <p className="text-xs text-gray-400">This invoice is no longer a draft — the edit above only changes what prints now, it isn't saved to the record.</p>
            )}
          </div>
        )}
      </div>

      <div className={`print-doc${isCancelled ? " opacity-50" : ""}`}>
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
            <div className="print-doc-title">{inv.docType === "tax_invoice" ? "TAX INVOICE" : "PROFORMA INVOICE"}</div>
            <div className="print-meta">
              <div>No. <b>{inv.invoiceNumber}</b></div>
              <div>Date: <b>{formatDate(inv.issueDate)}</b></div>
              {company?.gstin && <div>GSTIN: <b>{company.gstin}</b></div>}
              {company?.pan && <div>PAN: <b>{company.pan}</b></div>}
            </div>
          </div>
        </div>

        <div className="print-panels">
          <div className="print-panel-bill">
            <div className="print-panel-label">Bill to</div>
            <div className="name">{inv.customer.name}</div>
            <div className="addr">
              {inv.customer.address}
              {inv.placeOfSupply && <><br />{inv.placeOfSupply}</>}
            </div>
            {inv.customer.gstin && <div className="gstin">GSTIN: {inv.customer.gstin}</div>}
          </div>
          <AttnBlock contact={inv.customer.contacts?.[0]} validLabel="Due" validValue={inv.dueDate ? formatDate(inv.dueDate) : null} />
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
            {inv.lineItems.map((l, i) => (
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
            <div className="v">{numberToIndianWords(parseFloat(inv.total))}</div>
          </div>
          <div className="print-summary">
            <div className="row"><span>Subtotal</span><span>{formatINR(inv.subtotal)}</span></div>
            {parseFloat(inv.discountAmount) !== 0 && <div className="row"><span>Discount</span><span>-{formatINR(inv.discountAmount)}</span></div>}
            {parseFloat(inv.cgstAmount) !== 0 && <div className="row"><span>CGST</span><span>{formatINR(inv.cgstAmount)}</span></div>}
            {parseFloat(inv.sgstAmount) !== 0 && <div className="row"><span>SGST</span><span>{formatINR(inv.sgstAmount)}</span></div>}
            {parseFloat(inv.igstAmount) !== 0 && <div className="row"><span>IGST</span><span>{formatINR(inv.igstAmount)}</span></div>}
            <div className="row total"><span>Grand total</span><span>{formatINR(inv.total)}</span></div>
          </div>
        </div>

        <div className={`print-bank-terms${company?.bankName ? "" : " single"}`}>
          {company?.bankName && (
            <div className="print-bank">
              <div className="k">Bank details</div>
              <div className="row"><b>Bank</b><span>{company.bankName}{company.bankBranch ? ` (${company.bankBranch})` : ""}</span></div>
              <div className="row"><b>Account</b><span>{company.bankAccountNumber}</span></div>
              <div className="row"><b>IFSC</b><span>{company.bankIfsc}</span></div>
            </div>
          )}
          <div className="print-terms">
            {inv.notes && <p className="mb-1"><span className="font-semibold">Notes:</span> {inv.notes}</p>}
            <TermsBlock terms={termsText} />
          </div>
        </div>

        {isCancelled && (
          <p className="mt-4 text-red-600 font-semibold">CANCELLED{inv.cancelReason ? ` — ${inv.cancelReason}` : ""}</p>
        )}

        <div className="print-footer">
          <div className="print-footer-info">
            {company?.documentFooterNote && <div className="note">{company.documentFooterNote}</div>}
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
