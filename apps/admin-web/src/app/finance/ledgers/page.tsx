"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/apiClient";
import { useAuth } from "@/components/AuthContext";
import { downloadCsv } from "@/lib/csvExport";
import { ReportPrintHeader, ReportToolbar, useCompany } from "@/components/reports/ReportChrome";
import { formatINR, formatDate } from "@/lib/finance";

interface Party { id: string; name: string; }
interface LedgerEntry {
  date: string;
  type: string;
  refNumber: string;
  refId: string | null;
  debit: string;
  credit: string;
  runningBalance: string;
}
interface LedgerStatement {
  partyId: string;
  partyName: string;
  openingBalance: string;
  entries: LedgerEntry[];
  closingBalance: string;
}

const TYPE_LABEL: Record<string, string> = {
  opening_balance: "Opening balance",
  invoice: "Invoice",
  payment: "Payment received",
  tds: "TDS deducted",
  credit_note: "Credit note",
  bill: "Bill",
  payment_made: "Payment made",
};

export default function LedgersPage() {
  return (
    <Suspense fallback={null}>
      <LedgersPageInner />
    </Suspense>
  );
}

function LedgersPageInner() {
  const { hasPermission } = useAuth();
  const canView = hasPermission("view_ledgers");
  const company = useCompany();
  const searchParams = useSearchParams();

  const deepLinkedCustomer = searchParams.get("customer");
  const deepLinkedSupplier = searchParams.get("supplier");

  const [partyType, setPartyType] = useState<"customer" | "supplier">(deepLinkedSupplier ? "supplier" : "customer");
  const [customers, setCustomers] = useState<Party[]>([]);
  const [suppliers, setSuppliers] = useState<Party[]>([]);
  const [partyId, setPartyId] = useState(deepLinkedCustomer || deepLinkedSupplier || "");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [statement, setStatement] = useState<LedgerStatement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [didMount, setDidMount] = useState(false);

  useEffect(() => {
    if (!canView) return;
    api<Party[]>("/customers").then(setCustomers).catch(() => {});
    api<Party[]>("/purchase-orders/suppliers").then(setSuppliers).catch(() => {});
  }, [canView]);

  // Switching party type clears the selected party (a customer id isn't a valid supplier id) -
  // but not on the very first render, which may have come in pre-selected via ?customer=/?supplier=.
  useEffect(() => {
    if (!didMount) {
      setDidMount(true);
      return;
    }
    setPartyId("");
    setStatement(null);
  }, [partyType]);

  useEffect(() => {
    if (!canView || !partyId) {
      setStatement(null);
      return;
    }
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    api<LedgerStatement>(`/ledgers/${partyType}/${partyId}?${params.toString()}`)
      .then(setStatement)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load ledger"))
      .finally(() => setLoading(false));
  }, [canView, partyType, partyId, from, to]);

  if (!canView) return <p className="text-sm text-gray-500 p-4">You don&apos;t have access to this report.</p>;

  const parties = partyType === "customer" ? customers : suppliers;
  const filterSummary = partyId
    ? `${statement?.partyName ?? ""}${from || to ? ` — ${from || "start"} to ${to || "now"}` : " — full history"}`
    : "No party selected";

  return (
    <div className="space-y-6" data-testid="ledgers-page">
      <ReportToolbar
        backHref="/finance"
        onExportCsv={
          statement
            ? () =>
                downloadCsv(
                  `${statement.partyName}-ledger`,
                  ["Date", "Particulars", "Ref", "Debit", "Credit", "Balance"],
                  statement.entries.map((e) => [
                    formatDate(e.date),
                    TYPE_LABEL[e.type] ?? e.type,
                    e.refNumber,
                    e.debit,
                    e.credit,
                    e.runningBalance,
                  ]),
                )
            : undefined
        }
        exportDisabled={!statement || statement.entries.length === 0}
      />
      <ReportPrintHeader company={company} title="Party Ledger Statement" subtitle={filterSummary} />

      <div className="print:hidden">
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight" style={{ color: "var(--text-heading)" }}>
          Ledgers
        </h1>
        <p className="mt-1 text-sm text-gray-500">Everything on record with a customer or supplier, with a running balance.</p>
      </div>

      <div className="card p-4 flex flex-wrap items-end gap-3 print:hidden">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Party</label>
          <div className="flex rounded-lg border border-gray-300 overflow-hidden text-xs">
            <button
              type="button"
              onClick={() => setPartyType("customer")}
              className={`px-3 py-1.5 font-medium ${partyType === "customer" ? "bg-[var(--theme-accent)] text-white" : "bg-white text-gray-600"}`}
            >
              Customer
            </button>
            <button
              type="button"
              onClick={() => setPartyType("supplier")}
              className={`px-3 py-1.5 font-medium ${partyType === "supplier" ? "bg-[var(--theme-accent)] text-white" : "bg-white text-gray-600"}`}
            >
              Supplier
            </button>
          </div>
        </div>
        <div className="min-w-[220px]">
          <label className="block text-xs font-medium text-gray-500 mb-1">{partyType === "customer" ? "Customer" : "Supplier"}</label>
          <select className="field text-sm w-full" value={partyId} onChange={(e) => setPartyId(e.target.value)} data-testid="ledger-party-select">
            <option value="">Choose…</option>
            {parties.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
          <input type="date" className="field text-sm py-1.5" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
          <input type="date" className="field text-sm py-1.5" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>}
      {!partyId && !error && <p className="text-sm text-gray-400">Choose a {partyType} above to see their statement.</p>}
      {loading && <p className="text-sm text-gray-500">Loading…</p>}

      {statement && !loading && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 print:grid-cols-3">
            <Kpi label="Opening balance" value={formatINR(statement.openingBalance)} />
            <Kpi label="Closing balance" value={formatINR(statement.closingBalance)} accent />
            <Kpi label="Entries" value={String(statement.entries.length)} />
          </div>

          <div className="card overflow-hidden print:border-0 print:shadow-none">
            <div className="table-scroll">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 print:bg-transparent">
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Particulars</th>
                    <th className="px-4 py-3">Ref</th>
                    <th className="px-4 py-3 text-right">Debit</th>
                    <th className="px-4 py-3 text-right">Credit</th>
                    <th className="px-4 py-3 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {statement.entries.map((e, i) => (
                    <tr key={`${e.type}-${e.refId ?? i}`}>
                      <td className="px-4 py-3 whitespace-nowrap">{formatDate(e.date)}</td>
                      <td className="px-4 py-3">{TYPE_LABEL[e.type] ?? e.type}</td>
                      <td className="px-4 py-3 text-gray-500">{e.refNumber}</td>
                      <td className="px-4 py-3 text-right">{Number(e.debit) > 0 ? formatINR(e.debit) : ""}</td>
                      <td className="px-4 py-3 text-right">{Number(e.credit) > 0 ? formatINR(e.credit) : ""}</td>
                      <td className="px-4 py-3 text-right font-semibold">{formatINR(e.runningBalance)}</td>
                    </tr>
                  ))}
                  {statement.entries.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No activity in this range.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="kpi-tile">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-xl font-semibold mt-1 ${accent ? "text-[var(--theme-accent)]" : "text-gray-900"}`}>{value}</p>
    </div>
  );
}
