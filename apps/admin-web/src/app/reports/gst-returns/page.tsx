"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/apiClient";
import { useAuth } from "@/components/AuthContext";
import { downloadCsv } from "@/lib/csvExport";
import { ReportPrintHeader, ReportToolbar, useCompany } from "@/components/reports/ReportChrome";
import { formatINR, formatDate } from "@/lib/finance";

interface Gstr1B2bRow {
  invoiceNumber: string;
  invoiceDate: string;
  customerName: string;
  customerGstin: string | null;
  placeOfSupply: string | null;
  taxRatePct: string;
  taxableValue: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  invoiceValue: string;
}
interface Gstr1CdnrRow {
  noteNumber: string;
  noteDate: string;
  invoiceNumber: string;
  customerName: string;
  customerGstin: string | null;
  placeOfSupply: string | null;
  taxRatePct: string;
  taxableValue: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  noteValue: string;
}
interface Gstr1Response { b2b: Gstr1B2bRow[]; cdnr: Gstr1CdnrRow[]; }
interface Gstr3bResponse {
  outwardTaxableValue: string; outwardCgst: string; outwardSgst: string; outwardIgst: string;
  creditNoteTaxableValue: string; creditNoteCgst: string; creditNoteSgst: string; creditNoteIgst: string;
  netTaxableValue: string; netCgst: string; netSgst: string; netIgst: string; netOutputTax: string;
  eligibleItc: string;
}

interface Period { key: string; label: string; from: string; to: string; }

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Last 12 calendar months, newest first — GSTR-1 is filed monthly (or quarterly under QRMP,
 * but the month view still works for a QRMP filer checking one month within the quarter). */
function monthOptions(): Period[] {
  const now = new Date();
  const out: Period[] = [];
  for (let i = 0; i < 12; i++) {
    const from = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const to = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
    out.push({
      key: `m-${from.getFullYear()}-${from.getMonth()}`,
      label: from.toLocaleDateString("en-IN", { month: "long", year: "numeric" }),
      from: toIso(from),
      to: toIso(to),
    });
  }
  return out;
}

/** Last 8 Indian-FY-aligned quarters (Apr-Jun, Jul-Sep, Oct-Dec, Jan-Mar), newest first —
 * how GSTR-3B is filed under QRMP. */
function quarterOptions(): Period[] {
  const now = new Date();
  // FY-quarter index 0..3 starting April, for the current month.
  const fyQuarterOfMonth = (m: number) => Math.floor(((m + 9) % 12) / 3); // Jan(0)->3, Apr(3)->0
  let year = now.getFullYear();
  let q = fyQuarterOfMonth(now.getMonth());
  const out: Period[] = [];
  for (let i = 0; i < 8; i++) {
    const startMonth = (3 + q * 3) % 12; // 3=Apr, 6=Jul, 9=Oct, 0=Jan
    const startYear = startMonth === 0 ? year + 1 : year; // Jan-Mar quarter falls in the next calendar year
    const from = new Date(startYear, startMonth, 1);
    const to = new Date(startYear, startMonth + 3, 0);
    const label = `Q${q + 1} FY${String(from.getFullYear()).slice(-2)}-${String(to.getFullYear()).slice(-2)} (${from.toLocaleDateString("en-IN", { month: "short" })}-${to.toLocaleDateString("en-IN", { month: "short" })})`;
    out.push({ key: `q-${startYear}-${q}`, label, from: toIso(from), to: toIso(to) });
    q -= 1;
    if (q < 0) { q = 3; year -= 1; }
  }
  return out;
}

