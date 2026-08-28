"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/apiClient";
import { useAuth } from "@/components/AuthContext";
import { downloadCsv } from "@/lib/csvExport";
import { ReportPrintHeader, ReportToolbar, useCompany } from "@/components/reports/ReportChrome";
import { formatINR, formatDate } from "@/lib/finance";

interface TdsRow {
  paymentId: string;
  date: string;
  customerId: string;
  customerName: string;
  invoiceNumbers: string[];
  grossAmount: string;
  tdsAmount: string;
  tdsCertificateRef?: string | null;
}
interface CustomerTotal { customerId: string; customerName: string; grossAmount: number; tdsAmount: number; }
interface TdsResponse {
  fiscalYear: string;
  rows: TdsRow[];
  totalsByCustomer: CustomerTotal[];
  grandTotalTds: number;
}

/** Indian fiscal years from 2024-25 up to the one containing today, newest first. */
function fiscalYearOptions(): string[] {
  const now = new Date();
  const currentStart = now.getMonth() < 3 ? now.getFullYear() - 1 : now.getFullYear();
  const years: string[] = [];
  for (let y = currentStart; y >= currentStart - 3; y--) years.push(`${y}-${String(y + 1).slice(-2)}`);
  return years;
}

export default function TdsReportPage() {
  const { hasPermission } = useAuth();
  const canView = hasPermission("view_ledgers");
  const company = useCompany();

  const options = fiscalYearOptions();
  const [fy, setFy] = useState(options[0]);
  const [data, setData] = useState<TdsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!canView) return;
    setLoading(true);
    setError(null);
    api<TdsResponse>(`/ledgers/tds?fy=${fy}`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [canView, fy]);

  if (!canView) return <p className="text-sm text-gray-500 p-4">You don&apos;t have access to this report.</p>;

  return (
    <div className="space-y-6" data-testid="tds-report-page">
      <ReportToolbar
        backHref="/finance"
        onExportCsv={
          data
            ? () =>
                downloadCsv(
                  `tds-register-${fy}`,
                  ["Date", "Customer", "Invoice(s)", "Gross", "TDS", "Certificate Ref"],
                  data.rows.map((r) => [formatDate(r.date), r.customerName, r.invoiceNumbers.join(", "), r.grossAmount, r.tdsAmount, r.tdsCertificateRef ?? ""]),
                )
            : undefined
        }
        exportDisabled={!data || data.rows.length === 0}
      />
      <ReportPrintHeader company={company} title="TDS Register" subtitle={`FY ${fy} — for 26AS reconciliation`} />

      <div className="print:hidden flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight" style={{ color: "var(--text-heading)" }}>TDS Register</h1>
          <p className="mt-1 text-sm text-gray-500">Every payment with tax deducted at source, for reconciling against Form 26AS.</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Fiscal year</label>
          <select className="field text-sm" value={fy} onChange={(e) => setFy(e.target.value)}>
            {options.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading && <p className="text-sm text-gray-500">Loading…</p>}

      {data && !loading && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 print:grid-cols-3">
            <div className="kpi-tile"><p className="text-xs text-gray-500">Payments with TDS</p><p className="text-xl font-semibold mt-1">{data.rows.length}</p></div>
            <div className="kpi-tile"><p className="text-xs text-gray-500">Customers</p><p className="text-xl font-semibold mt-1">{data.totalsByCustomer.length}</p></div>
            <div className="kpi-tile"><p className="text-xs text-gray-500">Total TDS</p><p className="text-xl font-semibold mt-1 text-[var(--theme-accent)]">{formatINR(data.grandTotalTds)}</p></div>
          </div>

          <div className="card overflow-hidden print:border-0 print:shadow-none">
            <div className="table-scroll">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 print:bg-transparent">
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Customer</th>
                    <th className="px-4 py-3">Invoice(s)</th>
                    <th className="px-4 py-3 text-right">Gross received</th>
                    <th className="px-4 py-3 text-right">TDS</th>
                    <th className="px-4 py-3">Certificate ref</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.rows.map((r) => (
                    <tr key={r.paymentId}>
                      <td className="px-4 py-3 whitespace-nowrap">{formatDate(r.date)}</td>
                      <td className="px-4 py-3">{r.customerName}</td>
                      <td className="px-4 py-3 text-gray-500 font-mono text-xs">{r.invoiceNumbers.join(", ") || "—"}</td>
                      <td className="px-4 py-3 text-right">{formatINR(r.grossAmount)}</td>
                      <td className="px-4 py-3 text-right font-semibold">{formatINR(r.tdsAmount)}</td>
                      <td className="px-4 py-3 text-gray-500">{r.tdsCertificateRef ?? "—"}</td>
                    </tr>
                  ))}
                  {data.rows.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No TDS deductions recorded for FY {fy}.</td></tr>
                  )}
                </tbody>
                {data.totalsByCustomer.length > 0 && (
                  <tfoot>
                    {data.totalsByCustomer.map((c) => (
                      <tr key={c.customerId} className="bg-gray-50 text-xs font-medium print:bg-transparent">
                        <td className="px-4 py-2" colSpan={3}>Total — {c.customerName}</td>
                        <td className="px-4 py-2 text-right">{formatINR(c.grossAmount)}</td>
                        <td className="px-4 py-2 text-right">{formatINR(c.tdsAmount)}</td>
                        <td />
                      </tr>
                    ))}
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
