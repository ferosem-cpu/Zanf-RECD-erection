"use client";

import { useEffect, useState } from "react";
import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import { api } from "@/lib/apiClient";
import { useAuth } from "@/components/AuthContext";
import { formatINR, formatDate } from "@/lib/finance";

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

interface Summary {
  outstandingReceivables: string;
  outstandingPayables: string;
  receivedThisMonth: string;
  overdueInvoiceCount: number;
  overdueInvoiceValue: string;
  expensesThisMonth: string;
}
interface AgingRow { customerId: string; customerName: string; outstanding: string; current: string; days0_30: string; days31_60: string; days61_90: string; days90Plus: string; }
interface Monthly { month: string; revenue: string; expenses: string; }

export default function FinanceDashboardPage() {
  const { hasPermission } = useAuth();
  const canView = hasPermission("view_finance_dashboard");

  const [summary, setSummary] = useState<Summary | null>(null);
  const [aging, setAging] = useState<AgingRow[]>([]);
  const [monthly, setMonthly] = useState<Monthly[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canView) return;
    api<Summary>("/finance/summary").then(setSummary).catch((e) => setError(e instanceof Error ? e.message : "Failed"));
    api<AgingRow[]>("/finance/reports/receivables").then(setAging).catch(() => {});
    api<Monthly[]>("/finance/reports/monthly-revenue?months=12").then(setMonthly).catch(() => {});
  }, [canView]);

  if (!canView) return <p className="text-sm text-gray-500 p-4">You don&apos;t have access to the finance dashboard.</p>;
  if (error) return <p className="text-sm text-red-600 p-4">{error}</p>;
  if (!summary) return <p className="text-sm text-gray-500 p-4">Loading…</p>;

  const chartData = {
    labels: monthly.map((m) => m.month),
    datasets: [
      { label: "Revenue", data: monthly.map((m) => parseFloat(m.revenue)), backgroundColor: "rgba(16,185,129,0.7)" },
      { label: "Expenses", data: monthly.map((m) => parseFloat(m.expenses)), backgroundColor: "rgba(239,68,68,0.6)" },
    ],
  };

  return (
    <div className="space-y-6 max-w-6xl" data-testid="finance-dashboard">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight" style={{ color: "var(--text-heading)" }}>Finance Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">Receivables, payables and cash flow at a glance.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        <Kpi label="Outstanding receivables" value={formatINR(summary.outstandingReceivables)} accent />
        <Kpi label="Outstanding payables" value={formatINR(summary.outstandingPayables)} />
        <Kpi label="Received this month" value={formatINR(summary.receivedThisMonth)} />
        <Kpi label="Expenses this month" value={formatINR(summary.expensesThisMonth)} />
        <Kpi label="Overdue invoices" value={String(summary.overdueInvoiceCount)} />
        <Kpi label="Overdue value" value={formatINR(summary.overdueInvoiceValue)} warn={summary.overdueInvoiceCount > 0} />
      </div>

      <div className="card p-4">
        <h2 className="text-sm font-semibold mb-3">Revenue vs expenses (last 12 months)</h2>
        <div className="h-64">
          <Bar data={chartData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } }} />
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b">
          <h2 className="text-sm font-semibold">Receivables aging</h2>
        </div>
        <div className="table-scroll">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3 text-right">Current</th>
                <th className="px-4 py-3 text-right">0–30</th>
                <th className="px-4 py-3 text-right">31–60</th>
                <th className="px-4 py-3 text-right">61–90</th>
                <th className="px-4 py-3 text-right">90+</th>
                <th className="px-4 py-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {aging.map((r) => (
                <tr key={r.customerId}>
                  <td className="px-4 py-3">{r.customerName}</td>
                  <td className="px-4 py-3 text-right">{formatINR(r.current)}</td>
                  <td className="px-4 py-3 text-right">{formatINR(r.days0_30)}</td>
                  <td className="px-4 py-3 text-right">{formatINR(r.days31_60)}</td>
                  <td className="px-4 py-3 text-right">{formatINR(r.days61_90)}</td>
                  <td className="px-4 py-3 text-right">{formatINR(r.days90Plus)}</td>
                  <td className="px-4 py-3 text-right font-semibold">{formatINR(r.outstanding)}</td>
                </tr>
              ))}
              {aging.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No outstanding receivables.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
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