export default function GstReturnsPage() {
  const { hasPermission } = useAuth();
  const canView = hasPermission("view_ledgers");
  const company = useCompany();

  const [periodType, setPeriodType] = useState<"month" | "quarter">("month");
  const months = useMemo(monthOptions, []);
  const quarters = useMemo(quarterOptions, []);
  const options = periodType === "month" ? months : quarters;
  const [periodKey, setPeriodKey] = useState(options[0].key);
  const period = options.find((o) => o.key === periodKey) ?? options[0];

  const [gstr1, setGstr1] = useState<Gstr1Response | null>(null);
  const [gstr3b, setGstr3b] = useState<Gstr3bResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Switching period type resets to that type's newest option.
    const fresh = periodType === "month" ? months : quarters;
    setPeriodKey(fresh[0].key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodType]);

  useEffect(() => {
    if (!canView) return;
    setLoading(true);
    setError(null);
    Promise.all([
      api<Gstr1Response>(`/ledgers/gst/gstr1?from=${period.from}&to=${period.to}`),
      api<Gstr3bResponse>(`/ledgers/gst/gstr3b?from=${period.from}&to=${period.to}`),
    ])
      .then(([g1, g3b]) => { setGstr1(g1); setGstr3b(g3b); })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [canView, period.from, period.to]);

  if (!canView) return <p className="text-sm text-gray-500 p-4">You don&apos;t have access to this report.</p>;

  function exportB2bCsv() {
    if (!gstr1) return;
    downloadCsv(
      `gstr1-b2b-${period.from}-to-${period.to}`,
      ["Invoice No", "Invoice Date", "Customer", "GSTIN", "Place of Supply", "Rate %", "Taxable Value", "CGST", "SGST", "IGST", "Invoice Value"],
      gstr1.b2b.map((r) => [r.invoiceNumber, formatDate(r.invoiceDate), r.customerName, r.customerGstin ?? "", r.placeOfSupply ?? "", r.taxRatePct, r.taxableValue, r.cgstAmount, r.sgstAmount, r.igstAmount, r.invoiceValue]),
    );
  }
  function exportCdnrCsv() {
    if (!gstr1) return;
    downloadCsv(
      `gstr1-cdnr-${period.from}-to-${period.to}`,
      ["Note No", "Note Date", "Invoice No", "Customer", "GSTIN", "Place of Supply", "Rate %", "Taxable Value", "CGST", "SGST", "IGST", "Note Value"],
      gstr1.cdnr.map((r) => [r.noteNumber, formatDate(r.noteDate), r.invoiceNumber, r.customerName, r.customerGstin ?? "", r.placeOfSupply ?? "", r.taxRatePct, r.taxableValue, r.cgstAmount, r.sgstAmount, r.igstAmount, r.noteValue]),
    );
  }
  function exportGstr3bCsv() {
    if (!gstr3b) return;
    downloadCsv(`gstr3b-summary-${period.from}-to-${period.to}`, ["Field", "Value"], [
      ["Period", `${period.from} to ${period.to}`],
      ["Outward taxable value", gstr3b.outwardTaxableValue],
      ["Outward CGST", gstr3b.outwardCgst],
      ["Outward SGST", gstr3b.outwardSgst],
      ["Outward IGST", gstr3b.outwardIgst],
      ["Credit note taxable value", gstr3b.creditNoteTaxableValue],
      ["Credit note CGST", gstr3b.creditNoteCgst],
      ["Credit note SGST", gstr3b.creditNoteSgst],
      ["Credit note IGST", gstr3b.creditNoteIgst],
      ["Net taxable value (3.1a)", gstr3b.netTaxableValue],
      ["Net CGST", gstr3b.netCgst],
      ["Net SGST", gstr3b.netSgst],
      ["Net IGST", gstr3b.netIgst],
      ["Net output tax", gstr3b.netOutputTax],
      ["Eligible ITC (4A)", gstr3b.eligibleItc],
    ]);
  }

  return (
    <div className="space-y-6" data-testid="gst-returns-page">
      <ReportToolbar backHref="/finance" />
      <ReportPrintHeader company={company} title="GST Returns" subtitle={`${period.label} (${period.from} to ${period.to})`} />

      <div className="print:hidden flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight" style={{ color: "var(--text-heading)" }}>GST Returns</h1>
          <p className="mt-1 text-sm text-gray-500">GSTR-1 (B2B + CDNR) and a GSTR-3B summary — a filing aid, not a filing-ready return; reconcile with your CA before submission.</p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Period type</label>
            <select className="field text-sm" value={periodType} onChange={(e) => setPeriodType(e.target.value as "month" | "quarter")}>
              <option value="month">Month</option>
              <option value="quarter">Quarter</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Period</label>
            <select className="field text-sm" value={periodKey} onChange={(e) => setPeriodKey(e.target.value)}>
              {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading && <p className="text-sm text-gray-500">Loading…</p>}

      {gstr3b && !loading && (
        <div className="card p-4 space-y-3 print:border-0 print:shadow-none">
          <div className="flex items-center justify-between print:hidden">
            <h2 className="text-sm font-semibold" style={{ color: "var(--text-heading)" }}>GSTR-3B summary</h2>
            <button onClick={exportGstr3bCsv} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">Export CSV</button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 print:grid-cols-4">
            <div className="kpi-tile"><p className="text-xs text-gray-500">Net taxable value (3.1a)</p><p className="text-lg font-semibold mt-1">{formatINR(gstr3b.netTaxableValue)}</p></div>
            <div className="kpi-tile"><p className="text-xs text-gray-500">Net output tax</p><p className="text-lg font-semibold mt-1 text-[var(--theme-accent)]">{formatINR(gstr3b.netOutputTax)}</p></div>
            <div className="kpi-tile"><p className="text-xs text-gray-500">Eligible ITC (4A)</p><p className="text-lg font-semibold mt-1">{formatINR(gstr3b.eligibleItc)}</p></div>
            <div className="kpi-tile"><p className="text-xs text-gray-500">Est. net payable</p><p className="text-lg font-semibold mt-1">{formatINR((Number(gstr3b.netOutputTax) - Number(gstr3b.eligibleItc)).toFixed(2))}</p></div>
          </div>
          <div className="table-scroll">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 print:bg-transparent">
                  <th className="px-4 py-2"></th>
                  <th className="px-4 py-2 text-right">Taxable value</th>
                  <th className="px-4 py-2 text-right">CGST</th>
                  <th className="px-4 py-2 text-right">SGST</th>
                  <th className="px-4 py-2 text-right">IGST</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                <tr>
                  <td className="px-4 py-2 text-gray-500">Outward tax invoices</td>
                  <td className="px-4 py-2 text-right">{formatINR(gstr3b.outwardTaxableValue)}</td>
                  <td className="px-4 py-2 text-right">{formatINR(gstr3b.outwardCgst)}</td>
                  <td className="px-4 py-2 text-right">{formatINR(gstr3b.outwardSgst)}</td>
                  <td className="px-4 py-2 text-right">{formatINR(gstr3b.outwardIgst)}</td>
                </tr>
                <tr>
                  <td className="px-4 py-2 text-gray-500">Less: issued credit notes</td>
                  <td className="px-4 py-2 text-right">({formatINR(gstr3b.creditNoteTaxableValue)})</td>
                  <td className="px-4 py-2 text-right">({formatINR(gstr3b.creditNoteCgst)})</td>
                  <td className="px-4 py-2 text-right">({formatINR(gstr3b.creditNoteSgst)})</td>
                  <td className="px-4 py-2 text-right">({formatINR(gstr3b.creditNoteIgst)})</td>
                </tr>
                <tr className="bg-gray-50 font-semibold print:bg-transparent">
                  <td className="px-4 py-2">Net (3.1a)</td>
                  <td className="px-4 py-2 text-right">{formatINR(gstr3b.netTaxableValue)}</td>
                  <td className="px-4 py-2 text-right">{formatINR(gstr3b.netCgst)}</td>
                  <td className="px-4 py-2 text-right">{formatINR(gstr3b.netSgst)}</td>
                  <td className="px-4 py-2 text-right">{formatINR(gstr3b.netIgst)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {gstr1 && !loading && (
        <div className="card p-4 space-y-3 print:border-0 print:shadow-none">
          <div className="flex items-center justify-between print:hidden">
            <h2 className="text-sm font-semibold" style={{ color: "var(--text-heading)" }}>GSTR-1 — B2B outward supplies</h2>
            <button onClick={exportB2bCsv} disabled={gstr1.b2b.length === 0} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">Export CSV</button>
          </div>
          <div className="table-scroll">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 print:bg-transparent">
                  <th className="px-4 py-2">Invoice</th>
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2">Customer</th>
                  <th className="px-4 py-2">GSTIN</th>
                  <th className="px-4 py-2">Place of supply</th>
                  <th className="px-4 py-2 text-right">Rate</th>
                  <th className="px-4 py-2 text-right">Taxable value</th>
                  <th className="px-4 py-2 text-right">CGST</th>
                  <th className="px-4 py-2 text-right">SGST</th>
                  <th className="px-4 py-2 text-right">IGST</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {gstr1.b2b.map((r, i) => (
                  <tr key={`${r.invoiceNumber}-${r.taxRatePct}-${i}`}>
                    <td className="px-4 py-2 font-mono text-xs">{r.invoiceNumber}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{formatDate(r.invoiceDate)}</td>
                    <td className="px-4 py-2">{r.customerName}</td>
                    <td className="px-4 py-2 text-gray-500 font-mono text-xs">{r.customerGstin ?? "—"}</td>
                    <td className="px-4 py-2 text-gray-500">{r.placeOfSupply ?? "—"}</td>
                    <td className="px-4 py-2 text-right">{r.taxRatePct}%</td>
                    <td className="px-4 py-2 text-right">{formatINR(r.taxableValue)}</td>
                    <td className="px-4 py-2 text-right">{formatINR(r.cgstAmount)}</td>
                    <td className="px-4 py-2 text-right">{formatINR(r.sgstAmount)}</td>
                    <td className="px-4 py-2 text-right">{formatINR(r.igstAmount)}</td>
                  </tr>
                ))}
                {gstr1.b2b.length === 0 && (
                  <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-400">No issued tax invoices in this period.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {gstr1 && !loading && (
        <div className="card p-4 space-y-3 print:border-0 print:shadow-none">
          <div className="flex items-center justify-between print:hidden">
            <h2 className="text-sm font-semibold" style={{ color: "var(--text-heading)" }}>GSTR-1 — CDNR (issued credit notes)</h2>
            <button onClick={exportCdnrCsv} disabled={gstr1.cdnr.length === 0} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">Export CSV</button>
          </div>
          <div className="table-scroll">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 print:bg-transparent">
                  <th className="px-4 py-2">Note</th>
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2">Invoice</th>
                  <th className="px-4 py-2">Customer</th>
                  <th className="px-4 py-2">GSTIN</th>
                  <th className="px-4 py-2 text-right">Rate</th>
                  <th className="px-4 py-2 text-right">Taxable value</th>
                  <th className="px-4 py-2 text-right">CGST</th>
                  <th className="px-4 py-2 text-right">SGST</th>
                  <th className="px-4 py-2 text-right">IGST</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {gstr1.cdnr.map((r, i) => (
                  <tr key={`${r.noteNumber}-${r.taxRatePct}-${i}`}>
                    <td className="px-4 py-2 font-mono text-xs">{r.noteNumber}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{formatDate(r.noteDate)}</td>
                    <td className="px-4 py-2 font-mono text-xs text-gray-500">{r.invoiceNumber}</td>
                    <td className="px-4 py-2">{r.customerName}</td>
                    <td className="px-4 py-2 text-gray-500 font-mono text-xs">{r.customerGstin ?? "—"}</td>
                    <td className="px-4 py-2 text-right">{r.taxRatePct}%</td>
                    <td className="px-4 py-2 text-right">{formatINR(r.taxableValue)}</td>
                    <td className="px-4 py-2 text-right">{formatINR(r.cgstAmount)}</td>
                    <td className="px-4 py-2 text-right">{formatINR(r.sgstAmount)}</td>
                    <td className="px-4 py-2 text-right">{formatINR(r.igstAmount)}</td>
                  </tr>
                ))}
                {gstr1.cdnr.length === 0 && (
                  <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-400">No issued credit notes in this period.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
