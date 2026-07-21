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
  customer: { id: string; name: string; gstin?: string | null; state?: string | null; address?: string | null };
  lineItems: LineItem[];
}
interface Company { legalName?: string | null; address?: string | null; state?: string | null; gstin?: string | null; pan?: string | null; bankName?: string | null; bankAccountNumber?: string | null; bankIfsc?: string | null; bankBranch?: string | null; invoiceTerms?: string | null; logoDataUrl?: string | null; signatoryName?: string | null; signatoryDataUrl?: string | null; }

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

  useEffect(() => {
    if (!id) return;
    api<InvoiceDetail>(`/invoices/${id}`).then(setInv).catch(() => {});
    api<Company>("/settings").then(setCompany).catch(() => {});
  }, [id]);

  if (!inv) return <p className="text-sm text-gray-500 p-4">Loading…</p>;
  const isCancelled = inv.status === "cancelled";

  return (
    <PrintShell>
      <div className={isCancelled ? "opacity-50" : ""}>
        <div className="mb-6">
          {company?.logoDataUrl ? <img src={company.logoDataUrl} alt="logo" className="h-12 object-contain mb-2" /> : null}
          <h1 className="text-lg font-bold">{company?.legalName ?? "Your Company"}</h1>
          {company?.address && <p className="text-xs text-gray-600 whitespace-pre-line">{company.address}</p>}
          <div className="text-xs text-gray-600 mt-1">
            {company?.gstin && <p>GSTIN: {company.gstin}</p>}
            {company?.pan && <p>PAN: {company.pan}</p>}
          </div>
        </div>

        <div className="flex justify-between items-start mb-4">
          <div>
            <h2 className="text-xl font-bold">{inv.docType === "tax_invoice" ? "TAX INVOICE" : "PROFORMA INVOICE"}</h2>
            <p className="text-sm">{inv.invoiceNumber}</p>
            <p className="text-xs text-gray-500">Date: {formatDate(inv.issueDate)}</p>
            {inv.dueDate && <p className="text-xs text-gray-500">Due: {formatDate(inv.dueDate)}</p>}
          </div>
          <div className="text-right text-sm">
            <p className="font-semibold">{inv.customer.name}</p>
            {inv.customer.address && <p className="text-gray-600 whitespace-pre-line">{inv.customer.address}</p>}
            {inv.customer.gstin && <p className="text-xs text-gray-500">GSTIN: {inv.customer.gstin}</p>}
            {inv.placeOfSupply && <p className="text-xs text-gray-500">Place of supply: {inv.placeOfSupply}</p>}
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
            {inv.lineItems.map((l, i) => (
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

        <div className="mt-4 ml-auto w-full sm:w-72 text-sm">
          <div className="flex justify-between py-1"><span>Subtotal</span><span>{formatINR(inv.subtotal)}</span></div>
          {parseFloat(inv.discountAmount) !== 0 && <div className="flex justify-between py-1"><span>Discount</span><span>-{formatINR(inv.discountAmount)}</span></div>}
          {parseFloat(inv.cgstAmount) !== 0 && <div className="flex justify-between py-1"><span>CGST</span><span>{formatINR(inv.cgstAmount)}</span></div>}
          {parseFloat(inv.sgstAmount) !== 0 && <div className="flex justify-between py-1"><span>SGST</span><span>{formatINR(inv.sgstAmount)}</span></div>}
          {parseFloat(inv.igstAmount) !== 0 && <div className="flex justify-between py-1"><span>IGST</span><span>{formatINR(inv.igstAmount)}</span></div>}
          <div className="flex justify-between py-1 font-bold border-t border-gray-300 mt-1"><span>Total</span><span>{formatINR(inv.total)}</span></div>
          <p className="text-xs text-gray-500 mt-1">({numberToIndianWords(parseFloat(inv.total))})</p>
        </div>

        {company?.bankName && (
          <div className="text-xs text-gray-600 mt-6 border-t border-gray-200 pt-3">
            <p className="font-semibold mb-1">Bank details</p>
            <p>Bank: {company.bankName}{company.bankBranch ? ` (${company.bankBranch})` : ""}</p>
            <p>Account: {company.bankAccountNumber}</p>
            <p>IFSC: {company.bankIfsc}</p>
          </div>
        )}

        {(inv.notes || company?.invoiceTerms) && (
          <div className="text-xs text-gray-600 mt-4">
            {inv.notes && <p className="mb-1"><span className="font-semibold">Notes:</span> {inv.notes}</p>}
            {company?.invoiceTerms && <p className="mb-1"><span className="font-semibold">Terms:</span> {company.invoiceTerms}</p>}
          </div>
        )}

        {isCancelled && (
          <p className="mt-4 text-red-600 font-semibold">CANCELLED{inv.cancelReason ? ` — ${inv.cancelReason}` : ""}</p>
        )}

        <div className="mt-10 text-xs text-gray-500 text-right">
          {company?.signatoryDataUrl && <img src={company.signatoryDataUrl} alt="Signature" className="h-14 object-contain ml-auto mb-1" />}
          <p>Authorised signatory{company?.signatoryName ? ` — ${company.signatoryName}` : ""}</p>
        </div>
      </div>
    </PrintShell>
  );
}
