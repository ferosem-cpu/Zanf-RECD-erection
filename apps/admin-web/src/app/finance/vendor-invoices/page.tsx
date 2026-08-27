"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/apiClient";
import { useAuth } from "@/components/AuthContext";
import { formatINR, formatDate, BILL_STATUS_LABEL, statusPillClass } from "@/lib/finance";
import { DataTable } from "@/components/DataTable";

interface AllocationRow {
  id: string;
  amount: string;
  site: { id: string; address: string | null; companyName: string | null } | null;
  order: { id: string; orderNumber: string; customer: { id: string; name: string } } | null;
  invoice: { id: string; invoiceNumber: string; docType: string } | null;
}
interface BillRow {
  id: string;
  billNumber: string;
  status: string;
  billDate: string;
  total: string;
  amountPaid: string;
  balance: string;
  supplier: { id: string; name: string };
  allocations: AllocationRow[];
}

function siteLabel(a: AllocationRow): string | null {
  if (!a.site) return null;
  return a.site.companyName || a.site.address || a.site.id;
}

export default function VendorInvoicesPage() {
  const { hasPermission } = useAuth();
  const canCapture = hasPermission("record_vendor_invoice") || hasPermission("approve_vendor_invoice");
  const canApprove = hasPermission("approve_vendor_invoice");

  const [rows, setRows] = useState<BillRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api<BillRow[]>("/bills").then(setRows).catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }
  useEffect(load, []);

  return (
    <div className="space-y-6 max-w-6xl" data-testid="vendor-invoices-page">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight" style={{ color: "var(--text-heading)" }}>Vendor Invoices</h1>
          <p className="mt-1 text-sm text-gray-500">Bills from suppliers and erection vendors - capture, verify, approve, and pay.</p>
        </div>
        {canCapture && (
          <Link href="/finance/vendor-invoices/new" className="btn-primary px-4 py-2 text-sm self-start sm:self-auto">+ New Vendor Invoice</Link>
        )}
      </div>

      {error && <p className="text-sm text-red-600 print:hidden">{error}</p>}
      {!canApprove && canCapture && (
        <p className="text-xs text-gray-500 print:hidden">You can capture and upload vendor invoices. Verifying and approving them is done by Finance.</p>
      )}

      <DataTable
        storageKey="vendor-invoices"
        title="Vendor Invoices"
        rows={rows}
        rowKey={(r) => r.id}
        emptyMessage="No vendor invoices yet."
        columns={[
          {
            key: "billNumber",
            label: "Bill #",
            accessor: (r) => r.billNumber,
            filterType: "text",
            alwaysVisible: true,
            render: (r) => <Link href={`/finance/vendor-invoices/${r.id}`} className="font-mono text-xs font-semibold text-[var(--theme-accent)] hover:underline">{r.billNumber}</Link>,
          },
          { key: "supplier", label: "Supplier", accessor: (r) => r.supplier.name, filterType: "text" },
          { key: "billDate", label: "Date", accessor: (r) => formatDate(r.billDate), filterType: "text" },
          { key: "total", label: "Total", accessor: (r) => r.total, filterType: "text", render: (r) => formatINR(r.total) },
          {
            key: "sites",
            label: "Sites",
            accessorList: (r) => r.allocations.map(siteLabel).filter((v): v is string => !!v),
          },
          {
            key: "customers",
            label: "Customer(s)",
            accessorList: (r) => r.allocations.map((a) => a.order?.customer.name).filter((v): v is string => !!v),
          },
          {
            key: "linkedInvoices",
            label: "Linked Invoice(s)",
            accessorList: (r) => r.allocations.map((a) => a.invoice?.invoiceNumber).filter((v): v is string => !!v),
          },
          { key: "status", label: "Status", accessor: (r) => BILL_STATUS_LABEL[r.status] ?? r.status, render: (r) => <span className={statusPillClass(r.status)}>{BILL_STATUS_LABEL[r.status] ?? r.status}</span> },
          { key: "balance", label: "Balance", accessor: (r) => r.balance, filterType: "text", render: (r) => <span className={parseFloat(r.balance) > 0 ? "font-medium text-amber-600" : "font-medium text-gray-400"}>{formatINR(r.balance)}</span> },
        ]}
      >
        {(filteredRows) => (
          <div className="cards-mobile">
            {filteredRows.length === 0 ? (
              <div className="card p-6 text-center text-sm text-gray-400">
                {rows.length === 0 ? "No vendor invoices yet." : "No rows match the current filters."}
              </div>
            ) : filteredRows.map((r) => (
              <Link key={r.id} href={`/finance/vendor-invoices/${r.id}`} className="data-card block">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <span className="font-mono text-xs font-semibold text-gray-900">{r.billNumber}</span>
                  <span className={statusPillClass(r.status)}>{BILL_STATUS_LABEL[r.status] ?? r.status}</span>
                </div>
                <p className="text-sm font-semibold text-gray-900 truncate">{r.supplier.name}</p>
                <div className="data-card-row"><span className="label">Total</span><span className="value font-semibold">{formatINR(r.total)}</span></div>
                <div className="data-card-row"><span className="label">Balance</span><span className="value">{formatINR(r.balance)}</span></div>
              </Link>
            ))}
          </div>
        )}
      </DataTable>
    </div>
  );
}
