"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/apiClient";
import { useAuth } from "@/components/AuthContext";
import { downloadCsv } from "@/lib/csvExport";
import { ReportPrintHeader, ReportToolbar, useCompany } from "@/components/reports/ReportChrome";
import { formatINR } from "@/lib/finance";

interface Summary {
  outstandingReceivables: string;
  outstandingPayables: string;
  receivedThisMonth: string;
  overdueInvoiceCount: number;
  overdueInvoiceValue: string;
  expensesThisMonth: string;
}
interface AgingRow { customerId?: string; supplierId?: string; customerName?: string; supplierName?: string; outstanding: string; current: string; days0_30: string; days31_60: string; days61_90: string; days90Plus: string; }
interface GstRow { month: string; taxableValue: string; cgst: string; sgst: string; igst: string; }
interface MonthlyRow { month: string; revenue: string; expenses: string; }

function ExportButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg border border-gray-300 px-2.5 py-1 text-[0.6875rem] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed print:hidden"
    >
      Export CSV
    </button>
  );
}

export default function FinanceSummaryReportPage() {
  const { hasPermission } = useAuth();
  const canView = hasPermission("view_finance_dashboard");
  const company = useCompany();

  const [summary, setSummary] = useState<Summary | null>(null);
  const [receivables, setReceivables] = useState<AgingRow[]>([]);
  const [payables, setPayables] = useState<AgingRow[]>([]);
  const [gst, setGst] = useState<GstRow[]>([]);
  const [monthly, setMonthly] = useState<MonthlyRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    if (!canView) return;
    api<Summary>("/finance/summary").then(setSummary).catch((e) => setError(e instanceof Error ? e.message : "Failed"));
    api<AgingRow[]>("/finance/reports/receivables").then(setReceivables).catch(() => {});
    api<AgingRow[]>("/finance/reports/payables").then(setPayables).catch(() => {});
    api<MonthlyRow[]>("/finance/reports/monthly-revenue?months=12").then(setMonthly).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView]);

  useEffect(() => {
    if (!canView) return;
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    api<GstRow[]>(`/finance/reports/gst-summary?${params.toString()}`).then(setGst).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, from, to]);

  if (!canView) return <p className="text-sm text-gray-500 p-4">You don&apos;t have access to this report.</p>;
  if (error) return <p className="text-sm text-red-600 p-4">{error}</p>;
  if (!summary) return <p className="text-sm text-gray-500 p-4">Loading…</p>;

  const filterSummary = (from || to) ? `GST summary: ${from || "start"} to ${to || "now"}` : "GST summary: all time";

  return (
    <div className="space-y-6" data-testid="finance-report-page">
      <ReportToolbar />
      <ReportPrintHeader company={company} title="Finance Summary Report" subtitle={filterSummary} />

      <div className="print:hidden">
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight" style={{ color: "var(--text-heading)" }}>
          Finance summary
        </h1>
        <p className="mt-1 text-sm text-gray-500">Receivables, payables, GST and cash flow — printable snapshot.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 print:grid-cols-3">
        <Kpi label="Outstanding receivables" value={formatINR(summary.outstandingReceivables)} accent />
        <Kpi label="Outstanding payables" value={formatINR(summary.outstandingPayables)} />
        <Kpi label="Received this month" value={formatINR(summary.receivedThisMonth)} />
        <Kpi label="Expenses this month" value={formatINR(summary.expensesThisMonth)} />
        <Kpi label="Overdue invoices" value={String(summary.overdueInvoiceCount)} />
        <Kpi label="Overdue value" value={formatINR(summary.overdueInvoiceValue)} warn={summary.overdueInvoiceCount > 0} />
      </div>

      <Section
        title="Receivables aging"
        onExport={() => downloadCsv("receivables-aging", ["Customer", "Current", "0-30", "31-60", "61-90", "90+", "Total"], receivables.map((r) => [r.customerName ?? "", r.current, r.days0_30, r.days31_60, r.days61_90, r.days90Plus, r.outstanding]))}
        exportDisabled={receivables.length === 0}
      >
        <AgingTable rows={receivables} nameKey="customerName" emptyLabel="No outstanding receivables." />
      </Section>

      <Section
        title="Payables aging"
        onExport={() => downloadCsv("payables-aging", ["Supplier", "Current", "0-30", "31-60", "61-90", "90+", "Total"], payables.map((r) => [r.supplierName ?? "", r.current, r.days0_30, r.days31_60, r.days61_90, r.days90Plus, r.outstanding]))}
        exportDisabled={payables.length === 0}
      >
        <AgingTable rows={payables} nameKey="supplierName" emptyLabel="No outstanding payables." />
      </Section>

      <div className="card overflow-hidden print:border-0 print:shadow-none">
        <div className="px-4 py-3 border-b flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-sm font-semibold">GST summary (by month)</h2>
          <div className="flex items-center gap-2 print:hidden">
            <input type="date" className="field text-xs py-1" value={from} onChange={(e) => setFrom(e.target.value)} />
            <span className="text-xs text-gray-400">to</span>
            <input type="date" className="field text-xs py-1" value={to} onChange={(e) => setTo(e.target.value)} />
            <ExportButton
              disabled={gst.length === 0}
              onClick={() => downloadCsv("gst-summary", ["Month", "Taxable value", "CGST", "SGST", "IGST"], gst.map((r) => [r.month, r.taxableValue, r.cgst, r.sgst, r.igst]))}
            />
          </div>
        </div>
        <div className="table-scroll">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 print:bg-transparent">
                <th className="px-4 py-3">Month</th>
                <th className="px-4 py-3 text-right">Taxable value</th>
                <th className="px-4 py-3 text-right">CGST</th>
                <th className="px-4 py-3 text-right">SGST</th>
                <th className="px-4 py-3 text-right">IGST</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {gst.map((r) => (
                <tr key={r.month}>
                  <td className="px-4 py-3">{r.month}</td>
                  <td className="px-4 py-3 text-right">{formatINR(r.taxableValue)}</td>
                  <td className="px-4 py-3 text-right">{formatINR(r.cgst)}</td>
                  <td className="px-4 py-3 text-right">{formatINR(r.sgst)}</td>
                  <td className="px-4 py-3 text-right">{formatINR(r.igst)}</td>
                </tr>
              ))}
              {gst.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No GST activity in this range.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <Section
        title="Revenue vs. expenses (last 12 months)"
        onExport={() => downloadCsv("monthly-revenue", ["Month", "Revenue", "Expenses"], monthly.map((r) => [r.month, r.revenue, r.expenses]))}
        exportDisabled={monthly.length === 0}
      >
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 print:bg-transparent">
              <th className="px-4 py-3">Month</th>
              <th className="px-4 py-3 text-right">Revenue</th>
              <th className="px-4 py-3 text-right">Expenses</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {monthly.map((r) => (
              <tr key={r.month}>
                <td className="px-4 py-3">{r.month}</td>
                <td className="px-4 py-3 text-right">{formatINR(r.revenue)}</td>
                <td className="px-4 py-3 text-right">{formatINR(r.expenses)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  );
}

function Section({ title, onExport, exportDisabled, children }: { title: string; onExport: () => void; exportDisabled?: boolean; children: React.ReactNode }) {
  return (
    <div className="card overflow-hidden print:border-0 print:shadow-none print:break-inside-avoid">
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <h2 className="text-sm font-semibold">{title}</h2>
        <ExportButton onClick={onExport} disabled={exportDisabled} />
      </div>
      <div className="table-scroll">{children}</div>
    </div>
  );
}

function AgingTable({ rows, nameKey, emptyLabel }: { rows: AgingRow[]; nameKey: "customerName" | "supplierName"; emptyLabel: string }) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 print:bg-transparent">
          <th className="px-4 py-3">{nameKey === "customerName" ? "Customer" : "Supplier"}</th>
          <th className="px-4 py-3 text-right">Current</th>
          <th className="px-4 py-3 text-right">0–30</th>
          <th className="px-4 py-3 text-right">31–60</th>
          <th className="px-4 py-3 text-right">61–90</th>
          <th className="px-4 py-3 text-right">90+</th>
          <th className="px-4 py-3 text-right">Total</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {rows.map((r, i) => (
          <tr key={r.customerId ?? r.supplierId ?? i}>
            <td className="px-4 py-3">{r[nameKey]}</td>
            <td className="px-4 py-3 text-right">{formatINR(r.current)}</td>
            <td className="px-4 py-3 text-right">{formatINR(r.days0_30)}</td>
            <td className="px-4 py-3 text-right">{formatINR(r.days31_60)}</td>
            <td className="px-4 py-3 text-right">{formatINR(r.days61_90)}</td>
            <td className="px-4 py-3 text-right">{formatINR(r.days90Plus)}</td>
            <td className="px-4 py-3 text-right font-semibold">{formatINR(r.outstanding)}</td>
          </tr>
        ))}
        {rows.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">{emptyLabel}</td></tr>}
      </tbody>
    </table>
  );
}

function Kpi({ label, value, accent, warn }: { label: string; value: string; accent?: boolean; warn?: boolean }) {
  const cls = warn ? "text-red-600" : accent ? "text-[var(--theme-accent)]" : "text-gray-900";
  return (
    <div className="kpi-tile">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-xl font-semibold mt-1 ${cls}`}>{value}</p>
    </div>
  );
}
