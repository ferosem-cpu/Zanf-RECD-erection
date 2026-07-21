"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/apiClient";
import { formatINR, formatDate, numberToIndianWords } from "@/lib/finance";

interface LineItem { id: string; description: string; hsnCode?: string | null; quantity: string; unitPrice: string; taxRatePct: string; lineTotal: string; }
interface PoDetail {
  id: string; poNumber: string; status: string; orderDate: string; expectedDate?: string | null;
  subtotal: string; cgstAmount: string; sgstAmount: string; igstAmount: string; total: string;
  notes?: string | null; terms?: string | null;
  supplier: { id: string; name: string; gstin?: string | null; state?: string | null; address?: string | null };
  lineItems: LineItem[];
}
interface Company { legalName?: string | null; address?: string | null; state?: string | null; gstin?: string | null; pan?: string | null; logoDataUrl?: string | null; purchaseOrderTerms?: string | null; signatoryName?: string | null; signatoryDataUrl?: string | null; }

export default function PurchaseOrderPrintPage() {
  const { id } = useParams<{ id: string }>();
  const [po, setPo] = useState<PoDetail | null>(null);
  const [company, setCompany] = useState<Company | undefined>(undefined);

  useEffect(() => {
    if (!id) return;
    api<PoDetail>(`/purchase-orders/${id}`).then(setPo).catch(() => {});
    api<Company>("/settings").then(setCompany).catch(() => {});
  }, [id]);

  if (!po) return <p className="text-sm text-gray-500 p-4">Loading…</p>;

  return (
    <div className="min-h-screen bg-white p-6 sm:p-10 print:p-0">
      <div className="max-w-3xl mx-auto print:max-w-full">
        <div className="flex justify-end mb-4 print:hidden">
          <button onClick={() => window.print()} className="btn-primary px-4 py-2 text-sm">Download PDF</button>
        </div>

        <div className="mb-6">
          {company?.logoDataUrl ? <img src={company.logoDataUrl} alt="logo" className="h-12 object-contain mb-2" /> : null}
          <h1 className="text-lg font-bold">{company?.legalName ?? "Your Company"}</h1>
          {company?.address && <p className="text-xs text-gray-600 whitespace-pre-line">{company.address}</p>}
          {company?.gstin && <p className="text-xs text-gray-500">GSTIN: {company.gstin}</p>}
        </div>

        <div className="flex justify-between items-start mb-4">
          <div>
            <h2 className="text-xl font-bold">PURCHASE ORDER</h2>
            <p className="text-sm">{po.poNumber}</p>
            <p className="text-xs text-gray-500">Date: {formatDate(po.orderDate)}</p>
            {po.expectedDate && <p className="text-xs text-gray-500">Expected: {formatDate(po.expectedDate)}</p>}
          </div>
          <div className="text-right text-sm">
            <p className="font-semibold">{po.supplier.name}</p>
            {po.supplier.address && <p className="text-gray-600 whitespace-pre-line">{po.supplier.address}</p>}
            {po.supplier.gstin && <p className="text-xs text-gray-500">GSTIN: {po.supplier.gstin}</p>}
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
            {po.lineItems.map((l, i) => (
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
          <div className="flex justify-between py-1"><span>Subtotal</span><span>{formatINR(po.subtotal)}</span></div>
          {parseFloat(po.cgstAmount) !== 0 && <div className="flex justify-between py-1"><span>CGST</span><span>{formatINR(po.cgstAmount)}</span></div>}
          {parseFloat(po.sgstAmount) !== 0 && <div className="flex justify-between py-1"><span>SGST</span><span>{formatINR(po.sgstAmount)}</span></div>}
          {parseFloat(po.igstAmount) !== 0 && <div className="flex justify-between py-1"><span>IGST</span><span>{formatINR(po.igstAmount)}</span></div>}
          <div className="flex justify-between py-1 font-bold border-t border-gray-300 mt-1"><span>Total</span><span>{formatINR(po.total)}</span></div>
          <p className="text-xs text-gray-500 mt-1">({numberToIndianWords(parseFloat(po.total))})</p>
        </div>

        {(po.notes || po.terms || company?.purchaseOrderTerms) && (
          <div className="text-xs text-gray-600 mt-6">
            {po.notes && <p className="mb-1"><span className="font-semibold">Notes:</span> {po.notes}</p>}
            {(po.terms || company?.purchaseOrderTerms) && <p className="mb-1"><span className="font-semibold">Terms:</span> {po.terms || company?.purchaseOrderTerms}</p>}
          </div>
        )}

        <div className="mt-10 text-xs text-gray-500 text-right">
          {company?.signatoryDataUrl && <img src={company.signatoryDataUrl} alt="Signature" className="h-14 object-contain ml-auto mb-1" />}
          <p>Authorised signatory{company?.signatoryName ? ` — ${company.signatoryName}` : ""}</p>
        </div>
      </div>
    </div>
  );
}
